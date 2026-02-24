import * as vscode from 'vscode';
import { DiagnosticsManager, diagnosticFixData } from './diagnostics';
import { CraftAuditFix } from './runner';

export class SuppressCodeActionProvider implements vscode.CodeActionProvider {
    constructor(private diagnosticsManager: DiagnosticsManager) {}

    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        // Only provide actions for craft-audit diagnostics
        const craftAuditDiagnostics = context.diagnostics.filter(
            d => d.source === 'craft-audit'
        );

        if (craftAuditDiagnostics.length === 0) {
            return actions;
        }

        // Add fix actions first (they appear at top of menu)
        for (const diagnostic of craftAuditDiagnostics) {
            const data = diagnosticFixData.get(diagnostic);
            if (data?.fix) {
                const fixAction = this.createFixAction(document, diagnostic, data.fix);
                if (fixAction) {
                    actions.push(fixAction);
                }
            }
        }

        // Get unique rule IDs from diagnostics on this line
        const ruleIds = new Set<string>();
        for (const diagnostic of craftAuditDiagnostics) {
            if (diagnostic.code && typeof diagnostic.code === 'string') {
                ruleIds.add(diagnostic.code);
            }
        }

        // Add suppress action for each rule
        for (const ruleId of ruleIds) {
            const action = this.createSuppressAction(document, range.start.line, ruleId);
            actions.push(action);
        }

        // Add "suppress all" action
        if (ruleIds.size >= 1) {
            const action = this.createSuppressAllAction(document, range.start.line);
            actions.push(action);
        }

        return actions;
    }

    private createFixAction(
        document: vscode.TextDocument,
        diagnostic: vscode.Diagnostic,
        fix: CraftAuditFix
    ): vscode.CodeAction | null {
        const line = diagnostic.range.start.line;
        const lineText = document.lineAt(line).text;

        // Find the search string on this line
        const searchIndex = lineText.indexOf(fix.search);
        if (searchIndex === -1) {
            return null;
        }

        const label = fix.safe
            ? `Fix: ${fix.description}`
            : `Fix (unsafe): ${fix.description}`;

        const action = new vscode.CodeAction(label, vscode.CodeActionKind.QuickFix);

        // Safe fixes are preferred (appear first, work with "Fix All")
        action.isPreferred = fix.safe;
        action.diagnostics = [diagnostic];

        // Create the edit
        const edit = new vscode.WorkspaceEdit();
        const start = new vscode.Position(line, searchIndex);
        const end = new vscode.Position(line, searchIndex + fix.search.length);
        edit.replace(document.uri, new vscode.Range(start, end), fix.replacement);

        action.edit = edit;
        return action;
    }

    private createSuppressAction(
        document: vscode.TextDocument,
        line: number,
        ruleId: string
    ): vscode.CodeAction {
        const action = new vscode.CodeAction(
            `Suppress craft-audit rule: ${ruleId}`,
            vscode.CodeActionKind.QuickFix
        );

        const edit = new vscode.WorkspaceEdit();
        const lineText = document.lineAt(line).text;
        const indent = lineText.match(/^\s*/)?.[0] || '';

        const suppressComment = `${indent}{# craft-audit-disable-next-line ${ruleId} #}\n`;
        const position = new vscode.Position(line, 0);

        edit.insert(document.uri, position, suppressComment);
        action.edit = edit;

        return action;
    }

    private createSuppressAllAction(
        document: vscode.TextDocument,
        line: number
    ): vscode.CodeAction {
        const action = new vscode.CodeAction(
            'Suppress all craft-audit rules for this line',
            vscode.CodeActionKind.QuickFix
        );

        const edit = new vscode.WorkspaceEdit();
        const lineText = document.lineAt(line).text;
        const indent = lineText.match(/^\s*/)?.[0] || '';

        const suppressComment = `${indent}{# craft-audit-disable-next-line #}\n`;
        const position = new vscode.Position(line, 0);

        edit.insert(document.uri, position, suppressComment);
        action.edit = edit;

        return action;
    }
}
