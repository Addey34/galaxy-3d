import { describe, expect, it } from 'vitest';
// @ts-expect-error : script .mjs sans déclaration de types
import { judgeSite, SITES } from '../../scripts/check-sites.mjs';

const site = {
  name: 'Test',
  url: 'https://x.example/',
  marker: 'MonSite',
  csp: true,
};

const ok = () => ({
  status: 200,
  headers: new Headers({
    server: 'cloudflare',
    'content-security-policy': "default-src 'self'",
  }),
});

describe('sonde des autres sites', () => {
  it('ne dit rien quand le site répond, porte son mot, vient de Cloudflare et déclare sa CSP', () => {
    expect(judgeSite(ok(), '<title>monsite</title>', site)).toEqual([]);
  });

  it('refuse le 509 de Firebase, même si la page nomme le site', () => {
    const response = ok();
    response.status = 509;
    expect(judgeSite(response, 'MonSite', site)).toEqual([
      'HTTP 509 au lieu de 200',
    ]);
  });

  it("refuse une page d'erreur d'hébergeur servie en 200 (le mot du site manque)", () => {
    expect(judgeSite(ok(), 'Bandwidth Quota Exceeded', site)).toEqual([
      'le texte « MonSite » est absent de la page',
    ]);
  });

  it('refuse un site qui ne vient plus de Cloudflare', () => {
    const response = ok();
    response.headers.set('server', 'Google Frontend');
    expect(judgeSite(response, 'MonSite', site)).toEqual([
      'servi par « google frontend » et non par Cloudflare',
    ]);
  });

  it('exige la CSP seulement des sites qui en déclarent une', () => {
    const response = ok();
    response.headers.delete('content-security-policy');
    expect(judgeSite(response, 'MonSite', site)).toEqual([
      'Content-Security-Policy absente',
    ]);
    expect(judgeSite(response, 'MonSite', { ...site, csp: false })).toEqual([]);
  });

  it('liste chaque site une fois, en HTTPS, avec un mot à chercher', () => {
    const urls = SITES.map((s: { url: string }) => s.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const s of SITES as { url: string; marker: string }[]) {
      expect(s.url.startsWith('https://')).toBe(true);
      expect(s.marker.length).toBeGreaterThan(0);
    }
  });
});
