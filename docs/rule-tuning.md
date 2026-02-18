# Rule Tuning Guide

Use `ruleSettings` in `craft-audit.config.json` to tune noise per project.
You can combine this with `preset` profiles for a faster starting point.

## Common pattern

```json
{
  "ruleSettings": {
    "template/n-plus-one-loop": {
      "severity": "medium",
      "ignorePaths": ["homepage/includes/**", "tw/components/**"]
    },
    "template/deprecated-api": {
      "enabled": false
    }
  }
}
```

## When to use it

- Your site has known legacy template areas you plan to ignore temporarily.
- A rule is valid but too strict for specific paths.
- You want phased adoption without hiding findings everywhere.

## Notes

- `enabled: false` removes that rule entirely.
- `severity` overrides the rule severity before threshold checks.
- `ignorePaths` supports glob patterns and matches issue file paths relative to `templates/`.
