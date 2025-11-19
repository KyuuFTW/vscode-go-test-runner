# Go Test Runner

A modern VSCode extension for running Go tests with configurable test profiles and parallel execution support.

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

Configure test profiles in your workspace settings:

```json
{
  "goTestRunner.profiles": [
    {
      "name": "Default",
      "testFlags": ["-v", "-p=4", "-parallel=8"],
      "testEnvVars": {}
    },
    {
      "name": "Race Detector",
      "testFlags": ["-v", "-race", "-p=2", "-parallel=4"],
      "testEnvVars": {}
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
