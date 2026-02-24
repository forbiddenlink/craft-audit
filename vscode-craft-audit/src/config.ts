import * as vscode from 'vscode';

export interface CraftAuditConfig {
    enable: boolean;
    executablePath: string;
    configPath: string;
    runOnSave: boolean;
    runOnOpen: boolean;
    severity: Record<string, string>;
    timeout: number;
    cliPath: string;
    qualityGate: string;
    minimumSeverity: string;
}

const SEVERITY_ORDER: Record<string, number> = {
    info: 0,
    low: 1,
    medium: 2,
    high: 3,
};

export function getConfig(): CraftAuditConfig {
    const config = vscode.workspace.getConfiguration('craftAudit');

    return {
        enable: config.get('enable', true),
        executablePath: config.get('executablePath', 'craft-audit'),
        configPath: config.get('configPath', ''),
        runOnSave: config.get('runOnSave', true),
        runOnOpen: config.get('runOnOpen', true),
        severity: config.get('severity', {
            high: 'Error',
            medium: 'Warning',
            low: 'Information',
            info: 'Hint'
        }),
        timeout: config.get('timeout', 30000),
        cliPath: config.get('cliPath', 'npx craft-audit'),
        qualityGate: config.get('qualityGate', ''),
        minimumSeverity: config.get('minimumSeverity', 'info'),
    };
}

export function meetsMinimumSeverity(severity: string, minimumSeverity: string): boolean {
    const level = SEVERITY_ORDER[severity] ?? 0;
    const threshold = SEVERITY_ORDER[minimumSeverity] ?? 0;
    return level >= threshold;
}

export function mapSeverity(craftSeverity: string, config: CraftAuditConfig): vscode.DiagnosticSeverity {
    const mapping = config.severity[craftSeverity] || 'Warning';

    switch (mapping) {
        case 'Error':
            return vscode.DiagnosticSeverity.Error;
        case 'Warning':
            return vscode.DiagnosticSeverity.Warning;
        case 'Information':
            return vscode.DiagnosticSeverity.Information;
        case 'Hint':
            return vscode.DiagnosticSeverity.Hint;
        default:
            return vscode.DiagnosticSeverity.Warning;
    }
}
