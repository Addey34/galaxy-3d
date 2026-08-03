export function resolveTextureBasePath(
  externalBaseUrl: string | undefined,
  viteBaseUrl: string
): string {
  const configured = externalBaseUrl?.trim();
  if (!configured) return `${viteBaseUrl}assets/textures/`;

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(
      'VITE_TEXTURE_BASE_URL must be an absolute HTTPS URL when configured.'
    );
  }

  if (url.protocol !== 'https:') {
    throw new Error(
      'VITE_TEXTURE_BASE_URL must use HTTPS when configured.'
    );
  }

  return `${configured.replace(/\/+$/, '')}/`;
}
