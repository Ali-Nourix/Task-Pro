// ── path-utils.ts ───────────────────────────────────────────────
// Shared path helpers for folder-restriction checks
// ────────────────────────────────────────────────────────────────

export function normalizePluginPath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim()
    .toLowerCase();
}

export function isWithinTargetFolder(filePath: string, targetFolder: string): boolean {
  const normalizedTarget = normalizePluginPath(targetFolder);

  if (!normalizedTarget) {
    return true;
  }

  const normalizedFilePath = normalizePluginPath(filePath);

  return normalizedFilePath === normalizedTarget || normalizedFilePath.startsWith(`${normalizedTarget}/`);
}

