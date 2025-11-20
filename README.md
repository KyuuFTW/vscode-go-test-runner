# Go Test Runner

A high-performance VSCode extension for running Go tests with configurable test profiles, parallel execution, and optimized I/O handling for large test suites.

## ⚡ Performance

**Version 0.1.1** includes critical performance optimizations:
- **500x fewer I/O operations** via output buffering
- **Execution time**: Now matches native `go test` performance
- **Large test suites**: 4,000 tests with 37,000 assertions run in ~45 minutes (was 70 minutes)
- See [Performance Improvements](.github/docs/PERFORMANCE_IMPROVEMENTS.md) for details

## 📚 Documentation

- **[Quick Start Guide](.github/docs/QUICK_START.md)** - Get started with the optimized extension
- **[Performance Improvements](.github/docs/PERFORMANCE_IMPROVEMENTS.md)** - Details on I/O bottleneck fix
- **[Technical Details](.github/docs/TECHNICAL.md)** - Architecture and implementation
- **[Changelog](.github/docs/CHANGELOG.md)** - Version history and updates

---

# Integration Guide - VSCode Go Test Runner Extension
Since the plugin is not published yet, you can use the current implementation and install it on your own vscode.

### Create .vsix File

```bash
# Install vsce globally (if not already)
npm install -g @vscode/vsce

# Package the extension
vsce package

# This creates: go-test-runner-optimized.vsix (or go-test-runner-0.1.1.vsix)
```

### Install .vsix Locally

```bash
# Install the optimized version
code --install-extension go-test-runner-optimized.vsix

# Or via VSCode UI:
# Extensions view → ... menu → Install from VSIX
```

## Features

- **Test Discovery**: Automatically discovers and groups tests by package
- **Parallel Execution**: Run tests in parallel using `-p` and `-parallel` flags (up to 17× speedup)
- **Multiple Profiles**: Configure different test profiles with custom flags and environment variables
- **Real-time Results**: See test results update in real-time as tests run
- **VSCode Integration**: Uses native VSCode Testing API for seamless integration
- **Scalable**: Optimized to handle 20,000+ tests efficiently

### Memory-Optimized Output Handling

The extension uses intelligent output storage to handle large test suites:

- **Failed-Only Storage**: Only stores output for failed tests (95% memory reduction)
- **Smart Detection**: Automatically detects failures via heuristics (panic, FAIL, error keywords)
- **Circular Buffer**: Stores last 500 lines per failed test
- **UI Limiting**: Sends only first 100 lines to Test Explorer to prevent UI freezing
- **Full Output Access**: Complete output always available in "Go Test Runner" Output Channel

**Memory Usage:**
- 20,000 tests: 40 MB (vs 800 MB without optimization)
- 50,000 tests: 100 MB (vs 2 GB without optimization)

## Usage

1. Open a Go workspace in VSCode
2. Tests will automatically appear in the Testing view (beaker icon)
3. Click on the profile in the status bar to switch between test configurations
4. Run tests by clicking the play button next to any test or package

## Configuration

Configure test profiles in your workspace or user settings:

```json
{
  "goTestRunner.profiles": [
    {
      "name": "Default",
      "testFlags": ["-v", "-p=4", "-parallel=8"],
      "testEnvVars": {"YOUR_TEST_ENV_HERE": "TRUE"}
    },
    {
      "name": "Race Detector",
      "testFlags": ["-v", "-race", "-p=2", "-parallel=4"],
      "testEnvVars": {"YOUR_TEST_ENV_HERE": "TRUE", "ABCD":"EFGH"}
    }
  ],
  "goTestRunner.defaultProfile": "Default",
  "goTestRunner.enableTestController": true,
  "goTestRunner.setAsDefaultRunner": false
}
```

### Settings

- **`goTestRunner.enableTestController`** (default: `true`) - Enable this extension's test controller. Set to `false` to use only the official Go extension test runner.
- **`goTestRunner.setAsDefaultRunner`** (default: `false`) - When `false`, you must explicitly select which test runner to use from the Test Explorer. When `true`, this extension runs automatically when clicking "Run Test" buttons.
- **`goTestRunner.defaultProfile`** - Name of the default test profile to use.
- **`goTestRunner.autoDiscover`** (default: `true`) - Automatically discover tests on file changes.

### Using Multiple Test Runners

If you have both the official Go extension and this extension installed:

1. **Default behavior** (`setAsDefaultRunner: false`): When you click "Run Test", you'll be prompted to choose which test runner to use. Both runners appear as options in the Test Explorer.
2. **Auto-run behavior** (`setAsDefaultRunner: true`): This extension runs automatically when you click "Run Test". Not recommended if you want to choose between runners.

## Commands

- `Go Test: Refresh Tests` - Refresh test discovery
- `Go Test: Select Profile` - Switch between test profiles
- `Go Test: Run All Tests` - Run all tests in the workspace

## Requirements

- Go 1.16 or later
- VSCode 1.75 or later

## License

MIT
