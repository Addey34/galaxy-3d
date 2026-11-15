import { matchesGlob } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ECLIPSE_SEGMENT_FOR_TESTS,
  LANDING_PAGE_GLOB_IGNORES,
  NAVIGATE_FALLBACK_DENYLIST,
} from './pwaRouting';
import { bodyLandingPages } from './bodyLandingPage';
import { eclipseLandingPages } from './eclipseLandingPage';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { ECLIPSE_PATH_SEGMENT } from '@/core/eclipsePages';
import { LOCALES } from '@/i18n/locales';
import { docPath, MISSIONS_SLUG } from './documentPage';
import missionCatalogue from './missionCatalogue.json';
import flybyRecord from './flybyEvents.json';
import { flybySlug } from './flybyPages';

/**
 * Chaque page que le build écrit doit être à la fois NON précachée et NON remplacée par l'app
 * shell. Le test part des pages elles-mêmes, pas d'une liste d'exemples : une nouvelle famille
 * de pages à trois segments ferait échouer ceci au lieu de passer inaperçue, comme les pages
 * d'éclipse l'ont fait. `matchesGlob` suit la syntaxe minimatch, celle du `glob` de workbox.
 */
const ORIGIN = 'https://example.test';
const pages = [
  ...bodyLandingPages(CELESTIAL_CONFIG, ORIGIN),
  ...eclipseLandingPages(ORIGIN),
  // Les pages de mission (2026-10-04) : deux segments en anglais, TROIS traduites.
  ...LOCALES.flatMap((locale) =>
    missionCatalogue.missions.map((mission) => ({
      canonical: `${ORIGIN}${docPath(`${MISSIONS_SLUG}/${mission.slug}`, locale)}`,
    }))
  ),
  // Les pages de survol (2026-10-12), même forme.
  ...LOCALES.flatMap((locale) =>
    flybyRecord.events.map((event) => ({
      canonical: `${ORIGIN}${docPath(flybySlug(event), locale)}`,
    }))
  ),
];

describe('routage du service worker pour les pages d’atterrissage', () => {
  it('voit toutes les familles de pages', () => {
    // Borne : un ensemble vide rendrait tout le reste vert sans rien vérifier.
    expect(pages.length).toBeGreaterThan(100);
    expect(ECLIPSE_SEGMENT_FOR_TESTS).toBe(ECLIPSE_PATH_SEGMENT);
    expect(
      pages.some((p) => p.canonical.endsWith('/pt-br/missions/voyager/'))
    ).toBe(true);
    expect(
      pages.some((p) =>
        p.canonical.endsWith('/es/flybys/voyager2-neptune-1989-08-25/')
      )
    ).toBe(true);
  });

  it('ne précache aucune page générée', () => {
    for (const page of pages) {
      const file = `${new URL(page.canonical).pathname.slice(1)}index.html`;
      expect(
        LANDING_PAGE_GLOB_IGNORES.some((glob) => matchesGlob(file, glob)),
        `${file} serait précachée`
      ).toBe(true);
    }
  });

  it('ne sert jamais l’app shell à la place d’une page générée', () => {
    for (const page of pages) {
      const { pathname } = new URL(page.canonical);
      for (const path of [pathname, pathname.replace(/\/$/, '')])
        expect(
          NAVIGATE_FALLBACK_DENYLIST.some((rule) => rule.test(path)),
          `${path} recevrait l'index.html en cache`
        ).toBe(true);
    }
  });

  it('garde la page de confidentialité avec et sans extension', () => {
    for (const path of ['/privacy.html', '/privacy'])
      expect(NAVIGATE_FALLBACK_DENYLIST.some((rule) => rule.test(path))).toBe(
        true
      );
  });

  it('ne précache pas le résumé de validation, chargé à la demande', () => {
    // Nom réel produit par le build (hash Rollup). L'app shell, lui, reste précaché.
    expect(
      LANDING_PAGE_GLOB_IGNORES.some((glob) =>
        matchesGlob('assets/horizons-validation-summary-BQPcL_Ww.js', glob)
      )
    ).toBe(true);
    expect(
      LANDING_PAGE_GLOB_IGNORES.some((glob) =>
        matchesGlob('assets/SolarSystemApp-hlgQ0VPF.js', glob)
      )
    ).toBe(false);
  });

  it('garde l’app shell pour la racine et les assets', () => {
    expect(
      LANDING_PAGE_GLOB_IGNORES.some((glob) => matchesGlob('index.html', glob))
    ).toBe(false);
    for (const path of ['/', '/assets/SolarSystemApp-abc.js'])
      expect(NAVIGATE_FALLBACK_DENYLIST.some((rule) => rule.test(path))).toBe(
        false
      );
  });

  it('exclut du précache tout index.html sous un dossier, à toute profondeur et dans toute langue', () => {
    // GAL-PERF-PWA-001 : une famille NOUVELLE (ici inventée) est exclue par défaut. Les formations
    // (trois niveaux) et les activités étaient précachées parce qu'aucune liste ne les nommait.
    const generated = [
      'places/vesta/albana/index.html',
      'es/places/vesta/albana/index.html',
      'pt-br/places/moon/tycho/index.html',
      'activities/eclipse/index.html',
      'fr/activities/seasons/index.html',
      'une-famille-inventee/a/b/c/index.html',
      'jupiter/index.html',
    ];
    for (const file of generated)
      expect(
        LANDING_PAGE_GLOB_IGNORES.some((glob) => matchesGlob(file, glob)),
        `${file} serait précachée`
      ).toBe(true);
    for (const file of ['index.html', 'privacy.html', 'assets/index-abc.js'])
      expect(
        LANDING_PAGE_GLOB_IGNORES.some((glob) => matchesGlob(file, glob)),
        `${file} doit rester précaché`
      ).toBe(false);
  });

  it('ne sert jamais l’app shell à la place d’une page de formation ou d’activité, avec ou sans paramètres', () => {
    const paths = [
      '/places/vesta/albana/',
      '/places/vesta/albana',
      '/places/vesta/albana/index.html',
      '/places/vesta/albana/?utm_source=x',
      '/places/vesta/albana?foo=1&bar=2',
      '/activities/eclipse/',
      '/activities/eclipse/index.html',
      '/activities/eclipse/?utm_campaign=y',
    ];
    for (const lang of ['', '/fr', '/es', '/pt-br'])
      for (const path of paths)
        expect(
          NAVIGATE_FALLBACK_DENYLIST.some((rule) => rule.test(lang + path)),
          `${lang}${path} recevrait l'index.html en cache`
        ).toBe(true);
  });

  it('laisse les permaliens interactifs ouvrir l’application : un corps ou une éclipse avec paramètres', () => {
    // Workbox teste `pathname + search`. `/mars/?mode=explo` n'est pas refusé au repli : le shell
    // (précaché) ouvre la vue demandée, y compris hors ligne. Aucune règle de ce lot n'y touche.
    for (const path of [
      '/mars/?mode=explo&date=2026-11-20T18%3A00%3A00Z',
      '/vesta/?place=albana',
      '/eclipse/2026-08-12/?mode=educ',
    ])
      expect(
        NAVIGATE_FALLBACK_DENYLIST.some((rule) => rule.test(path)),
        `${path} doit retomber sur l'app shell`
      ).toBe(false);
  });

  it('ne refuse pas une langue inconnue ni un niveau de trop', () => {
    for (const path of [
      '/de/places/vesta/albana/',
      '/places/vesta/albana/extra/',
      '/places/vesta/',
    ])
      expect(
        NAVIGATE_FALLBACK_DENYLIST.some((rule) => rule.test(path)),
        `${path}`
      ).toBe(false);
  });
});
