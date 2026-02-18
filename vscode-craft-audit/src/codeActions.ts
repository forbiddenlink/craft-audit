import * as vscode from 'vscode';
import { DiagnosticsManager } from './diagnostics';

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

        // Get unique rule IDs from diagnostics on this line
        const ruleIds = new Set<string>();
        for (const diagnostic of craftAuditDiagnostics) {
            if (diagnostic.code && typeof diagnostic.code === 'string') {
                ruleIds.add(diagnostic.code);
            }
        }

        // Add action for each rule
        for (const ruleId of ruleIds) {
            const action = this.createSuppressAction(document, range.start.line, ruleId);
            actions.push(action);
        }

        // Add "suppress all" action if multiple rules
        if (ruleIds.size > 1) {
            const action = this.createSuppressAllAction(document, range.start.line);
            actions.push(action);
        } else if (ruleIds.size === 1) {
            // Also offer suppress-all as an alternative
            const action = this.createSuppressAllAction(document, range.start.line);
            actions.push(action);
        }

        return actions;
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
