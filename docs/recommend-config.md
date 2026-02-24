# Config Recommendations

Use `recommend-config` to analyze template findings and generate a tuned starting config.

## Usage

```bash
craft-audit recommend-config /path/to/craft-project
```

JSON output:

```bash
craft-audit recommend-config /path/to/craft-project --output json
```

Write to file:

```bash
craft-audit recommend-config /path/to/craft-project --output json --output-file recommendation.json
```

## What it does

- Runs template analysis for the project.
- Measures issue mix (`n+1`, `deprecated-api`, `missing-limit`).
- Recommends a preset (`strict`, `balanced`, `legacy-migration`).
- Optionally suggests scoped `ruleSettings.ignorePaths` for high-volume N+1 hotspots.

## Applying output

Copy the `suggestedConfig` block into `craft-audit.config.json`.

Example:

```json
{
  "preset": "legacy-migration",
  "ruleSettings": {
    "template/n-plus-one-loop": {
      "ignorePaths": ["tw/components/**"]
    }
  }
}
```
