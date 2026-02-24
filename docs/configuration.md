# Configuration

`craft-audit` supports project-level defaults via:

- `craft-audit.config.json` in the project root, or
- `--config <path>` to use another file.

CLI flags override config file values.

`output` supports: `console`, `json`, `sarif`, `bitbucket`, `html`.

Note: `html` output requires `outputFile` to be set.

## Example

```json
{
  "$schema": "./craft-audit.config.schema.json",
  "output": "sarif",
  "outputFile": "craft-audit.sarif",
  "exitThreshold": "high",
  "debugProfile": "./runtime/debug-profile.json",
  "preset": "balanced",
  "skipVisual": true,
  "notifySlack": true,
  "slackSendOn": "issues",
  "createClickupTask": true,
  "clickupListId": "123456789",
  "clickupSendOn": "high",
  "createLinearIssue": true,
  "linearTeamId": "TEAM_ID",
  "linearSendOn": "high",
  "publishBitbucket": true,
  "bitbucketWorkspace": "acme",
  "bitbucketRepoSlug": "craft-site",
  "bitbucketSendOn": "issues",
  "bitbucketReportId": "craft-audit-pr",
  "bitbucketReportLink": "https://example.com/artifacts/craft-audit.sarif",
  "ruleSettings": {
    "template/n-plus-one-loop": {
      "severity": "medium",
      "ignorePaths": ["partials/legacy/**"]
    }
  }
}
```

## Supported keys

- `$schema`
- `templates`
- `skipTemplates`
- `changedOnly`
- `baseRef`
- `skipSystem`
- `skipSecurity`
- `securityFileLimit`
- `skipVisual`
- `production`
- `staging`
- `baseline`
- `writeBaseline`
- `output`
- `outputFile`
- `exitThreshold`
- `debugProfile`
- `verbose`
- `notifySlack`
- `slackWebhookUrl`
- `slackSendOn`
- `createClickupTask`
- `clickupListId`
- `clickupSendOn`
- `clickupTokenEnv`
- `clickupOnlyNew`
- `clickupStateFile`
- `clickupFindingsUrl`
- `publishBitbucket`
- `bitbucketWorkspace`
- `bitbucketRepoSlug`
- `bitbucketCommit`
- `bitbucketTokenEnv`
- `bitbucketSendOn`
- `bitbucketReportId`
- `bitbucketReportLink`
- `preset`
- `createLinearIssue`
- `linearTeamId`
- `linearSendOn`
- `linearTokenEnv`
- `linearLabelIds`
- `linearProjectId`
- `linearFindingsUrl`
- `title`
- `ruleSettings`

## Integration env vars

- `SLACK_WEBHOOK_URL`
- `CLICKUP_API_TOKEN` (or custom name via `clickupTokenEnv`)
- `LINEAR_API_KEY` (or custom name via `linearTokenEnv`)
- `CRAFT_AUDIT_FINDINGS_URL` (used when `clickupFindingsUrl` or `linearFindingsUrl` is not set)
- `BITBUCKET_TOKEN` (or custom name via `bitbucketTokenEnv`)

Integrations are optional and disabled by default. They run only when enabled:

- Slack: `notifySlack: true`
- ClickUp: `createClickupTask: true`
- Linear: `createLinearIssue: true`
- Bitbucket publish: `publishBitbucket: true`

## Rule tuning

`ruleSettings` lets you tune findings per project without changing analyzer code.

```json
{
  "ruleSettings": {
    "template/n-plus-one-loop": {
      "enabled": true,
      "severity": "medium",
      "ignorePaths": ["partials/legacy/**", "pages/archive.twig"]
    },
    "template/deprecated-api": {
      "enabled": false
    }
  }
}
```

More examples: [Rule Tuning](rule-tuning.md).

Runtime correlation examples: [Debug Correlation](debug-correlation.md).

## Presets

Use `preset` for baseline behavior:

- `strict`: no severity relaxations
- `balanced`: downgrades noisy medium-signal template rules
- `legacy-migration`: downgrades high-volume legacy template rules for phased rollout

Generate a starting preset and scoped overrides from real findings:
[Config Recommendations](recommend-config.md).

## Security scan limits

`securityFileLimit` caps how many files the security analyzer will scan (default: 2000). Increase this value
if your project has a large template/code surface and you want full debug-pattern coverage.
