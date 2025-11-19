import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';

const execAsync = promisify(exec);

interface PackageTests {
    package: string;
    tests: string[];
}

export class TestDiscovery {
    private outputChannel: vscode.OutputChannel;

    constructor(private controller: vscode.TestController) {
        this.outputChannel = vscode.window.createOutputChannel('Go Test Discovery');
    }

    async discoverTests(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        const startTime = Date.now();
        this.controller.items.replace([]);

        try {
            // Discover all tests in parallel using file-based approach
            const packageTests = await this.findAllTests(workspaceFolder.uri.fsPath);
            
            for (const { package: pkg, tests } of packageTests) {
                if (tests.length > 0) {
                    const pkgItem = this.controller.createTestItem(
                        pkg,
                        pkg,
                        vscode.Uri.file(workspaceFolder.uri.fsPath)
                    );
                    
                    for (const test of tests) {
                        const testItem = this.controller.createTestItem(
                            `${pkg}/${test}`,
                            test,
                            pkgItem.uri
                        );
                        pkgItem.children.add(testItem);
                    }
                    
                    this.controller.items.add(pkgItem);
                }
            }
            
            const elapsed = Date.now() - startTime;
            this.outputChannel.appendLine(`Test discovery completed in ${elapsed}ms - found ${packageTests.reduce((sum, p) => sum + p.tests.length, 0)} tests in ${packageTests.length} packages`);
        } catch (error) {
            console.error('Error discovering tests:', error);
            this.outputChannel.appendLine(`Error discovering tests: ${error}`);
        }
    }

    private async findAllTests(workspaceRoot: string): Promise<PackageTests[]> {
        try {
            // Find all *_test.go files
            const testFiles = await vscode.workspace.findFiles(
                new vscode.RelativePattern(workspaceRoot, '**/*_test.go'),
                '**/vendor/**'
            );

            if (testFiles.length === 0) {
                return [];
            }

            // Group files by package directory
            const packageMap = new Map<string, vscode.Uri[]>();
            
            for (const file of testFiles) {
                const dir = path.dirname(file.fsPath);
                if (!packageMap.has(dir)) {
                    packageMap.set(dir, []);
                }
                packageMap.get(dir)!.push(file);
            }

            // Process packages in parallel with concurrency limit
            const results = await this.processPackagesConcurrently(
                Array.from(packageMap.entries()),
                workspaceRoot,
                10 // Max concurrent operations
            );

            return results.filter(r => r.tests.length > 0);
        } catch (error) {
            console.error('Error finding test files:', error);
            return [];
        }
    }

    private async processPackagesConcurrently(
        packageDirs: [string, vscode.Uri[]][],
        workspaceRoot: string,
        concurrency: number
    ): Promise<PackageTests[]> {
        const results: PackageTests[] = [];
        const queue = [...packageDirs];
        const inProgress: Promise<void>[] = [];

        const processNext = async () => {
            while (queue.length > 0) {
                const item = queue.shift();
                if (!item) break;

                const [dir, files] = item;
                const tests = await this.extractTestsFromFiles(files);
                
                if (tests.length > 0) {
                    // Get package name
                    const pkg = await this.getPackageName(dir, workspaceRoot);
                    if (pkg) {
                        results.push({ package: pkg, tests });
                    }
                }
            }
        };

        // Start concurrent workers
        for (let i = 0; i < concurrency && i < packageDirs.length; i++) {
            inProgress.push(processNext());
        }

        await Promise.all(inProgress);
        return results;
    }

    private async extractTestsFromFiles(files: vscode.Uri[]): Promise<string[]> {
        const testNames = new Set<string>();
        
        // Read all files in parallel
        const fileContents = await Promise.all(
            files.map(file => fs.readFile(file.fsPath, 'utf-8').catch(() => ''))
        );

        // Extract test function names using regex
        const testFuncRegex = /func\s+(Test\w+)\s*\(/g;
        
        for (const content of fileContents) {
            let match;
            while ((match = testFuncRegex.exec(content)) !== null) {
                testNames.add(match[1]);
            }
        }

        return Array.from(testNames).sort();
    }

    private async getPackageName(dir: string, workspaceRoot: string): Promise<string | null> {
        try {
            // Try to get package path from go.mod
            const { stdout } = await execAsync(
                `go list -f "{{.ImportPath}}"`,
                { cwd: dir, timeout: 5000 }
            );
            return stdout.trim();
        } catch (error) {
            // Fallback: use relative path
            const relativePath = path.relative(workspaceRoot, dir);
            if (relativePath && relativePath !== '.') {
                return relativePath.replace(/\\/g, '/');
            }
            return null;
        }
    }
}
