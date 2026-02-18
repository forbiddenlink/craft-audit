# Slack and ClickUp Integrations

`craft-audit` can push results to Slack and create ClickUp tasks after each run.
Both integrations are optional and disabled unless explicitly enabled.

## Slack

Enable via config:

```json
{
  "notifySlack": true,
  "slackSendOn": "issues"
}
```

Provide webhook URL either:

- in config: `slackWebhookUrl`
- or env: `SLACK_WEBHOOK_URL`

Modes:

- `always`: every run
- `issues`: only when total findings > 0
- `high`: only when high-severity findings exist

## ClickUp

Enable via config:

```json
{
  "createClickupTask": true,
  "clickupListId": "123456789",
  "clickupSendOn": "high",
  "clickupOnlyNew": true,
  "clickupFindingsUrl": "https://example.com/artifacts/craft-audit.sarif"
}
```

Provide API token in env:

- default: `CLICKUP_API_TOKEN`
- custom env var name via `clickupTokenEnv`
- optional report URL env fallback: `CRAFT_AUDIT_FINDINGS_URL`

Modes:

- `always`: every run
- `issues`: only when total findings > 0
- `high`: only when high-severity findings exist

Task behavior:

- creates one task per run in the target list
- includes summary counts and top findings in markdown description
- if `clickupOnlyNew` is enabled, previously synced fingerprints are skipped using `.craft-audit-clickup-state.json` (or `clickupStateFile`)
