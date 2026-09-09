import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import type { CelestialBodyConfig } from '@/types';
import {
  bodyFacts,
  bodyLandingPages,
  renderBodyPage,
  renderSitemap,
  trimForMeta,
} from './bodyLandingPage';

/**
 * Ces pages n'existent que pour une raison : l'application est une URL unique, donc un moteur
 * de recherche ne peut classer qu'UN sujet pour tout le site. Ce que ces tests protègent est
 * donc la propriété qui rend l'opération utile — chaque page doit être RÉELLEMENT différente
 * des cinquante autres — et le mode d'échec qui la détruirait en silence.
 */

const ORIGIN = 'https://example.test';
const pages = bodyLandingPages(CELESTIAL_CONFIG, ORIGIN);

/** Un squelette minimal portant les mêmes repères que `index.html`. */
const BASE_HTML = [
  '<!doctype html><html><head>',
  '<title>Home</title>',
  '<meta name="description" content="home" />',
  '<link rel="canonical" href="https://example.test/" />',
  '<meta property="og:title" content="home" />',
  '<meta property="og:description" content="home" />',
  '<meta property="og:url" content="https://example.test/" />',
  '<meta name="twitter:title" content="home" />',
  '<meta name="twitter:description" content="home" />',
  '<script type="application/ld+json">{"@type":"WebApplication"}</script>',
  '</head><body>',
  '<h1 class="sr-only">Home heading</h1>',
  '<noscript><p>home fallback</p></noscript>',
  '</body></html>',
].join('');

describe('pages d’atterrissage par corps', () => {
  it('couvre exactement les corps que l’application sait ouvrir', () => {
    // Une page menant vers un corps non sélectionnable serait une promesse non tenue : le
    // visiteur arriverait sur une scène qui ne montre pas ce qu'il a cherché.
    const selectable = [...flattenBodies(CELESTIAL_CONFIG).entries()]
      .filter(([, cfg]) => cfg.kind !== 'skybox')
      .map(([name]) => name.toLowerCase())
      .sort();
    expect(pages.map((page) => page.slug)).toEqual(selectable);
    expect(pages.length).toBeGreaterThan(40);
  });

  it('donne à chaque page un titre, une description et un canonique DISTINCTS', () => {
    // LA propriété : cinquante pages quasi identiques seraient du contenu dupliqué, c'est-à-dire
    // exactement le problème qu'on prétend résoudre.
    for (const key of ['title', 'description', 'canonical'] as const) {
      const values = pages.map((page) => page[key]);
      expect(new Set(values).size, `${key} dupliqué`).toBe(values.length);
    }
  });

  it('garde les descriptions dans le budget d’un extrait de résultat', () => {
    for (const page of pages) {
      expect(page.description.length).toBeLessThanOrEqual(160);
      // Et la phrase d'appel n'est jamais coupée : c'est la partie la plus utile de l'extrait.
      expect(page.description).toMatch(/right now\.$/);
    }
  });

  it('coupe sur une phrase entière quand c’est possible, sur un mot sinon', () => {
    expect(trimForMeta('Un. Deux. Trois.', 10)).toBe('Un. Deux.');
    expect(trimForMeta('Une phrase sans ponctuation du tout ici', 20)).toBe(
      'Une phrase sans…'
    );
    expect(trimForMeta('Court', 50)).toBe('Court');
  });
});

describe('faits affichés', () => {
  it('omet un champ déclaré inconnu plutôt que d’aligner un tiret', () => {
    // La raison publiée vit dans la fiche de l'application ; une page statique qui affiche « — »
    // n'apprend rien à un lecteur ni à un moteur.
    const withValue = {
      realData: { radiusKm: 100, massKg: 5e20 },
    } as CelestialBodyConfig;
    const declaredUnknown = {
      realData: {
        radiusKm: 100,
        massKg: 5e20,
        unknown: { massKg: { en: 'no published value', fr: 'non publiée' } },
      },
    } as CelestialBodyConfig;
    expect(bodyFacts(withValue).map((f) => f.label)).toContain('Mass');
    expect(bodyFacts(declaredUnknown).map((f) => f.label)).not.toContain(
      'Mass'
    );
  });

  it('situe une lune par rapport à sa planète', () => {
    const moon = { realData: { radiusKm: 1 } } as CelestialBodyConfig;
    expect(bodyFacts(moon, 'Jupiter')).toContainEqual({
      label: 'Orbits',
      value: 'Jupiter',
    });
  });
});

describe('rendu de la page', () => {
  const page = pages.find((p) => p.slug === 'jupiter');

  it('remplace les balises de tête et le contenu textuel', () => {
    expect(page).toBeDefined();
    const html = renderBodyPage(BASE_HTML, page!);
    expect(html).toContain(`<title>${page!.title}</title>`);
    expect(html).toContain(`href="${page!.canonical}"`);
    expect(html).toContain(`content="${page!.canonical}"`);
    expect(html).toContain(`<h1 class="sr-only">${page!.heading}</h1>`);
    // Plus aucune trace du texte de l'accueil : c'est ce qui distingue la page.
    expect(html).not.toContain('home fallback');
    expect(html).not.toContain('<title>Home</title>');
    // Le contenu existe DEUX fois : pour les moteurs sans script (`noscript`) et pour ceux qui
    // en exécutent — sans le second, un crawler moderne ne verrait qu'un canevas WebGL.
    expect(html.split('Jupiter is shown at its real position').length - 1).toBe(
      2
    );
    // Données structurées propres à la page, pas la `WebApplication` répétée cinquante fois.
    expect(html).toContain('"@type":"WebPage"');
  });

  it('ÉCHOUE si un repère du HTML a disparu', () => {
    // LE mode d'échec à interdire : un `replace` dont le motif ne correspond plus est un no-op
    // SILENCIEUX. Il produirait cinquante pages portant le titre de l'accueil — du contenu
    // dupliqué, précisément ce qu'on veut éviter, et rien pour le signaler. Une évolution du
    // HTML ou de Vite doit casser le build, pas le référencement.
    for (const marker of [
      '<title>',
      'rel="canonical"',
      'property="og:url"',
      '<h1 class="sr-only">',
      '<noscript>',
    ]) {
      const broken = BASE_HTML.replace(marker, '<!-- retiré -->');
      expect(() => renderBodyPage(broken, page!), marker).toThrow();
    }
  });

  it('échappe ce qui vient du catalogue', () => {
    const hostile = {
      ...page!,
      displayName: 'A<b>"&',
      heading: 'A<b>"&',
      summary: 'A<b>"&',
    };
    const html = renderBodyPage(BASE_HTML, hostile);
    expect(html).not.toContain('A<b>"&');
    expect(html).toContain('A&lt;b&gt;&quot;&amp;');
  });
});

describe('sitemap', () => {
  it('liste l’accueil, la confidentialité et chaque corps', () => {
    const xml = renderSitemap(pages, ORIGIN, '2026-09-10');
    expect(xml.match(/<loc>/g)?.length).toBe(pages.length + 2);
    expect(xml).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/privacy.html</loc>`);
    for (const page of pages)
      expect(xml).toContain(`<loc>${page.canonical}</loc>`);
  });
});
