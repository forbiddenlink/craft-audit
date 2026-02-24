import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

/**
 * Read the package version from package.json at build time.
 * Falls back to '0.0.0' if the read fails for any reason.
 */
function readPackageVersion(): string {
  try {
    const pkgPath = resolve(dirname(__filename), '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const TOOL_VERSION = readPackageVersion();
