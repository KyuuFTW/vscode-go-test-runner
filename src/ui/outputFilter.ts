import * as vscode from 'vscode';

export enum FilterMode {
    All = 'all',
    Failed = 'failed',
    Passed = 'passed',
    Skipped = 'skipped'
}

export class OutputFilter {
    private currentFilter: FilterMode = FilterMode.All;
    private statusBarItem: vscode.StatusBarItem;

    constructor(context: vscode.ExtensionContext) {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'goTestRunner.toggleOutputFilter';
        this.updateStatusBar();
        this.statusBarItem.show();
        
        context.subscriptions.push(this.statusBarItem);
    }

    async toggleFilter(): Promise<void> {
        const options: vscode.QuickPickItem[] = [
            { label: '$(checklist) All Tests', description: 'Show all test output', picked: this.currentFilter === FilterMode.All },
            { label: '$(error) Failed Only', description: 'Show only failed tests', picked: this.currentFilter === FilterMode.Failed },
            { label: '$(pass) Passed Only', description: 'Show only passed tests', picked: this.currentFilter === FilterMode.Passed },
            { label: '$(circle-slash) Skipped Only', description: 'Show only skipped tests', picked: this.currentFilter === FilterMode.Skipped }
        ];

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'Select test output filter'
        });

        if (selected) {
            switch (selected.label) {
                case '$(checklist) All Tests':
                    this.currentFilter = FilterMode.All;
                    break;
                case '$(error) Failed Only':
                    this.currentFilter = FilterMode.Failed;
                    break;
                case '$(pass) Passed Only':
                    this.currentFilter = FilterMode.Passed;
                    break;
                case '$(circle-slash) Skipped Only':
                    this.currentFilter = FilterMode.Skipped;
                    break;
            }
            this.updateStatusBar();
        }
    }

    getFilter(): FilterMode {
        return this.currentFilter;
    }

    shouldShowTest(status: 'pass' | 'fail' | 'skip'): boolean {
        if (this.currentFilter === FilterMode.All) {
            return true;
        }
        
        switch (this.currentFilter) {
            case FilterMode.Failed:
                return status === 'fail';
            case FilterMode.Passed:
                return status === 'pass';
            case FilterMode.Skipped:
                return status === 'skip';
            default:
                return true;
        }
    }

    private updateStatusBar(): void {
        const icons = {
            [FilterMode.All]: '$(checklist)',
            [FilterMode.Failed]: '$(error)',
            [FilterMode.Passed]: '$(pass)',
            [FilterMode.Skipped]: '$(circle-slash)'
        };
        
        const labels = {
            [FilterMode.All]: 'All',
            [FilterMode.Failed]: 'Failed',
            [FilterMode.Passed]: 'Passed',
            [FilterMode.Skipped]: 'Skipped'
        };

        this.statusBarItem.text = `${icons[this.currentFilter]} Filter: ${labels[this.currentFilter]}`;
        this.statusBarItem.tooltip = 'Click to change test output filter';
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }
}
