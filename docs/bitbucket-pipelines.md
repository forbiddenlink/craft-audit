# Bitbucket Pipelines Integration

This project supports Bitbucket pull request base-ref auto detection via:

- `BITBUCKET_PR_DESTINATION_BRANCH`

That means `audit-ci` can use `--base-ref auto` in Bitbucket without extra scripting.

## Recommended: Direct publish from CLI

Use the built-in Bitbucket integration to post Code Insights reports + annotations directly.

```yaml
image: node:20

pipelines:
  pull-requests:
    "**":
      - step:
          name: Craft Audit (PR)
          caches:
            - node
          script:
            - npm ci
            - npm run build
            - node dist/cli.js audit-ci . --output bitbucket --publish-bitbucket --bitbucket-token-env BITBUCKET_TOKEN --debug-profile ./runtime/debug-profile.json
```

Required env vars in Bitbucket:

- `BITBUCKET_TOKEN`
- `BITBUCKET_COMMIT`
- `BITBUCKET_REPO_FULL_NAME` (provided by Bitbucket Pipelines)

Optional overrides:

- `--bitbucket-workspace`
- `--bitbucket-repo-slug`
- `--bitbucket-commit`
- `--bitbucket-report-id`
- `--bitbucket-report-link`
- `--bitbucket-send-on always|issues|high`

## Manual publish mode (fallback)

If you prefer not to use direct publish, emit payload JSON and post it yourself:

```bash
node dist/cli.js audit-ci . --output bitbucket --output-file craft-audit-bitbucket.json
```

The JSON contains:

- `report` payload for the report endpoint (`PUT`)
- `annotationBatches` payloads for the annotations endpoint (`POST`)

## Recommended project config

```json
{
  "skipSecurity": false,
  "skipTemplates": false,
  "output": "bitbucket",
  "exitThreshold": "high",
  "publishBitbucket": true,
  "bitbucketTokenEnv": "BITBUCKET_TOKEN",
  "bitbucketSendOn": "issues",
  "bitbucketReportId": "craft-audit-pr",
  "bitbucketReportLink": "https://example.com/artifacts/craft-audit-bitbucket.json",
  "notifySlack": true,
  "slackSendOn": "issues",
  "createClickupTask": true,
  "clickupListId": "123456789",
  "clickupSendOn": "high"
}
```

Reference docs:

- Bitbucket variables: [support.atlassian.com/bitbucket-cloud/docs/variables-and-secrets](https://support.atlassian.com/bitbucket-cloud/docs/variables-and-secrets/)
- Bitbucket Code Insights API: [developer.atlassian.com/cloud/bitbucket/rest/api-group-reports](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-reports/)
