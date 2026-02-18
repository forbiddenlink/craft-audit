import * as vscode from 'vscode';
import { CraftAuditIssue } from './runner';
import { mapSeverity, getConfig } from './config';

export class DiagnosticsManager implements vscode.Disposable {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private issuesByUri: Map<string, CraftAuditIssue[]> = new Map();

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('craft-audit');
    }

    get totalCount(): number {
        let count = 0;
        this.diagnosticCollection.forEach((uri, diagnostics) => {
            count += diagnostics.length;
        });
        return count;
    }

    set(uri: vscode.Uri, issues: CraftAuditIssue[]) {
        const config = getConfig();
        const diagnostics = issues.map(issue => this.issueToDiagnostic(issue, config));
        this.diagnosticCollection.set(uri, diagnostics);
        this.issuesByUri.set(uri.toString(), issues);
    }

    setAll(issuesByFile: Map<string, CraftAuditIssue[]>) {
        this.clearAll();
        const config = getConfig();

        for (const [filePath, issues] of issuesByFile) {
            const uri = vscode.Uri.file(filePath);
            const diagnostics = issues.map(issue => this.issueToDiagnostic(issue, config));
            this.diagnosticCollection.set(uri, diagnostics);
            this.issuesByUri.set(uri.toString(), issues);
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
        diagnostic.code = issue.rule;

        if (issue.suggestion) {
            diagnostic.message += `\n\nSuggestion: ${issue.suggestion}`;
        }

        return diagnostic;
    }

    dispose() {
        this.diagnosticCollection.dispose();
    }
}
