# Integrations

`craft-audit` can push results to Slack, ClickUp, Linear, and Bitbucket after each run.
All integrations are optional and disabled unless explicitly enabled.

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

### Send modes

All integrations support the same send modes:

- `always` — every run
- `issues` — only when total findings > 0
- `high` — only when high-severity findings exist

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

Task behavior:

- Creates one task per run in the target list
- Includes summary counts and top findings in markdown description
- If `clickupOnlyNew` is enabled, previously synced fingerprints are skipped using `.craft-audit-clickup-state.json` (or `clickupStateFile`)

## Linear

Enable via config:

```json
{
  "createLinearIssue": true,
  "linearTeamId": "TEAM_ID",
  "linearSendOn": "high"
}
```

Provide API key in env:

- default: `LINEAR_API_KEY`
- custom env var name via `linearTokenEnv`

Optional config:

- `linearLabelIds` — comma-separated label IDs to attach
- `linearProjectId` — assign to a specific project
- `linearFindingsUrl` — link to the findings report (falls back to `CRAFT_AUDIT_FINDINGS_URL`)

Issue behavior:

- Creates one issue per run in the target team
- Includes summary counts and top findings in markdown description

## Bitbucket Code Insights

Enable via config:

```json
{
  "publishBitbucket": true,
  "bitbucketWorkspace": "acme",
  "bitbucketRepoSlug": "craft-site",
  "bitbucketSendOn": "issues"
}
```

Provide API token in env:

- default: `BITBUCKET_TOKEN`
- custom env var name via `bitbucketTokenEnv`

Optional config:

- `bitbucketCommit` — target commit hash (auto-detected in pipelines)
- `bitbucketReportId` — custom report identifier (default: `craft-audit`)
- `bitbucketReportLink` — link to full report artifact

See [Bitbucket Pipelines](bitbucket-pipelines.md) for full CI pipeline setup.
