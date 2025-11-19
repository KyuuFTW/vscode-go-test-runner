import * as vscode from 'vscode';
import { ProfileManager } from './config/profileManager';
import { TestDiscovery } from './discovery/testDiscovery';
import { TestRunner } from './runner/testRunner';
import { OutputFilter } from './ui/outputFilter';

export class TestController {
    private controller: vscode.TestController;
    private profileManager: ProfileManager;
    private testDiscovery: TestDiscovery;
    private testRunner: TestRunner;
    private statusBarItem: vscode.StatusBarItem;
    private outputFilter: OutputFilter;

    constructor(private context: vscode.ExtensionContext) {
        this.controller = vscode.tests.createTestController(
            'goTestRunner',
            'Go Test Runner'
        );
        
        this.profileManager = new ProfileManager();
        this.testDiscovery = new TestDiscovery(this.controller);
        this.outputFilter = new OutputFilter(context);
        this.testRunner = new TestRunner(this.controller, this.profileManager, this.testDiscovery, this.outputFilter);
        
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.statusBarItem.command = 'goTestRunner.selectProfile';
        this.updateStatusBar();
        this.statusBarItem.show();
        
        context.subscriptions.push(
            this.controller,
            this.statusBarItem,
            this.outputFilter
        );
        
        // Create run profile with clear labeling
        this.controller.createRunProfile(
            'Go Test Runner',
            vscode.TestRunProfileKind.Run,
            (request, token) => this.testRunner.runTests(request, token),
            true,
            undefined,
            true
        );
        
        // Create debug profile
        this.controller.createRunProfile(
            'Go Test Runner (Debug)',
            vscode.TestRunProfileKind.Debug,
            (request, token) => this.testRunner.runTests(request, token),
            false
        );
        
        this.refreshTests();
    }

    async refreshTests(): Promise<void> {
        await this.testDiscovery.discoverTests();
        vscode.window.showInformationMessage('Tests refreshed');
    }

    async selectProfile(): Promise<void> {
        const profile = await this.profileManager.selectProfile();
        if (profile) {
            this.updateStatusBar();
            vscode.window.showInformationMessage(`Switched to profile: ${profile.name}`);
        }
    }

    async runAllTests(): Promise<void> {
        await this.testRunner.runAllTests();
    }

    async toggleOutputFilter(): Promise<void> {
        await this.outputFilter.toggleFilter();
    }

    async clearAllResults(): Promise<void> {
        await this.testRunner.clearAllResults();
        vscode.window.showInformationMessage('All test results cleared');
    }

    private updateStatusBar(): void {
        const profile = this.profileManager.getActiveProfile();
        this.statusBarItem.text = `$(beaker) ${profile.name}`;
        this.statusBarItem.tooltip = `Active test profile: ${profile.name}`;
    }

    dispose(): void {
        this.controller.dispose();
        this.statusBarItem.dispose();
        this.outputFilter.dispose();
    }
}
