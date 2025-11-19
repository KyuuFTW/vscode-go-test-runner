import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { ProfileManager } from '../config/profileManager';

interface TestEvent {
    Time?: string;
    Action: string;
    Package?: string;
    Test?: string;
    Output?: string;
    Elapsed?: number;
}

export class TestRunner {
    private outputChannel: vscode.OutputChannel;

    constructor(
        private controller: vscode.TestController,
        private profileManager: ProfileManager
    ) {
        this.outputChannel = vscode.window.createOutputChannel('Go Test Runner');
        this.outputChannel.show(true);
    }

    async runTests(
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken
    ): Promise<void> {
        const run = this.controller.createTestRun(request);
        const profile = this.profileManager.getActiveProfile();

        try {
            if (request.include) {
                for (const test of request.include) {
                    await this.runTest(test, run, profile);
                }
            } else {
                await this.runAllTestsInternal(run, profile);
            }
        } finally {
            run.end();
        }
    }

    async runAllTests(): Promise<void> {
        const run = this.controller.createTestRun(new vscode.TestRunRequest());
        const profile = this.profileManager.getActiveProfile();

        try {
            await this.runAllTestsInternal(run, profile);
        } finally {
            run.end();
        }
    }

    private async runAllTestsInternal(
        run: vscode.TestRun,
        profile: any
    ): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        return new Promise((resolve, reject) => {
            const args = ['test', '-json', ...profile.testFlags, './...'];
            
            const proc = spawn('go', args, {
                cwd: workspaceFolder.uri.fsPath,
                env: { ...process.env, ...profile.testEnvVars }
            });

            let buffer = '';

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
                resolve();
            });

            proc.on('error', (err) => {
                reject(err);
            });
        });
    }

    private async runTest(
        test: vscode.TestItem,
        run: vscode.TestRun,
        profile: any
    ): Promise<void> {
        run.started(test);
        
        const testId = test.id;
        const parts = testId.split('/');
        
        if (parts.length === 2) {
            const [pkg, testName] = parts;
            await this.runSpecificTest(pkg, testName, test, run, profile);
        } else if (parts.length === 1) {
            await this.runPackageTests(parts[0], test, run, profile);
        }
    }

    private async runSpecificTest(
        pkg: string,
        testName: string,
        test: vscode.TestItem,
        run: vscode.TestRun,
        profile: any
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

            proc.on('close', () => resolve());
        });
    }

    private async runPackageTests(
        pkg: string,
        test: vscode.TestItem,
        run: vscode.TestRun,
        profile: any
    ): Promise<void> {
        test.children.forEach(child => run.started(child));
        await this.runSpecificTest(pkg, '', test, run, profile);
    }

    private handleTestEvent(event: TestEvent, run: vscode.TestRun): void {
        // Log all events to output channel for debugging
        this.outputChannel.appendLine(`Event: ${JSON.stringify(event)}`);
        
        if (!event.Package || !event.Test) {
            if (event.Output) {
                this.outputChannel.appendLine(event.Output);
            }
            return;
        }

        const testId = `${event.Package}/${event.Test}`;
        const testItem = this.findTestItem(testId);

        if (!testItem) {
            this.outputChannel.appendLine(`Test item not found: ${testId}`);
            return;
        }

        switch (event.Action) {
            case 'run':
                run.started(testItem);
                this.outputChannel.appendLine(`Started: ${testId}`);
                break;
            case 'pass':
                run.passed(testItem, event.Elapsed ? event.Elapsed * 1000 : undefined);
                this.outputChannel.appendLine(`Passed: ${testId} (${event.Elapsed}s)`);
                break;
            case 'fail':
                const message = new vscode.TestMessage('Test failed');
                run.failed(testItem, message, event.Elapsed ? event.Elapsed * 1000 : undefined);
                this.outputChannel.appendLine(`Failed: ${testId} (${event.Elapsed}s)`);
                break;
            case 'skip':
                run.skipped(testItem);
                this.outputChannel.appendLine(`Skipped: ${testId}`);
                break;
            case 'output':
                if (event.Output) {
                    run.appendOutput(event.Output.replace(/\n/g, '\r\n'));
                    this.outputChannel.append(event.Output);
                }
                break;
        }
    }

    private findTestItem(id: string): vscode.TestItem | undefined {
        const parts = id.split('/');
        if (parts.length < 2) {
            return undefined;
        }

        // Reconstruct package path (everything except last part which is test name)
        const testName = parts[parts.length - 1];
        const pkg = parts.slice(0, -1).join('/');
        
        // First try to find by exact ID
        this.controller.items.forEach(pkgItem => {
            const found = pkgItem.children.get(id);
            if (found) {
                return found;
            }
        });
        
        // Try to find the package item
        const pkgItem = this.controller.items.get(pkg);
        if (!pkgItem) {
            this.outputChannel.appendLine(`Package not found: ${pkg}`);
            return undefined;
        }

        // Get the test item from the package
        const testItem = pkgItem.children.get(id);
        if (!testItem) {
            this.outputChannel.appendLine(`Test not found in package ${pkg}: ${id}`);
            this.outputChannel.appendLine(`Available tests in package:`);
            pkgItem.children.forEach(child => {
                this.outputChannel.appendLine(`  - ${child.id}`);
            });
        }
        return testItem;
    }
}
