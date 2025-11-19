import * as vscode from 'vscode';
import { TestProfile } from '../models/testProfile';

export class ProfileManager {
    private activeProfile: TestProfile;

    constructor() {
        this.activeProfile = this.loadActiveProfile();
    }

    getActiveProfile(): TestProfile {
        return this.activeProfile;
    }

    async selectProfile(): Promise<TestProfile | undefined> {
        const profiles = this.getProfiles();
        
        const items = profiles.map(p => ({
            label: p.name,
            description: p.testFlags.join(' '),
            profile: p
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a test profile'
        });

        if (selected) {
            this.activeProfile = selected.profile;
            this.saveActiveProfile(selected.profile.name);
            return selected.profile;
        }

        return undefined;
    }

    private getProfiles(): TestProfile[] {
        const config = vscode.workspace.getConfiguration('goTestRunner');
        const profiles = config.get<TestProfile[]>('profiles');
        
        if (!profiles || profiles.length === 0) {
            return this.getDefaultProfiles();
        }
        
        return profiles;
    }

    private getDefaultProfiles(): TestProfile[] {
        return [
            {
                name: 'Default',
                testFlags: ['-v', '-p=4', '-parallel=8'],
                testEnvVars: {}
            },
            {
                name: 'Race Detector',
                testFlags: ['-v', '-race', '-p=2', '-parallel=4'],
                testEnvVars: {}
            },
            {
                name: 'Fast',
                testFlags: ['-v', '-p=8', '-parallel=16'],
                testEnvVars: {}
            }
        ];
    }

    private loadActiveProfile(): TestProfile {
        const config = vscode.workspace.getConfiguration('goTestRunner');
        const defaultProfileName = config.get<string>('defaultProfile') || 'Default';
        
        const profiles = this.getProfiles();
        const profile = profiles.find(p => p.name === defaultProfileName);
        
        return profile || profiles[0];
    }

    private saveActiveProfile(name: string): void {
        const config = vscode.workspace.getConfiguration('goTestRunner');
        config.update('defaultProfile', name, vscode.ConfigurationTarget.Workspace);
    }
}
