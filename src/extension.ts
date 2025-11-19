import * as vscode from 'vscode';
import { TestController } from './testController';

let testController: TestController | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Go Test Runner extension activated');
    
    testController = new TestController(context);
    
    const refreshCommand = vscode.commands.registerCommand(
        'goTestRunner.refreshTests',
        () => testController?.refreshTests()
    );
    
    const selectProfileCommand = vscode.commands.registerCommand(
        'goTestRunner.selectProfile',
        () => testController?.selectProfile()
    );
    
    const runAllTestsCommand = vscode.commands.registerCommand(
        'goTestRunner.runAllTests',
        () => testController?.runAllTests()
    );
    
    const toggleFilterCommand = vscode.commands.registerCommand(
        'goTestRunner.toggleOutputFilter',
        () => testController?.toggleOutputFilter()
    );
    
    context.subscriptions.push(refreshCommand, selectProfileCommand, runAllTestsCommand, toggleFilterCommand);
    
    vscode.window.showInformationMessage('Go Test Runner is ready!');
}

export function deactivate() {
    console.log('Go Test Runner extension deactivated');
    testController?.dispose();
}
