import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { CraftAuditConfig } from './config';

export interface CraftAuditFix {
    safe: boolean;
    search: string;
    replacement: string;
    description: string;
}

export interface CraftAuditIssue {
    file: string;
    line: number;
    column?: number;
    rule: string;
    message: string;
    severity: string;
    suggestion?: string;
    fix?: CraftAuditFix;
}

interface CraftAuditOutput {
    issues: Array<{
        file: string;
        line: number;
        column?: number;
        ruleId: string;
        message: string;
        severity: string;
        suggestion?: string;
        fix?: {
            safe: boolean;
            search: string;
            replacement: string;
            description: string;
        };
    }>;
}

export class CraftAuditRunner {
    constructor(private outputChannel: vscode.OutputChannel) {}

    async analyzeFile(filePath: string, config: CraftAuditConfig): Promise<CraftAuditIssue[]> {
        const args = ['templates', '--files', filePath, '--output', 'json'];

        if (config.configPath) {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                args.push('--config', path.join(workspaceFolder.uri.fsPath, config.configPath));
            }
        }

        const output = await this.runCommand(config.executablePath, args);
        return this.parseOutput(output);
    }

    async analyzeWorkspace(config: CraftAuditConfig): Promise<Map<string, CraftAuditIssue[]>> {
        const args = ['audit', '--output', 'json'];

        if (config.configPath) {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                args.push('--config', path.join(workspaceFolder.uri.fsPath, config.configPath));
            }
        }

        const output = await this.runCommand(config.executablePath, args);
        const issues = this.parseOutput(output);

        // Group by file
        const byFile = new Map<string, CraftAuditIssue[]>();
        for (const issue of issues) {
            const existing = byFile.get(issue.file) || [];
            existing.push(issue);
            byFile.set(issue.file, existing);
        }

        return byFile;
    }

    private runCommand(executable: string, args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

            this.outputChannel.appendLine(`Running: ${executable} ${args.join(' ')}`);

            const proc = spawn(executable, args, {
                cwd: workspaceFolder,
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('error', (error) => {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                    reject(new Error(
                        `craft-audit not found. Install it with: npm install -g craft-audit\n` +
                        `Or set craftAudit.executablePath to the correct path.`
                    ));
                } else {
                    reject(error);
                }
            });

            proc.on('close', (code) => {
                if (stderr) {
                    this.outputChannel.appendLine(`stderr: ${stderr}`);
                }

                // craft-audit may exit with non-zero when issues are found
                // Only reject on actual errors (no stdout and has stderr)
                if (!stdout && stderr) {
                    reject(new Error(stderr));
                } else {
                    resolve(stdout);
                }
            });

            // Timeout after 30 seconds
            setTimeout(() => {
                proc.kill();
                reject(new Error('craft-audit timed out after 30 seconds'));
            }, 30000);
        });
    }

    private parseOutput(output: string): CraftAuditIssue[] {
        if (!output.trim()) {
            return [];
        }

        try {
            const data: CraftAuditOutput = JSON.parse(output);

            return (data.issues || []).map(issue => ({
                file: issue.file,
                line: issue.line,
                column: issue.column,
                rule: issue.ruleId,
                message: issue.message,
                severity: issue.severity,
                suggestion: issue.suggestion,
                fix: issue.fix
            }));
        } catch (error) {
            this.outputChannel.appendLine(`Failed to parse output: ${error}`);
            this.outputChannel.appendLine(`Raw output: ${output}`);
            return [];
        }
    }
}
