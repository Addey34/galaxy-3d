import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import { SQRT_K } from '@/core/ScaleService';
import { MIN_SAMPLES_PER_ORBIT_FOR_HERMITE } from '@/core/HorizonsEphemerisService';
import summaryJson from './horizons-validation-summary.json';
import manifestJson from '../../public/assets/ephemerides/manifest.json';
import textureSources from '../../scripts/texture-sources.json';
import {
  DOC_SLUGS,
  docPath,
  formatQuantity,
  renderDocPage,
} from './documentPage';
import {
  assertPublishableSummary,
  methodologyPages,
  type EphemerisManifest,
  type ValidationSummary,
} from './methodologyPage';
import {
  missingTextureProvenance,
  shippedTextureLayers,
  sourcesPages,
  type SourcesInput,
  type TextureProvenance,
} from './sourcesPage';
import { renderInline, renderMarkdown } from './markdown';
import {
  LANDING_PAGE_GLOB_IGNORES,
  NAVIGATE_FALLBACK_DENYLIST,
} from './pwaRouting';
import { matchesGlob } from 'node:path';
import { messages } from '@/i18n/locales';

/**
 * `/methodology` et `/sources` publient des chiffres et des crédits. Ce que ces tests gardent :
 * que chaque valeur vienne de sa source (la changer change la page), que rien de ce qui est
 * livré ne manque, et que les deux langues soient deux vrais documents.
 */

const ORIGIN = 'https://example.test';
const ROOT = resolve(import.meta.dirname, '..', '..');
const summary = summaryJson as unknown as ValidationSummary;
const manifest = manifestJson as unknown as EphemerisManifest;
const textures = (textureSources as { imported: TextureProvenance[] }).imported;

const methodology = methodologyPages({
  summary,
  manifest,
  config: CELESTIAL_CONFIG,
  origin: ORIGIN,
});

const sourcesInput: SourcesInput = {
  config: CELESTIAL_CONFIG,
  textures,
  manifest,
  dependencies: [
    { name: 'three', version: '0.176.0', license: 'MIT', homepage: null },
  ],
  notices: readFileSync(resolve(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf-8'),
  repositoryBlobUrl: 'https://github.com/example/repo/blob/main',
  updated: '2026-09-17',
  origin: ORIGIN,
};
const sources = sourcesPages(sourcesInput);
const allPages = [...methodology, ...sources];

/** Copie profonde modifiable du résumé, pour falsifier une valeur. */
const cloneSummary = (): ValidationSummary =>
  JSON.parse(JSON.stringify(summary)) as ValidationSummary;

describe('résumé de validation publié', () => {
  it('est une mesure complète, publiable', () => {
    expect(() => assertPublishableSummary(summary)).not.toThrow();
  });

  it('couvre chaque corps positionné du catalogue', () => {
    // Un corps ajouté sans relancer `pnpm ephemeris:validate` disparaîtrait du tableau de
    // précision sans que la page le dise. Le Soleil est l'origine, la skybox n'a pas de position.
    const measured = new Set(
      summary.rows.filter((r) => r.provider === 'production').map((r) => r.body)
    );
    const expected = [...flattenBodies(CELESTIAL_CONFIG).entries()]
      .filter(([, cfg]) => cfg.kind !== 'skybox' && cfg.kind !== 'star')
      .map(([name]) => name);
    expect(expected.filter((name) => !measured.has(name))).toEqual([]);
  });

  it('refuse un résumé vide ou partiel', () => {
    const partial = cloneSummary();
    partial.rows = partial.rows.filter((r) => r.provider !== 'production');
    expect(() => assertPublishableSummary(partial)).toThrow(/production/);
    const unmeasured = cloneSummary();
    const row = unmeasured.rows.find((r) => r.provider === 'production')!;
    row.n = 0;
    expect(() => assertPublishableSummary(unmeasured)).toThrow(row.body);
  });
});

describe('page /methodology', () => {
  it('publie chaque chiffre du résumé : le changer change la page', () => {
    const mutated = cloneSummary();
    const titan = mutated.rows.find(
      (r) => r.provider === 'production' && r.body === 'titan'
    )!;
    titan.km!.mean = 123456;
    const [en] = methodologyPages({
      summary: mutated,
      manifest,
      config: CELESTIAL_CONFIG,
      origin: ORIGIN,
    });
    expect(methodology[0]!.body).not.toContain('123,456');
    expect(en!.body).toContain('123,456');
  });

  it('lit le pas des binaires dans le manifest et les constantes dans le code', () => {
    const mutated: EphemerisManifest = JSON.parse(JSON.stringify(manifest));
    for (const entry of Object.values(mutated.bodies)) entry.stepDays = 7;
    const [en] = methodologyPages({
      summary,
      manifest: mutated,
      config: CELESTIAL_CONFIG,
      origin: ORIGIN,
    });
    expect(en!.body).toContain('every 7 days for natural bodies');
    expect(methodology[0]!.body).not.toContain('every 7 days');
    expect(en!.body).toContain(`K = ${SQRT_K}`);
    expect(en!.body).toContain('TT − UTC = 69.184 s');
    expect(en!.body).toContain(
      `from ${MIN_SAMPLES_PER_ORBIT_FOR_HERMITE} samples per orbit`
    );
  });

  it('montre l’erreur de production de chaque corps, en km et en rayons', () => {
    const [en] = methodology;
    for (const row of summary.rows.filter((r) => r.provider === 'production'))
      expect(en!.body).toContain(formatQuantity(row.km!.mean, 'en'));
  });

  it('ne publie pas le SPK comme actif quand il ne l’est pas', () => {
    const [en, fr] = methodology;
    expect(summary.spk.enabledInProduction).toBe(false);
    expect(en!.body).toContain('<strong>not enabled</strong>');
    expect(fr!.body).toContain('<strong>pas activé</strong>');
  });
});

describe('page /sources', () => {
  it('trouve une provenance pour CHAQUE couche de texture livrée', () => {
    expect(shippedTextureLayers(CELESTIAL_CONFIG).length).toBeGreaterThan(40);
    expect(missingTextureProvenance(CELESTIAL_CONFIG, textures)).toEqual([]);
  });

  it('refuse de publier si une couche livrée perd sa provenance', () => {
    const withoutMars = textures.filter(
      (t) => !(t.body === 'mars' && t.layer === 'surface')
    );
    expect(() =>
      sourcesPages({ ...sourcesInput, textures: withoutMars })
    ).toThrow('mars/surface');
  });

  it('cite le crédit de chaque modèle de forme du catalogue', () => {
    const [en] = sources;
    const models = [...flattenBodies(CELESTIAL_CONFIG).values()].filter(
      (cfg) => cfg.model
    );
    expect(models.length).toBeGreaterThanOrEqual(5);
    for (const cfg of models)
      expect(en!.body).toContain(
        cfg.model!.credit.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      );
  });

  it('liste chaque fichier d’éphémérides avec sa cible Horizons', () => {
    const [en] = sources;
    for (const entry of Object.values(manifest.bodies))
      expect(en!.body).toContain(`<code>${entry.target}</code>`);
  });

  it('rend le texte juridique complet, titres compris', () => {
    const [en] = sources;
    const headings = sourcesInput.notices.match(/^##\s+.+$/gm) ?? [];
    expect(headings.length).toBeGreaterThan(2);
    expect(en!.body.match(/<h3>/g)?.length).toBe(headings.length);
    // Le titre de premier niveau du fichier est retiré (il doublerait celui de la section), y
    // compris en fins de ligne CRLF, celles d'un checkout Windows.
    const crlf = sourcesPages({
      ...sourcesInput,
      notices: sourcesInput.notices.replace(/\r?\n/g, '\r\n'),
    })[0]!;
    for (const page of [en!, crlf])
      expect(page.body).not.toContain('<h2>Third-party notices</h2>');
    expect(crlf.body.match(/<h3>/g)?.length).toBe(headings.length);
    expect(en!.body).toContain(
      'href="https://github.com/example/repo/blob/main/LICENSE.md"'
    );
  });
});

describe('rendu Markdown', () => {
  const options = {
    repositoryBlobUrl: 'https://repo.test/blob/main',
    headingShift: 1,
  };

  it('échappe le HTML au lieu de l’interpréter', () => {
    expect(renderInline('<img src=x onerror=alert(1)>', options)).toBe(
      '&lt;img src=x onerror=alert(1)&gt;'
    );
    // Un schéma non http n'est jamais un lien actif : il est rattaché au dépôt comme un chemin.
    expect(renderInline('[x](javascript:alert(1))', options)).not.toContain(
      'href="javascript:'
    );
  });

  it('garde le code intact et rattache les liens relatifs au dépôt', () => {
    expect(renderInline('`a_*b*_` and **bold**', options)).toBe(
      '<code>a_*b*_</code> and <strong>bold</strong>'
    );
    expect(renderInline('see [`LICENSE.md`](LICENSE.md)', options)).toBe(
      'see <a href="https://repo.test/blob/main/LICENSE.md" rel="noopener noreferrer"><code>LICENSE.md</code></a>'
    );
    expect(renderInline('<https://svs.gsfc.nasa.gov/5069>', options)).toContain(
      'href="https://svs.gsfc.nasa.gov/5069"'
    );
  });

  it('prolonge un élément de liste par ses lignes indentées', () => {
    const html = renderMarkdown(
      '## T\n\n1. **One** first\n   continued.\n\n2. Two\n\nAfter.',
      options
    );
    expect(html).toBe(
      '<h3>T</h3>\n<ol><li><strong>One</strong> first continued.</li><li>Two</li></ol>\n<p>After.</p>'
    );
  });
});

describe('documents et routage', () => {
  it('produit une page par sujet et par langue, reliées entre elles', () => {
    expect(allPages.map((p) => new URL(p.canonical).pathname).sort()).toEqual([
      '/fr/methodology/',
      '/fr/sources/',
      '/methodology/',
      '/sources/',
    ]);
    for (const page of allPages) {
      const html = renderDocPage(page, ORIGIN);
      expect(html).toContain(`<html lang="${page.locale}">`);
      expect(html).toContain(
        `<link rel="canonical" href="${page.canonical}" />`
      );
      for (const locale of ['en', 'fr'] as const)
        expect(html).toContain(
          `hreflang="${locale}" href="${ORIGIN}${docPath(page.slug, locale)}"`
        );
      // Aucun script exécutable : la CSP l'interdirait, et une page de lecture n'en a pas besoin.
      expect(html.match(/<script(?![^>]*application\/ld\+json)/g)).toBeNull();
      expect(() =>
        JSON.parse(
          /<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)![1]!
        )
      ).not.toThrow();
    }
  });

  it('écrit deux vraies versions, pas une page doublée', () => {
    for (const slug of DOC_SLUGS) {
      const [en, fr] = allPages.filter((p) => p.slug === slug);
      expect(en!.title).not.toBe(fr!.title);
      expect(en!.description).not.toBe(fr!.description);
    }
  });

  it('ne fait entrer aucun tiret cadratin dans le texte rédigé', () => {
    // Les crédits CITÉS (fichier de provenance, catalogue, mentions) en contiennent et restent
    // tels quels ; la prose de la page, elle, n'en emploie pas.
    const [en, fr] = methodology;
    expect(en!.body).not.toContain('—');
    expect(fr!.body).not.toContain('—');
  });

  it('est la cible exacte des liens de l’aide, dans chaque langue', () => {
    for (const locale of ['en', 'fr'] as const)
      for (const slug of DOC_SLUGS)
        expect(messages[locale][`credits.${slug}.href`]).toBe(
          docPath(slug, locale)
        );
  });

  it('n’entre en collision avec aucun corps', () => {
    const slugs = new Set(
      [...flattenBodies(CELESTIAL_CONFIG).keys()].map((n) => n.toLowerCase())
    );
    for (const reserved of [...DOC_SLUGS, 'fr'])
      expect(slugs.has(reserved), reserved).toBe(false);
  });

  it('n’est ni précachée ni remplacée par l’app shell', () => {
    for (const page of allPages) {
      const { pathname } = new URL(page.canonical);
      expect(
        LANDING_PAGE_GLOB_IGNORES.some((glob) =>
          matchesGlob(`${pathname.slice(1)}index.html`, glob)
        ),
        pathname
      ).toBe(true);
      for (const path of [pathname, pathname.replace(/\/$/, '')])
        expect(
          NAVIGATE_FALLBACK_DENYLIST.some((rule) => rule.test(path)),
          path
        ).toBe(true);
    }
  });
});
