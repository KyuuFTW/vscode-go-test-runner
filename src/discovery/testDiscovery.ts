import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';

const execAsync = promisify(exec);

interface PackageTests {
    package: string;
    tests: TestInfo[];
}

interface TestInfo {
    name: string;
    uri: vscode.Uri;
    range: vscode.Range;
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
                    pkgItem.canResolveChildren = false;
                    
                    for (const testInfo of tests) {
                        const testItem = this.controller.createTestItem(
                            `${pkg}/${testInfo.name}`,
                            testInfo.name,
                            testInfo.uri
                        );
                        testItem.range = testInfo.range;
                        testItem.canResolveChildren = false;
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

    private async extractTestsFromFiles(files: vscode.Uri[]): Promise<TestInfo[]> {
        const testInfos: TestInfo[] = [];
        
        // Read all files in parallel
        const fileContents = await Promise.all(
            files.map(file => fs.readFile(file.fsPath, 'utf-8').catch(() => ''))
        );

        // Extract test function names with their locations using regex
        const testFuncRegex = /func\s+(Test\w+)\s*\(/g;
        
        for (let i = 0; i < fileContents.length; i++) {
            const content = fileContents[i];
            const file = files[i];
            const lines = content.split('\n');
            
            let match;
            testFuncRegex.lastIndex = 0; // Reset regex state
            
            while ((match = testFuncRegex.exec(content)) !== null) {
                const testName = match[1];
                const position = match.index;
                
                // Find line number
                let lineNum = 0;
                let charCount = 0;
                for (let j = 0; j < lines.length; j++) {
                    charCount += lines[j].length + 1; // +1 for newline
                    if (charCount > position) {
                        lineNum = j;
                        break;
                    }
                }
                
                const range = new vscode.Range(
                    new vscode.Position(lineNum, 0),
                    new vscode.Position(lineNum, lines[lineNum]?.length || 0)
                );
                
                testInfos.push({
                    name: testName,
                    uri: file,
                    range: range
                });
            }
        }

        return testInfos.sort((a, b) => a.name.localeCompare(b.name));
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
