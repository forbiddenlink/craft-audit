# VS Code Extension

The Craft Audit VS Code extension provides real-time diagnostics for Twig templates directly in your editor.

## Installation

### From Marketplace

1. Open VS Code
2. Go to Extensions (`Cmd+Shift+X` / `Ctrl+Shift+X`)
3. Search for "Craft Audit"
4. Click **Install**

### From VSIX File

```bash
code --install-extension vscode-craft-audit-0.1.0.vsix
```

## Requirements

The extension requires the craft-audit CLI to be installed:

```bash
npm install -g craft-audit
```

The extension will automatically detect the CLI if it is available in your PATH.

## Configuration Options

Open VS Code settings (`Cmd+,` / `Ctrl+,`) and search for "Craft Audit".

| Setting | Default | Description |
|---------|---------|-------------|
| `craftAudit.enable` | `true` | Enable/disable diagnostics |
| `craftAudit.executablePath` | `craft-audit` | Path to CLI binary |
| `craftAudit.configPath` | `""` | Path to config file (relative to workspace) |
| `craftAudit.runOnSave` | `true` | Run analysis when saving .twig files |
| `craftAudit.runOnOpen` | `true` | Run analysis when opening .twig files |
| `craftAudit.timeout` | `30000` | Analysis timeout in milliseconds |
| `craftAudit.qualityGate` | `""` | Quality gate profile to use |
| `craftAudit.minimumSeverity` | `info` | Minimum severity to display |
| `craftAudit.severity` | See below | Severity mapping |

### Severity Mapping

Map craft-audit severities to VS Code diagnostic severities:

```json
{
  "craftAudit.severity": {
    "high": "Error",
    "medium": "Warning",
    "low": "Information",
    "info": "Hint"
  }
}
```

Valid VS Code severities: `Error`, `Warning`, `Information`, `Hint`.

### Example Configuration

Add to your `.vscode/settings.json`:

```json
{
  "craftAudit.enable": true,
  "craftAudit.configPath": "craft-audit.config.json",
  "craftAudit.runOnSave": true,
  "craftAudit.runOnOpen": true,
  "craftAudit.qualityGate": "recommended",
  "craftAudit.minimumSeverity": "low",
  "craftAudit.timeout": 60000
}
```

## Available Commands

Access commands via the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

| Command | Description |
|---------|-------------|
| **Craft Audit: Scan Current File** | Analyze the active .twig file |
| **Craft Audit: Scan Workspace** | Analyze all templates in workspace |
| **Craft Audit: Clear Diagnostics** | Remove all diagnostic markers |
| **Craft Audit: Show Output** | Open the output channel for logs |
| **Craft Audit: Clear Analysis Cache** | Clear the CLI's analysis cache |

## Inline Diagnostics

When issues are found, they appear as:

1. **Squiggly underlines** in the editor on the affected line
2. **Problems panel** entries with file, line, and message
3. **Gutter icons** indicating severity

### Diagnostic Information

Each diagnostic includes:

- **Message** - Description of the issue
- **Suggestion** - How to fix it (when available)
- **Rule Link** - Click the rule ID to open documentation
- **Source Context** - The code snippet triggering the issue

### Quick Fixes

For rules that support auto-fix, hover over the diagnostic and click **Quick Fix** or press `Cmd+.` / `Ctrl+.` to see available fixes.

## Status Bar

The status bar shows a summary:

- **Checkmark icon** - No issues found
- **Warning icon with count** - Number of issues in current workspace

Click the status bar item to re-scan the current file.

## Troubleshooting

### CLI Not Found

**Symptom:** Error message "craft-audit not found"

**Solutions:**

1. Verify the CLI is installed:
   ```bash
   craft-audit --version
   ```

2. If installed locally, set the full path:
   ```json
   {
     "craftAudit.executablePath": "/Users/you/.npm-global/bin/craft-audit"
   }
   ```

3. Or use npx:
   ```json
   {
     "craftAudit.executablePath": "npx craft-audit"
   }
   ```

### Analysis Times Out

**Symptom:** "craft-audit timed out after 30 seconds"

**Solutions:**

1. Increase the timeout:
   ```json
   {
     "craftAudit.timeout": 60000
   }
   ```

2. Enable caching in your config file to speed up subsequent runs:
   ```json
   {
     "cache": true
   }
   ```

3. Limit analysis to specific directories via `templates` in config.

### No Diagnostics Appearing

**Symptom:** Extension activated but no issues shown

**Solutions:**

1. Verify the extension is enabled:
   ```json
   {
     "craftAudit.enable": true
   }
   ```

2. Check minimum severity - you may be filtering out issues:
   ```json
   {
     "craftAudit.minimumSeverity": "info"
   }
   ```

3. Open the Output panel and select "Craft Audit" to see CLI output.

4. Verify your project has a `templates/` directory or configure `templates` in config.

### PHP Errors in Output

**Symptom:** PHP errors in the Craft Audit output channel

**Solutions:**

1. Ensure PHP 8.0+ is in your PATH:
   ```bash
   php --version
   ```

2. If using a version manager (Herd, Valet), ensure VS Code inherits the correct PATH.

3. Add PHP to VS Code's terminal profile:
   ```json
   {
     "terminal.integrated.env.osx": {
       "PATH": "/path/to/php/bin:${env:PATH}"
     }
   }
   ```

### Extension Not Activating

The extension activates when:

- A `.twig` file is opened
- The workspace contains `.twig` files
- A `craft-audit.config.json` file exists

If none of these conditions are met, run **Craft Audit: Scan Workspace** to manually activate.

## Performance Tips

1. **Enable caching** - Add `"cache": true` to your config file
2. **Use runOnSave instead of runOnOpen** - Reduces analysis frequency
3. **Increase minimumSeverity** - Hide low-priority issues
4. **Exclude large directories** - Use `skipTemplates` patterns in config

## Keyboard Shortcuts

Set custom keybindings in `keybindings.json`:

```json
[
  {
    "key": "ctrl+shift+a",
    "command": "craftAudit.scanFile",
    "when": "editorLangId == twig"
  },
  {
    "key": "ctrl+shift+alt+a",
    "command": "craftAudit.scanWorkspace"
  }
]
```

## Related Documentation

- [Configuration](configuration.md) - Config file options
- [Quality Gates](quality-gates.md) - Threshold profiles
- [Rule Tuning](rule-tuning.md) - Customize rule behavior
