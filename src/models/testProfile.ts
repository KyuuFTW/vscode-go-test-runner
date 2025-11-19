export interface TestProfile {
    name: string;
    testFlags: string[];
    testEnvVars: { [key: string]: string };
}
