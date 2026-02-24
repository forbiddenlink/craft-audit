/**
 * Shared integration utilities.
 */

/**
 * Derive a short project label from a file-system path.
 * Returns the last path segment after normalizing separators and trailing slashes.
 */
export function projectLabel(projectPath: string): string {
  const normalized = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : projectPath;
}
