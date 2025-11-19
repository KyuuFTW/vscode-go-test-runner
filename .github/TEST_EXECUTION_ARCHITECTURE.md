# Test Execution Architecture

This document provides comprehensive context on how the Go Test Runner extension executes tests, manages output, and integrates with VS Code's Test Explorer.

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Test Discovery & Structure](#test-discovery--structure)
3. [Test Execution Flow](#test-execution-flow)
4. [Output Channels & Results](#output-channels--results)
5. [VS Code Test Explorer Integration](#vs-code-test-explorer-integration)
6. [Test Result Management](#test-result-management)

---

## Architecture Overview

### Main Components

```
TestController (src/testController.ts)
├── TestDiscovery (src/discovery/testDiscovery.ts)
├── TestRunner (src/runner/testRunner.ts)
├── ProfileManager (src/config/profileManager.ts)
└── OutputFilter (src/ui/outputFilter.ts)
```

### Component Responsibilities

- **TestController**: Main entry point, manages VS Code Test Controller API integration
- **TestDiscovery**: Discovers Go test files and extracts test functions
- **TestRunner**: Executes tests via `go test -json` and processes results
- **ProfileManager**: Manages test profiles (flags, environment variables)
- **OutputFilter**: Filters test results display (all/failed/passed/skipped)

---

## Test Discovery & Structure

### Test Item Hierarchy

Tests are organized in a two-level hierarchy:

```
Package (Level 1)
└── Test Function (Level 2)
```

### Test Item IDs

- **Package Item**: `{package_path}` (e.g., `github.com/user/repo/pkg`)
- **Test Item**: `{package_path}/{test_name}` (e.g., `github.com/user/repo/pkg/TestExample`)

This ID structure is created in `testDiscovery.ts`:
```typescript
// Package item
const pkgItem = this.controller.createTestItem(pkg, pkg, ...);

// Test item
const testItem = this.controller.createTestItem(
    `${pkg}/${testInfo.name}`,  // ID format: pkg/TestName
    testInfo.name,
    testInfo.uri
);
```

### Discovery Process

1. Find all `*_test.go` files using `vscode.workspace.findFiles()`
2. Parse files using regex to extract `Test*` functions
3. Group tests by package directory
4. Create VS Code TestItems in hierarchical structure
5. Store location information (file URI, line range) for each test

---

## Test Execution Flow

### Entry Points

1. **Test Explorer Run Button**: Triggers via run profile → `TestRunner.runTests()`
2. **Command: Run All Tests**: Triggers `TestRunner.runAllTests()`
3. **Individual Test/Package**: Triggers `TestRunner.runTests()` with specific items

### Execution Routing (`runTests`)

```typescript
async runTests(request: vscode.TestRunRequest, token: vscode.CancellationToken) {
    const run = this.controller.createTestRun(request);
    
    if (request.include) {
        // Run specific tests/packages
        for (const test of request.include) {
            await this.runTest(test, run, profile, token);
        }
    } else {
        // Run all tests
        await this.runAllTestsInternal(run, profile, token);
    }
    
    run.end();
    this.displayTestSummary();
}
```

### Test Type Detection (`runTest`)

The test item structure determines execution type (not by counting slashes in ID):

```typescript
private async runTest(test: vscode.TestItem, run, profile, token) {
    // Check if this is a package item (has children) or a test item (no children)
    if (test.children.size > 0) {
        // Package item → run all tests in package
        await this.runPackageTests(test.id, ...);
    } else {
        // Test item → extract package and test name
        // Use lastIndexOf('/') because package paths can contain multiple slashes
        // e.g., "rukita.co/main/be/accessor/chat/TestExample"
        const lastSlashIndex = test.id.lastIndexOf('/');
        const pkg = test.id.substring(0, lastSlashIndex);
        const testName = test.id.substring(lastSlashIndex + 1);
        await this.runSpecificTest(pkg, testName, ...);
    }
}
```

**Important**: Package paths like `rukita.co/main/be/accessor/chat` contain multiple slashes. We cannot use `split('/').length` to determine type. Instead, check if the test item has children.

### Execution Methods

#### 1. `runAllTestsInternal()`
- Executes: `go test -json {profile.testFlags} ./...`
- Runs all tests in workspace
- Includes preparation: `go generate ./...` and `go clean -testcache`

#### 2. `runSpecificTest()`
- Executes: `go test -json -run ^{testName}$ {profile.testFlags} {pkg}`
- Runs single test function

#### 3. `runPackageTests()`
- Executes: `go test -json {profile.testFlags} {pkg}`
- Runs all tests in a specific package

### Process Management

All execution methods:
1. Spawn `go test` process with `-json` flag
2. Stream stdout/stderr with buffering
3. Parse JSON test events line-by-line
4. Handle cancellation via process tree termination
5. Support profile-specific flags and environment variables

---

## Output Channels & Results

### Three Output Destinations

#### 1. VS Code Test Explorer (Visual UI - Sidebar)
- Shows pass/fail/skip icons next to tests in the sidebar
- Tree structure organized by package → tests
- Managed via `vscode.TestRun` API
- Methods: `run.started()`, `run.passed()`, `run.failed()`, `run.skipped()`
- Real-time updates during test execution
- Automatically grouped by package hierarchy from test discovery

#### 2. VS Code Test Results Panel (Bottom Panel)
- Appears in the bottom panel when running tests
- Shows detailed output for each test
- **Automatically grouped by package** based on test item hierarchy
- Populated via: `run.appendOutput(output, location, testItem)`
- The third parameter (`testItem`) determines which test/package the output belongs to
- VS Code automatically organizes this in a tree: Package → Test → Output
- No manual grouping required - inherits structure from Test Explorer

#### 3. Output Channel "Go Test Runner" (Bottom Panel)
- Text-based output channel (separate tab from Test Results)
- Shows detailed test output and formatted summary
- Created: `vscode.window.createOutputChannel('Go Test Runner')`
- Displayed via: `this.outputChannel.appendLine()`
- **Manually grouped by package** in `displayTestsByPackage()` for better readability

### Output Flow Diagram

```
go test -json
    │
    ├─→ stdout (JSON events)
    │   ├─→ Parse TestEvent
    │   ├─→ handleTestEvent()
    │   │   ├─→ Update Test Explorer Sidebar (run.passed/failed/skipped)
    │   │   ├─→ Update Test Results Panel (run.appendOutput with testItem)
    │   │   ├─→ Store in testResults Map
    │   │   └─→ Append to Output Channel
    │   └─→ Store output in TestResult.output[]
    │
    └─→ stderr
        └─→ Append to both Output Channel and Test Results Panel
```

**Key Point**: `run.appendOutput(output, location, testItem)` - The third parameter determines where the output appears in the Test Results panel tree structure.

### Test Event Processing

```typescript
interface TestEvent {
    Action: 'run' | 'pass' | 'fail' | 'skip' | 'output';
    Package?: string;
    Test?: string;
    Output?: string;
    Elapsed?: number;
}

private handleTestEvent(event: TestEvent, run: vscode.TestRun) {
    const testId = `${event.Package}/${event.Test}`;
    const testItem = this.findTestItem(testId);
    
    switch (event.Action) {
        case 'run':
            run.started(testItem);
            break;
        case 'pass':
            run.passed(testItem, elapsed);
            this.testResults.set(testId, { status: 'pass', ... });
            break;
        case 'fail':
            run.failed(testItem, message, elapsed);
            this.testResults.set(testId, { status: 'fail', ... });
            break;
        case 'skip':
            run.skipped(testItem);
            break;
        case 'output':
            run.appendOutput(event.Output, testItem);
            this.testResults.get(testId).output.push(event.Output);
            break;
    }
}
```

---

## VS Code Test Explorer Integration

### Test Controller Setup

```typescript
// Create controller
this.controller = vscode.tests.createTestController('goTestRunner', 'Go Test Runner');

// Create run profile (appears as run button in UI)
this.controller.createRunProfile(
    'Go Test Runner',
    vscode.TestRunProfileKind.Run,
    (request, token) => this.testRunner.runTests(request, token),
    true  // isDefault
);
```

### Test Run Lifecycle

```typescript
// 1. Create test run
const run = this.controller.createTestRun(request);

// 2. Mark test as started
run.started(testItem);

// 3. Update status during execution
run.appendOutput(output, testItem);

// 4. Mark final status
run.passed(testItem, duration);  // or failed/skipped

// 5. End the run
run.end();
```

### Visual Indicators in Test Explorer

| Status | Icon | Method Called |
|--------|------|---------------|
| Running | ⟳ (spinner) | `run.started(testItem)` |
| Passed | ✓ (green check) | `run.passed(testItem, duration)` |
| Failed | ✗ (red X) | `run.failed(testItem, message, duration)` |
| Skipped | ○ (gray circle) | `run.skipped(testItem)` |
| Not run | - (no icon) | (no status method called) |

### Clearing Test Results

To clear visual status from Test Explorer:

```typescript
clearAllResults() {
    // Clear internal state
    this.testResults.clear();
    this.packageTestStatus.clear();
    
    // Clear Test Explorer UI - IMPORTANT!
    for (const [, pkgItem] of this.controller.items) {
        for (const [, testItem] of pkgItem.children) {
            this.controller.invalidateTestResults(testItem);
        }
        this.controller.invalidateTestResults(pkgItem);
    }
}
```

**Critical**: Must call `invalidateTestResults()` to remove pass/fail icons from UI.

---

## Test Result Management

### Internal Data Structures

```typescript
// Individual test results
testResults: Map<string, TestResult>
// Format: "pkg/TestName" → { id, name, status, elapsed, output[] }

// Package-level status tracking
packageTestStatus: Map<string, Map<string, 'pass' | 'fail' | 'skip'>>
// Format: "pkg" → Map("TestName" → "pass")
```

### Test Summary Display (Output Channel Only)

After all tests complete, `displayTestSummary()` generates formatted output **in the Output Channel** (not the Test Results panel):

```
═══════════════════════════════════════════════════════════════
                        TEST RESULTS SUMMARY
═══════════════════════════════════════════════════════════════

Total: 15 | ✓ Passed: 13 | ✗ Failed: 2 | ⊘ Skipped: 0

───────────────────────────────────────────────────────────────
  ✗ FAILED TESTS
───────────────────────────────────────────────────────────────

📦 rukita.co/main/be/accessor/chat (2 tests)
  ✗ TestChatService (0.123s)
    Output:
      chat_test.go:15: expected 5, got 3
      
  ✗ TestMessageHandler (0.045s)

📦 rukita.co/main/be/accessor/user (1 test)
  ✗ TestUserCreate (0.032s)
    
───────────────────────────────────────────────────────────────
  ✓ PASSED TESTS
───────────────────────────────────────────────────────────────

📦 rukita.co/main/be/accessor/chat (3 tests)
  ✓ TestChatCreate (0.012s)
  ✓ TestChatDelete (0.008s)
  ✓ TestChatUpdate (0.015s)

📦 rukita.co/main/be/accessor/user (10 tests)
  ✓ TestUserUpdate (0.019s)
  ...
═══════════════════════════════════════════════════════════════
```

**Implementation**: The `displayTestsByPackage()` method groups tests by extracting package paths from test IDs and displays them in a tree format with package headers (📦).

### Output Filtering

The `OutputFilter` class controls which test results appear in the summary:

```typescript
shouldShowTest(status: 'pass' | 'fail' | 'skip'): boolean {
    switch (this.currentFilter) {
        case FilterMode.All: return true;
        case FilterMode.Failed: return status === 'fail';
        case FilterMode.Passed: return status === 'pass';
        case FilterMode.Skipped: return status === 'skip';
    }
}
```

Filter is applied in `displayTestResult()` before outputting to channel.

### Package Status Display

After test run, package items show summary in their description:

```typescript
collapsePassedPackages() {
    for (const [, pkgItem] of this.controller.items) {
        const allPassed = /* check all tests in package */;
        
        if (allPassed) {
            pkgItem.description = `✓ All ${testCount} tests passed`;
        } else {
            pkgItem.description = `✗ ${failedCount} failed`;
        }
    }
}
```

---

## Key Execution Points Summary

### When User Clicks Run Button in Test Explorer

1. **VS Code** → Calls run profile handler
2. **TestController** → `runTests(request, token)` called
3. **TestRunner** → Determines test type from `request.include`
4. **Routing**:
   - No items → `runAllTestsInternal()` → `go test ./...`
   - Package item (ID: `pkg`) → `runPackageTests()` → `go test {pkg}`
   - Test item (ID: `pkg/TestName`) → `runSpecificTest()` → `go test -run ^TestName$ {pkg}`
5. **Process**: Spawn `go test -json` with profile flags
6. **Stream**: Parse JSON events → Update Test Explorer + Output Channel
7. **Finalize**: Display summary → Update package descriptions

### Critical Integration Points

- **Test IDs**: Format is `{package_path}/{test_name}`. Package paths can contain slashes (e.g., `rukita.co/main/be/accessor/chat/TestExample`)
- **Test Type Detection**: Use `test.children.size > 0` to identify packages, not ID string parsing
- **Test Run API**: Must call `run.started()` before `run.passed/failed/skipped()`
- **Clearing Results**: Must call `invalidateTestResults()` to clear UI
- **Three Output Systems**:
  - Test Explorer sidebar: Visual tree with icons
  - Test Results panel: Automatically grouped by package hierarchy via `run.appendOutput(output, location, testItem)`
  - Output Channel: Manually formatted summary via `outputChannel.appendLine()`

---

## Common Issues & Solutions

### Issue: Tests not showing in Test Explorer
- **Check**: Test discovery found the tests (look for test items in `controller.items`)
- **Check**: Test file naming (`*_test.go`) and function naming (`Test*`)

### Issue: Package tests not running
- **Check**: Package paths can contain multiple slashes (e.g., `rukita.co/main/be/accessor/chat`)
- **Check**: Use `test.children.size > 0` to identify package items, not slash counting
- **Check**: `runPackageTests()` being called (add debug logging)
- **Check**: Package path is valid Go package

### Issue: Test results not clearing
- **Check**: Calling `controller.invalidateTestResults()` for each test item
- **Missing**: Only clearing internal maps is not enough

### Issue: Output not showing
- **Check**: Three different outputs exist:
  1. **Test Explorer (sidebar)**: Visual icons - updated via `run.passed/failed/skipped()`
  2. **Test Results panel (bottom)**: Automatically grouped by package - populated via `run.appendOutput(output, location, testItem)`
  3. **Output Channel (bottom)**: Manual text output - populated via `outputChannel.appendLine()`
- **Check**: `outputChannel.show()` called to display Output Channel
- **Note**: Test Results panel grouping is automatic based on test item hierarchy, no manual grouping needed

---

## Future Improvements

- Add support for subtests (currently handled by finding parent test)
- Benchmark support (currently only Test* functions)
- Better error messages when test discovery fails
- Parallel test execution visualization
- Test coverage integration

---

**Last Updated**: 2025-11-19
**Maintained by**: Development Team
