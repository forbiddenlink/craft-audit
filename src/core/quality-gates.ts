import { AuditIssue, Severity } from '../types';

export interface QualityGate {
  name: string;
  description: string;
  failOn: string;
  maxIssues?: number;
  maxHighSeverity?: number;
  maxMediumSeverity?: number;
  rules?: {
    exclude?: string[];
    include?: string[];
  };
}

export interface QualityGateResult {
  pass: boolean;
  reason?: string;
  summary: string;
}

const SEVERITY_ORDER: Record<string, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const BUILT_IN_GATES: QualityGate[] = [
  {
    name: 'strict',
    description: 'Fail on any issue (info+). Zero tolerance.',
    failOn: 'info',
  },
  {
    name: 'recommended',
    description: 'Fail on medium+ severity. Standard for CI.',
    failOn: 'medium',
  },
  {
    name: 'security-only',
    description: 'Fail on high+ severity, only security-category rules.',
    failOn: 'high',
    rules: {
      include: ['security/'],
    },
  },
  {
    name: 'relaxed',
    description: 'Fail on high only. Lenient for legacy projects.',
    failOn: 'high',
  },
  {
    name: 'ci',
    description: 'Same as recommended but with maxHighSeverity: 0 (no high-severity issues allowed).',
    failOn: 'medium',
    maxHighSeverity: 0,
  },
];

export function getQualityGate(name: string): QualityGate | undefined {
  return BUILT_IN_GATES.find((g) => g.name === name);
}

export function listQualityGates(): QualityGate[] {
  return [...BUILT_IN_GATES];
}

export function getQualityGateNames(): string[] {
  return BUILT_IN_GATES.map((g) => g.name);
}

function matchesRuleFilter(issue: AuditIssue, rules: QualityGate['rules']): boolean {
  if (!rules) return true;

  const ruleId = issue.ruleId ?? '';
  const category = issue.category ?? '';

  if (rules.include && rules.include.length > 0) {
    return rules.include.some(
      (pattern) => ruleId.startsWith(pattern) || category === pattern.replace(/\/$/, '')
    );
  }

  if (rules.exclude && rules.exclude.length > 0) {
    return !rules.exclude.some(
      (pattern) => ruleId.startsWith(pattern) || category === pattern.replace(/\/$/, '')
    );
  }

  return true;
}

function meetsThreshold(severity: Severity, failOn: string): boolean {
  const issueLevel = SEVERITY_ORDER[severity] ?? 0;
  const minLevel = SEVERITY_ORDER[failOn] ?? 0;
  return issueLevel >= minLevel;
}

export function filterIssuesForGate(issues: AuditIssue[], gate: QualityGate): AuditIssue[] {
  return issues.filter((issue) => matchesRuleFilter(issue, gate.rules));
}

export function applyQualityGate(
  gate: QualityGate,
  issues: AuditIssue[]
): QualityGateResult {
  const relevant = filterIssuesForGate(issues, gate);
  const reasons: string[] = [];

  // Check maxIssues
  if (gate.maxIssues !== undefined && relevant.length > gate.maxIssues) {
    reasons.push(`total issues ${relevant.length} exceeds max ${gate.maxIssues}`);
  }

  // Count by severity
  let highCount = 0;
  let mediumCount = 0;
  let thresholdViolations = 0;
  for (const issue of relevant) {
    if (issue.severity === 'high') highCount++;
    if (issue.severity === 'medium') mediumCount++;
    if (meetsThreshold(issue.severity, gate.failOn)) thresholdViolations++;
  }

  // Check maxHighSeverity
  if (gate.maxHighSeverity !== undefined && highCount > gate.maxHighSeverity) {
    reasons.push(`high-severity issues ${highCount} exceeds max ${gate.maxHighSeverity}`);
  }

  // Check maxMediumSeverity
  if (gate.maxMediumSeverity !== undefined && mediumCount > gate.maxMediumSeverity) {
    reasons.push(`medium-severity issues ${mediumCount} exceeds max ${gate.maxMediumSeverity}`);
  }

  // Check severity threshold
  if (thresholdViolations > 0) {
    reasons.push(`${thresholdViolations} issue(s) at or above ${gate.failOn} severity`);
  }

  const pass = reasons.length === 0;
  const summary = pass
    ? `Quality gate "${gate.name}" passed (${relevant.length} issue(s) evaluated)`
    : `Quality gate "${gate.name}" failed: ${reasons.join('; ')} (${relevant.length} issue(s) evaluated)`;

  return {
    pass,
    reason: pass ? undefined : reasons.join('; '),
    summary,
  };
}
