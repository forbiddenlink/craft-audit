/**
 * End-of-security-support dates for PHP and Craft CMS, shared by every check
 * that flags an unsupported runtime (live headers, Dockerfiles, composer.json).
 *
 * Sources, checked 2026-11-18:
 * - PHP: https://www.php.net/supported-versions.php (via endoflife.date/php)
 * - Craft: https://craftcms.com/knowledge-base/supported-versions
 */

/** Last day of security fixes per PHP minor release. */
const PHP_SECURITY_END: Readonly<Record<string, string>> = {
  '7.4': '2022-11-28',
  '8.0': '2023-11-26',
  '8.1': '2025-12-31',
  '8.2': '2026-12-31',
  '8.3': '2027-12-31',
  '8.4': '2028-12-31',
  '8.5': '2029-12-31',
};

/** Last day of security fixes per Craft CMS major release. */
const CRAFT_SECURITY_END: Readonly<Record<number, string>> = {
  2: '2022-01-31',
  3: '2024-04-30',
  4: '2026-04-30',
};

/** A release whose security support ends within this many days is "ending soon". */
export const ENDING_SOON_DAYS = 365;

export type SupportState = 'eol' | 'ending-soon' | 'supported' | 'unknown';

export interface SupportStatus {
  state: SupportState;
  /** Last day of security support, when known. */
  endsOn?: string;
}

function classify(endsOn: string, today: Date): SupportStatus {
  const end = Date.parse(`${endsOn}T23:59:59Z`);
  const now = today.getTime();
  if (now > end) return { state: 'eol', endsOn };
  if (end - now <= ENDING_SOON_DAYS * 86_400_000) return { state: 'ending-soon', endsOn };
  return { state: 'supported', endsOn };
}

/** Security support status of PHP `major.minor` on `today`. */
export function phpSupport(major: number, minor: number, today: Date = new Date()): SupportStatus {
  const endsOn = PHP_SECURITY_END[`${major}.${minor}`];
  if (endsOn) return classify(endsOn, today);
  // Anything older than the oldest tracked release is long past end of life.
  if (major < 7 || (major === 7 && minor < 4)) return { state: 'eol' };
  return { state: 'unknown' };
}

/** Security support status of Craft CMS `major` on `today`. */
export function craftSupport(major: number, today: Date = new Date()): SupportStatus {
  const endsOn = CRAFT_SECURITY_END[major];
  if (endsOn) return classify(endsOn, today);
  if (major < 2) return { state: 'eol' };
  return { state: 'unknown' };
}
