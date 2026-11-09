import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const caddy = readFileSync(
  resolve(ROOT, 'services/galaxy-data/Caddyfile'),
  'utf8'
);

/** Les noms d'en-têtes que le Caddyfile expose aux pages d'une autre origine. */
function exposedHeaders(): string[] {
  const line =
    /^\s*header @allowed Access-Control-Expose-Headers "([^"]*)"/m.exec(caddy);
  expect(line, 'directive Access-Control-Expose-Headers').not.toBeNull();
  return line![1]!.split(',').map((h) => h.trim());
}

describe('CORS du service de données (services/galaxy-data/Caddyfile)', () => {
  it('expose Retry-After, sans quoi la reprise des tuiles ne lit pas le délai du serveur', () => {
    // `core/fetchRetry.ts` lit `headers.get('retry-after')` sur les tuiles du service de données.
    expect(exposedHeaders()).toContain('Retry-After');
  });

  it('garde les trois en-têtes que le lecteur d’éphémérides exige', () => {
    expect(exposedHeaders()).toEqual(
      expect.arrayContaining([
        'Content-Range',
        'Content-Length',
        'Accept-Ranges',
      ])
    );
  });

  it('garde les origines autorisées et Vary: Origin', () => {
    expect(caddy).toContain(
      String.raw`@allowed header_regexp origin Origin ^(https://galaxy\.adrianguichard\.dev|http://localhost:[0-9]+)$`
    );
    expect(caddy).toContain(
      'header @allowed Access-Control-Allow-Origin {re.origin.0}'
    );
    expect(caddy).toMatch(/^\s*header Vary Origin$/m);
  });
});
