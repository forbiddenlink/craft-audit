import { RuleSettings } from './rule-tuning';

export type PresetName = 'strict' | 'balanced' | 'legacy-migration';

const PRESET_RULE_SETTINGS: Record<PresetName, RuleSettings> = {
  strict: {},
  balanced: {
    'template/deprecated-api': {
      severity: 'low',
    },
    'template/missing-limit': {
      severity: 'low',
    },
  },
  'legacy-migration': {
    'template/n-plus-one-loop': {
      severity: 'medium',
    },
    'template/deprecated-api': {
      severity: 'low',
    },
    'template/missing-limit': {
      severity: 'low',
    },
  },
};

export function isPresetName(value: string): value is PresetName {
  return value === 'strict' || value === 'balanced' || value === 'legacy-migration';
}

export function resolvePresetRuleSettings(preset?: PresetName): RuleSettings {
  if (!preset) return {};
  return PRESET_RULE_SETTINGS[preset] ?? {};
}

export function mergePresetAndCustomRuleSettings(
  preset: PresetName | undefined,
  custom: RuleSettings | undefined
): RuleSettings | undefined {
  const base = resolvePresetRuleSettings(preset);
  const hasBase = Object.keys(base).length > 0;
  const hasCustom = custom && Object.keys(custom).length > 0;

  if (!hasBase && !hasCustom) return undefined;
  if (!hasBase) return custom;
  if (!hasCustom) return base;

  const merged: RuleSettings = { ...base };
  for (const [ruleId, customSetting] of Object.entries(custom!)) {
    const baseSetting = merged[ruleId] ?? {};
    merged[ruleId] = {
      ...baseSetting,
      ...customSetting,
      ignorePaths:
        customSetting.ignorePaths !== undefined
          ? customSetting.ignorePaths
          : baseSetting.ignorePaths,
    };
  }

  return merged;
}
