# Presets

Presets provide fast starting profiles for teams with multiple sites.

## `strict`

- No rule severity changes.
- Best when teams want full default strictness.

## `balanced`

- Downgrades:
  - `template/deprecated-api` -> `low`
  - `template/missing-limit` -> `low`
- Good default for active projects where deprecations are known but not urgent blockers.

## `legacy-migration`

- Downgrades:
  - `template/n-plus-one-loop` -> `medium`
  - `template/deprecated-api` -> `low`
  - `template/missing-limit` -> `low`
- Best for large legacy sites migrating gradually.

## Usage

CLI:

```bash
craft-audit audit . --preset legacy-migration --output json
```

Config:

```json
{
  "preset": "balanced"
}
```

Custom `ruleSettings` still override preset defaults.

Tip: see [Config Recommendations](recommend-config.md) to pick a preset from real findings.
