# Competitive Analysis: craft-audit vs. The Landscape

> Generated 2026-02-18 — comprehensive research into Craft CMS auditing tools, CMS-specific scanners, and adjacent tooling to identify gaps and competitive advantages.

---

## 1. Direct Competitors (Craft CMS Ecosystem)

### Sherlock Plugin (putyourlightson/craft-sherlock)
**Type:** Craft CMS control panel plugin (PHP)  
**Pricing:** Free / Plus ($199/yr) / Pro ($299/yr)  
**Stars:** ~moderate adoption in Craft ecosystem

| Feature | Sherlock | craft-audit |
|---------|----------|-------------|
| Security scans (config checks) | ✅ | ✅ |
| File/folder permissions checks | ✅ | ❌ **GAP** |
| CORS configuration checks | ✅ | ❌ **GAP** |
| CSRF token validation | ✅ | ✅ |
| HTTP response header checks | ✅ | ❌ **GAP** |
| Content Security Policy (CSP) | ✅ | ❌ **GAP** |
| HTTPS enforcement checks | ✅ | ❌ **GAP** |
| Critical update monitoring | ✅ | ✅ (composer outdated) |
| Scheduled scans (cron) | ✅ Plus | ❌ (CI handles this) |
| Scan history & details | ✅ Plus | ❌ (baseline serves similar role) |
| Email notifications | ✅ Plus | ✅ (Slack/ClickUp/Linear) |
| IP restriction monitoring | ✅ Plus | ❌ |
| Bugsnag/Rollbar/Sentry integration | ✅ Pro | ❌ |
| CLI / CI integration | ❌ **CP only** | ✅ |
| Template analysis | ❌ | ✅ |
| N+1 / eager loading detection | ❌ | ✅ |
| SARIF output | ❌ | ✅ |
| Visual regression testing | ❌ | ✅ |
| Deprecated API detection + auto-fix | ❌ | ✅ |
| Git diff scoping (--changed-only) | ❌ | ✅ |
| Presets (strict/balanced/legacy) | ❌ | ✅ |
| Bitbucket Code Insights | ❌ | ✅ |

**Verdict:** Sherlock is a CP-only GUI plugin — no CLI, no CI, no template analysis. But it has HTTP header/CSP/CORS/permissions checks we lack. These are straightforward to add.

---

### No other Craft CMS-specific CLI audit tools exist.
We searched GitHub extensively. craft-audit is the **only** Craft CMS CLI auditing tool that combines template analysis, security scanning, system checks, and CI integration. This is a significant first-mover advantage.

---

## 2. Adjacent CMS Audit Tools

### WPScan (WordPress Security Scanner)
**Type:** Ruby CLI  
**Stars:** 8,600+  
**Vuln DB:** 43,472+ vulnerabilities

| Feature | WPScan | craft-audit |
|---------|--------|-------------|
| Known vulnerability database | ✅ 43K+ CVEs | ⚠️ **Only 4 CVEs** |
| Plugin/theme enumeration | ✅ | N/A (Craft ecosystem) |
| Version detection + CVE matching | ✅ | ✅ (partial) |
| User enumeration | ✅ | ❌ (not applicable) |
| Config file exposure detection | ✅ | ✅ (env file checks) |
| Password brute forcing | ✅ | ❌ (out of scope) |
| Multiple output formats | ✅ (CLI/JSON/XML/YAML) | ✅ (console/JSON/SARIF/HTML/Bitbucket) |
| API for automation | ✅ | ✅ (audit-ci mode) |
| Template analysis | ❌ | ✅ |
| Auto-fix capabilities | ❌ | ✅ |

**Takeaway:** WPScan's greatest strength is its massive vulnerability database. Our CVE database is embarrassingly small (4 entries). This is our #1 gap.

### drupal-check (mglaman/drupal-check)
**Type:** PHP CLI (PHPStan wrapper)  
**Stars:** 342

| Feature | drupal-check | craft-audit |
|---------|-------------|-------------|
| Deprecated code detection | ✅ | ✅ |
| Static analysis (PHPStan) | ✅ | ❌ (regex-based) |
| Zero-config usage | ✅ | ✅ |
| CI integration | ✅ | ✅ |
| VS Code extension | ✅ | ✅ |
| Template analysis | ❌ | ✅ |
| Security scanning | ❌ | ✅ |

**Takeaway:** drupal-check shows the value of wrapping PHPStan for zero-config CMS-specific analysis. Our regex-based approach is more practical for Twig templates.

### Lighthouse CI (Google)
**Type:** Node.js CLI  
**Stars:** 6,300+

| Feature | Lighthouse CI | craft-audit |
|---------|-------------|-------------|
| Performance auditing | ✅ | ❌ (out of scope) |
| Accessibility checks | ✅ | ❌ **OPPORTUNITY** |
| SEO auditing | ✅ | ❌ (out of scope) |
| Budget/threshold assertions | ✅ | ✅ (exit thresholds) |
| GitHub Actions integration | ✅ | ✅ |
| Historical comparison | ✅ (server mode) | ✅ (baseline) |
| collect/assert/upload commands | ✅ | Comparable CLI structure |

**Takeaway:** Lighthouse is complementary, not competitive. Could recommend it alongside craft-audit in docs.

---

## 3. Twig-Specific Tools

### TwigQI (alisqi/twigqi)
**Type:** PHP library  
**Stars:** 38

| Feature | TwigQI | craft-audit |
|---------|--------|-------------|
| Type system for templates | ✅ | ❌ |
| Variable typo detection | ✅ | ❌ |
| Macro argument validation | ✅ | ❌ |
| Constants/enum validation | ✅ | ❌ |
| Compile-time inspections | ✅ | ❌ (runtime regex) |
| N+1 query detection | ❌ | ✅ |
| XSS detection | ❌ | ✅ |
| SSTI detection | ❌ | ✅ |
| Security scanning | ❌ | ✅ |
| CI integration | ✅ (pre-commit) | ✅ |

**Takeaway:** TwigQI provides deep Twig type analysis we don't have. However, it's Symfony-focused and doesn't cover Craft-specific patterns. Low priority but interesting for future roadmap.

### Twig CS Fixer (vincentlanglet/twig-cs-fixer)
**Type:** PHP CLI  
**Stars:** 325

| Feature | Twig CS Fixer | craft-audit |
|---------|-------------|-------------|
| Coding standard enforcement | ✅ | ❌ **GAP** |
| Auto-fix formatting issues | ✅ | ✅ (deprecated APIs only) |
| Delimiter/operator spacing | ✅ | ❌ |
| Snake case enforcement | ✅ | ❌ |
| Macro formatting | ✅ | ❌ |

**Takeaway:** Twig CS Fixer handles formatting/style, which is complementary to our semantic analysis. Could recommend alongside craft-audit, or add basic formatting checks in a future phase.

---

## 4. Critical Gaps Identified (Priority Order)

### GAP 1: Stale CVE Database (CRITICAL)
**Impact:** High — actively exploited vulnerabilities not detected  
**Effort:** Small (data entry)

We have **only 4 CVEs** (2023-2024). Missing 10+ critical vulnerabilities from 2025-2026:

| CVE | CVSS | Description | Status |
|-----|------|-------------|--------|
| CVE-2025-32432 | **10.0** | RCE via image transformation endpoint | **ACTIVELY EXPLOITED** |
| CVE-2024-58136 | **9.0** | Yii framework vuln (chained with above) | Critical |
| CVE-2025-23209 | High | Code injection, CISA KEV listed | **CISA KEV** |
| CVE-2026-25498 | High | Authenticated RCE via malicious Behavior | Feb 2026 |
| CVE-2026-25491 | Medium | Stored XSS via Entry Type labels | Feb 2026 |
| GHSA-v2gc-rm6g-wrw9 | High | Cloud Metadata SSRF via IPv6 bypass | Feb 2026 |
| GHSA-gp2f-7wcm-5fhx | High | Cloud Metadata SSRF via DNS Rebinding | Feb 2026 |
| GHSA-fxp3-g6gw-4r4v | High | GraphQL Asset Mutation Privilege Escalation | Feb 2026 |
| GHSA-8jr8-7hr4-vhfx | High | SSRF in GraphQL Asset Mutation via redirect | Feb 2026 |
| GHSA-2453-mppf-46cj | High | SQL Injection in Element Indexes | Feb 2026 |

### GAP 2: Per-Advisory Severity from Composer (HIGH)
**Impact:** High — users can't triage dependency vulnerabilities  
**Effort:** Medium

Current `parseComposerAuditOutput()` only counts total advisories. Does NOT extract:
- Individual CVE IDs
- Severity levels per advisory
- Advisory titles/descriptions
- Links to advisory details

WPScan exposes per-vulnerability details. We should too.

### GAP 3: HTTP Security Headers Check (MEDIUM)
**Impact:** Medium — common production misconfiguration  
**Effort:** Medium

Sherlock checks these, we don't:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` or `SAMEORIGIN`
- `X-XSS-Protection` header
- `Strict-Transport-Security` (HSTS)
- `Content-Security-Policy` header presence
- `Referrer-Policy` header
- Missing `HttpOnly` / `Secure` cookie flags

**Note:** This requires a running site URL. Could be opt-in via `--site-url` flag.

### GAP 4: Production Config Secure Defaults (MEDIUM)
**Impact:** Medium — catches deployment misconfigurations  
**Effort:** Small

Missing checks for Craft production settings:
- `enableTemplateCaching` should be `true`
- `allowUpdates` should be `false` in production
- `testToEmailAddress` should be empty in production
- `cpTrigger` exposure (default "admin" is discoverable)
- `enableGraphqlCaching` should be `true` if GraphQL is used
- `sendPoweredByHeader` should be `false`
- `enableCsrfProtection` already checked ✅

### GAP 5: HTTPS/TLS Enforcement (LOW)
**Impact:** Low — most hosting handles this  
**Effort:** Small

Check if `siteUrl` uses `https://` in config. Warn if `http://` is found.

### GAP 6: File Permission Checks (LOW for CLI)
**Impact:** Low — hosting-dependent  
**Effort:** Medium

Sherlock checks writable dirs, web-accessible sensitive files. Lower priority for CLI tool since hosting varies.

---

## 5. Our Unique Competitive Advantages

These features exist in **NO** other Craft CMS tool:

| Feature | Why It Matters |
|---------|---------------|
| **Combined multi-analyzer CLI** | Template + security + system + visual in one tool |
| **SARIF output** | GitHub Code Scanning integration |
| **Bitbucket Code Insights** | Native Bitbucket CI integration |
| **Slack + ClickUp + Linear integrations** | Team workflow integration |
| **Presets system** | Fast multi-site rollout (strict/balanced/legacy) |
| **--changed-only with git diff** | PR-scoped analysis |
| **Interactive/batch auto-fix** | Deprecated API remediation |
| **audit-ci mode with exit thresholds** | Gate deployments on finding severity |
| **Config file with JSON schema** | Editor autocomplete for settings |
| **recommend-config command** | Auto-generate config from project scan |
| **N+1 and eager loading detection** | Performance issue detection in templates |
| **SSTI detection** | Security-critical template pattern analysis |
| **Rule suppression comments** | `{# craft-audit-disable rule-name #}` inline |
| **VS Code extension** | Real-time diagnostics + quick fixes |

---

## 6. Competitive Positioning Summary

```
                    TEMPLATE    SECURITY    SYSTEM     CI/CD      AUTO-FIX
                    ANALYSIS    SCANNING    CHECKS   INTEGRATION  
────────────────────────────────────────────────────────────────────────────
craft-audit          ✅✅✅       ⚠️ (gaps)    ✅✅       ✅✅✅        ✅✅
Sherlock             ❌           ✅✅         ✅         ❌           ❌
WPScan (WP)          ❌           ✅✅✅       ✅✅       ✅✅          ❌
drupal-check         ❌           ❌           ✅         ✅✅          ❌
Twig CS Fixer        ⚠️ (style)  ❌           ❌         ✅           ✅✅
TwigQI               ⚠️ (types)  ❌           ❌         ✅           ❌
Lighthouse CI        ❌           ❌           ❌         ✅✅✅        ❌
```

**craft-audit is already the most comprehensive Craft CMS audit tool by a wide margin.** The main gaps are:
1. CVE database coverage (critical, easy fix)
2. Per-advisory severity parsing (high impact)
3. HTTP security header checks (medium, differentiator)
4. Production config completeness (small effort, big value)

---

## 7. Recommended Implementation Priority

### Tier 1 — Must Have (fills critical gaps)
1. **Update KNOWN_CVES** with all 2025-2026 CVEs (~1 hour)
2. **Per-advisory severity from composer audit** (~2 hours)
3. **Production config secure defaults** (~1 hour)

### Tier 2 — Should Have (competitive advantage)
4. **HTTP security headers check** (opt-in via `--site-url`) (~3 hours)
5. **HTTPS enforcement check** in config (~30 min)
6. **Auto-update CVE database** from GitHub Advisories API (~2 hours, future)

### Tier 3 — Nice to Have (differentiation)
7. **Twig coding standards** (basic spacing/formatting checks) (~4 hours)
8. **File permission checks** (~2 hours)
9. **CORS configuration check** (~1 hour)
10. **Accessibility template checks** (alt text on images, ARIA attributes) (~3 hours)

---

## 8. What Makes Us Win

To be definitively the best Craft CMS audit tool:

1. **Depth:** Cover more security vectors than Sherlock (CVEs, headers, production config)
2. **Breadth:** Template + security + system + visual in one CLI (no competitor does this)
3. **CI-native:** SARIF, Bitbucket, audit-ci mode, git diff scoping (Sherlock can't do any of this)
4. **Actionable:** Auto-fix, detailed suggestions, severity-based exit codes (most tools just report)
5. **Extensible:** Config file, presets, rule tuning, suppression comments (professional-grade customization)

After implementing Tier 1 and Tier 2 items, craft-audit will be the undisputed best-in-class Craft CMS audit tool with no close competitor.
