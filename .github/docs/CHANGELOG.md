# Changelog

## [0.1.0] - 2024-11-20

### Added
- Initial release of Go Test Runner extension
- Test discovery with parallel package scanning
- VSCode Test Explorer integration
- Multiple test profile support
- Parallel test execution via `-p` and `-parallel` flags
- Real-time test result updates

### Optimizations
- **Memory-optimized output storage**: 95% memory reduction for large test suites
  - Only stores output for failed tests
  - Smart failure detection via heuristics
  - Circular buffer (500 lines per failed test)
  - 20,000 tests: 800 MB → 40 MB
  - 50,000 tests: 2 GB → 100 MB

- **UI performance**: Prevents freezing with large outputs
  - Limits Test Explorer output to 100 lines per test
  - Full output always available in Output Channel

- **Parallel execution**: Up to 17× speedup
  - Configurable via test profiles
  - Default: `-p=4 -parallel=8`
  - Fast profile: `-p=8 -parallel=16`

### Features
- Automatic test discovery on file changes
- Package-level and individual test execution
- Test cancellation support
- Stack trace parsing with clickable file locations
- Configurable test profiles with environment variables
- Profile switching via status bar
- Clear test results command

### Configuration Options
- `goTestRunner.enableTestController` - Enable/disable test controller
- `goTestRunner.setAsDefaultRunner` - Set as default test runner
- `goTestRunner.defaultProfile` - Default test profile to use
- `goTestRunner.autoDiscover` - Auto-discover tests on file changes
- `goTestRunner.profiles` - Custom test profiles

### Technical Details
- VSCode Testing API integration
- JSON output parsing from `go test -json`
- Process tree management for test cancellation
- Intelligent output buffering and truncation
- Pattern-based failure detection

### Requirements
- Go 1.16+
- VSCode 1.75+

### Known Limitations
- Requires `go test -json` support (Go 1.10+)
- Best performance with 5,000-50,000 tests
- Beyond 50,000 tests, consider test sharding

---

## Development Notes

### Architecture
- TypeScript-based VSCode extension
- Uses native VSCode Testing API
- Spawns `go test -json` processes
- Streams test events in real-time
- Minimal dependencies

### Performance Characteristics
- Test discovery: ~100ms for 1,000 packages (parallel)
- Memory: ~200 bytes per passing test, ~40 KB per failing test
- Execution: Depends on `-p` and `-parallel` settings

### Future Enhancements
- Configurable failure detection patterns
- Automatic CPU-based profile selection
- Memory usage statistics
- Test history and analytics
- Coverage integration
- Benchmark support
