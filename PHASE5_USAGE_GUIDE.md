# Phase 5 Features - Quick Usage Guide

## 🎯 Stack Trace Navigation

### What It Does
When a Go test fails, the extension automatically parses stack traces and creates clickable links to the exact file and line where the error occurred.

### How to Use

1. **Run a test that fails**:
   ```go
   func TestExample(t *testing.T) {
       panic("something went wrong") // This will create a stack trace
   }
   ```

2. **View the test results**:
   - Failed test appears in Testing view with ❌
   - Click on the failed test

3. **Navigate to error location**:
   - The test message shows the error output
   - VS Code automatically links to `file.go:line`
   - Click the link to jump directly to the problematic code

### Supported Formats
- Absolute paths: `/full/path/to/file.go:42`
- Relative paths: `pkg/file.go:42`
- Standard Go panic traces
- Test assertion failures

### Example Output
```
--- FAIL: TestExample (0.00s)
    panic: something went wrong
    
    /path/to/project/file_test.go:15  ← Clickable!
    /path/to/project/file.go:42       ← Clickable!
```

## 🔍 Output Filtering

### What It Does
Filter the test output summary to show only the tests you care about - all tests, only failures, only passes, or only skipped tests.

### How to Use

1. **Open the filter menu**:
   - Look at the **right side** of the status bar
   - Click the filter status item: `$(icon) Filter: Mode`

2. **Select a filter mode**:
   - **$(checklist) All Tests** - Shows all test output (default)
   - **$(error) Failed Only** - Shows only failed tests
   - **$(pass) Passed Only** - Shows only passed tests
   - **$(circle-slash) Skipped Only** - Shows only skipped tests

3. **View filtered results**:
   - Run tests (or view existing results)
   - Output channel shows only matching tests
   - Summary is filtered in real-time

### Use Cases

**Focus on failures:**
```
Filter: Failed Only
Shows: Only failed tests and their output
Perfect for: Debugging test failures
```

**Verify passing tests:**
```
Filter: Passed Only
Shows: Only successful tests
Perfect for: Confirming coverage
```

**Check all results:**
```
Filter: All Tests
Shows: Everything
Perfect for: Complete overview
```

### Filter Persistence
- Filter selection persists during your VS Code session
- Resets to "All Tests" when VS Code restarts
- Status bar always shows current filter mode

## 🎨 Visual Indicators

### Status Bar Layout
```
Left Side:               Right Side:
$(beaker) ProfileName    $(filter) Filter: Mode
     ↑                        ↑
Profile switcher        Output filter
```

### Filter Icons
- 📋 `$(checklist)` - All Tests
- ❌ `$(error)` - Failed Only
- ✅ `$(pass)` - Passed Only  
- 🚫 `$(circle-slash)` - Skipped Only

## 💡 Pro Tips

### Stack Trace Navigation
1. **Quick debugging**: Click failed test → click location → see exact error line
2. **Multiple frames**: If stack trace has multiple frames, first (most relevant) is used
3. **Works with subtests**: Navigation works for subtests and table-driven tests

### Output Filtering
1. **Workflow**: Set filter → run tests → see filtered output
2. **Combination**: Use with profile switcher for different test configurations
3. **Performance**: Filter only affects display, not test execution speed

## 📝 Example Workflow

### Debugging Failed Tests

1. Run all tests (some fail)
2. Click filter: "Failed Only"
3. View only failed test output
4. Click on stack trace location
5. Jump to error in code
6. Fix the issue
7. Re-run tests

### Verifying Test Coverage

1. Run all tests
2. Click filter: "Passed Only"
3. Verify all expected tests passed
4. Click filter: "All Tests"
5. Review complete summary

## 🚀 Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| `Go Test: Toggle Output Filter` | - | Open filter selection menu |
| Click status bar filter item | - | Quick access to filter menu |

## 🔧 Technical Details

### Stack Trace Parser
- **Regex**: `/^\s*(.+\.go):(\d+)/`
- **Handles**: Both absolute and relative paths
- **Resolves**: Paths relative to workspace folder
- **Performance**: Only parses on test failure

### Filter Implementation
- **Filter Modes**: Enum-based selection
- **Display Logic**: Applied during summary generation
- **Memory**: Lightweight (single enum value)
- **Thread-safe**: No concurrent access issues

## ❓ Troubleshooting

### Stack Trace Not Clickable
- ✅ Ensure file path is valid
- ✅ Check workspace folder is open
- ✅ Verify file exists in project

### Filter Not Working
- ✅ Check filter status in status bar
- ✅ Re-run tests after changing filter
- ✅ Verify output channel is "Go Test Runner"

### Can't Find Filter Control
- ✅ Look at **right side** of status bar
- ✅ Icon is `$(filter)` or current filter icon
- ✅ Use Command Palette: "Go Test: Toggle Output Filter"

## 📚 Related Documentation

- See `PHASE5_COMPLETION.md` for implementation details
- See `README.md` for general extension usage
- See `STATUS.md` for overall project status
