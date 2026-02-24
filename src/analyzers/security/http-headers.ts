/**
 * HTTP Security Headers Checker
 *
 * Makes a single HTTP GET request to the site URL and checks for
 * missing or weak security response headers.
 */
import { SecurityIssue } from '../../types';

interface HeaderCheck {
  header: string;
  ruleId: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
  suggestion: string;
  /** Optional: if present, checks the header value matches this pattern */
  valueCheck?: (value: string) => boolean;
  /** If valueCheck fails, use this message instead */
  weakMessage?: string;
  weakSuggestion?: string;
}

const HEADER_CHECKS: HeaderCheck[] = [
  {
    header: 'strict-transport-security',
    ruleId: 'security/missing-hsts',
    severity: 'high',
    message: 'Missing Strict-Transport-Security (HSTS) header.',
    suggestion: 'Add "Strict-Transport-Security: max-age=31536000; includeSubDomains" via your web server or Craft CMS plugin.',
    valueCheck: (v) => {
      const match = v.match(/max-age=(\d+)/i);
      return match !== null && parseInt(match[1], 10) >= 31536000;
    },
    weakMessage: 'Strict-Transport-Security max-age is below recommended minimum (31536000 seconds / 1 year).',
    weakSuggestion: 'Set max-age to at least 31536000: "Strict-Transport-Security: max-age=31536000; includeSubDomains".',
  },
  {
    header: 'x-content-type-options',
    ruleId: 'security/missing-x-content-type-options',
    severity: 'medium',
    message: 'Missing X-Content-Type-Options header.',
    suggestion: 'Add "X-Content-Type-Options: nosniff" to prevent MIME-type sniffing attacks.',
    valueCheck: (v) => v.toLowerCase().trim() === 'nosniff',
    weakMessage: 'X-Content-Type-Options header has unexpected value (should be "nosniff").',
    weakSuggestion: 'Set X-Content-Type-Options to "nosniff".',
  },
  {
    header: 'x-frame-options',
    ruleId: 'security/missing-x-frame-options',
    severity: 'medium',
    message: 'Missing X-Frame-Options header. Site may be vulnerable to clickjacking.',
    suggestion: 'Add "X-Frame-Options: DENY" or "SAMEORIGIN" to prevent clickjacking. Alternatively, use Content-Security-Policy frame-ancestors directive.',
  },
  {
    header: 'content-security-policy',
    ruleId: 'security/missing-csp',
    severity: 'medium',
    message: 'Missing Content-Security-Policy (CSP) header.',
    suggestion: 'Add a Content-Security-Policy header. Start with "Content-Security-Policy: default-src \'self\'" and expand as needed for your site\'s resources.',
  },
  {
    header: 'referrer-policy',
    ruleId: 'security/missing-referrer-policy',
    severity: 'low',
    message: 'Missing Referrer-Policy header.',
    suggestion: 'Add "Referrer-Policy: strict-origin-when-cross-origin" or "no-referrer" to control referrer information leakage.',
  },
  {
    header: 'permissions-policy',
    ruleId: 'security/missing-permissions-policy',
    severity: 'low',
    message: 'Missing Permissions-Policy header (formerly Feature-Policy).',
    suggestion: 'Add a Permissions-Policy header to control browser feature access. Example: "Permissions-Policy: camera=(), microphone=(), geolocation=()".',
  },
];

/** Dangerous headers that SHOULD NOT be present */
const DANGEROUS_HEADERS: { header: string; ruleId: string; severity: 'high' | 'medium' | 'low'; message: string; suggestion: string }[] = [
  {
    header: 'server',
    ruleId: 'security/server-header-exposed',
    severity: 'low',
    message: 'Server header exposes web server software and version.',
    suggestion: 'Remove or hide the Server header to reduce information leakage. Configure your web server to suppress this header.',
  },
  {
    header: 'x-powered-by',
    ruleId: 'security/x-powered-by-exposed',
    severity: 'low',
    message: 'X-Powered-By header exposes technology stack.',
    suggestion: 'Remove the X-Powered-By header. In Craft CMS, set sendPoweredByHeader to false in config/general.php.',
  },
];

const REQUEST_TIMEOUT_MS = 10000;

export async function checkHttpHeaders(siteUrl: string): Promise<SecurityIssue[]> {
  const issues: SecurityIssue[] = [];

  let response: Response;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    response = await fetch(siteUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
  } catch (error) {
    // Network error — emit a single info-level issue and return
    issues.push({
      severity: 'info',
      category: 'security',
      type: 'http-header-check',
      ruleId: 'security/http-header-check-failed',
      message: `Could not connect to ${siteUrl} to check HTTP security headers.`,
      suggestion: 'Ensure the site URL is reachable and try again.',
      evidence: { details: error instanceof Error ? error.message : String(error) },
      fingerprint: `security/http-header-check-failed:${siteUrl}`,
    });
    return issues;
  }

  // Check for missing/weak required headers
  for (const check of HEADER_CHECKS) {
    const value = response.headers.get(check.header);
    if (!value) {
      issues.push({
        severity: check.severity,
        category: 'security',
        type: 'http-header-check',
        ruleId: check.ruleId,
        message: check.message,
        suggestion: check.suggestion,
        evidence: { details: `Response from ${siteUrl} (HTTP ${response.status})` },
        fingerprint: `${check.ruleId}:${siteUrl}`,
      });
    } else if (check.valueCheck && !check.valueCheck(value)) {
      issues.push({
        severity: check.severity,
        category: 'security',
        type: 'http-header-check',
        ruleId: check.ruleId,
        message: check.weakMessage ?? check.message,
        suggestion: check.weakSuggestion ?? check.suggestion,
        evidence: { details: `${check.header}: ${value}` },
        fingerprint: `${check.ruleId}:weak:${siteUrl}`,
      });
    }
  }

  // Check for dangerous headers that should be removed
  for (const check of DANGEROUS_HEADERS) {
    const value = response.headers.get(check.header);
    if (value) {
      issues.push({
        severity: check.severity,
        category: 'security',
        type: 'http-header-check',
        ruleId: check.ruleId,
        message: `${check.message} (value: "${value}")`,
        suggestion: check.suggestion,
        evidence: { details: `${check.header}: ${value}` },
        fingerprint: `${check.ruleId}:${siteUrl}`,
      });
    }
  }

  return issues;
}
