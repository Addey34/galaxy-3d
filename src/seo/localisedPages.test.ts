import { describe, expect, it } from 'vitest';
import {
  bodyLandingPages,
  bodyPagePath,
  renderBodyPage,
} from './bodyLandingPage';
import {
  eclipseLandingPages,
  eclipsePagePath,
  renderEclipsePage,
} from './eclipseLandingPage';
import { docPath, DOC_SLUGS } from './documentPage';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { HTML_LANG, LOCALES, LOCALE_PATH } from '@/i18n/locales';
import {
  LANDING_PAGE_GLOB_IGNORES,
  NAVIGATE_FALLBACK_DENYLIST,
} from './pwaRouting';

/**
 * UNE ADRESSE PAR CORPS ET PAR LANGUE (lot 20, phase 20D).
 *
 * Avant ce lot, les 111 pages d'atterrissage n'existaient qu'en anglais, y compris pour un
 * visiteur francophone dont l'interface, elle, était traduite depuis longtemps. Chaque langue a
 * maintenant son adresse, et ce fichier tient les quatre propriétés qui la rendent utile plutôt
 * que décorative :
 *
 *   1. l'anglais reste à la RACINE — ses URL sont indexées depuis le 2026-09-10, et une adresse
 *      publiée ne se déplace pas ;
 *   2. `hreflang` est RÉCIPROQUE : chaque page nomme toutes ses sœurs, elle-même comprise, plus
 *      un `x-default`. Un ensemble non réciproque est purement ignoré par Google, donc le
 *      travail entier ne servirait à rien, sans qu'aucune erreur ne le dise ;
 *   3. `<html lang>` porte la langue de la page : c'est lui qui décide de la VOIX d'un lecteur
 *      d'écran et de la coupure des mots ;
 *   4. le service worker ne remplace pas ces pages par l'app shell en cache — le mode de panne
 *      que `pwaRouting.ts` décrit en tête, et qui ne se voit que chez un visiteur revenu.
 */

const ORIGIN = 'https://example.test';
const BASE =
  '<!doctype html><html lang="en"><head>' +
  '<title>t</title><meta name="description" content="d" />' +
  '<link rel="canonical" href="https://example.test/" />' +
  '<meta property="og:title" content="t" /><meta property="og:description" content="d" />' +
  '<meta property="og:url" content="u" /><meta property="og:image" content="i" />' +
  '<meta property="og:image:alt" content="a" /><meta property="og:image:width" content="1" />' +
  '<meta property="og:image:height" content="1" /><meta name="twitter:image" content="i" />' +
  '<meta name="twitter:title" content="t" /><meta name="twitter:description" content="d" />' +
  '<script type="application/ld+json">{}</script></head><body>' +
  '<h1 class="sr-only">h</h1><noscript>n</noscript></body></html>';

describe('pages d’atterrissage localisées', () => {
  const byLocale = new Map(
    LOCALES.map((locale) => [
      locale,
      bodyLandingPages(CELESTIAL_CONFIG, ORIGIN, locale),
    ])
  );

  it('produit le même nombre de pages dans chaque langue', () => {
    const counts = [...byLocale.values()].map((pages) => pages.length);
    expect(counts.length).toBe(4);
    expect(new Set(counts).size, `comptes différents : ${counts}`).toBe(1);
    expect(counts[0]).toBeGreaterThan(50);
  });

  it('laisse l’anglais à la racine et met les autres sous leur segment', () => {
    expect(bodyPagePath('jupiter', 'en')).toBe('jupiter');
    expect(bodyPagePath('jupiter', 'fr')).toBe('fr/jupiter');
    expect(bodyPagePath('jupiter', 'es')).toBe('es/jupiter');
    // Le brésilien s'écrit en minuscules dans une URL, comme tout le reste du site.
    expect(bodyPagePath('jupiter', 'pt-BR')).toBe('pt-br/jupiter');
    expect(LOCALE_PATH.en).toBe('');
  });

  it('donne à chaque corps une adresse par langue, et une seule', () => {
    const seen = new Set<string>();
    for (const [locale, pages] of byLocale)
      for (const page of pages) {
        expect(page.canonical).toBe(
          `${ORIGIN}/${bodyPagePath(page.body, locale)}/`
        );
        expect(seen.has(page.canonical), `doublon : ${page.canonical}`).toBe(
          false
        );
        seen.add(page.canonical);
      }
    expect(seen.size).toBe(byLocale.get('en')!.length * LOCALES.length);
  });

  it('partage UNE vignette par corps entre les quatre langues', () => {
    // `socialCard.ts` peint la texture du corps, sans un mot de texte : une page espagnole n'a
    // aucune raison d'avoir sa propre image. C'est aussi ce qui garde le relevé d'empreinte à
    // 57 vignettes, la preuve qu'aucune texture n'a bougé.
    for (const [, pages] of byLocale)
      for (const page of pages)
        expect(page.image).toBe(`${ORIGIN}/social/${page.body}.jpg`);
  });

  it('déclare un hreflang RÉCIPROQUE et un x-default sur chaque page', () => {
    for (const [locale, pages] of byLocale) {
      const page = pages.find((candidate) => candidate.body === 'jupiter')!;
      const html = renderBodyPage(BASE, page, ORIGIN);
      expect(html).toContain(`<html lang="${HTML_LANG[locale]}">`);
      for (const other of LOCALES)
        expect(html, `${locale} ne nomme pas ${other}`).toContain(
          `<link rel="alternate" hreflang="${other}" href="${ORIGIN}/${bodyPagePath('jupiter', other)}/" />`
        );
      expect(html).toContain(
        `<link rel="alternate" hreflang="x-default" href="${ORIGIN}/jupiter/" />`
      );
      // EXACTEMENT cinq variantes, et aucune qui mène à l'accueil : `index.html` en porte trois
      // (l'application sert ses quatre langues depuis `/`), et les hériter faisait déclarer huit
      // variantes contradictoires à chaque page traduite. Un ensemble contradictoire est ignoré
      // par un moteur, donc tout le travail de cette phase l'aurait été.
      const alternates = html.match(/<link rel="alternate"[^>]*>/g) ?? [];
      expect(
        alternates.length,
        `${locale} : ${alternates.length} variantes`
      ).toBe(LOCALES.length + 1);
      expect(alternates.join(' ')).not.toContain(`href="${ORIGIN}/"`);
      expect(html).toContain(
        `<link rel="canonical" href="${page.canonical}" />`
      );
    }
  });

  it('en fait autant pour les pages d’éclipse', () => {
    for (const locale of LOCALES) {
      const pages = eclipseLandingPages(ORIGIN, locale);
      expect(pages.length).toBeGreaterThan(40);
      const page = pages[0]!;
      expect(page.canonical).toBe(
        `${ORIGIN}${eclipsePagePath(page.event, locale)}`
      );
      const html = renderEclipsePage(BASE, page, ORIGIN);
      expect(html).toContain(`<html lang="${HTML_LANG[locale]}">`);
      for (const other of LOCALES)
        expect(html).toContain(
          `hreflang="${other}" href="${ORIGIN}${eclipsePagePath(page.event, other)}"`
        );
    }
    expect(
      eclipsePagePath(eclipseLandingPages(ORIGIN)[0]!.event, 'es')
    ).toMatch(/^\/es\/eclipse\//);
  });

  it('traduit vraiment le contenu, et pas seulement l’adresse', () => {
    const en = byLocale.get('en')!.find((p) => p.body === 'earth')!;
    const es = byLocale.get('es')!.find((p) => p.body === 'earth')!;
    const pt = byLocale.get('pt-BR')!.find((p) => p.body === 'earth')!;
    expect(en.displayName).toBe('Earth');
    expect(es.displayName).toBe('Tierra');
    expect(pt.displayName).toBe('Terra');
    // La description vient du catalogue, les libellés de faits de la page : deux sources
    // différentes, donc deux preuves.
    expect(es.summary).toContain('planeta');
    expect(es.facts.map((f) => f.label)).toContain('Radio');
    expect(pt.facts.map((f) => f.label)).toContain('Raio');
    expect(en.facts.map((f) => f.label)).toContain('Radius');
  });

  it('garde l’anglais des libellés publiés, au caractère près', () => {
    // Ces libellés sont indexés et peints dans 57 vignettes de partage. Les aligner sur le
    // dictionnaire de l'application aurait réécrit « Surface gravity » en « Gravity » et
    // « Orbits » en « Orbit » : mesuré, 34 vignettes changeaient. La liste ci-dessous est donc
    // l'anglais d'AVANT le lot 20.
    const labels = new Set(
      byLocale.get('en')!.flatMap((page) => page.facts.map((f) => f.label))
    );
    for (const label of [
      'Orbits',
      'Radius',
      'Mass',
      'Surface gravity',
      'Mean temperature',
      'Mean distance from the Sun',
      'Orbital period',
      'Sidereal rotation',
      'Axial tilt',
      'Known moons',
    ])
      expect(labels, `libellé publié perdu : ${label}`).toContain(label);
  });

  it('écrit la mention de méthode une seule fois, dans chaque langue', () => {
    // DÉFAUT TROUVÉ EN RELISANT LA PAGE RENDUE, pas par un test : la mention enveloppait dans
    // « {method} value » une valeur de dictionnaire qui disait déjà « derived value », ce qui
    // rendait « (derived value value) » — en anglais comme dans les trois autres langues, et
    // l'empreinte ne l'a pas vu parce que ces pages changeaient de toute façon.
    const expected: Record<string, string> = {
      en: '(derived value)',
      fr: '(valeur dérivée)',
      es: '(valor derivado)',
      'pt-BR': '(valor derivado)',
    };
    for (const [locale, pages] of byLocale) {
      const titan = pages.find((page) => page.body === 'titan')!;
      const html = renderBodyPage(BASE, titan, ORIGIN);
      expect(html, `${locale} : mention absente`).toContain(expected[locale]);
      // Et jamais deux fois le même mot : c'est la forme exacte du défaut.
      for (const word of ['value value', 'valeur valeur', 'valor valor'])
        expect(html, `${locale} : « ${word} »`).not.toContain(word);
    }
  });

  it('exclut les pages traduites du cache de l’app shell', () => {
    const denied = (path: string): boolean =>
      NAVIGATE_FALLBACK_DENYLIST.some((pattern) => pattern.test(path));
    for (const locale of LOCALES) {
      const segment = LOCALE_PATH[locale];
      const body = `/${bodyPagePath('jupiter', locale)}/`;
      expect(denied(body), `body ${locale}`).toBe(true);
      const eclipse = eclipsePagePath(
        eclipseLandingPages(ORIGIN)[0]!.event,
        locale
      );
      expect(denied(eclipse), `eclipse ${locale}`).toBe(true);
      for (const slug of DOC_SLUGS)
        expect(denied(docPath(slug, locale)), `doc ${locale}`).toBe(true);
      // Et ces pages ne sont pas PRÉCACHÉES : ce sont des quasi-copies de l'app shell.
      if (segment !== '')
        expect(LANDING_PAGE_GLOB_IGNORES).toContain(`${segment}/*/index.html`);
    }
    // Témoin : l'accueil et les vrais fichiers ne sont pas exclus, sinon la règle ne dirait rien.
    expect(denied('/')).toBe(false);
    expect(denied('/assets/app.js')).toBe(false);
  });
});
