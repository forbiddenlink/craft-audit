/**
 * Content Security Policy (CSP) Header Generator
 *
 * Scans Twig templates for inline scripts, styles, external resource URLs,
 * and other patterns to generate a recommended CSP header.
 *
 * NOTE: The generated policy is an approximation based on static template analysis.
 * It should be reviewed and tested before deployment.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface CspPolicy {
  directives: Record<string, string[]>;
  hasUnsafeInlineScript: boolean;
  hasUnsafeInlineStyle: boolean;
  warnings: string[];
  headerValue: string;
}

/** Well-known CDN and service domains for auto-detection. */
const KNOWN_SERVICES: Record<string, string> = {
  'cdn.jsdelivr.net': 'jsDelivr CDN',
  'unpkg.com': 'unpkg CDN',
  'cdnjs.cloudflare.com': 'cdnjs CDN',
  'fonts.googleapis.com': 'Google Fonts (stylesheets)',
  'fonts.gstatic.com': 'Google Fonts (font files)',
  'www.google-analytics.com': 'Google Analytics',
  'www.googletagmanager.com': 'Google Tag Manager',
  'ajax.googleapis.com': 'Google Hosted Libraries',
  'code.jquery.com': 'jQuery CDN',
  'stackpath.bootstrapcdn.com': 'BootstrapCDN (Stack Path)',
  'maxcdn.bootstrapcdn.com': 'BootstrapCDN (MaxCDN)',
  'cdn.tailwindcss.com': 'Tailwind CSS CDN',
  'use.fontawesome.com': 'Font Awesome',
  'kit.fontawesome.com': 'Font Awesome Kit',
  'ka-f.fontawesome.com': 'Font Awesome CDN',
  'www.youtube.com': 'YouTube embeds',
  'player.vimeo.com': 'Vimeo embeds',
  'maps.googleapis.com': 'Google Maps',
  'maps.google.com': 'Google Maps',
  'www.google.com': 'Google (reCAPTCHA, etc.)',
  'www.gstatic.com': 'Google static assets',
  'connect.facebook.net': 'Facebook SDK',
  'platform.twitter.com': 'Twitter/X embeds',
  'cdn.shopify.com': 'Shopify CDN',
  'js.stripe.com': 'Stripe.js',
  'checkout.stripe.com': 'Stripe Checkout',
  'hcaptcha.com': 'hCaptcha',
  'js.hcaptcha.com': 'hCaptcha JS',
  'newassets.hcaptcha.com': 'hCaptcha assets',
  'plausible.io': 'Plausible Analytics',
  'cdn.plyr.io': 'Plyr media player',
};

// ── Regex patterns ──────────────────────────────────────────────────────────

// External resource tags
const SCRIPT_SRC_RE = /<script[^>]+src\s*=\s*["']([^"']+)["']/gi;
const LINK_STYLESHEET_RE = /<link[^>]+rel\s*=\s*["']stylesheet["'][^>]+href\s*=\s*["']([^"']+)["']/gi;
const LINK_STYLESHEET_ALT_RE = /<link[^>]+href\s*=\s*["']([^"']+)["'][^>]+rel\s*=\s*["']stylesheet["']/gi;
const IMG_SRC_RE = /<img[^>]+src\s*=\s*["']([^"']+)["']/gi;
const IFRAME_SRC_RE = /<iframe[^>]+src\s*=\s*["']([^"']+)["']/gi;
const FORM_ACTION_RE = /<form[^>]+action\s*=\s*["']([^"']+)["']/gi;
const FONT_FACE_URL_RE = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;

// Inline patterns
const INLINE_SCRIPT_RE = /<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi;
const SCRIPT_WITH_SRC_RE = /<script[^>]+src\s*=/i;
const INLINE_STYLE_ATTR_RE = /\bstyle\s*=\s*["'][^"']+["']/gi;

// Connect-src patterns (fetch / XHR / websocket)
const FETCH_URL_RE = /fetch\s*\(\s*["'`]([^"'`]+)["'`]/gi;
const XHR_OPEN_RE = /\.open\s*\(\s*["'][A-Z]+["']\s*,\s*["'`]([^"'`]+)["'`]/gi;
const WEBSOCKET_RE = /new\s+WebSocket\s*\(\s*["'`]([^"'`]+)["'`]/gi;

// Media patterns
const VIDEO_SRC_RE = /<(?:video|source)[^>]+src\s*=\s*["']([^"']+)["']/gi;
const AUDIO_SRC_RE = /<(?:audio|source)[^>]+src\s*=\s*["']([^"']+)["']/gi;
const OBJECT_DATA_RE = /<object[^>]+data\s*=\s*["']([^"']+)["']/gi;

/**
 * Recursively collect all .twig and .html files under a directory.
 */
function collectTemplateFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTemplateFiles(full));
    } else if (/\.(twig|html)$/i.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Extract the hostname from a URL string.
 * Returns null for relative URLs, Twig expressions, and data URIs.
 */
function extractDomain(raw: string): string | null {
  const trimmed = raw.trim();

  // Skip Twig expressions, template variables, relative paths, data URIs, anchors
  if (
    trimmed.startsWith('{{') ||
    trimmed.startsWith('{%') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('/')
  ) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.hostname;
    }
    if (url.protocol === 'wss:' || url.protocol === 'ws:') {
      return url.hostname;
    }
  } catch {
    // Not a valid absolute URL — skip
  }
  return null;
}

/**
 * Extract all regex matches from content and return unique domains.
 */
function extractDomains(content: string, regex: RegExp): Set<string> {
  const domains = new Set<string>();
  let match: RegExpExecArray | null;
  // Reset lastIndex for global regexes
  regex.lastIndex = 0;
  while ((match = regex.exec(content)) !== null) {
    const domain = extractDomain(match[1]);
    if (domain) domains.add(domain);
  }
  return domains;
}

/**
 * Check whether content has inline <script> blocks (not just <script src="...">).
 */
function hasInlineScripts(content: string): boolean {
  INLINE_SCRIPT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_SCRIPT_RE.exec(content)) !== null) {
    if (!SCRIPT_WITH_SRC_RE.test(match[0])) {
      return true;
    }
  }
  return false;
}

/**
 * Check whether content has inline style="..." attributes.
 */
function hasInlineStyles(content: string): boolean {
  INLINE_STYLE_ATTR_RE.lastIndex = 0;
  return INLINE_STYLE_ATTR_RE.test(content);
}

/**
 * Add a value to a directive set, creating it if necessary.
 */
function addDirective(directives: Record<string, Set<string>>, key: string, value: string): void {
  if (!directives[key]) directives[key] = new Set();
  directives[key].add(value);
}

/**
 * Convert directive sets to sorted arrays for deterministic output.
 */
function finalizeDirectives(directives: Record<string, Set<string>>): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(directives)) {
    result[key] = [...values].sort((a, b) => {
      // Keep 'self', 'none', 'unsafe-inline' etc. first
      const aQuoted = a.startsWith("'");
      const bQuoted = b.startsWith("'");
      if (aQuoted && !bQuoted) return -1;
      if (!aQuoted && bQuoted) return 1;
      return a.localeCompare(b);
    });
  }
  return result;
}

/**
 * Build the header value string from finalized directives.
 */
function buildHeaderValue(directives: Record<string, string[]>): string {
  // Preferred ordering of directives for readability
  const order = [
    'default-src',
    'script-src',
    'style-src',
    'img-src',
    'font-src',
    'connect-src',
    'media-src',
    'object-src',
    'frame-src',
    'frame-ancestors',
    'base-uri',
    'form-action',
    'upgrade-insecure-requests',
  ];

  const lines: string[] = [];
  const seen = new Set<string>();

  for (const key of order) {
    if (directives[key]) {
      seen.add(key);
      if (key === 'upgrade-insecure-requests') {
        lines.push(key);
      } else {
        lines.push(`${key} ${directives[key].join(' ')}`);
      }
    }
  }

  // Append any directives not in the preferred order
  for (const key of Object.keys(directives)) {
    if (!seen.has(key)) {
      lines.push(`${key} ${directives[key].join(' ')}`);
    }
  }

  return lines.join('; ');
}

/**
 * Scan Twig/HTML templates and generate a recommended Content-Security-Policy.
 *
 * @param projectPath   Root of the Craft CMS project
 * @param templatesPath Path to the templates directory
 * @returns A CspPolicy with directives, warnings, and header value
 */
export async function generateCspPolicy(
  projectPath: string,
  templatesPath: string
): Promise<CspPolicy> {
  const directives: Record<string, Set<string>> = {};
  const warnings: string[] = [];

  let foundInlineScript = false;
  let foundInlineStyle = false;

  const files = collectTemplateFiles(templatesPath);

  if (files.length === 0) {
    warnings.push('No template files found. The generated CSP is based on defaults only.');
  }

  // Scan every template
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');

    // ── script-src ────────────────────────────────────
    for (const domain of extractDomains(content, SCRIPT_SRC_RE)) {
      addDirective(directives, 'script-src', `https://${domain}`);
    }
    if (!foundInlineScript && hasInlineScripts(content)) {
      foundInlineScript = true;
    }

    // ── style-src ─────────────────────────────────────
    for (const domain of extractDomains(content, LINK_STYLESHEET_RE)) {
      addDirective(directives, 'style-src', `https://${domain}`);
    }
    for (const domain of extractDomains(content, LINK_STYLESHEET_ALT_RE)) {
      addDirective(directives, 'style-src', `https://${domain}`);
    }
    if (!foundInlineStyle && hasInlineStyles(content)) {
      foundInlineStyle = true;
    }

    // ── img-src ───────────────────────────────────────
    for (const domain of extractDomains(content, IMG_SRC_RE)) {
      addDirective(directives, 'img-src', `https://${domain}`);
    }
    // Allow data: URIs for images (very common for inline SVGs / base64 images)
    if (/src\s*=\s*["']data:/i.test(content)) {
      addDirective(directives, 'img-src', 'data:');
    }

    // ── font-src ──────────────────────────────────────
    for (const domain of extractDomains(content, FONT_FACE_URL_RE)) {
      addDirective(directives, 'font-src', `https://${domain}`);
    }
    // Auto-add Google Fonts font files if stylesheets reference it
    if (directives['style-src']?.has('https://fonts.googleapis.com')) {
      addDirective(directives, 'font-src', 'https://fonts.gstatic.com');
    }

    // ── frame-src ─────────────────────────────────────
    for (const domain of extractDomains(content, IFRAME_SRC_RE)) {
      addDirective(directives, 'frame-src', `https://${domain}`);
    }

    // ── form-action ───────────────────────────────────
    for (const domain of extractDomains(content, FORM_ACTION_RE)) {
      addDirective(directives, 'form-action', `https://${domain}`);
    }

    // ── connect-src ───────────────────────────────────
    for (const regex of [FETCH_URL_RE, XHR_OPEN_RE, WEBSOCKET_RE]) {
      for (const domain of extractDomains(content, regex)) {
        addDirective(directives, 'connect-src', `https://${domain}`);
      }
    }

    // ── media-src ─────────────────────────────────────
    for (const regex of [VIDEO_SRC_RE, AUDIO_SRC_RE]) {
      for (const domain of extractDomains(content, regex)) {
        addDirective(directives, 'media-src', `https://${domain}`);
      }
    }

    // ── object-src ────────────────────────────────────
    for (const domain of extractDomains(content, OBJECT_DATA_RE)) {
      addDirective(directives, 'object-src', `https://${domain}`);
    }
  }

  // ── Defaults & security hardening ───────────────────────────────────────

  addDirective(directives, 'default-src', "'self'");
  addDirective(directives, 'script-src', "'self'");
  addDirective(directives, 'style-src', "'self'");
  addDirective(directives, 'img-src', "'self'");
  addDirective(directives, 'font-src', "'self'");
  addDirective(directives, 'connect-src', "'self'");
  addDirective(directives, 'frame-ancestors', "'none'");
  addDirective(directives, 'base-uri', "'self'");
  addDirective(directives, 'form-action', "'self'");
  addDirective(directives, 'object-src', "'none'");
  directives['upgrade-insecure-requests'] = new Set();

  // Handle unsafe-inline
  if (foundInlineScript) {
    addDirective(directives, 'script-src', "'unsafe-inline'");
    warnings.push(
      "'unsafe-inline' detected in script-src. " +
        'Consider moving inline scripts to external files or using nonce-based CSP.'
    );
  }

  if (foundInlineStyle) {
    addDirective(directives, 'style-src', "'unsafe-inline'");
    warnings.push(
      "'unsafe-inline' detected in style-src. " +
        'Consider using CSS classes instead of inline styles.'
    );
  }

  // Auto-detect well-known services and add advisory warnings
  const detectedServices: string[] = [];
  for (const sets of Object.values(directives)) {
    for (const value of sets) {
      const domain = value.replace(/^https?:\/\//, '');
      if (KNOWN_SERVICES[domain]) {
        detectedServices.push(`${domain} (${KNOWN_SERVICES[domain]})`);
      }
    }
  }
  if (detectedServices.length > 0) {
    const unique = [...new Set(detectedServices)].sort();
    warnings.push(`Detected known services: ${unique.join(', ')}`);
  }

  const finalized = finalizeDirectives(directives);
  const headerValue = buildHeaderValue(finalized);

  return {
    directives: finalized,
    hasUnsafeInlineScript: foundInlineScript,
    hasUnsafeInlineStyle: foundInlineStyle,
    warnings,
    headerValue,
  };
}
