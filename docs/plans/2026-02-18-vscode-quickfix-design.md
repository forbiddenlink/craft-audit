# VS Code Quick Fix Design

Date: 2026-02-18
Status: Approved

## Overview

Add quick fix code actions to the VS Code extension, allowing one-click fixes for craft-audit issues. Safe fixes can be applied automatically; unsafe fixes require explicit selection.

## Data Flow

```
CLI JSON output (with fix field)
    ↓
runner.ts parseOutput() - extracts fix data
    ↓
diagnostics.ts issueToDiagnostic() - stores fix in diagnostic.data
    ↓
codeActions.ts - reads diagnostic.data, creates WorkspaceEdit
```

## Changes Required

### 1. runner.ts - Parse fix data

Add `fix` field to `CraftAuditIssue` interface:

```typescript
export interface CraftAuditFix {
    safe: boolean;
    search: string;
    replacement: string;
    description: string;
}

export interface CraftAuditIssue {
    // ... existing fields
    fix?: CraftAuditFix;
}
```

Update `parseOutput()` to include fix data.

### 2. diagnostics.ts - Store fix in diagnostic

Use VS Code's `Diagnostic.data` field to carry fix info:

```typescript
private issueToDiagnostic(issue: CraftAuditIssue, config): vscode.Diagnostic {
    // ... existing code

    // Store fix data for code actions
    (diagnostic as any).data = {
        fix: issue.fix,
        file: issue.file,
        line: issue.line
    };

    return diagnostic;
}
```

### 3. codeActions.ts - Add fix actions

Extend `SuppressCodeActionProvider` to also provide fix actions:

```typescript
provideCodeActions(document, range, context): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of craftAuditDiagnostics) {
        const data = (diagnostic as any).data;

        // Add fix action if available
        if (data?.fix) {
            const fixAction = this.createFixAction(document, diagnostic, data.fix);
            actions.push(fixAction);
        }

        // Add suppress action (existing)
        actions.push(this.createSuppressAction(...));
    }

    return actions;
}

private createFixAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic,
    fix: CraftAuditFix
): vscode.CodeAction {
    const label = fix.safe
        ? `Fix: ${fix.description}`
        : `Fix (unsafe): ${fix.description}`;

    const action = new vscode.CodeAction(label, vscode.CodeActionKind.QuickFix);

    // Safe fixes are preferred (appear first, work with "Fix All")
    action.isPreferred = fix.safe;
    action.diagnostics = [diagnostic];

    // Create the edit
    const edit = new vscode.WorkspaceEdit();
    const line = diagnostic.range.start.line;
    const lineText = document.lineAt(line).text;

    // Find and replace the search string on this line
    const searchIndex = lineText.indexOf(fix.search);
    if (searchIndex !== -1) {
        const start = new vscode.Position(line, searchIndex);
        const end = new vscode.Position(line, searchIndex + fix.search.length);
        edit.replace(document.uri, new vscode.Range(start, end), fix.replacement);
    }

    action.edit = edit;
    return action;
}
```

## Fix Actions Display

In VS Code's quick fix menu (lightbulb):

```
💡 Fix: Add .limit(100)                    ← Safe fix (preferred, at top)
   Suppress craft-audit rule: missing-limit
   Suppress all craft-audit rules for this line
```

For unsafe fixes:

```
💡 Fix (unsafe): Add |e before |raw        ← Not preferred, requires selection
   Suppress craft-audit rule: xss-raw-output
   ...
```

## "Fix All" Behavior

VS Code's "Fix All" command (`source.fixAll`) only applies `isPreferred` actions. This means:
- Safe fixes auto-apply with "Fix All"
- Unsafe fixes require manual selection

This matches the CLI's `--safe` vs `--unsafe` behavior.

## Configuration (Future)

Could add settings:
- `craftAudit.fixOnSave`: Apply safe fixes on save
- `craftAudit.showUnsafeFixes`: Show/hide unsafe fix suggestions

## Files to Modify

```
vscode-craft-audit/src/runner.ts      - Add fix to interface, parse from JSON
vscode-craft-audit/src/diagnostics.ts - Store fix in diagnostic.data
vscode-craft-audit/src/codeActions.ts - Add createFixAction(), update provider
```

## Testing

1. Open a .twig file with fixable issues
2. Hover over squiggly line, click lightbulb
3. Verify fix action appears with correct label
4. Apply fix, verify code changes correctly
5. Test "Fix All" only applies safe fixes
