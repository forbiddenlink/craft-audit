import * as vscode from 'vscode';

export interface CraftAuditConfig {
    enable: boolean;
    executablePath: string;
    configPath: string;
    runOnSave: boolean;
    runOnOpen: boolean;
    severity: Record<string, string>;
    timeout: number;
}

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
            info: 'Information'
        }),
        timeout: config.get('timeout', 30000)
    };
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
