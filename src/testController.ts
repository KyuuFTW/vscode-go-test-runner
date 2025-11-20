import * as vscode from 'vscode';
import { ProfileManager } from './config/profileManager';
import { TestDiscovery } from './discovery/testDiscovery';
import { TestRunner } from './runner/testRunner';
import { OutputFilter } from './ui/outputFilter';

export class TestController {
    private controller: vscode.TestController | undefined;
    private profileManager: ProfileManager;
    private testDiscovery: TestDiscovery | undefined;
    private testRunner: TestRunner | undefined;
    private statusBarItem: vscode.StatusBarItem;
    private outputFilter: OutputFilter;
    private configWatcher: vscode.Disposable;

    constructor(private context: vscode.ExtensionContext) {
        this.profileManager = new ProfileManager();
        this.outputFilter = new OutputFilter(context);
        
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.statusBarItem.command = 'goTestRunner.selectProfile';
        
        context.subscriptions.push(
            this.statusBarItem,
            this.outputFilter
        );
        
        // Watch for configuration changes
        this.configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('goTestRunner.enableTestController')) {
                this.handleConfigChange();
            }
            if (e.affectsConfiguration('goTestRunner.setAsDefaultRunner')) {
                this.handleDefaultRunnerChange();
            }
        });
        context.subscriptions.push(this.configWatcher);
        
        // Initialize based on current config
        this.handleConfigChange();
    }

    private handleConfigChange(): void {
        const config = vscode.workspace.getConfiguration('goTestRunner');
        const enabled = config.get<boolean>('enableTestController', true);
        
        if (enabled && !this.controller) {
            this.enableTestController();
        } else if (!enabled && this.controller) {
            this.disableTestController();
        }
    }

    private enableTestController(): void {
        this.controller = vscode.tests.createTestController(
            'goTestRunner',
            'Go Test Runner'
        );
        
        this.testDiscovery = new TestDiscovery(this.controller);
        this.testRunner = new TestRunner(this.controller, this.profileManager, this.testDiscovery, this.outputFilter);
        
        this.updateStatusBar();
        this.statusBarItem.show();
        
        this.context.subscriptions.push(this.controller);
        
        // Check if this should be the default runner
        const config = vscode.workspace.getConfiguration('goTestRunner');
        const isDefault = config.get<boolean>('setAsDefaultRunner', false);
        
        // Create run profile - not default to avoid auto-running with other test controllers
        this.controller.createRunProfile(
            'Go Test Runner',
            vscode.TestRunProfileKind.Run,
            (request, token) => this.testRunner!.runTests(request, token),
            isDefault
        );
        
        // Create debug profile
        this.controller.createRunProfile(
            'Go Test Runner (Debug)',
            vscode.TestRunProfileKind.Debug,
            (request, token) => this.testRunner!.runTests(request, token),
            false
        );
        
        this.refreshTests();
        const msg = isDefault 
            ? 'Go Test Runner controller enabled (set as default)' 
            : 'Go Test Runner controller enabled (use Test Explorer to select)';
        vscode.window.showInformationMessage(msg);
    }

    private disableTestController(): void {
        if (this.controller) {
            this.controller.dispose();
            this.controller = undefined;
            this.testDiscovery = undefined;
            this.testRunner = undefined;
            this.statusBarItem.hide();
            vscode.window.showInformationMessage('Go Test Runner controller disabled - using default Go extension');
        }
    }

    private handleDefaultRunnerChange(): void {
        if (this.controller) {
            vscode.window.showInformationMessage(
                'Default runner setting changed. Reload window to apply changes.',
                'Reload Window'
            ).then(selection => {
                if (selection === 'Reload Window') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        }
    }

    async refreshTests(): Promise<void> {
        if (!this.testDiscovery) {
            vscode.window.showWarningMessage('Test controller is disabled. Enable it in settings.');
            return;
        }
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
        if (!this.testRunner) {
            vscode.window.showWarningMessage('Test controller is disabled. Enable it in settings.');
            return;
        }
        await this.testRunner.runAllTests();
    }

    async toggleOutputFilter(): Promise<void> {
        await this.outputFilter.toggleFilter();
    }

    async clearAllResults(): Promise<void> {
        if (!this.testRunner) {
            vscode.window.showWarningMessage('Test controller is disabled. Enable it in settings.');
            return;
        }
        await this.testRunner.clearAllResults();
        vscode.window.showInformationMessage('All test results cleared');
    }

    private updateStatusBar(): void {
        const profile = this.profileManager.getActiveProfile();
        this.statusBarItem.text = `$(beaker) ${profile.name}`;
        this.statusBarItem.tooltip = `Active test profile: ${profile.name}`;
    }

    dispose(): void {
        this.controller?.dispose();
        this.statusBarItem.dispose();
        this.outputFilter.dispose();
        this.configWatcher.dispose();
    }
}
