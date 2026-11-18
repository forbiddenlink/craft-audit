/**
 * Server software checks: web server versions against the hand-maintained
 * advisories in data/server-advisories.json. Used by the live exposure probes
 * (Server header) and the project file scan (Docker image tags).
 */
import * as tls from 'node:tls';

import { SecurityIssue } from '../types';
import { Advisory, AdvisoryRange, findAdvisories, loadServerAdvisories } from '../core/advisories';

export interface NginxHit {
  advisory: Advisory;
  range: AdvisoryRange;
}

/** Advisories that affect nginx `version` (a full `1.2.3` version). */
export function nginxAdvisories(version: string, advisories: readonly Advisory[] = loadServerAdvisories()): NginxHit[] {
  return findAdvisories(advisories, 'nginx', version);
}

/** `nginx/1.31.8` (optionally followed by an OS tag) to `1.31.8`; undefined when the version is hidden. */
export function nginxVersionFromServerHeader(header: string): string | undefined {
  return /^nginx\/(\d+\.\d+\.\d+)/i.exec(header.trim())?.[1];
}

export function isNginxServerHeader(header: string): boolean {
  return /^nginx(?:\/|\s|$)/i.test(header.trim());
}

/**
 * The nginx version an image tag pins, as a version to compare. A full tag
 * (`1.27.3-alpine`) is that release. A minor tag (`1.27`) floats to the newest
 * patch of that branch, so it counts as fixed only when the branch has a fix.
 * Tags without a version (`alpine`, `latest`, `mainline`) return undefined.
 */
export function nginxImageVersion(image: string): string | undefined {
  const match = /^(?:docker\.io\/)?(?:library\/)?nginx:(\d+)\.(\d+)(?:\.(\d+))?(?:[-@].*)?$/i.exec(image.trim());
  if (!match) return undefined;
  return `${match[1]}.${match[2]}.${match[3] ?? '9999'}`;
}

export function describeNginxHit(hit: NginxHit): string {
  return `${hit.advisory.id} (${hit.advisory.title})`;
}

export function nginxFixedVersions(hits: NginxHit[]): string {
  const fixes = Array.from(new Set(hits.flatMap((h) => h.advisory.ranges.map((r) => r.fixedIn).filter(Boolean))));
  return fixes.join(' or ');
}

export function nginxRestartNote(): string {
  return 'Restart nginx after upgrading; a reload keeps the old binary running. Turning off HTTP/2 blocks only part of this until you can upgrade.';
}

/** Docker image lines (`FROM nginx:1.27.3` or compose `image: nginx:1.27`) on an affected nginx release. */
export function checkNginxImages(content: string, file: string): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const ref = /^\s*(?:FROM\s+(?:--platform=\S+\s+)?|-?\s*image\s*:\s*)["']?([^\s"']+)/i.exec(line)?.[1];
    if (!ref) return;
    const version = nginxImageVersion(ref);
    if (!version) return;
    const hits = nginxAdvisories(version);
    if (hits.length === 0) return;
    const tag = ref.split(':')[1];
    issues.push({
      severity: 'critical',
      category: 'security',
      type: 'insecure-production-config',
      ruleId: 'security/nginx-vulnerable',
      file,
      line: index + 1,
      message: `Image ${ref} runs an nginx release affected by ${hits.map(describeNginxHit).join('; ')}.`,
      suggestion: `Pin nginx ${nginxFixedVersions(hits)} or later (tag ${tag} has no fix), rebuild and redeploy the container.`,
      fingerprint: `security/nginx-vulnerable:${file}:${ref}`,
    });
  });
  return issues;
}

export type AlpnProbe = (siteUrl: string, timeoutMs: number) => Promise<string | null>;

/** The protocol the server picks when offered h2 and http/1.1, or null when the TLS handshake fails. */
export const probeAlpn: AlpnProbe = (siteUrl, timeoutMs) =>
  new Promise((resolve) => {
    const url = new URL(siteUrl);
    if (url.protocol !== 'https:') {
      resolve(null);
      return;
    }
    const socket = tls.connect({
      host: url.hostname,
      port: url.port ? Number(url.port) : 443,
      servername: url.hostname,
      ALPNProtocols: ['h2', 'http/1.1'],
      // Only the negotiated protocol is read; no request is sent over this connection.
      rejectUnauthorized: false,
    });
    const done = (value: string | null): void => {
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    socket.once('secureConnect', () => done(socket.alpnProtocol || 'http/1.1'));
    socket.once('error', () => done(null));
  });
