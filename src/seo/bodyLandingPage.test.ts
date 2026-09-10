import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { bodyFromPathname } from '@/core/permalink';
import { flattenBodies } from '@/config/catalog';
import type { CelestialBodyConfig } from '@/types';
import { existsSync } from 'fs';
import { resolve } from 'path';
import {
  bodyFacts,
  bodyLandingPages,
  bodyVisual,
  pickSurfaceResolution,
  renderBodyPage,
  renderSitemap,
  trimForMeta,
} from './bodyLandingPage';
import { CARD_HEIGHT, CARD_WIDTH } from './socialCard';

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

  it('garde les titres dans le budget affiché par un moteur', () => {
    // Mesuré : le premier format tenait en 58 à 65 caractères et 43 des 51 titres se faisaient
    // tronquer. Un titre coupé perd son ellipse au mauvais endroit et n'apporte rien de plus.
    for (const page of pages) {
      expect(
        page.title.length,
        `${page.slug} : « ${page.title} »`
      ).toBeLessThanOrEqual(60);
      // Et le NOM DU CORPS ouvre le titre : c'est le mot que quelqu'un cherche, il doit
      // survivre à toute troncature quelle qu'en soit la règle.
      expect(page.title.startsWith(page.displayName)).toBe(true);
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

describe('URL des pages', () => {
  it('donne à chaque corps un segment d’URL sûr, qui se relit', () => {
    // PIÈGE LATENT : le slug vient du nom de catalogue. Un futur corps nommé avec un accent,
    // un espace ou un point produirait une URL encodée que `bodyFromPathname` ne reconnaîtrait
    // plus — la page existerait, serait servie, et n'ouvrirait PAS le bon corps. Rien ne le
    // signalerait : ni le build, ni le rendu, ni un test de contenu.
    const slugs = new Set(pages.map((page) => page.slug));
    for (const page of pages) {
      expect(page.slug, `${page.slug} : segment d'URL non sûr`).toMatch(
        /^[a-z0-9-]+$/
      );
      expect(encodeURIComponent(page.slug)).toBe(page.slug);
      // Aller-retour complet : c'est ce chemin-là que l'application relira.
      expect(bodyFromPathname(`/${page.slug}/`, slugs)).toBe(page.slug);
    }
  });

  it('n’émet aucune URL en double', () => {
    expect(new Set(pages.map((page) => page.slug)).size).toBe(pages.length);
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

describe('vignette de partage', () => {
  /**
   * Ces cinquante et une pages partageaient une seule vieille capture de la vue d'ensemble :
   * un lien vers Titan montrait le Soleil. C'est l'image qui décide du clic dans une
   * conversation, et c'est la seule partie de la page que personne ne voit jamais échouer
   * pendant le développement.
   */

  it('donne à chaque page SA vignette', () => {
    const images = pages.map((p) => p.image);
    expect(new Set(images).size).toBe(images.length);
    for (const p of pages) {
      expect(p.image).toBe(`${ORIGIN}/social/${p.slug}.jpg`);
      // URL ABSOLUE : un chemin relatif n'est pas résolu par la plupart des aspirateurs
      // d'aperçu, qui lisent les balises sans contexte de document.
      expect(p.image.startsWith('https://')).toBe(true);
      // Hors de `/assets/`, dont Firebase déclare le contenu immuable pendant un an, alors que
      // ce nom de fichier est stable et son contenu réécrit à chaque build.
      expect(p.image).not.toContain('/assets/');
    }
  });

  it('décrit l’image, et nomme le corps en premier', () => {
    for (const p of pages) {
      expect(p.imageAlt.startsWith(p.displayName)).toBe(true);
      expect(p.imageAlt).toMatch(/3D sphere/);
    }
    expect(new Set(pages.map((p) => p.imageAlt)).size).toBe(pages.length);
  });

  it('donne à chaque corps une texture OU une couleur déclarée', () => {
    // Sans l'une des deux, le corps sortirait en boule grise anonyme — une vignette pire que
    // l'ancienne, parce qu'elle prétend montrer ce corps-là. Le repli neutre du code existe
    // pour ne jamais casser le build ; ce test est ce qui empêche de s'en contenter.
    const flat = flattenBodies(CELESTIAL_CONFIG);
    for (const p of pages) {
      const cfg = flat.get(p.slug);
      const declared =
        p.visual.surface !== null || cfg?.fallbackColor !== undefined;
      expect(
        declared,
        `${p.slug} : ni texture de surface ni fallbackColor`
      ).toBe(true);
      for (const channel of p.visual.fallback) {
        expect(Number.isInteger(channel)).toBe(true);
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });

  it('pointe vers des fichiers de texture qui EXISTENT', () => {
    // Le plugin de build lit ces chemins avec sharp. Un renommage dans le catalogue ferait
    // échouer le build vingt minutes plus tard, sans dire lequel des cinquante et un corps
    // est en cause. Ici, tout de suite, et nommément.
    for (const p of pages) {
      if (!p.visual.surface) continue;
      expect(p.visual.surface.startsWith('public/assets/textures/')).toBe(true);
      expect(
        existsSync(resolve(process.cwd(), p.visual.surface)),
        `${p.slug} : ${p.visual.surface}`
      ).toBe(true);
    }
  });

  it('n’allume que l’étoile', () => {
    // `emissive` décide de l'absence de terminateur. Se tromper de corps donnerait une lune
    // plate ou un Soleil éclairé de côté.
    const emissive = pages.filter((p) => p.visual.emissive).map((p) => p.slug);
    expect(emissive).toEqual(['sun']);
  });

  it('choisit la 2k, sinon la 1k, sinon la plus petite disponible', () => {
    expect(pickSurfaceResolution(['8k', '4k', '2k', '1k'])).toBe('2k');
    expect(pickSurfaceResolution(['1k'])).toBe('1k');
    // Ordre du tableau volontairement décroissant, comme dans le catalogue : prendre le
    // premier élément donnerait la 8k et cinquante décodages inutiles au build.
    expect(pickSurfaceResolution(['8k', '4k'])).toBe('4k');
    expect(pickSurfaceResolution([])).toBe(null);
    expect(pickSurfaceResolution(undefined)).toBe(null);
  });

  it('convertit la couleur du catalogue sans mélanger les canaux', () => {
    const visual = bodyVisual({
      kind: 'moon',
      fallbackColor: 0x9b6a45,
      textureResolutions: {},
    } as unknown as Parameters<typeof bodyVisual>[0]);
    expect(visual.fallback).toEqual([0x9b, 0x6a, 0x45]);
    expect(visual.surface).toBe(null);
    expect(visual.emissive).toBe(false);
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

  it('remplace la vignette de partage, Open Graph ET Twitter', () => {
    // Les deux balises se lisent séparément : Twitter n'utilise `og:image` qu'à défaut de
    // `twitter:image`. En oublier une, c'est l'ancienne capture générique sur la moitié des
    // réseaux — et rien ne le dit tant que quelqu'un ne partage pas le lien.
    const html = renderBodyPage(BASE_HTML, page!);
    expect(html).toContain(`property="og:image" content="${page!.image}"`);
    expect(html).toContain(`name="twitter:image" content="${page!.image}"`);
    expect(html).toContain(
      `property="og:image:alt" content="${page!.imageAlt}"`
    );
    // Plus aucune trace de l'ancienne vignette générique.
    expect(html).not.toContain('/assets/social/og.jpg');
    expect(html).not.toContain('home card');
    // Les dimensions annoncées suivent le format réellement produit par `socialCard.ts`.
    expect(html).toContain(`property="og:image:width" content="${CARD_WIDTH}"`);
    expect(html).toContain(
      `property="og:image:height" content="${CARD_HEIGHT}"`
    );
    expect(CARD_WIDTH).toBe(1200);
    expect(CARD_HEIGHT).toBe(630);
  });

  it('donne une vignette DIFFÉRENTE à chaque page rendue', () => {
    // La propriété qui rend l'opération utile : cinquante et une pages qui partagent une image
    // sont, pour un lecteur, cinquante et une fois la même page.
    const rendered = pages.map((p) => {
      const html = renderBodyPage(BASE_HTML, p);
      return /property="og:image" content="([^"]+)"/.exec(html)?.[1];
    });
    expect(rendered.every((value) => value !== undefined)).toBe(true);
    expect(new Set(rendered).size).toBe(pages.length);
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
      'property="og:image"',
      'property="og:image:alt"',
      'name="twitter:image"',
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
  it('produit un XML que la Search Console peut accepter', () => {
    // Un sitemap malformé est rejeté EN BLOC : les cinquante-trois URL deviennent alors
    // invisibles d'un coup, et le message d'erreur arrive des jours plus tard, hors de tout
    // contexte. Contrôle de forme minimal, ici, tout de suite.
    const xml = renderSitemap(pages, ORIGIN, '2026-09-10');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    );
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
    // Balises appariées, et aucune URL relative ou non chiffrée.
    expect(xml.match(/<url>/g)?.length).toBe(xml.match(/<\/url>/g)?.length);
    for (const loc of xml.match(/<loc>([^<]*)<\/loc>/g) ?? [])
      expect(loc.slice(5, -6)).toMatch(/^https:\/\//);
    // Rien d'échappable ne doit avoir échappé à l'échappement.
    expect(xml).not.toMatch(/<loc>[^<]*[<>"][^<]*<\/loc>/);
  });

  it('liste l’accueil, la confidentialité et chaque corps', () => {
    const xml = renderSitemap(pages, ORIGIN, '2026-09-10');
    expect(xml.match(/<loc>/g)?.length).toBe(pages.length + 2);
    expect(xml).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/privacy.html</loc>`);
    for (const page of pages)
      expect(xml).toContain(`<loc>${page.canonical}</loc>`);
  });
});
