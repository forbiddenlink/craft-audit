# Research-Backed Improvement Plan (2026-02-18)

This summarizes current external guidance and maps it to concrete `craft-audit` improvements.

## Key External Findings

1. Craft template query behavior:
   - Element queries are lazy until execution methods are called (`all()`, `one()`, `count()`, etc.).
   - In Twig, some operations (like `|length`) can execute queries.
   Source: [Craft Element Queries](https://craftcms.com/docs/5.x/development/element-queries)

2. N+1 mitigation in Craft:
   - Eager-load relations with `.with()` and use lazy eager-loading with `.eagerly()`.
   Source: [Eager-Loading Elements](https://docs.craft.cloud/docs/5.x/development/eager-loading)

3. Query/load profiling support:
   - Craft debug toolbar can help inspect query counts and runtime overhead.
   Source: [Debug Toolbar](https://craftcms.com/docs/5.x/system/debug-toolbar.html)

4. Deployment/config discipline:
   - Project config should be versioned and synchronized across environments.
   Source: [Project Config](https://craftcms.com/docs/5.x/system/project-config.html)

5. Bitbucket CI primitives that fit this tool:
   - PR destination branch variable for diff targeting.
   - Artifacts for cross-step report handoff.
   - Code Insights reports/annotations for PR-native feedback.
   - Cloud annotations API allows up to 100 per POST and up to 1000 per report.
   Sources:
   - [Bitbucket Default Variables](https://support.atlassian.com/bitbucket-cloud/docs/variables-and-secrets/)
   - [Bitbucket Artifacts](https://support.atlassian.com/bitbucket-cloud/docs/use-artifacts-in-steps/)
   - [Bitbucket Code Insights API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-reports/)

6. Optional integrations (Slack/ClickUp):
   - Slack webhooks are straightforward but secrets must be protected/rotated if exposed.
   - ClickUp API uses bearer token auth and supports markdown task descriptions.
   Sources:
   - [Slack Incoming Webhooks](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/)
   - [ClickUp API Auth](https://developer.clickup.com/docs/authentication)
   - [ClickUp Create Task API](https://developer.clickup.com/reference/createtask)

7. Supplemental video learning resources:
   - [CraftCMS - CMS Office Hours and Optimization Web Performance](https://www.youtube.com/watch?v=56oP2Y_6_xk)
   - [CraftQuest - Better Front-End Performance with Twig Cache Tags and HTTP Caching](https://www.youtube.com/watch?v=dh5pQxyhEA4)

## Herd-Calibrated Recommendation Output (Read-Only Runs)

Used `recommend-config --output json` without modifying those projects:

- `/Users/elizabethstein/Herd/jensenhughes`: `legacy-migration` + `ruleSettings.template/n-plus-one-loop.ignorePaths=["tw/components/**"]`
- `/Users/elizabethstein/Herd/victory-church`: `strict`
- `/Users/elizabethstein/Herd/levelup`: `strict`
- `/Users/elizabethstein/Herd/bandlsound`: `strict`

## Highest-Impact Next Implementations

1. Add a Bitbucket Code Insights reporter:
   - Status: completed in this iteration via `--output bitbucket` with batched annotation payloads.
   - Follow-up completed: optional direct publish with `--publish-bitbucket`.

2. Add template profiler correlation mode:
   - Status: completed in this iteration via `--debug-profile` correlation (query/time evidence attached to findings).

3. Expand N+1 detection for eager-loading coverage:
   - Explicitly recognize `.eagerly()` patterns and suggest `.with()` candidates in messages.

4. Add project-config guard checks:
   - Detect common environment drift signals and recommend `project-config/apply` workflow.

5. Add “autofix suggestion packs” per preset:
   - Emit grouped remediation snippets by rule ID for faster migration sprints.
