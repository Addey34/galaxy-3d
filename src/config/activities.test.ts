import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from './bodies';
import { catalogueFactProvenance, catalogueFactReader } from './activityFacts';
import { TOUR_ORDER } from '@/registry/tours';
import {
  ACTIVITY_ORDER,
  ACTIVITY_RECORDS,
  loadActivities,
} from '@/registry/activities';
import {
  evaluateActivityValues,
  fillSlots,
  type FactReader,
} from '@/core/activityValues';
import { LOCALES } from '@/i18n/locales';
import type { ActivityRecord } from '@/registry/schema/activity';

/**
 * UN CORRIGÉ EST CONFRONTÉ AU CODE ET AUX FAITS (lot 58).
 *
 * Chaque valeur d'une fiche d'activité est calculée par le chemin même de la scène
 * (`core/activityMeasures.ts`) ou lue dans le fait sourcé du catalogue, sur TOUT le domaine
 * d'années que la fiche annonce ; chaque mesure qui illustre un fait doit s'accorder avec lui ;
 * chaque emplacement de chaque langue doit se remplir. Les falsifications sont gardées ici comme
 * des tests : elles prouvent que les refus mordent.
 */
const activities = loadActivities(ACTIVITY_RECORDS, ACTIVITY_ORDER, TOUR_ORDER);
const readFact = catalogueFactReader(CELESTIAL_CONFIG);

describe.each(activities.map((a) => [a.id, a] as const))(
  'activité %s',
  (_id, activity) => {
    const values = evaluateActivityValues(activity, readFact);

    it('chaque fait cité est sourcé dans le catalogue', () => {
      for (const value of Object.values(activity.values))
        if (value.kind === 'fact')
          expect(
            catalogueFactProvenance(CELESTIAL_CONFIG, value.body, value.fact)
              ?.source
          ).toBeTruthy();
    });

    it.each(LOCALES)(
      'chaque texte se remplit en %s, sans accolade restante',
      (locale) => {
        for (const part of activity.parts)
          for (const q of part.questions)
            for (const text of [q.prompt[locale], q.answer[locale]]) {
              const filled = fillSlots(text, values, locale);
              expect(filled).not.toMatch(/[{}]/);
              expect(filled).not.toContain('—');
            }
      }
    );
  }
);

describe('saisons : ce que le corrigé affirme', () => {
  const seasons = activities.find((a) => a.id === 'seasons')!;
  const values = evaluateActivityValues(seasons, readFact);
  const fr = (name: string): string => fillSlots(`{${name}}`, values, 'fr');

  it('lit les valeurs mesurées le 2026-10-18 (une régression les ferait bouger)', () => {
    expect(fr('tilt')).toBe('23,44');
    expect(fr('polarCircle')).toBe('66,56');
    expect(fr('sunJune')).toBe('23,4');
    expect(fr('sunMarch')).toBe('0,0');
    expect(fr('apsisGap')).toBe('3');
    expect(fr('periEarliest')).toMatch(/^[2-5] janvier$/);
    expect(fr('aphLatest')).toMatch(/^[3-7] juillet$/);
    expect(fr('parisJune')).toMatch(/^16 h 1\d min$/);
    expect(fr('parisDecember')).toMatch(/^8 h 1\d min$/);
  });

  it('refuse l’inclinaison arrondie de la fiche PR45 de l’ESA (23,5°) : la scène la dément', () => {
    const rounded: FactReader = () => 23.5;
    expect(() => evaluateActivityValues(seasons, rounded)).toThrow(
      /s'écarte de « (tilt|polarCircle) »/
    );
  });

  it('refuse un fait que le catalogue ne publie pas', () => {
    expect(() => evaluateActivityValues(seasons, () => undefined)).toThrow(
      /n'est pas publié/
    );
  });

  it('refuse une précision que le domaine d’années ne tient pas', () => {
    const tooPrecise = structuredClone(seasons) as ActivityRecord;
    tooPrecise.values['sunJune'] = {
      kind: 'subsolarLatitude',
      event: 'june-solstice',
      decimals: 3,
    };
    expect(() => evaluateActivityValues(tooPrecise, readFact)).toThrow(
      /précision déclarée n'est pas tenue/
    );
  });

  it('refuse une activité dont la visite n’existe pas', () => {
    expect(() =>
      loadActivities(ACTIVITY_RECORDS, ACTIVITY_ORDER, ['eclipse'])
    ).toThrow(/visite « seasons » inconnue/);
  });
});
