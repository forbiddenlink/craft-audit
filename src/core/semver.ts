/**
 * Minimal version parsing and range matching for Composer package versions.
 *
 * Handles the shapes found in composer.lock (`4.12.0`, `v2.0.52`, `5.0.0-RC1`)
 * and in advisory ranges (`< 4.13.8`, `>= 4.0.0-RC1, < 4.14.15`, `<= 5.5.4`).
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Pre-release tag such as `beta.1` or `RC1`; empty for a stable release. */
  pre: string;
}

export function parseVersion(versionStr: string): ParsedVersion | undefined {
  const cleaned = versionStr.trim().replace(/^v/i, '');
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.\d+)*(?:-?([0-9A-Za-z.-]+))?/.exec(cleaned);
  if (!match) return undefined;
  // A bare major ("5") is too vague to compare against a fixed release.
  if (match[2] === undefined) return undefined;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: match[3] === undefined ? 0 : Number.parseInt(match[3], 10),
    pre: match[4] ?? '',
  };
}

const PRE_RANK: Array<[RegExp, number]> = [
  [/^(dev|alpha|a)/i, 1],
  [/^(beta|b)/i, 2],
  [/^rc/i, 3],
];

function preRank(pre: string): number {
  if (!pre) return 4;
  for (const [pattern, rank] of PRE_RANK) {
    if (pattern.test(pre)) return rank;
  }
  return 0;
}

function preNumber(pre: string): number {
  const match = /(\d+)$/.exec(pre);
  return match ? Number.parseInt(match[1], 10) : 0;
}

export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  const rankDelta = preRank(a.pre) - preRank(b.pre);
  if (rankDelta !== 0) return rankDelta;
  return preNumber(a.pre) - preNumber(b.pre);
}

/**
 * True when `version` satisfies every comparator in `range`.
 * Comparators are separated by commas or whitespace (`>= 4.0.0, < 4.14.15`).
 * A range that cannot be parsed never matches.
 */
export function satisfiesRange(version: string | ParsedVersion, range: string): boolean {
  const installed = typeof version === 'string' ? parseVersion(version) : version;
  if (!installed) return false;
  const comparators = range.match(/(>=|<=|>|<|=)?\s*v?\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?/g);
  if (!comparators || comparators.length === 0) return false;
  for (const comparator of comparators) {
    const match = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(comparator.trim());
    if (!match) return false;
    const target = parseVersion(match[2]);
    if (!target) return false;
    const delta = compareVersions(installed, target);
    switch (match[1] ?? '=') {
      case '<':
        if (!(delta < 0)) return false;
        break;
      case '<=':
        if (!(delta <= 0)) return false;
        break;
      case '>':
        if (!(delta > 0)) return false;
        break;
      case '>=':
        if (!(delta >= 0)) return false;
        break;
      default:
        if (delta !== 0) return false;
    }
  }
  return true;
}
