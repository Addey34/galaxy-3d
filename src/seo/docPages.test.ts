import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import { FACT_SOURCES } from '@/config/factSources';
import { ALL_FACT_FIELDS, bodyFact } from '@/core/bodyFacts';
import { NAVIGABLE_TARGETS } from '@/config/navigable';
import { parseSmallBodyDataset, type SmallBodyDatasetFile } from '@/core/sbdb';
import { SQRT_K } from '@/core/ScaleService';
import { MIN_SAMPLES_PER_ORBIT_FOR_HERMITE } from '@/core/HorizonsEphemerisService';
import summaryJson from '@/config/horizons-validation-summary.json';
import { TEMPORAL_CATEGORIES, temporalCategoryLabelKey } from '@/core/temporal';
import { EVENT_PROVIDERS } from '@/registry/providers/runtimeServices';
import manifestJson from '../../public/assets/ephemerides/manifest.json';
import { HEIGHTFIELD_PRODUCTS, shippedTextures } from '@/registry/products';
import firebaseJson from '../../firebase.json';
import { ILLUSTRATIVE_SURFACES } from '@/config/catalog';
import { OBLIQUITY_RAD } from '@/core/frames';
import { educationalParentOrbitScale } from '@/core/educationalScale';
import {
  DOC_SLUGS,
  docPath,
  formatQuantity,
  renderDocPage,
  socialImageFromHtml,
} from './documentPage';
import {
  assertPublishableSummary,
  methodologyPages,
  synchronousSpinDrifts,
  type EphemerisManifest,
  type ValidationSummary,
} from './methodologyPage';
import {
  connectHostsFromFirebase,
  LIVE_DATA_SERVICES,
  liveServiceMismatch,
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
const indexHtml = readFileSync(resolve(ROOT, 'index.html'), 'utf-8');
const socialImage = socialImageFromHtml(indexHtml);
const connectHosts = connectHostsFromFirebase(firebaseJson);
const manifest = manifestJson as unknown as EphemerisManifest;
const textures: TextureProvenance[] = shippedTextures();

const methodology = methodologyPages({
  summary,
  manifest,
  config: CELESTIAL_CONFIG,
  origin: ORIGIN,
});

/**
 * Date et compte de l'instantané des petits corps, obtenus par la MÊME règle que
 * l'application (`parseSmallBodyDataset`) sur le fichier que le build livre : un compte de
 * lignes brutes dirait 8000 quand le panneau en affiche 6965.
 */
function smallBodySnapshot(): { retrieved: string; count: number } {
  const dataset = parseSmallBodyDataset(
    JSON.parse(
      readFileSync(
        resolve(ROOT, 'public/assets/small-bodies/dataset.json'),
        'utf-8'
      )
    ) as SmallBodyDatasetFile
  );
  return { retrieved: dataset.retrieved!, count: dataset.bodies.length };
}

/**
 * Jeux de hauteurs livrés, lus comme le plugin Vite les lit : la fiche pour l'identité, le
 * manifeste du cuiseur pour les mesures. Rien n'est retapé ici, sinon la page serait comparée
 * à une copie d'elle-même.
 */
function shippedHeightfields() {
  return HEIGHTFIELD_PRODUCTS.map((product) => {
    const manifest = JSON.parse(
      readFileSync(resolve(ROOT, 'public', product.manifest), 'utf-8')
    ) as {
      baseLevel: number;
      tiles: number;
      bytes: number;
      coverage: { level: number; levels?: number[]; area?: { name: string } }[];
    };
    return {
      body: product.body,
      title: product.title,
      mission: product.mission,
      instrument: product.instrument,
      credit: product.providers.map((p) => p.name).join(' · '),
      sourceUrl:
        product.links.find((l) => l.rel === 'via')?.href ??
        product.links.find((l) => l.rel === 'describedby')!.href,
      baseLevel: manifest.baseLevel,
      areas: manifest.coverage
        .filter((entry) => entry.area)
        .map((entry) => ({
          name: entry.area!.name,
          level: Math.max(...(entry.levels ?? [entry.level])),
        })),
      tiles: manifest.tiles,
      bytes: manifest.bytes,
    };
  });
}

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
  connectHosts,
  // Lu dans le fichier livré, comme le fait le plugin Vite : la page cite sa date, et une
  // valeur retapée ici ne prouverait rien de ce qui est publié.
  smallBodies: smallBodySnapshot(),
  heightfields: shippedHeightfields(),
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
    expect(en!.body).toContain('every 7 days depending on the body, between');
    expect(methodology[0]!.body).not.toContain('every 7 days');
    // Les pas réels, lus dans le manifeste et joints comme une phrase (lot 11 : quatre pas).
    const spacecraft = new Set(
      summary.rows
        .filter((r) => r.provider === 'horizons-binary' && r.radiusKm === null)
        .map((r) => r.body)
    );
    const steps = [
      ...new Set(
        Object.entries(manifest.bodies)
          .filter(([name]) => !spacecraft.has(name))
          .map(([, e]) => e.stepDays)
      ),
    ].sort((a, b) => a - b);
    expect(steps.length).toBeGreaterThan(2);
    expect(methodology[0]!.body).toContain(
      `every ${steps.slice(0, -1).join(', ')} or ${steps.at(-1)} days depending on the body`
    );
    expect(en!.body).toContain(`K = ${SQRT_K}`);
    expect(en!.body).toContain('TT − UTC = 69.184 s');
    expect(en!.body).toContain(
      `From ${MIN_SAMPLES_PER_ORBIT_FOR_HERMITE} samples per orbit upwards`
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
  it('liste chaque source primaire des données physiques et compte depuis le catalogue', () => {
    for (const page of sources) {
      for (const source of Object.values(FACT_SOURCES))
        expect(page.body, `${page.locale} : ${source.url}`).toContain(
          `href="${source.url}"`
        );
      // Le nombre publié est celui que la règle d'affichage produit, pas une constante. Les
      // objets d'instrument comptent : ils ont une fiche, donc des faits affichés.
      let shown = 0;
      for (const [, cfg] of [
        ...flattenBodies(CELESTIAL_CONFIG),
        ...NAVIGABLE_TARGETS,
      ])
        for (const field of ALL_FACT_FIELDS)
          if (cfg.kind !== 'skybox' && bodyFact(cfg, field).status === 'value')
            shown++;
      expect(page.body).toMatch(
        page.locale === 'fr'
          ? new RegExp(`${shown} valeurs sont affichées`)
          : new RegExp(`${shown} values are shown`)
      );
    }
  });

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
    const [, fr] = sources;
    for (const cfg of models) {
      // Chaque langue affiche SON crédit : la page anglaise ne cite pas le texte français.
      const escape = (text: string): string =>
        text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      expect(en!.body).toContain(escape(cfg.model!.credit.en));
      expect(fr!.body).toContain(escape(cfg.model!.credit.fr));
      if (cfg.model!.credit.en !== cfg.model!.credit.fr)
        expect(en!.body).not.toContain(escape(cfg.model!.credit.fr));
    }
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
      const html = renderDocPage(page, ORIGIN, socialImage);
      // Image de partage : celle du site, lue dans index.html, jamais recopiée.
      expect(html).toContain(
        `<meta property="og:image" content="${socialImage.url}" />`
      );
      expect(html).toContain(
        '<meta name="twitter:card" content="summary_large_image" />'
      );
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

describe('affirmations de /methodology confrontées au code', () => {
  const [en, fr] = methodology;

  it('met le SPK AVANT les fichiers Horizons, comme la production', () => {
    // La première version de la page disait l'inverse. L'ordre réel est celui des arguments de
    // `FallbackPreciseEphemerisProvider(primaire, repli)` dans `SolarSystemApp.ts`.
    const app = readFileSync(resolve(ROOT, 'src/SolarSystemApp.ts'), 'utf-8');
    expect(app).toMatch(
      /new FallbackPreciseEphemerisProvider\(\s*this\._spkProvider,\s*this\._horizonsEphemeris/
    );
    for (const page of [en!, fr!]) {
      const list = /<ol class="doc-list">(.*?)<\/ol>/s.exec(page.body)![1]!;
      const items = list.split('<li>').slice(1);
      expect(items[0]).toMatch(/SPK/);
      expect(items[1]).toMatch(/Horizons/);
    }
  });

  it('publie exactement les catégories temporelles que l’application affiche', () => {
    // La page et la fiche lisent le MÊME dictionnaire : une catégorie ajoutée au modèle
    // temporel sans libellé (ou décrite ici avec un autre mot) casse ce test.
    for (const [page, locale] of [
      [en!, 'en'],
      [fr!, 'fr'],
    ] as const) {
      const section = /id="temporal"[\s\S]*?<\/ul>/.exec(page.body)?.[0];
      expect(section).toBeDefined();
      for (const category of TEMPORAL_CATEGORIES) {
        // Un libellé manquant se replierait sur la clé brute : la page publierait
        // « time.category.predicted ». La fiche lit le même dictionnaire.
        const label = messages[locale][temporalCategoryLabelKey(category)];
        expect(label, `${locale}/${category}`).toBeDefined();
        expect(label).not.toContain('time.category.');
        expect(section).toContain(`<strong>${label}</strong>`);
      }
      // Aucune catégorie de plus, aucune de moins.
      expect(section!.split('<li>').length - 1).toBe(
        TEMPORAL_CATEGORIES.length
      );
    }
  });

  it('publie l’obliquité qui définit l’écliptique d’Horizons', () => {
    expect((OBLIQUITY_RAD * 180 * 3600) / Math.PI).toBeCloseTo(84381.448, 6);
    expect(en!.body).toContain('84381.448″');
    expect(fr!.body).toContain('84381,448″');
  });

  it('ne dit pas que le mode Éducatif conserve les tailles', () => {
    expect(en!.body).toContain('enlarged teaching sizes');
    expect(fr!.body).toContain('tailles pédagogiques agrandies');
  });

  it('nomme les planètes dont les lunes sont écartées en Éducatif', () => {
    // Lu dans `educationalParentOrbitScale`, le module qui l'applique : une planète dont les
    // lunes sont écartées doit être nommée, une qui ne l'est pas ne doit pas l'être.
    const scaled = Object.entries(CELESTIAL_CONFIG.bodies).filter(
      ([, cfg]) => educationalParentOrbitScale(cfg) > 1
    );
    expect(scaled.length).toBeGreaterThan(0);
    const sentence = /Around (.*?), the moons’ distances/.exec(en!.body)![1]!;
    for (const [name, cfg] of Object.entries(CELESTIAL_CONFIG.bodies)) {
      const label =
        cfg.displayName?.en ?? name.charAt(0).toUpperCase() + name.slice(1);
      expect(sentence.includes(label), name).toBe(
        educationalParentOrbitScale(cfg) > 1
      );
    }
  });

  it('calcule la dérive de rotation des lunes presque synchrones', () => {
    const drifts = synchronousSpinDrifts(CELESTIAL_CONFIG);
    const names = drifts.map((d) => d.body);
    // Les lunes verrouillées exactement (bodies.test.ts) n'y sont pas ; celles qui dérivent, si.
    expect(names).toContain('io');
    expect(names).not.toContain('titan');
    for (const drift of drifts) {
      expect(drift.degreesPerYear).toBeGreaterThan(0);
      expect(en!.body).toContain(formatQuantity(drift.degreesPerYear, 'en'));
    }
  });

  it('ne publie la liste des corps képlériens seuls que si le résumé en contient', () => {
    // Lot 11 : chaque corps du catalogue a désormais un fichier Horizons sur la période de
    // production. Écrite pour une liste non vide, la phrase aurait publié « () ».
    const keplerOnly = summary.rows.filter(
      (r) =>
        r.provider === 'production' &&
        Object.keys(r.sources).length === 1 &&
        r.sources.kepler
    );
    expect(keplerOnly).toEqual([]);
    for (const page of [en!, fr!]) {
      expect(page.body).not.toMatch(/\(\s*\)/);
      expect(page.body).not.toMatch(
        /Keplerian bodies close to|Corps képlériens près/
      );
    }
    expect(en!.body).toContain(
      'No body in the production table (1900–2100) is positioned by them alone'
    );
    expect(fr!.body).toContain(
      'Aucun corps du tableau de production (1900–2100) n’est positionné par eux seuls'
    );

    // Un corps qui perdrait son fichier y reviendrait, nommé.
    const mutated = cloneSummary();
    const vesta = mutated.rows.find(
      (r) => r.provider === 'production' && r.body === 'vesta'
    )!;
    vesta.sources = { kepler: vesta.n };
    const [enMutated] = methodologyPages({
      summary: mutated,
      manifest,
      config: CELESTIAL_CONFIG,
      origin: ORIGIN,
    });
    expect(enMutated!.body).toContain(
      'Bodies positioned by Keplerian elements alone (Vesta)'
    );
    expect(enMutated!.body).toContain('Keplerian bodies close to');
  });

  it('dit que la Terre est au barycentre Terre-Lune, comme le catalogue', () => {
    const earth = flattenBodies(CELESTIAL_CONFIG).get('earth')!;
    expect(earth.positionBody).toBeDefined();
    expect(en!.body).toContain('Earth-Moon barycentre');
  });

  it('publie TOUTES les lignes du rapport dans les tableaux détaillés', () => {
    const details = [...en!.body.matchAll(/<details[^>]*>(.*?)<\/details>/gs)]
      .map((m) => m[1]!.match(/<tr><th scope="row">/g)?.length ?? 0)
      .reduce((a, b) => a + b, 0);
    const spacecraft = new Set(
      summary.rows
        .filter((r) => r.provider === 'horizons-binary' && r.radiusKm === null)
        .map((r) => r.body)
    );
    const expected = summary.rows.filter(
      (r) =>
        r.provider !== 'production' &&
        !(r.provider === 'spk' && r.n === 0) &&
        !(r.provider === 'horizons-binary' && spacecraft.has(r.body))
    ).length;
    expect(expected).toBeGreaterThan(100);
    expect(details).toBe(expected);
  });
});

describe('cohérence des sources publiées', () => {
  it('décrit exactement les hôtes que la CSP autorise', () => {
    expect(connectHosts.length).toBeGreaterThanOrEqual(4);
    expect(liveServiceMismatch(connectHosts)).toEqual({
      undescribed: [],
      unused: [],
    });
    expect(() =>
      sourcesPages({
        ...sourcesInput,
        connectHosts: [...connectHosts, 'new.example'],
      })
    ).toThrow('new.example');
    expect(
      LIVE_DATA_SERVICES.some((s) => s.name.startsWith('Open-Meteo'))
    ).toBe(true);
  });

  it('publie les fournisseurs d’événements depuis leur fiche, pas depuis une copie', () => {
    // La ligne de `/sources` est DÉRIVÉE de `src/registry/providers/` : la fiche porte l'hôte
    // déclaré dans la CSP, le texte bilingue et la date de lecture des conditions. Une copie
    // à la main dans `sourcesPage.ts` aurait fini par diverger de la fiche, sur une page
    // publiée dans deux langues.
    for (const provider of Object.values(EVENT_PROVIDERS)) {
      expect(connectHosts, provider.id).toContain(provider.host);
      const service = LIVE_DATA_SERVICES.find((s) => s.host === provider.host);
      expect(service, provider.id).toBeDefined();
      expect(service!.use).toBe(provider.use);
      expect(service!.terms).toBe(provider.terms);
      // La date de lecture est DANS le texte publié : une condition non datée ne se vérifie pas.
      for (const locale of ['en', 'fr'] as const)
        expect(service!.terms[locale], provider.id).toContain(
          provider.accessed
        );
      // `other` sans lien de licence voudrait dire « aucun droit accordé » (STAC 1.1.0).
      if (provider.license === 'other')
        expect(provider.licenseUrl, provider.id).toMatch(/^https:\/\//);
    }

    // Et les deux fiches arrivent bien jusqu'au texte rendu, dans les deux langues.
    for (const page of sourcesPages(sourcesInput)) {
      for (const provider of Object.values(EVENT_PROVIDERS))
        expect(page.body, `${provider.id} en ${page.locale}`).toContain(
          provider.host
        );
    }
  });

  it('range chaque corps des mentions sous la licence de son entrée de provenance', () => {
    // THIRD_PARTY_NOTICES.md (prose) et le registre products/ (données) décrivent les mêmes
    // textures : un corps déplacé d'une licence à l'autre dans l'un doit l'être dans l'autre.
    const notices = sourcesInput.notices.replace(/\r/g, '');
    const groups = notices
      .split(/\n(?=\d\. \*\*)/)
      .filter((block) => /^\d\. \*\*/.test(block))
      .map((block) => block.split(/\n\n/)[0]!);
    expect(groups.length).toBe(4);
    const surface = (body: string): TextureProvenance | undefined =>
      textures.find((t) => t.body === body && t.layer === 'surface');
    const expectations: ((t: TextureProvenance) => boolean)[] = [
      (t) => t.license === 'public-domain' && !t.illustrative,
      (t) => t.license === 'CC BY 4.0' && !t.illustrative,
      (t) => t.illustrative === true && t.license !== 'generated',
      (t) => t.license === 'generated' && t.illustrative === true,
    ];
    groups.forEach((group, index) => {
      const bodies = [...group.matchAll(/`([a-z]+)`/g)].map((m) => m[1]!);
      expect(bodies.length).toBeGreaterThan(3);
      for (const body of bodies) {
        // Le groupe 2 cite `earth` pour dire qu'elle n'en fait PAS partie.
        if (index === 1 && body === 'earth') continue;
        const entry = surface(body);
        expect(entry, `${body} sans provenance`).toBeDefined();
        expect(
          expectations[index]!(entry!),
          `${body} dans le groupe ${index + 1}`
        ).toBe(true);
      }
    });
  });

  it('marque illustratives exactement les surfaces que l’application signale', () => {
    const illustrative = textures
      .filter((t) => t.layer === 'surface' && t.illustrative)
      .map((t) => t.body)
      .sort();
    expect(illustrative).toEqual([...ILLUSTRATIVE_SURFACES].sort());
  });

  it('ne lie que des fichiers qui existent dans le dépôt', () => {
    const targets = [
      ...sourcesInput.notices.matchAll(/\]\((?!https?:)([^)]+)\)/g),
    ].map((m) => m[1]!);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets)
      expect(existsSync(resolve(ROOT, target)), target).toBe(true);
  });

  it('lit l’image de partage dans index.html et refuse son absence', () => {
    expect(socialImage.url).toMatch(/^https:\/\//);
    expect(() =>
      socialImageFromHtml(
        indexHtml.replace('property="og:image"', 'property="x"')
      )
    ).toThrow('og:image');
  });
});
