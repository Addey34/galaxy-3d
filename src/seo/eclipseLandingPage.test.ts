import { describe, expect, it } from 'vitest';
import { eclipseLandingPages, renderEclipsePage } from './eclipseLandingPage';
import { bodyLandingPages, renderSitemap } from './bodyLandingPage';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { eclipseFromPathname } from '@/core/eclipsePages';

const ORIGIN = 'https://example.test';
const pages = eclipseLandingPages(ORIGIN);

/** Un squelette minimal portant les mêmes repères que `index.html` (cf. bodyLandingPage.test). */
const BASE_HTML = [
  '<!doctype html><html><head>',
  '<title>Home</title>',
  '<meta name="description" content="home" />',
  '<link rel="canonical" href="https://example.test/" />',
  '<meta property="og:title" content="home" />',
  '<meta property="og:description" content="home" />',
  '<meta property="og:url" content="https://example.test/" />',
  '<meta property="og:image" content="https://example.test/assets/social/og.jpg" />',
  '<meta property="og:image:width" content="1200" />',
  '<meta property="og:image:height" content="630" />',
  '<meta property="og:image:alt" content="home card" />',
  '<meta name="twitter:image" content="https://example.test/assets/social/og.jpg" />',
  '<meta name="twitter:title" content="home" />',
  '<meta name="twitter:description" content="home" />',
  '<script type="application/ld+json">{"@type":"WebApplication"}</script>',
  '</head><body>',
  '<h1 class="sr-only">Home heading</h1>',
  '<noscript><p>home fallback</p></noscript>',
  '</body></html>',
].join('');

const page = (slug: string) => {
  const found = pages.find((p) => p.slug === slug);
  if (!found) throw new Error(`page absente : ${slug}`);
  return found;
};

describe('pages d’atterrissage par éclipse', () => {
  it('produit une page par éclipse de la fenêtre 2024-2035', () => {
    expect(pages).toHaveLength(53);
  });

  it('donne à chaque page un titre, une description et un canonique DISTINCTS', () => {
    for (const field of ['title', 'description', 'canonical'] as const)
      expect(new Set(pages.map((p) => p[field])).size, field).toBe(
        pages.length
      );
  });

  it('tient les titres et descriptions dans ce qu’un moteur affiche sans couper', () => {
    // Mesuré, pas deviné : le plus long titre fait 50 caractères (une pénombrale de février).
    for (const p of pages) {
      expect(p.title.length, p.title).toBeLessThanOrEqual(60);
      expect(p.description.length, p.description).toBeLessThanOrEqual(160);
    }
  });

  it('annonce une adresse que l’application relit comme CETTE éclipse', () => {
    // Le canonique et le voyage doivent désigner le même instant : l'app recalcule l'éclipse
    // depuis le chemin, la page l'a calculée au build.
    for (const p of pages) {
      const { pathname } = new URL(p.canonical);
      expect(pathname).toBe(`/eclipse/${p.slug}/`);
      // À la seconde : la recherche converge à 1 ms près selon son départ (cf. eclipsePages.test).
      expect(
        Math.abs(
          eclipseFromPathname(pathname)!.date.getTime() - p.event.date.getTime()
        )
      ).toBeLessThan(1000);
    }
  });

  it('réutilise la vignette du corps sur lequel la page s’ouvre', () => {
    expect(page('2026-08-12').image).toBe(`${ORIGIN}/social/earth.jpg`);
    expect(page('2026-08-28').image).toBe(`${ORIGIN}/social/moon.jpg`);
  });

  it('écrit ce que le calcul donne, rien de plus', () => {
    const total = page('2026-08-12');
    expect(total.title).toBe('Total solar eclipse of August 12, 2026 in 3D');
    expect(total.summary).toMatch(
      /At its peak, at 17:4\d UTC, the Moon hides 100% of the Sun/
    );
    expect(total.facts.map((f) => f.label)).toContain('Greatest eclipse');
    // Une pénombrale n'a pas d'ombre franche : pas de pourcentage inventé.
    const penumbral = pages.find((p) => p.event.eclipseKind === 'penumbral')!;
    expect(penumbral.summary).toContain('penumbra only');
    expect(penumbral.facts.map((f) => f.label)).not.toContain('Moon in shadow');
  });
});

describe('renderEclipsePage', () => {
  const html = renderEclipsePage(BASE_HTML, page('2026-08-12'));

  it('réécrit la tête et le contenu, sans rester sur l’accueil', () => {
    expect(html).toContain(
      '<title>Total solar eclipse of August 12, 2026 in 3D</title>'
    );
    expect(html).toContain(`href="${ORIGIN}/eclipse/2026-08-12/"`);
    expect(html).toContain(`content="${ORIGIN}/social/earth.jpg"`);
    expect(html).not.toContain('home fallback');
    expect(html).toContain('<section class="sr-only">');
    expect(JSON.parse(html.match(/ld\+json">([^<]*)</)![1]!).url).toBe(
      `${ORIGIN}/eclipse/2026-08-12/`
    );
  });

  it('casse au lieu de produire une copie de l’accueil si un repère disparaît', () => {
    expect(() =>
      renderEclipsePage(
        BASE_HTML.replace('<noscript>', '<div>'),
        page('2026-08-12')
      )
    ).toThrow(/repère introuvable/);
  });
});

describe('sitemap', () => {
  it('liste l’accueil, la confidentialité, chaque corps et chaque éclipse', () => {
    const bodies = bodyLandingPages(CELESTIAL_CONFIG, ORIGIN);
    const xml = renderSitemap([...bodies, ...pages], ORIGIN, '2026-09-15');
    expect(xml.match(/<loc>/g)?.length).toBe(bodies.length + pages.length + 2);
    expect(xml).toContain(`<loc>${ORIGIN}/eclipse/2026-08-12/</loc>`);
  });
});
