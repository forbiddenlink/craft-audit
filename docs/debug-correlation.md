# Debug Profile Correlation

Use runtime profile data to prioritize findings by real query/time cost.

## Usage

```bash
node dist/cli.js audit . --output json --debug-profile ./runtime/debug-profile.json
```

`audit-ci` also supports this option:

```bash
node dist/cli.js audit-ci . --output bitbucket --debug-profile ./runtime/debug-profile.json
```

## Expected JSON shape

The profile file can be:

- an array, or
- an object containing `entries`, `items`, `data`, or `profiles`.

Each row can use these keys:

- path/file keys: `path`, `file`, `template`, `templatePath`, `view`, `name`
- query keys: `queryCount`, `queries`, `query_count`, `dbQueries`
- duration keys: `durationMs`, `duration`, `duration_ms`, `timeMs`, `time`, `totalMs`

Example:

```json
[
  { "path": "templates/_topics/_entry.twig", "queryCount": 42, "durationMs": 118.4 },
  { "templatePath": "templates/_home/index.twig", "queries": 8, "duration": 22 }
]
```

When matched, findings include evidence details like:

`Runtime profile: 42 queries, 118.4ms (templates/_topics/_entry.twig)`

References:

- Craft debug toolbar: [craftcms.com/docs/5.x/system/debug-toolbar.html](https://craftcms.com/docs/5.x/system/debug-toolbar.html)
- Craft performance guidance: [craftcms.com/docs/5.x/development/performance](https://craftcms.com/docs/5.x/development/performance)
