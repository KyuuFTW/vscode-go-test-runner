import * as vscode from 'vscode';
import { spawn, execSync } from 'child_process';
import { ProfileManager } from '../config/profileManager';
import { OutputFilter } from '../ui/outputFilter';
import { TestDiscovery } from '../discovery/testDiscovery';

interface TestEvent {
    Time?: string;
    Action: string;
    Package?: string;
    Test?: string;
    Output?: string;
    Elapsed?: number;
}

interface TestResult {
    id: string;
    name: string;
    status: 'pass' | 'fail' | 'skip';
    elapsed?: number;
    uiOutputLineCount: number;
}

interface StackFrame {
    file: string;
    line: number;
    text: string;
}

export class TestRunner {
    private outputChannel: vscode.OutputChannel;
    private testResults: Map<string, TestResult>;
    private failedTestsOutput: Map<string, { lines: string[], truncated: boolean }>;
    private outputFilter?: OutputFilter;
    private packageTestStatus: Map<string, Map<string, 'pass' | 'fail' | 'skip'>>;
    private static readonly MAX_OUTPUT_LINES = 500;
    private static readonly MAX_UI_OUTPUT_LINES = 100;
    private outputBuffer: string[];
    private outputBufferSize: number;
    private flushTimer?: NodeJS.Timeout;

    constructor(
        private controller: vscode.TestController,
        private profileManager: ProfileManager,
        private testDiscovery: TestDiscovery,
        outputFilter?: OutputFilter
    ) {
        this.outputChannel = vscode.window.createOutputChannel('Go Test Runner');
        this.testResults = new Map();
        this.failedTestsOutput = new Map();
        this.outputFilter = outputFilter;
        this.packageTestStatus = new Map();
        this.outputBuffer = [];
        this.outputBufferSize = 0;
    }

    async runTests(
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken
    ): Promise<void> {
        const run = this.controller.createTestRun(request);
        const profile = this.profileManager.getActiveProfile();
        
        this.testResults.clear();
        this.failedTestsOutput.clear();
        this.packageTestStatus.clear();
        this.outputBuffer = [];
        this.outputBufferSize = 0;
        this.outputChannel.clear();
        this.outputChannel.show(true);

        try {
            if (request.include) {
                for (const test of request.include) {
                    if (token.isCancellationRequested) {
                        break;
                    }
                    await this.runTest(test, run, profile, token);
                }
            } else {
                await this.runAllTestsInternal(run, profile, token);
            }
        } finally {
            this.flushOutputBuffer();
            run.end();
            this.collapsePassedPackages();
        }
    }

    async runAllTests(): Promise<void> {
        const run = this.controller.createTestRun(new vscode.TestRunRequest());
        const profile = this.profileManager.getActiveProfile();
        const tokenSource = new vscode.CancellationTokenSource();
        
        this.testResults.clear();
        this.failedTestsOutput.clear();
        this.packageTestStatus.clear();
        this.outputBuffer = [];
        this.outputBufferSize = 0;
        this.outputChannel.clear();
        this.outputChannel.show(true);

        try {
            await this.runAllTestsInternal(run, profile, tokenSource.token);
        } finally {
            this.flushOutputBuffer();
            run.end();
            this.collapsePassedPackages();
            tokenSource.dispose();
        }
    }

    private async runAllTestsInternal(
        run: vscode.TestRun,
        profile: any,
        token: vscode.CancellationToken
    ): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        // Prepare tests: generate and clean cache
        this.appendToOutputBuffer('Preparing tests...');
        try {
            this.appendToOutputBuffer('Running: go generate ./...');
            execSync('go generate ./...', { 
                cwd: workspaceFolder.uri.fsPath,
                encoding: 'utf-8'
            });
            
            this.appendToOutputBuffer('Running: go clean -testcache');
            execSync('go clean -testcache', { 
                cwd: workspaceFolder.uri.fsPath,
                encoding: 'utf-8'
            });
            this.appendToOutputBuffer('Tests prepared successfully\n');
            this.flushOutputBuffer();
        } catch (error) {
            this.appendToOutputBuffer(`Warning during preparation: ${error}\n`);
            this.flushOutputBuffer();
        }

        return new Promise((resolve, reject) => {
            const args = ['test', '-json', ...profile.testFlags, './...'];
            
            const proc = spawn('go', args, {
                cwd: workspaceFolder.uri.fsPath,
                env: { ...process.env, ...profile.testEnvVars }
            });

            let buffer = '';
            let cancelled = false;

            const cleanup = () => {
                if (!cancelled) {
                    cancelled = true;
                    this.killProcessTree(proc.pid!);
                }
            };

            token.onCancellationRequested(() => {
                this.appendToOutputBuffer('\n[Test run cancelled by user]');
                this.flushOutputBuffer();
                cleanup();
                resolve();
            });

            proc.stdout.on('data', (data) => {
                buffer += data.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                // Batch parse JSON events to reduce overhead
                const events: TestEvent[] = [];
                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            events.push(JSON.parse(line));
                        } catch (e) {
                            console.error('Error parsing JSON:', line);
                        }
                    }
                }
                
                // Process all events in batch
                for (const event of events) {
                    this.handleTestEvent(event, run);
                }
            });

            proc.stderr.on('data', (data) => {
                this.appendToOutputBuffer(data.toString());
            });

            proc.on('close', (code) => {
                if (!cancelled) {
                    this.flushOutputBuffer();
                    resolve();
                }
            });

            proc.on('error', (err) => {
                if (!cancelled) {
                    reject(err);
                }
            });
        });
    }

    private async runTest(
        test: vscode.TestItem,
        run: vscode.TestRun,
        profile: any,
        token: vscode.CancellationToken
    ): Promise<void> {
        run.started(test);
        
        const testId = test.id;
        
        // Check if this is a package item (has children) or a test item (no children)
        if (test.children.size > 0) {
            // This is a package item - run all tests in package
            await this.runPackageTests(testId, test, run, profile, token);
        } else {
            // This is a test item - extract package and test name
            // Test ID format: "pkg/path/TestName" where last part is the test name
            const lastSlashIndex = testId.lastIndexOf('/');
            if (lastSlashIndex === -1) {
                return;
            }
            
            const pkg = testId.substring(0, lastSlashIndex);
            const testName = testId.substring(lastSlashIndex + 1);
            await this.runSpecificTest(pkg, testName, test, run, profile, token);
        }
    }

    private async runSpecificTest(
        pkg: string,
        testName: string,
        test: vscode.TestItem,
        run: vscode.TestRun,
        profile: any,
        token: vscode.CancellationToken
    ): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        return new Promise((resolve) => {
            const args = ['test', '-json', '-run', `^${testName}$`, ...profile.testFlags, pkg];
            
            const proc = spawn('go', args, {
                cwd: workspaceFolder.uri.fsPath,
                env: { ...process.env, ...profile.testEnvVars }
            });

            let buffer = '';
            let cancelled = false;

            const cleanup = () => {
                if (!cancelled) {
                    cancelled = true;
                    this.killProcessTree(proc.pid!);
                }
            };

            token.onCancellationRequested(() => {
                this.appendToOutputBuffer('\n[Test run cancelled by user]');
                this.flushOutputBuffer();
                cleanup();
                resolve();
            });

            proc.stdout.on('data', (data) => {
                buffer += data.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                // Batch parse JSON events
                const events: TestEvent[] = [];
                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            events.push(JSON.parse(line));
                        } catch (e) {
                            console.error('Error parsing JSON:', line);
                        }
                    }
                }
                
                for (const event of events) {
                    this.handleTestEvent(event, run);
                }
            });

            proc.stderr.on('data', (data) => {
                const output = data.toString();
                this.appendToOutputBuffer(output);
                run.appendOutput(output.replace(/\n/g, '\r\n'), undefined, test);
            });

            proc.on('close', () => {
                if (!cancelled) {
                    resolve();
                }
            });
        });
    }

    private async runPackageTests(
        pkg: string,
        test: vscode.TestItem,
        run: vscode.TestRun,
        profile: any,
        token: vscode.CancellationToken
    ): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        return new Promise((resolve) => {
            const args = ['test', '-json', ...profile.testFlags, pkg];
            
            const proc = spawn('go', args, {
                cwd: workspaceFolder.uri.fsPath,
                env: { ...process.env, ...profile.testEnvVars }
            });

            let buffer = '';
            let cancelled = false;

            const cleanup = () => {
                if (!cancelled) {
                    cancelled = true;
                    this.killProcessTree(proc.pid!);
                }
            };

            token.onCancellationRequested(() => {
                this.appendToOutputBuffer('\n[Test run cancelled by user]');
                this.flushOutputBuffer();
                cleanup();
                resolve();
            });

            proc.stdout.on('data', (data) => {
                buffer += data.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                // Batch parse JSON events
                const events: TestEvent[] = [];
                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            events.push(JSON.parse(line));
                        } catch (e) {
                            console.error('Error parsing JSON:', line);
                        }
                    }
                }
                
                for (const event of events) {
                    this.handleTestEvent(event, run);
                }
            });

            proc.stderr.on('data', (data) => {
                const output = data.toString();
                this.appendToOutputBuffer(output);
                run.appendOutput(output.replace(/\n/g, '\r\n'), undefined, test);
            });

            proc.on('close', () => {
                if (!cancelled) {
                    resolve();
                }
            });
        });
    }

    private handleTestEvent(event: TestEvent, run: vscode.TestRun): void {
        if (!event.Package || !event.Test) {
            if (event.Output) {
                this.appendToOutputBuffer(event.Output);
            }
            return;
        }

        const testId = `${event.Package}/${event.Test}`;
        const testItem = this.findTestItem(testId);

        if (!testItem) {
            return;
        }

        // Initialize test result if needed
        if (!this.testResults.has(testId)) {
            this.testResults.set(testId, {
                id: testId,
                name: event.Test,
                status: 'pass',
                uiOutputLineCount: 0
            });
        }

        const result = this.testResults.get(testId)!;

        switch (event.Action) {
            case 'run':
                run.started(testItem);
                break;
            case 'pass':
                result.status = 'pass';
                result.elapsed = event.Elapsed;
                run.passed(testItem, event.Elapsed ? event.Elapsed * 1000 : undefined);
                this.updatePackageTestStatus(event.Package, event.Test, 'pass');
                break;
            case 'fail':
                result.status = 'fail';
                result.elapsed = event.Elapsed;
                // Get output from failed tests map
                const outputData = this.failedTestsOutput.get(testId);
                const failureOutput = outputData ? outputData.lines.join('') : '';
                const truncationNotice = outputData?.truncated 
                    ? `[Output truncated - showing last ${TestRunner.MAX_OUTPUT_LINES} lines. See Output Channel for full output]\n\n` 
                    : '';
                const message = this.createTestMessageWithLocation(
                    truncationNotice + failureOutput || 'Test failed - see Output Channel', 
                    testItem
                );
                run.failed(testItem, message, event.Elapsed ? event.Elapsed * 1000 : undefined);
                this.updatePackageTestStatus(event.Package, event.Test, 'fail');
                break;
            case 'skip':
                result.status = 'skip';
                run.skipped(testItem);
                this.updatePackageTestStatus(event.Package, event.Test, 'skip');
                break;
            case 'output':
                if (event.Output) {
                    this.handleTestOutput(testId, event.Output, testItem, run, result);
                }
                break;
        }
    }

    private handleTestOutput(
        testId: string,
        output: string,
        testItem: vscode.TestItem,
        run: vscode.TestRun,
        result: TestResult
    ): void {
        // Buffer output to reduce I/O overhead (flush every 64KB or 500 lines)
        this.appendToOutputBuffer(output);
        
        // Send limited output to UI
        if (result.uiOutputLineCount < TestRunner.MAX_UI_OUTPUT_LINES) {
            run.appendOutput(output.replace(/\n/g, '\r\n'), undefined, testItem);
            result.uiOutputLineCount++;
        } else if (result.uiOutputLineCount === TestRunner.MAX_UI_OUTPUT_LINES) {
            // Add truncation notice once
            const truncationMsg = '\r\n... [Output truncated - see Output Channel for full test output] ...\r\n';
            run.appendOutput(truncationMsg, undefined, testItem);
            result.uiOutputLineCount++;
        }
        
        // Only collect output for potential failures
        if (this.shouldCollectOutput(output, result)) {
            if (!this.failedTestsOutput.has(testId)) {
                this.failedTestsOutput.set(testId, { lines: [], truncated: false });
            }
            
            const outputData = this.failedTestsOutput.get(testId)!;
            outputData.lines.push(output);
            
            // Circular buffer for failed tests only
            if (outputData.lines.length > TestRunner.MAX_OUTPUT_LINES) {
                outputData.lines.shift();
                outputData.truncated = true;
            }
        }
    }

    private appendToOutputBuffer(output: string): void {
        const trimmed = output.trimEnd();
        this.outputBuffer.push(trimmed);
        this.outputBufferSize += trimmed.length;
        
        // Flush if buffer exceeds 64KB or 500 lines
        if (this.outputBufferSize >= 65536 || this.outputBuffer.length >= 500) {
            this.flushOutputBuffer();
        }
    }

    private flushOutputBuffer(): void {
        if (this.outputBuffer.length > 0) {
            this.outputChannel.appendLine(this.outputBuffer.join('\n'));
            this.outputBuffer = [];
            this.outputBufferSize = 0;
        }
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
    }

    private shouldCollectOutput(output: string, result: TestResult): boolean {
        // Already collecting (test has been marked as failing or suspected)
        if (result.status === 'fail') {
            return true;
        }
        
        // Heuristic: collect if output indicates potential failure
        // Common Go test failure patterns
        return output.includes('FAIL') || 
               output.includes('panic:') || 
               output.includes('fatal error:') ||
               output.includes('Error:') ||
               output.includes('error:') ||
               output.includes('expected') ||
               output.includes('got:') ||
               output.includes('want:') ||
               output.includes('--- FAIL') ||
               output.includes('FAIL:') ||
               output.includes('testing.go:') || // Stack trace indicator
               output.includes('goroutine') ||    // Panic stack trace
               /\s+\S+_test\.go:\d+:/.test(output); // test file with line number (common in failures)
    }

    private findTestItem(id: string): vscode.TestItem | undefined {
        // Try to find exact match first
        for (const [, pkgItem] of this.controller.items) {
            const testItem = pkgItem.children.get(id);
            if (testItem) {
                return testItem;
            }
        }
        
        // For subtests, try to find parent test
        for (const [, pkgItem] of this.controller.items) {
            for (const [, testItem] of pkgItem.children) {
                if (id.startsWith(testItem.id + '/')) {
                    return testItem;
                }
            }
        }
        
        return undefined;
    }

    private killProcessTree(pid: number): void {
        try {
            if (process.platform === 'win32') {
                // Windows: use taskkill to kill process tree
                spawn('taskkill', ['/pid', pid.toString(), '/T', '/F']);
            } else {
                // Unix: kill the entire process group
                // First, get all child processes
                const { execSync } = require('child_process');
                
                try {
                    // Find all descendant processes including .test binaries
                    const descendants = execSync(
                        `pgrep -P ${pid}`,
                        { encoding: 'utf-8' }
                    ).trim().split('\n').filter((p: string) => p);
                    
                    // Kill all descendants first
                    for (const childPid of descendants) {
                        try {
                            process.kill(parseInt(childPid), 'SIGKILL');
                        } catch (e) {
                            // Process might already be dead
                        }
                    }
                } catch (e) {
                    // pgrep might fail if no children
                }
                
                // Kill the main process
                try {
                    process.kill(pid, 'SIGKILL');
                } catch (e) {
                    // Process might already be dead
                }
                

            }
            
            this.outputChannel.appendLine(`[Killed process tree: ${pid}]`);
        } catch (error) {
            this.outputChannel.appendLine(`[Error killing process tree: ${error}]`);
        }
    }

    private parseStackTrace(output: string): StackFrame[] {
        const frames: StackFrame[] = [];
        const lines = output.split('\n');
        
        // Go stack trace format: filename.go:line or /full/path/filename.go:line
        const stackTraceRegex = /^\s*(.+\.go):(\d+)/;
        
        for (const line of lines) {
            const match = line.match(stackTraceRegex);
            if (match) {
                const [, file, lineNum] = match;
                frames.push({
                    file: file.trim(),
                    line: parseInt(lineNum, 10),
                    text: line.trim()
                });
            }
        }
        
        return frames;
    }

    private createTestMessageWithLocation(output: string, testItem: vscode.TestItem): vscode.TestMessage {
        const stackFrames = this.parseStackTrace(output);
        const message = new vscode.TestMessage(output);
        
        if (stackFrames.length > 0) {
            const firstFrame = stackFrames[0];
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            
            if (workspaceFolder) {
                let filePath = firstFrame.file;
                
                // If not absolute path, resolve relative to workspace
                if (!require('path').isAbsolute(filePath)) {
                    filePath = require('path').join(workspaceFolder.uri.fsPath, filePath);
                }
                
                try {
                    const fileUri = vscode.Uri.file(filePath);
                    const position = new vscode.Position(Math.max(0, firstFrame.line - 1), 0);
                    message.location = new vscode.Location(fileUri, position);
                } catch (e) {
                    // If we can't create the location, continue without it
                }
            }
        }
        
        return message;
    }

    private updatePackageTestStatus(pkg: string, testName: string, status: 'pass' | 'fail' | 'skip'): void {
        if (!this.packageTestStatus.has(pkg)) {
            this.packageTestStatus.set(pkg, new Map());
        }
        this.packageTestStatus.get(pkg)!.set(testName, status);
    }

    private collapsePassedPackages(): void {
        // VS Code Test Explorer will automatically manage tree state
        // We track package status for potential future use
        // The test results shown in the UI will naturally show failures prominently
        for (const [, pkgItem] of this.controller.items) {
            const pkgId = pkgItem.id;
            const testStatuses = this.packageTestStatus.get(pkgId);
            
            if (testStatuses && testStatuses.size > 0) {
                const allPassed = Array.from(testStatuses.values()).every(status => status === 'pass');
                
                // Set description to indicate all tests passed
                if (allPassed) {
                    const testCount = testStatuses.size;
                    pkgItem.description = `✓ All ${testCount} tests passed`;
                } else {
                    const failedCount = Array.from(testStatuses.values()).filter(s => s === 'fail').length;
                    if (failedCount > 0) {
                        pkgItem.description = `✗ ${failedCount} failed`;
                    }
                }
            }
        }
    }

    async clearAllResults(): Promise<void> {
        this.testResults.clear();
        this.failedTestsOutput.clear();
        this.packageTestStatus.clear();
        this.outputBuffer = [];
        this.outputBufferSize = 0;
        this.outputChannel.clear();
        
        // Re-discover tests to get the latest test items (fast parallel discovery)
        await this.testDiscovery.discoverTests();
        
        // Clear test results in the VS Code Test Explorer UI (batched)
        const itemsToInvalidate: vscode.TestItem[] = [];
        for (const [, pkgItem] of this.controller.items) {
            pkgItem.description = undefined;
            itemsToInvalidate.push(pkgItem);
            for (const [, testItem] of pkgItem.children) {
                itemsToInvalidate.push(testItem);
            }
        }
        
        for (const item of itemsToInvalidate) {
            this.controller.invalidateTestResults(item);
        }
        
        this.outputChannel.appendLine('All test results cleared');
    }
}
