# Go Test Runner

A VSCode extension for running Go tests with configurable test profiles and parallel execution support.

## 📚 Project Documentation

This repository contains several documentation files to help you understand, develop, and use this extension:

- **[STATUS.md](STATUS.md)** - Quick overview of project status and completion (~95% complete)
- **[GO_TEST_PLUGIN_PLAN.md](GO_TEST_PLUGIN_PLAN.md)** - Original development plan with architecture and technical details
- **[DEVELOPMENT_PROGRESS.md](DEVELOPMENT_PROGRESS.md)** - Detailed phase-by-phase progress tracker for developers
- **[PARALLEL_EXECUTION_SUMMARY.md](PARALLEL_EXECUTION_SUMMARY.md)** - Explanation of parallel test execution architecture using `-p` and `-parallel` flags
- **[BUGFIX_SUMMARY.md](BUGFIX_SUMMARY.md)** - Summary of bug fixes related to test results display
- **[FILES_CREATED.md](FILES_CREATED.md)** - Complete list of all files created during development with priorities

**For Developers:** Start with [STATUS.md](STATUS.md), then read [DEVELOPMENT_PROGRESS.md](DEVELOPMENT_PROGRESS.md) for detailed implementation status.

---

# Integration Guide - VSCode Go Test Runner Extension
Since the plugin is not published yet, you can use the current implementation and install it on your own vscode.

### Create .vsix File

```bash
# Install vsce globally (if not already)
npm install -g @vscode/vsce

# Package the extension
vsce package

# This creates: go-test-runner-0.1.0.vsix
```

### Install .vsix Locally

```bash
# Install from command line
code --install-extension go-test-runner-0.1.0.vsix

# Or via VSCode UI:
# Extensions view → ... menu → Install from VSIX
```

## Features

- **Test Discovery**: Automatically discovers and groups tests by package
- **Parallel Execution**: Run tests in parallel using `-p` and `-parallel` flags
- **Multiple Profiles**: Configure different test profiles with custom flags and environment variables
- **Real-time Results**: See test results update in real-time as tests run
- **VSCode Integration**: Uses native VSCode Testing API for seamless integration

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
  "goTestRunner.defaultProfile": "Default"
}
```

## Commands

- `Go Test: Refresh Tests` - Refresh test discovery
- `Go Test: Select Profile` - Switch between test profiles
- `Go Test: Run All Tests` - Run all tests in the workspace

## Requirements

- Go 1.16 or later
- VSCode 1.75 or later

## License

MIT
