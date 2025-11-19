# VSCode Go Test Runner Plugin - Development Plan

## Executive Summary
Build a modern VSCode extension for running Go tests with configurable test profiles, grouped test results by package, and individual test output visualization. This plugin addresses the unmaintained GoTestExplorer by using modern VSCode APIs and dependencies.

---

## Architecture Overview

### Core Components

1. **Extension Entry Point** (`extension.ts`)
   - Activate on workspace containing Go files
   - Register commands, tree views, and configuration
   - Initialize test controller

2. **Test Controller** (VSCode Testing API)
   - Use VSCode's native Testing API (available since VSCode 1.59)
   - Replaces custom TreeView implementation
   - Provides built-in UI for test results

3. **Test Discovery Engine**
   - Scan workspace for `*_test.go` files
   - Parse test functions using `go list -json` and AST parsing
   - Group tests by package
   - Watch for file changes

4. **Test Runner**
   - Execute `go test` with configurable flags and env vars (including `-p` and `-parallel`)
   - Parse JSON output (`go test -json`) to track per-package and per-test results
   - Stream results in real-time from parallel execution
   - Support multiple test configurations
   - Run entire repo tests in parallel while maintaining granular result tracking

5. **Configuration Manager**
   - Store multiple test profiles
   - Manage testFlags and testEnvVars per profile
   - Profile selector UI

6. **Output Parser**
   - Parse `go test -json` output
   - Extract individual test results
   - Parse stack traces for navigation

---

## Key Features Implementation

### 1. Configurable Test Profiles

**Configuration Structure:**
```json
{
  "goTestRunner.profiles": [
    {
      "name": "Default",
      "testFlags": ["-v", "-race", "-p=4", "-parallel=8"],
      "testEnvVars": {
        "GO_ENV": "test"
      }
    },
    {
      "name": "Integration",
      "testFlags": ["-v", "-tags=integration", "-timeout=30m", "-p=2"],
      "testEnvVars": {
        "DATABASE_URL": "postgres://localhost/testdb"
      }
    },
    {
      "name": "Fast",
      "testFlags": ["-v", "-p=8", "-parallel=16"],
      "testEnvVars": {}
    }
  ],
  "goTestRunner.defaultProfile": "Default"
}
```

**Parallel Execution Strategy:**
- `-p` flag: Number of packages to build and test in parallel (default: number of CPUs)
- `-parallel` flag: Number of tests to run in parallel within each package (default: GOMAXPROCS)
- Run entire repo with: `go test -json -p=4 -parallel=8 ./...`
- Parse JSON output to track results per package and per test

**Implementation:**
- Configuration reader in `src/config/profileManager.ts`
- UI command to switch profiles
- Status bar item showing active profile
- Quick pick menu for profile selection

### 2. Test Discovery & Grouping by Package

**Implementation Strategy:**
```typescript
// Use go list to discover packages
const packages = await exec('go list -json ./...');

// For each package, discover tests
const tests = await exec('go test -list . -json');

// Build test tree:
// Workspace
//   └── Package: github.com/user/project/pkg1
//       ├── TestFunctionA
//       └── TestFunctionB
//   └── Package: github.com/user/project/pkg2
//       ├── TestFunctionC
//       └── TestFunctionD
```

**File Structure:**
- `src/discovery/testDiscovery.ts` - Main discovery logic
- `src/discovery/packageScanner.ts` - Scan for Go packages
- `src/discovery/testParser.ts` - Parse test functions
- `src/models/testItem.ts` - Test item data model

### 3. Individual Test Results Display

**VSCode Testing API Benefits:**
- Built-in test result UI
- Per-test status (passed/failed/skipped)
- Duration tracking
- Output per test
- Error messages with diff view

**Implementation:**
```typescript
// Create test items
const testItem = controller.createTestItem(id, label, uri);

// Run tests and update results
testRun.passed(testItem);
testRun.failed(testItem, new vscode.TestMessage(error));
testRun.appendOutput(output);
```

### 4. Stack Trace Navigation (Optional)

**Implementation:**
- Parse error output for file:line patterns
- Create clickable links in test output
- Use `vscode.TextDocumentShowOptions` to jump to location

**Regex Pattern:**
```typescript
// Match Go stack trace format
const stackTraceRegex = /^\s+([^\s]+):(\d+)/;
```

---

## Parallel Test Execution Architecture

### Execution Model

**Single Command for Entire Repo:**
```bash
go test -json -p=4 -parallel=8 ./...
```

**Advantages:**
- ✅ Faster execution (packages build/run in parallel)
- ✅ Better resource utilization
- ✅ Single process to manage
- ✅ Consistent with how developers run tests locally
- ✅ Go handles all parallelization logic

**JSON Output Demultiplexing:**
```typescript
// go test -json produces interleaved events from all packages
// Each event has a Package field for routing

class ParallelTestRunner {
  private packageStates = new Map<string, PackageState>();
  private testStates = new Map<string, TestState>();

  handleEvent(event: TestEvent) {
    const key = `${event.Package}/${event.Test || ''}`;
    
    switch (event.Action) {
      case 'run':
        // Test started
        this.updateTestUI(key, 'running');
        break;
      case 'pass':
        // Test passed
        this.updateTestUI(key, 'passed', event.Elapsed);
        break;
      case 'fail':
        // Test failed
        this.updateTestUI(key, 'failed', event.Elapsed);
        break;
      case 'output':
        // Accumulate output for specific test
        this.appendOutput(key, event.Output);
        break;
    }
  }
}
```

### JSON Event Format

**Example Stream:**
```json
{"Time":"2024-01-01T10:00:00Z","Action":"run","Package":"github.com/user/pkg1"}
{"Time":"2024-01-01T10:00:00Z","Action":"run","Package":"github.com/user/pkg2"}
{"Time":"2024-01-01T10:00:01Z","Action":"run","Package":"github.com/user/pkg1","Test":"TestA"}
{"Time":"2024-01-01T10:00:01Z","Action":"run","Package":"github.com/user/pkg2","Test":"TestB"}
{"Time":"2024-01-01T10:00:01Z","Action":"output","Package":"github.com/user/pkg1","Test":"TestA","Output":"=== RUN   TestA\n"}
{"Time":"2024-01-01T10:00:02Z","Action":"pass","Package":"github.com/user/pkg1","Test":"TestA","Elapsed":1.2}
{"Time":"2024-01-01T10:00:03Z","Action":"fail","Package":"github.com/user/pkg2","Test":"TestB","Elapsed":2.1}
```

### Implementation Details

**File: `src/runner/parallelTestRunner.ts`**
```typescript
export class ParallelTestRunner {
  async runAllTests(profile: TestProfile): Promise<void> {
    const flags = ['-json', ...profile.testFlags];
    const cmd = `go test ${flags.join(' ')} ./...`;
    
    const proc = spawn('go', ['test', '-json', ...profile.testFlags, './...'], {
      cwd: workspaceRoot,
      env: { ...process.env, ...profile.testEnvVars }
    });

    // Stream parser handles line-by-line JSON
    const parser = new JSONStreamParser();
    
    proc.stdout.on('data', (chunk) => {
      const events = parser.parse(chunk.toString());
      events.forEach(event => this.handleTestEvent(event));
    });
  }

  private handleTestEvent(event: TestEvent) {
    // Route event to correct test item in VSCode UI
    const testItem = this.findTestItem(event.Package, event.Test);
    
    if (!testItem) return;
    
    switch (event.Action) {
      case 'run':
        this.currentRun.started(testItem);
        break;
      case 'pass':
        this.currentRun.passed(testItem, event.Elapsed * 1000);
        break;
      case 'fail':
        const message = this.collectFailureOutput(event);
        this.currentRun.failed(testItem, message, event.Elapsed * 1000);
        break;
      case 'output':
        this.currentRun.appendOutput(event.Output);
        break;
    }
  }
}
```

### Configuration Options

```json
{
  "goTestRunner.parallelPackages": {
    "type": "number",
    "default": 0,
    "description": "Number of packages to test in parallel (0 = auto-detect CPUs)"
  },
  "goTestRunner.parallelTests": {
    "type": "number", 
    "default": 0,
    "description": "Number of tests to run in parallel per package (0 = GOMAXPROCS)"
  }
}
```

### User Experience

**Running Tests:**
1. User clicks "Run All Tests" 
2. Extension executes: `go test -json -p=4 -parallel=8 ./...`
3. JSON events stream in (interleaved from multiple packages)
4. UI updates in real-time:
   - Package "pkg1": TestA ✅ (1.2s)
   - Package "pkg2": TestB ❌ (2.1s)
   - Package "pkg1": TestC ✅ (0.8s)
5. Total execution time: ~3s (instead of ~6s if sequential)

**Benefits:**
- User sees same familiar test tree UI
- Tests run significantly faster
- Progress updates in real-time across all packages
- Can still click on individual test to see its output

---

## Technical Stack

### Dependencies
```json
{
  "engines": {
    "vscode": "^1.75.0"
  },
  "devDependencies": {
    "@types/node": "^18.x",
    "@types/vscode": "^1.75.0",
    "@typescript-eslint/eslint-plugin": "^6.x",
    "@typescript-eslint/parser": "^6.x",
    "eslint": "^8.x",
    "typescript": "^5.x",
    "@vscode/test-electron": "^2.3.x"
  }
}
```

**Why These Versions:**
- VSCode 1.75+ for stable Testing API
- TypeScript 5.x for modern language features
- No dependency on deprecated packages (vscode, go-outline)
- ESLint instead of deprecated TSLint

### VSCode APIs Used
- **Testing API** (`vscode.tests`) - Core test management
- **File System Watcher** - Detect test file changes
- **Output Channel** - Display detailed logs
- **Status Bar** - Show active profile
- **Quick Pick** - Profile selection
- **Terminal** - Optional test execution view

---

## Project Structure

```
go-test-runner/
├── src/
│   ├── extension.ts              # Extension entry point
│   ├── testController.ts         # Main test controller
│   ├── config/
│   │   ├── profileManager.ts     # Test profile management
│   │   └── configuration.ts      # Config reader/writer
│   ├── discovery/
│   │   ├── testDiscovery.ts      # Test discovery orchestrator
│   │   ├── packageScanner.ts     # Go package scanner
│   │   ├── testParser.ts         # Test function parser
│   │   └── fileWatcher.ts        # Watch for changes
│   ├── runner/
│   │   ├── parallelTestRunner.ts  # Execute go test with -p/-parallel
│   │   ├── testRunner.ts          # Test execution coordinator
│   │   ├── outputParser.ts        # Parse go test -json
│   │   ├── jsonStreamParser.ts    # Stream JSON event parser
│   │   ├── eventDemux.ts          # Demultiplex events by package
│   │   └── processManager.ts      # Manage test processes
│   ├── ui/
│   │   ├── profilePicker.ts      # Profile selection UI
│   │   ├── statusBar.ts          # Status bar integration
│   │   └── outputDecorator.ts    # Stack trace links
│   ├── models/
│   │   ├── testItem.ts           # Test item model
│   │   ├── testProfile.ts        # Profile model
│   │   └── testResult.ts         # Result model
│   └── utils/
│       ├── goTools.ts            # Go CLI utilities
│       ├── logger.ts             # Logging utility
│       └── pathUtils.ts          # Path manipulation
├── resources/
│   └── icons/                    # Extension icons
├── package.json                  # Extension manifest
├── tsconfig.json                 # TypeScript config
├── .eslintrc.json               # ESLint config
├── .vscodeignore                # Package exclusions
└── README.md                     # Documentation
```

---

## Implementation Phases

### Phase 1: Project Setup & Core Infrastructure (Week 1)
**Tasks:**
- [x] Initialize TypeScript project with modern tooling
- [x] Set up VSCode extension boilerplate
- [x] Configure build system (esbuild for faster builds)
- [x] Implement configuration management
- [x] Create basic test controller with Testing API

**Deliverable:** Extension activates and registers in VSCode

### Phase 2: Test Discovery (Week 2)
**Tasks:**
- [x] Implement package scanner using `go list`
- [x] Parse test functions from files
- [x] Build test hierarchy (workspace → package → test)
- [x] Create file watcher for auto-discovery
- [x] Handle edge cases (build tags, sub-packages)

**Deliverable:** Tests appear in VSCode Testing view, grouped by package

### Phase 3: Test Execution with Parallel Support (Week 3)
**Tasks:**
- [x] Implement test runner with `go test -json -p=N -parallel=M ./...`
- [x] Parse JSON output in real-time from parallel execution
- [x] Demultiplex test events by package using JSON `Package` field
- [x] Update test results in UI as events stream in
- [x] Handle test timeouts and cancellation
- [x] Support running individual tests, packages, or all tests in parallel

**Parallel Execution Implementation:**
```typescript
// Single command runs entire repo in parallel
const command = `go test -json -p=4 -parallel=8 ${flags.join(' ')} ./...`;

// JSON output contains Package field for demultiplexing
// Example events:
// {"Time":"...", "Action":"run", "Package":"pkg1", "Test":"TestA"}
// {"Time":"...", "Action":"run", "Package":"pkg2", "Test":"TestB"}
// {"Time":"...", "Action":"pass", "Package":"pkg1", "Test":"TestA"}

// Parser maintains state per package and per test
interface TestEvent {
  Package: string;
  Test?: string;
  Action: 'run' | 'pass' | 'fail' | 'skip' | 'output';
  Output?: string;
  Elapsed?: number;
}
```

**Deliverable:** Can run all tests in parallel and see pass/fail status per test

### Phase 4: Test Profiles (Week 4)
**Tasks:**
- [x] Implement profile manager
- [x] Create profile picker UI
- [x] Add status bar integration
- [x] Support custom flags and environment variables
- [x] Profile persistence and validation

**Deliverable:** Can switch between test profiles with different configs

### Phase 5: Output & Navigation (Week 5)
**Tasks:**
- [x] Display per-test output in Testing view
- [x] Parse and linkify stack traces
- [x] Implement "Go to Test" navigation
- [x] Add output filtering options
- [x] Support coverage visualization (optional)

**Deliverable:** Full test output with clickable stack traces

### Phase 6: Polish & Testing (Week 6)
**Tasks:**
- [x] Write unit tests for core components
- [x] Integration testing with sample Go projects
- [x] Performance optimization for large workspaces
- [x] Documentation and README
- [x] Package for marketplace

**Deliverable:** Production-ready extension

---

## Configuration Schema

```json
{
  "contributes": {
    "configuration": {
      "title": "Go Test Runner",
      "properties": {
        "goTestRunner.profiles": {
          "type": "array",
          "description": "Test execution profiles",
          "items": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string",
                "description": "Profile name"
              },
              "testFlags": {
                "type": "array",
                "description": "Flags passed to go test",
                "items": { "type": "string" }
              },
              "testEnvVars": {
                "type": "object",
                "description": "Environment variables",
                "additionalProperties": { "type": "string" }
              }
            }
          }
        },
        "goTestRunner.defaultProfile": {
          "type": "string",
          "default": "Default",
          "description": "Default profile name"
        },
        "goTestRunner.autoDiscover": {
          "type": "boolean",
          "default": true,
          "description": "Automatically discover tests on file changes"
        },
        "goTestRunner.excludePatterns": {
          "type": "array",
          "items": { "type": "string" },
          "default": ["vendor", "node_modules"],
          "description": "Folders to exclude from test discovery"
        }
      }
    }
  }
}
```

---

## Commands

```json
{
  "contributes": {
    "commands": [
      {
        "command": "goTestRunner.selectProfile",
        "title": "Go Test: Select Profile",
        "icon": "$(settings-gear)"
      },
      {
        "command": "goTestRunner.refreshTests",
        "title": "Go Test: Refresh Tests",
        "icon": "$(refresh)"
      },
      {
        "command": "goTestRunner.runAllTests",
        "title": "Go Test: Run All Tests",
        "icon": "$(run-all)"
      },
      {
        "command": "goTestRunner.editProfiles",
        "title": "Go Test: Edit Profiles"
      },
      {
        "command": "goTestRunner.showOutput",
        "title": "Go Test: Show Output"
      }
    ]
  }
}
```

---

## Key Differences from GoTestExplorer

### Problems with Original
1. **Deprecated Dependencies**: Uses old `vscode` package and `go-outline`
2. **Custom Tree View**: Reinvents testing UI
3. **Limited Configuration**: No test profiles
4. **Poor Output Handling**: Shows output in message box
5. **No JSON Parsing**: Relies on text parsing of test output
6. **Sequential Execution**: Runs tests one package at a time (slow)

### Our Modern Approach
1. **VSCode Testing API**: Native test management with built-in UI
2. **Go Test JSON**: Structured output parsing with `go test -json`
3. **No External Tools**: Direct Go CLI usage, no go-outline dependency
4. **Multiple Profiles**: Flexible test configurations with `-p` and `-parallel` support
5. **Real-time Updates**: Stream test results as they run from parallel execution
6. **Parallel Execution**: Run entire repo with `-p` and `-parallel` flags, track per-package/per-test
7. **Better Performance**: Efficient package scanning + parallel test execution
8. **JSON Demultiplexing**: Handle interleaved test events from multiple packages

---

## Testing Strategy

### Unit Tests
- Config manager logic
- Output parser with sample JSON
- Path utilities
- Profile validation

### Integration Tests
- Test discovery in sample projects
- Full test execution flow
- Profile switching
- File watching

### Manual Testing Scenarios
- Large workspace (100+ packages) with parallel execution
- Nested packages with build tags
- Tests with custom flags (-race, -cover, -p, -parallel)
- Concurrent test execution across multiple packages
- Error handling (no Go installed, invalid workspace)
- Stress test: 1000+ tests running in parallel

---

## Deployment

### Packaging
```bash
npm install -g @vscode/vsce
vsce package
```

### Publishing
```bash
vsce publish
```

### Marketplace Requirements
- README with screenshots
- Animated GIF demo
- Changelog
- License (MIT recommended)
- Repository link

---

## Future Enhancements (Post-MVP)

1. **Code Coverage Integration**
   - Visual coverage gutters
   - Coverage reports

2. **Benchmark Support**
   - Run and visualize benchmarks
   - Compare benchmark results

3. **Test Generation**
   - Generate test stubs
   - Table-driven test templates

4. **Remote Testing**
   - SSH test execution
   - Container-based testing

5. **Test History**
   - Track test results over time
   - Flaky test detection

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Testing API changes | High | Pin VSCode version, monitor changelog |
| Go CLI breaking changes | Medium | Version detection, fallback strategies |
| Large workspace performance | High | Lazy loading, configurable limits |
| Platform compatibility | Medium | Test on Windows, macOS, Linux |
| User adoption | Medium | Clear docs, migration guide from GoTestExplorer |

---

## Success Criteria

- ✅ Tests discovered and grouped by package
- ✅ Multiple test profiles with flags/env vars
- ✅ Individual test results visible
- ✅ Stack trace navigation working
- ✅ Works on workspaces with 100+ packages
- ✅ No dependency on deprecated packages
- ✅ Installation < 5 seconds
- ✅ Test execution starts < 1 second after click

---

## Resources

- [VSCode Testing API](https://code.visualstudio.com/api/extensioen-guides/testing)
- [Go test JSON format](https://pkg.go.dev/cmd/test2json)
- [VSCode Extension Samples](https://github.com/microsoft/vscode-extension-samples)
- [Go testing package](https://pkg.go.dev/testing)

---

## Timeline Summary

- **Week 1-2**: Setup + Discovery = Tests visible in UI
- **Week 3-4**: Execution + Profiles = Tests runnable with configs
- **Week 5-6**: Polish + Testing = Production ready

**Total Estimate**: 6 weeks for full implementation

---

## Getting Started Checklist

- [ ] Set up development environment
- [ ] Create GitHub repository
- [ ] Initialize npm project with TypeScript
- [ ] Install VSCode extension dependencies
- [ ] Create basic extension scaffold
- [ ] Implement minimal test controller
- [ ] Test extension loading in VSCode
- [ ] Begin Phase 1 implementation


---

## Parallel Execution Flow Diagram

```
User clicks "Run All Tests"
         |
         v
┌─────────────────────────────────────────────────────┐
│  Extension: Select Active Profile                   │
│  Flags: ["-v", "-race", "-p=4", "-parallel=8"]      │
└─────────────────────┬───────────────────────────────┘
                      |
                      v
┌─────────────────────────────────────────────────────┐
│  Execute Single Command:                             │
│  go test -json -v -race -p=4 -parallel=8 ./...      │
└─────────────────────┬───────────────────────────────┘
                      |
                      v
         ┌────────────┴────────────┐
         |   Stdout (JSON Stream)  |
         └────────────┬────────────┘
                      |
                      v
         ┌────────────────────────┐
         │  JSON Stream Parser    │
         │  (Line-by-line)        │
         └────────┬───────────────┘
                  |
    ┌─────────────┼─────────────┐
    |             |             |
    v             v             v
┌────────┐  ┌────────┐  ┌────────┐
│ Event  │  │ Event  │  │ Event  │
│ pkg1   │  │ pkg2   │  │ pkg1   │
│ TestA  │  │ TestB  │  │ TestC  │
└───┬────┘  └───┬────┘  └───┬────┘
    |           |           |
    └───────────┼───────────┘
                |
                v
    ┌───────────────────────┐
    │  Event Demultiplexer  │
    │  Routes by Package +  │
    │  Test name            │
    └───────────┬───────────┘
                |
    ┌───────────┼───────────┐
    |           |           |
    v           v           v
┌────────┐  ┌────────┐  ┌────────┐
│VSCode  │  │VSCode  │  │VSCode  │
│TestItem│  │TestItem│  │TestItem│
│pkg1/A  │  │pkg2/B  │  │pkg1/C  │
│✅ 1.2s │  │❌ 2.1s │  │✅ 0.8s │
└────────┘  └────────┘  └────────┘

Result: All tests run in parallel, UI updates in real-time
Total Time: ~3s (vs ~6s sequential)
```

### Example Timeline

```
Time  Package     Test        Action     
─────────────────────────────────────────
0.0s  pkg1        -           run
0.0s  pkg2        -           run
0.1s  pkg1        TestA       run
0.1s  pkg2        TestB       run
0.2s  pkg1        TestA       output
0.3s  pkg2        TestB       output
1.2s  pkg1        TestA       pass ✅
1.5s  pkg1        TestC       run
2.1s  pkg2        TestB       fail ❌
2.3s  pkg1        TestC       pass ✅
3.0s  DONE (2 packages, 3 tests, 1 failure)
```

---

