import * as vscode from 'vscode';
import { CraftAuditIssue, CraftAuditFix } from './runner';
import { mapSeverity, getConfig, meetsMinimumSeverity } from './config';

const DOCS_BASE_URL = 'https://craft-audit.dev/rules';

export interface DiagnosticFixData {
    fix: CraftAuditFix;
    file: string;
    line: number;
}

export const diagnosticFixData = new WeakMap<vscode.Diagnostic, DiagnosticFixData>();

export class DiagnosticsManager implements vscode.Disposable {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private issuesByUri: Map<string, CraftAuditIssue[]> = new Map();

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('craft-audit');
    }

    get totalCount(): number {
        let count = 0;
        this.diagnosticCollection.forEach(() => {
            count++;
        });
        return count;
    }

    set(uri: vscode.Uri, issues: CraftAuditIssue[]) {
        const config = getConfig();
        const filtered = issues.filter(i => meetsMinimumSeverity(i.severity, config.minimumSeverity));
        const diagnostics = filtered.map(issue => this.issueToDiagnostic(issue, config));
        this.diagnosticCollection.set(uri, diagnostics);
        this.issuesByUri.set(uri.toString(), filtered);
    }

    setAll(issuesByFile: Map<string, CraftAuditIssue[]>) {
        this.clearAll();
        const config = getConfig();

        for (const [filePath, issues] of issuesByFile) {
            const uri = vscode.Uri.file(filePath);
            const filtered = issues.filter(i => meetsMinimumSeverity(i.severity, config.minimumSeverity));
            const diagnostics = filtered.map(issue => this.issueToDiagnostic(issue, config));
            this.diagnosticCollection.set(uri, diagnostics);
            this.issuesByUri.set(uri.toString(), filtered);
        }
    }

    clear(uri: vscode.Uri) {
        this.diagnosticCollection.delete(uri);
        this.issuesByUri.delete(uri.toString());
    }

    clearAll() {
        this.diagnosticCollection.clear();
        this.issuesByUri.clear();
    }

    getIssuesForUri(uri: vscode.Uri): CraftAuditIssue[] {
        return this.issuesByUri.get(uri.toString()) || [];
    }

    private issueToDiagnostic(issue: CraftAuditIssue, config: ReturnType<typeof getConfig>): vscode.Diagnostic {
        const line = Math.max(0, issue.line - 1); // VS Code is 0-indexed
        const column = Math.max(0, (issue.column || 1) - 1);

        const range = new vscode.Range(line, column, line, column + 100);
        const severity = mapSeverity(issue.severity, config);

        const diagnostic = new vscode.Diagnostic(range, issue.message, severity);
        diagnostic.source = 'craft-audit';
        diagnostic.code = {
            value: issue.rule,
            target: vscode.Uri.parse(`${DOCS_BASE_URL}/${issue.rule}`),
        };

        // Tag deprecated-* rules with DiagnosticTag.Deprecated
        if (issue.rule.startsWith('deprecated-') || issue.rule.startsWith('deprecated/')) {
            diagnostic.tags = [vscode.DiagnosticTag.Deprecated];
        }

        if (issue.suggestion) {
            diagnostic.message += `\n\nSuggestion: ${issue.suggestion}`;
        }

        // Add related information linking to docs
        const docsUri = vscode.Uri.parse(`${DOCS_BASE_URL}/${issue.rule}`);
        diagnostic.relatedInformation = [
            new vscode.DiagnosticRelatedInformation(
                new vscode.Location(docsUri, new vscode.Position(0, 0)),
                `Documentation for rule '${issue.rule}'`
            ),
        ];

        // Add source context as related info if we have it
        if (issue.sourceContext) {
            diagnostic.relatedInformation.push(
                new vscode.DiagnosticRelatedInformation(
                    new vscode.Location(
                        vscode.Uri.file(issue.file),
                        new vscode.Range(line, 0, line, 200)
                    ),
                    issue.sourceContext
                )
            );
        }

        // Store fix data for code actions
        if (issue.fix) {
            diagnosticFixData.set(diagnostic, {
                fix: issue.fix,
                file: issue.file,
                line: issue.line,
            });
        }

        return diagnostic;
    }

    dispose() {
        this.diagnosticCollection.dispose();
    }
}
