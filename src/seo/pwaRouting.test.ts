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
];

describe('routage du service worker pour les pages d’atterrissage', () => {
  it('voit toutes les familles de pages', () => {
    // Borne : un ensemble vide rendrait tout le reste vert sans rien vérifier.
    expect(pages.length).toBeGreaterThan(100);
    expect(ECLIPSE_SEGMENT_FOR_TESTS).toBe(ECLIPSE_PATH_SEGMENT);
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

  it('garde l’app shell pour la racine et les assets', () => {
    expect(
      LANDING_PAGE_GLOB_IGNORES.some((glob) => matchesGlob('index.html', glob))
    ).toBe(false);
    for (const path of ['/', '/assets/SolarSystemApp-abc.js'])
      expect(NAVIGATE_FALLBACK_DENYLIST.some((rule) => rule.test(path))).toBe(
        false
      );
  });
});
