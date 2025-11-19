# Test Discovery Performance Improvements

## Problem
The original test discovery was extremely slow because it:
1. Ran `go list ./...` to find all packages
2. Ran `go test -list` **sequentially** for each package
3. For a project with 50 packages, this meant 51 separate `go` commands running one after another

## Solution
Completely redesigned the test discovery to be file-based and parallel:

### Key Optimizations

1. **File-Based Discovery Instead of Process-Based**
   - Uses VS Code's `findFiles` API to locate all `*_test.go` files instantly
   - Parses test files directly with regex to extract test function names
   - No need to run `go test -list` for each package

2. **Parallel Processing**
   - Reads and parses multiple test files concurrently
   - Processes up to 10 packages simultaneously (configurable)
   - All file I/O operations use `Promise.all()` for maximum parallelism

3. **Minimal Go Command Execution**
   - Only runs `go list` once per package directory to get the import path
   - Added 5-second timeout to prevent hanging
   - Fallback to relative path if `go list` fails

4. **Smart Caching**
   - Groups test files by directory before processing
   - Deduplicates test names using Set
   - Avoids redundant package lookups

### Performance Comparison

**Before:**
```
50 packages × 200ms avg per `go test -list` = ~10 seconds
```

**After:**
```
File discovery: ~100ms (VS Code API)
File parsing: ~200ms (parallel regex)
Package lookup: ~500ms (10 concurrent go list calls)
Total: ~800ms
```

**Expected speedup: 10-15x faster** ⚡

### Code Changes

#### New Methods
- `findAllTests()`: Main orchestrator using file-based discovery
- `processPackagesConcurrently()`: Manages concurrent package processing with queue
- `extractTestsFromFiles()`: Parses Go files with regex to find test functions
- `getPackageName()`: Gets package import path with timeout and fallback

#### Features Added
- Performance timing and logging to "Go Test Discovery" output channel
- Concurrency limit (10 parallel operations) to avoid overwhelming the system
- Graceful error handling with fallbacks
- Vendor directory exclusion

### Usage

The improved discovery runs automatically when:
- Extension activates
- User clicks "Refresh Tests"
- Workspace changes

Check the "Go Test Discovery" output channel to see performance metrics.

### Technical Details

**Regex Pattern Used:**
```javascript
/func\s+(Test\w+)\s*\(/g
```
This matches standard Go test functions like:
- `func TestSomething(t *testing.T)`
- `func Test_privateFunction(t *testing.T)`
- `func TestHTTPHandler(t *testing.T)`

**Concurrency Model:**
- Uses worker pool pattern with Promise.all()
- Limits concurrent operations to prevent resource exhaustion
- Gracefully handles individual package failures

### Edge Cases Handled
- Missing or unreadable test files
- Packages without test files
- Vendor directory exclusion
- Go command failures (with fallback to relative paths)
- Empty or malformed test files
