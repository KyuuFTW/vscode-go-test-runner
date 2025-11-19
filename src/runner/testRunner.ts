import * as vscode from 'vscode';
import { spawn, execSync } from 'child_process';
import { ProfileManager } from '../config/profileManager';
import { OutputFilter } from '../ui/outputFilter';

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
    output: string[];
}

interface StackFrame {
    file: string;
    line: number;
    text: string;
}

export class TestRunner {
    private outputChannel: vscode.OutputChannel;
    private testResults: Map<string, TestResult>;
    private outputFilter?: OutputFilter;

    constructor(
        private controller: vscode.TestController,
        private profileManager: ProfileManager,
        outputFilter?: OutputFilter
    ) {
        this.outputChannel = vscode.window.createOutputChannel('Go Test Runner');
        this.testResults = new Map();
        this.outputFilter = outputFilter;
    }

    async runTests(
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken
    ): Promise<void> {
        const run = this.controller.createTestRun(request);
        const profile = this.profileManager.getActiveProfile();
        
        this.testResults.clear();
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
            run.end();
            this.displayTestSummary();
        }
    }

    async runAllTests(): Promise<void> {
        const run = this.controller.createTestRun(new vscode.TestRunRequest());
        const profile = this.profileManager.getActiveProfile();
        const tokenSource = new vscode.CancellationTokenSource();
        
        this.testResults.clear();
        this.outputChannel.clear();
        this.outputChannel.show(true);

        try {
            await this.runAllTestsInternal(run, profile, tokenSource.token);
        } finally {
            run.end();
            this.displayTestSummary();
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
        this.outputChannel.appendLine('Preparing tests...');
        try {
            this.outputChannel.appendLine('Running: go generate ./...');
            execSync('go generate ./...', { 
                cwd: workspaceFolder.uri.fsPath,
                encoding: 'utf-8'
            });
            
            this.outputChannel.appendLine('Running: go clean -testcache');
            execSync('go clean -testcache', { 
                cwd: workspaceFolder.uri.fsPath,
                encoding: 'utf-8'
            });
            this.outputChannel.appendLine('Tests prepared successfully\n');
        } catch (error) {
            this.outputChannel.appendLine(`Warning during preparation: ${error}\n`);
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
                this.outputChannel.appendLine('\n[Test run cancelled by user]');
                cleanup();
                resolve();
            });

            proc.stdout.on('data', (data) => {
                buffer += data.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const event: TestEvent = JSON.parse(line);
                            this.handleTestEvent(event, run);
                        } catch (e) {
                            console.error('Error parsing JSON:', line);
                        }
                    }
                }
            });

            proc.stderr.on('data', (data) => {
                this.outputChannel.appendLine(data.toString());
            });

            proc.on('close', (code) => {
                if (!cancelled) {
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
        const parts = testId.split('/');
        
        if (parts.length === 2) {
            const [pkg, testName] = parts;
            await this.runSpecificTest(pkg, testName, test, run, profile, token);
        } else if (parts.length === 1) {
            await this.runPackageTests(parts[0], test, run, profile, token);
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
                this.outputChannel.appendLine('\n[Test run cancelled by user]');
                cleanup();
                resolve();
            });

            proc.stdout.on('data', (data) => {
                buffer += data.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const event: TestEvent = JSON.parse(line);
                            this.handleTestEvent(event, run);
                        } catch (e) {
                            console.error('Error parsing JSON:', line);
                        }
                    }
                }
            });

            proc.stderr.on('data', (data) => {
                const output = data.toString();
                this.outputChannel.appendLine(output);
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
                this.outputChannel.appendLine('\n[Test run cancelled by user]');
                cleanup();
                resolve();
            });

            proc.stdout.on('data', (data) => {
                buffer += data.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim()) {
                        try {
                            const event: TestEvent = JSON.parse(line);
                            this.handleTestEvent(event, run);
                        } catch (e) {
                            console.error('Error parsing JSON:', line);
                        }
                    }
                }
            });

            proc.stderr.on('data', (data) => {
                const output = data.toString();
                this.outputChannel.appendLine(output);
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
                this.outputChannel.appendLine(event.Output.trimEnd());
            }
            return;
        }

        const testId = `${event.Package}/${event.Test}`;
        const testItem = this.findTestItem(testId);

        if (!testItem) {
            // Log when test item not found for debugging
            if (event.Action === 'run') {
                this.outputChannel.appendLine(`[DEBUG] Test item not found for: ${testId}`);
            }
            return;
        }

        // Initialize test result if needed
        if (!this.testResults.has(testId)) {
            this.testResults.set(testId, {
                id: testId,
                name: event.Test,
                status: 'pass',
                output: []
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
                break;
            case 'fail':
                result.status = 'fail';
                result.elapsed = event.Elapsed;
                const failureOutput = result.output.join('');
                const message = this.createTestMessageWithLocation(failureOutput || 'Test failed', testItem);
                run.failed(testItem, message, event.Elapsed ? event.Elapsed * 1000 : undefined);
                break;
            case 'skip':
                result.status = 'skip';
                run.skipped(testItem);
                break;
            case 'output':
                if (event.Output) {
                    result.output.push(event.Output);
                    run.appendOutput(event.Output.replace(/\n/g, '\r\n'), undefined, testItem);
                }
                break;
        }
    }

    private displayTestSummary(): void {
        const passed: TestResult[] = [];
        const failed: TestResult[] = [];
        const skipped: TestResult[] = [];

        for (const result of this.testResults.values()) {
            if (result.status === 'pass') {
                passed.push(result);
            } else if (result.status === 'fail') {
                failed.push(result);
            } else {
                skipped.push(result);
            }
        }

        // Header
        this.outputChannel.appendLine('');
        this.outputChannel.appendLine('═══════════════════════════════════════════════════════════════');
        this.outputChannel.appendLine('                        TEST RESULTS SUMMARY');
        this.outputChannel.appendLine('═══════════════════════════════════════════════════════════════');
        this.outputChannel.appendLine('');
        this.outputChannel.appendLine(`Total: ${this.testResults.size} | ✓ Passed: ${passed.length} | ✗ Failed: ${failed.length} | ⊘ Skipped: ${skipped.length}`);
        this.outputChannel.appendLine('');

        // Failed tests first (most important)
        if (failed.length > 0) {
            this.outputChannel.appendLine('───────────────────────────────────────────────────────────────');
            this.outputChannel.appendLine('  ✗ FAILED TESTS');
            this.outputChannel.appendLine('───────────────────────────────────────────────────────────────');
            this.outputChannel.appendLine('');
            
            for (const result of failed) {
                this.displayTestResult(result, '✗');
            }
        }

        // Passed tests
        if (passed.length > 0) {
            this.outputChannel.appendLine('───────────────────────────────────────────────────────────────');
            this.outputChannel.appendLine('  ✓ PASSED TESTS');
            this.outputChannel.appendLine('───────────────────────────────────────────────────────────────');
            this.outputChannel.appendLine('');
            
            for (const result of passed) {
                this.displayTestResult(result, '✓');
            }
        }

        // Skipped tests
        if (skipped.length > 0) {
            this.outputChannel.appendLine('───────────────────────────────────────────────────────────────');
            this.outputChannel.appendLine('  ⊘ SKIPPED TESTS');
            this.outputChannel.appendLine('───────────────────────────────────────────────────────────────');
            this.outputChannel.appendLine('');
            
            for (const result of skipped) {
                this.displayTestResult(result, '⊘');
            }
        }

        this.outputChannel.appendLine('═══════════════════════════════════════════════════════════════');
    }

    private displayTestResult(result: TestResult, icon: string): void {
        // Apply filter
        if (this.outputFilter && !this.outputFilter.shouldShowTest(result.status)) {
            return;
        }
        
        const elapsed = result.elapsed ? ` (${result.elapsed.toFixed(3)}s)` : '';
        this.outputChannel.appendLine(`${icon} ${result.id}${elapsed}`);
        
        if (result.output.length > 0) {
            this.outputChannel.appendLine('  Output:');
            for (const line of result.output) {
                // Indent each line of output
                const trimmed = line.trimEnd();
                if (trimmed) {
                    this.outputChannel.appendLine(`    ${trimmed}`);
                }
            }
        }
        
        this.outputChannel.appendLine('');
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
}
