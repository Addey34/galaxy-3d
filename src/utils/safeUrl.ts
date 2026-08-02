/**
 * Validates user-visible external links before assigning them to an anchor.
 *
 * The catalogue is committed application data, but keeping URL validation at the
 * DOM boundary prevents a future catalogue edit or corrupted asset from turning
 * a documentation link into a `javascript:` or cross-origin control URL.
 */
export function safeExternalUrl(
  value: string | undefined,
  allowedHosts: ReadonlySet<string>
): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}
