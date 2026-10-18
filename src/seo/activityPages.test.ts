import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { TOUR_SCRIPTS } from '@/config/tourScripts';
import { LOCALES } from '@/i18n/locales';
import {
  ACTIVITY_ORDER,
  ACTIVITY_RECORDS,
  loadActivities,
} from '@/registry/activities';
import { activityPages, activitySceneHref } from './activityPages';
import { docPath } from './documentPage';

/**
 * LES FICHES D'ACTIVITÉ PUBLIÉES (lot 58) : ce que la page affirme se confronte au registre et à
 * l'application, pas à une copie.
 */
const inputs = {
  activities: loadActivities(
    ACTIVITY_RECORDS,
    ACTIVITY_ORDER,
    TOUR_SCRIPTS.map((tour) => tour.id)
  ),
  tours: TOUR_SCRIPTS,
  config: CELESTIAL_CONFIG,
  origin: 'https://galaxy.adrianguichard.dev',
};

describe.each(LOCALES)('pages des activités en %s', (locale) => {
  const pages = activityPages(inputs, locale);

  it('rend l’index et une page par activité, aux chemins de la langue', () => {
    expect(pages.map((p) => p.slug)).toEqual([
      'activities',
      ...inputs.activities.map((a) => `activities/${a.id}`),
    ]);
    for (const page of pages)
      expect(page.canonical).toBe(
        `${inputs.origin}${docPath(page.slug, locale)}`
      );
  });

  it('ne laisse aucun emplacement vide ni tiret cadratin', () => {
    for (const page of pages) {
      expect(page.body).not.toMatch(/\{[a-zA-Z]+\}/);
      expect(page.body).not.toContain('—');
    }
  });

  it('ouvre la scène sur la page de la Terre de cette langue, avec la visite', () => {
    const seasons = pages.find((p) => p.slug === 'activities/seasons')!;
    const href = activitySceneHref({ tour: 'seasons' }, locale);
    expect(href).toMatch(/^\/([a-z-]+\/)?earth\/\?tour=seasons$/);
    // Lien cliquable ET adresse imprimée en clair : les deux mènent au même endroit.
    expect(seasons.body).toContain(`href="${href}"`);
    expect(seasons.body).toContain(`${inputs.origin}${href}`);
  });

  it('met la fiche élève après le corrigé, et lui laisse des lignes pour chaque question', () => {
    const seasons = pages.find((p) => p.slug === 'activities/seasons')!;
    const activity = inputs.activities.find((a) => a.id === 'seasons')!;
    expect(seasons.body.indexOf('id="teacher"')).toBeLessThan(
      seasons.body.indexOf('id="pupil"')
    );
    const questions = activity.parts.flatMap((p) => p.questions).length;
    expect(seasons.body.match(/class="activity-lines"/g)).toHaveLength(
      questions
    );
    // Chaque prolongement gradué (pas 3) porte son niveau, au corrigé ET sur la fiche élève.
    const graded = activity.parts
      .flatMap((p) => p.questions)
      .filter((q) => q.level !== undefined).length;
    expect(graded).toBeGreaterThan(0);
    expect(seasons.body.match(/class="activity-level"/g)).toHaveLength(
      2 * graded
    );
    // Le corrigé n'est PAS dans la fiche élève.
    const pupil = seasons.body.slice(seasons.body.indexOf('id="pupil"'));
    expect(pupil).not.toContain('activity-answers');
  });
});
