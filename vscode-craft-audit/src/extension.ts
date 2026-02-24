import * as vscode from 'vscode';
import { CraftAuditRunner } from './runner';
import { DiagnosticsManager } from './diagnostics';
import { SuppressCodeActionProvider } from './codeActions';
import { getConfig } from './config';

let runner: CraftAuditRunner;
let diagnosticsManager: DiagnosticsManager;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let saveDebounceTimer: ReturnType<typeof setTimeout> | undefined;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('Craft Audit');
    runner = new CraftAuditRunner(outputChannel);
    diagnosticsManager = new DiagnosticsManager();

    // Status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'craftAudit.scanFile';
    updateStatusBar(0);
    statusBarItem.show();

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('craftAudit.scanFile', () => scanCurrentFile()),
        vscode.commands.registerCommand('craftAudit.scanWorkspace', () => scanWorkspace()),
        vscode.commands.registerCommand('craftAudit.clearDiagnostics', () => clearDiagnostics()),
        vscode.commands.registerCommand('craftAudit.showOutput', () => outputChannel.show()),
        vscode.commands.registerCommand('craftAudit.runAudit', () => scanWorkspace()),
        vscode.commands.registerCommand('craftAudit.clearCache', () => clearCache())
    );

    // Register code action provider for .twig files
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(
            { scheme: 'file', pattern: '**/*.twig' },
            new SuppressCodeActionProvider(diagnosticsManager),
            { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
        )
    );

    // File event listeners
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (shouldAnalyze(doc, 'open')) {
                analyzeDocument(doc);
            }
        }),
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (shouldAnalyze(doc, 'save')) {
                debouncedAnalyze(doc);
            }
        }),
        vscode.workspace.onDidCloseTextDocument(doc => {
            if (doc.languageId === 'twig' || doc.fileName.endsWith('.twig')) {
                diagnosticsManager.clear(doc.uri);
            }
        })
    );

    // Clean up
    context.subscriptions.push(
        diagnosticsManager,
        outputChannel,
        statusBarItem
    );

    // Analyze already open .twig files
    const config = getConfig();
    if (config.enable && config.runOnOpen) {
        vscode.workspace.textDocuments.forEach(doc => {
            if (doc.languageId === 'twig' || doc.fileName.endsWith('.twig')) {
                analyzeDocument(doc);
            }
        });
    }

    outputChannel.appendLine('Craft Audit extension activated');
}

function debouncedAnalyze(doc: vscode.TextDocument) {
    if (saveDebounceTimer) {
        clearTimeout(saveDebounceTimer);
    }
    saveDebounceTimer = setTimeout(() => {
        analyzeDocument(doc);
    }, 500);
}

function shouldAnalyze(doc: vscode.TextDocument, trigger: 'open' | 'save'): boolean {
    if (doc.languageId !== 'twig' && !doc.fileName.endsWith('.twig')) {
        return false;
    }

    const config = getConfig();
    if (!config.enable) {
        return false;
    }

    return trigger === 'open' ? config.runOnOpen : config.runOnSave;
}

async function analyzeDocument(doc: vscode.TextDocument) {
    const config = getConfig();

    try {
        const issues = await runner.analyzeFile(doc.uri.fsPath, config);
        diagnosticsManager.set(doc.uri, issues);
        updateStatusBar(diagnosticsManager.totalCount);
    } catch (error) {
        outputChannel.appendLine(`Error analyzing ${doc.fileName}: ${error}`);
    }
}

async function scanCurrentFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active file');
        return;
    }

    if (!editor.document.fileName.endsWith('.twig')) {
        vscode.window.showWarningMessage('Current file is not a .twig file');
        return;
    }

    await analyzeDocument(editor.document);
}

async function scanWorkspace() {
    const config = getConfig();

    try {
        statusBarItem.text = '$(sync~spin) Craft Audit';
        const issues = await runner.analyzeWorkspace(config);
        diagnosticsManager.setAll(issues);
        updateStatusBar(diagnosticsManager.totalCount);
        vscode.window.showInformationMessage(`Craft Audit: Found ${diagnosticsManager.totalCount} issues`);
    } catch (error) {
        outputChannel.appendLine(`Error scanning workspace: ${error}`);
        vscode.window.showErrorMessage(`Craft Audit scan failed: ${error}`);
    }
}

function clearDiagnostics() {
    diagnosticsManager.clearAll();
    updateStatusBar(0);
}

function updateStatusBar(count: number) {
    if (count === 0) {
        statusBarItem.text = '$(check) Craft Audit';
        statusBarItem.tooltip = 'No issues found';
    } else {
        statusBarItem.text = `$(warning) Craft Audit: ${count} issue${count === 1 ? '' : 's'}`;
        statusBarItem.tooltip = `${count} issue${count === 1 ? '' : 's'} found – click to re-scan`;
    }
}

async function clearCache() {
    try {
        await runner.clearCache();
        vscode.window.showInformationMessage('Craft Audit: Analysis cache cleared');
    } catch (error) {
        outputChannel.appendLine(`Error clearing cache: ${error}`);
        vscode.window.showErrorMessage(`Craft Audit: Failed to clear cache – ${error}`);
    }
}

export function deactivate() {
    if (saveDebounceTimer) {
        clearTimeout(saveDebounceTimer);
    }
    runner?.dispose();
}
