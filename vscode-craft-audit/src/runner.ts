import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'node:child_process';
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
    sourceContext?: string;
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
        sourceContext?: string;
        fix?: {
            safe: boolean;
            search: string;
            replacement: string;
            description: string;
        };
    }>;
}

export class CraftAuditRunner {
    private runningProcesses = new Set<ChildProcess>();

    constructor(private outputChannel: vscode.OutputChannel) {}

    async analyzeFile(filePath: string, config: CraftAuditConfig): Promise<CraftAuditIssue[]> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Window,
                title: `Craft Audit: analyzing ${path.basename(filePath)}`,
            },
            async () => {
                // The templates command takes a directory path, not individual files.
                // Pass the file's directory and filter results to the target file.
                const templateDir = path.dirname(filePath);
                const args = ['templates', templateDir, '--output', 'json', '--cache'];

                if (config.configPath) {
                    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                    if (workspaceFolder) {
                        args.push('--config', path.join(workspaceFolder.uri.fsPath, config.configPath));
                    }
                }

                if (config.qualityGate) {
                    args.push('--quality-gate', config.qualityGate);
                }

                const output = await this.runCommand(config.executablePath, args, config.timeout);
                const allIssues = this.parseOutput(output);
                // Filter to only issues for the target file
                const normalizedTarget = path.resolve(filePath);
                return allIssues.filter(issue => path.resolve(issue.file) === normalizedTarget);
            }
        );
    }

    async analyzeWorkspace(config: CraftAuditConfig): Promise<Map<string, CraftAuditIssue[]>> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Craft Audit: analyzing workspace',
                cancellable: true,
            },
            async (_progress, token) => {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (!workspaceFolder) {
                    return new Map();
                }

                const args = ['audit', workspaceFolder.uri.fsPath, '--output', 'json', '--cache'];

                if (config.configPath) {
                    args.push('--config', path.join(workspaceFolder.uri.fsPath, config.configPath));
                }

                if (config.qualityGate) {
                    args.push('--quality-gate', config.qualityGate);
                }

                const output = await this.runCommand(config.executablePath, args, config.timeout, token);
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
        );
    }

    async clearCache(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceFolder) {
            return;
        }

        return new Promise((resolve, reject) => {
            const proc = spawn('npx', ['craft-audit', 'cache', '--clear'], {
                cwd: workspaceFolder,
                shell: true,
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Failed to clear cache (exit code ${code})`));
                }
            });

            proc.on('error', reject);
        });
    }

    private runCommand(
        executable: string,
        args: string[],
        timeoutMs: number,
        cancellation?: vscode.CancellationToken
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

            this.outputChannel.appendLine(`Running: ${executable} ${args.join(' ')}`);

            const proc = spawn(executable, args, {
                cwd: workspaceFolder,
            });

            this.runningProcesses.add(proc);

            // Support cancellation from VS Code progress dialog
            const cancelListener = cancellation?.onCancellationRequested(() => {
                proc.kill();
                reject(new Error('Analysis cancelled'));
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
                cancelListener?.dispose();
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                    reject(new Error(
                        `craft-audit not found. Install it with: npm install -g craft-audit\n` +
                        `Or set craftAudit.executablePath to the correct path.`
                    ));
                } else {
                    reject(error);
                }
            });

            proc.on('close', (_code) => {
                this.runningProcesses.delete(proc);
                cancelListener?.dispose();

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

            // Timeout after configured duration
            setTimeout(() => {
                proc.kill();
                reject(new Error(`craft-audit timed out after ${timeoutMs / 1000} seconds`));
            }, timeoutMs);
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
                fix: issue.fix,
                sourceContext: issue.sourceContext,
            }));
        } catch (error) {
            this.outputChannel.appendLine(`Failed to parse output: ${error}`);
            this.outputChannel.appendLine(`Raw output: ${output}`);
            return [];
        }
    }

    dispose() {
        for (const proc of this.runningProcesses) {
            proc.kill();
        }
        this.runningProcesses.clear();
    }
}
