import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOUR_SCRIPTS } from './tourScripts';
import type { TourScript } from '@/core/tourEngine';

/**
 * LES VISITES QUI MONTRENT UN LIEU À UNE DATE (« Le delta du Nil dans le temps ») : ce que leurs
 * étapes `diveTo` citent doit exister, et ce que leurs légendes disent d'une année doit être
 * l'année de l'image affichée. Deux liens saisis à la main entre une fiche de visite et ce qu'elle
 * désigne, qu'aucun type ne vérifie.
 */
const ROOT = resolve(import.meta.dirname, '../../public/assets');

interface Named {
  name: string;
  names?: Record<string, string>;
}

function namesOf(body: string): Named[] {
  const file =
    body === 'earth'
      ? resolve(ROOT, 'earth-names/earth.json')
      : resolve(ROOT, 'gazetteer', `${body}.json`);
  return JSON.parse(readFileSync(file, 'utf-8')) as Named[];
}

/** Les problèmes d'une visite : un lieu introuvable, un cadrage manquant, une année qui ment. */
export function surfaceProblems(script: TourScript): string[] {
  const problems: string[] = [];
  // Une année dite sous une image ne vaut que si la visite CHOISIT une imagerie : « Aux confins »
  // cite 1930 et 2005, des années d'histoire, sans qu'aucune scène les affiche.
  const showsImagery = script.steps.some((step) => step.kind === 'setSurface');
  let body: string | null = null;
  let year: number | null = null;
  script.steps.forEach((step, index) => {
    const where = `${script.id}.steps[${index}]`;
    if (step.kind === 'flyTo') body = step.body;
    if (step.kind === 'jumpToDate') year = step.date.getUTCFullYear();
    if (step.kind === 'diveTo') {
      if (body === null) {
        problems.push(`${where} : plonge sans avoir volé vers un corps`);
        return;
      }
      if (!namesOf(body).some((n) => n.name === step.place))
        problems.push(
          `${where} : « ${step.place} » n'est pas un nom de ${body}`
        );
      // Natural Earth ne publie pas de diamètre : sans cadrage écrit, la plongée serait à 1 000 km.
      if (body === 'earth' && step.frameKm === undefined)
        problems.push(
          `${where} : la Terre n'a pas de taille connue, frameKm est requis`
        );
    }
    if (step.kind === 'caption' && showsImagery) {
      const spoken = new Set(
        [...step.text['en'].matchAll(/\b(19|20)\d{2}\b/g)].map((m) =>
          Number(m[0])
        )
      );
      for (const locale of ['fr', 'es', 'pt-BR'] as const)
        for (const m of step.text[locale].matchAll(/\b(19|20)\d{2}\b/g))
          spoken.add(Number(m[0]));
      for (const said of spoken)
        if (said !== year)
          problems.push(
            `${where} : la légende dit ${said}, la date de la scène est ${year ?? 'inconnue'}`
          );
    }
  });
  return problems;
}

describe('visites : lieux nommés et années des légendes', () => {
  it.each(TOUR_SCRIPTS.map((script) => [script.id, script] as const))(
    '%s',
    (_id, script) => {
      expect(surfaceProblems(script)).toEqual([]);
    }
  );

  it('une visite qui plonge existe, sinon la garde tournerait à vide', () => {
    expect(
      TOUR_SCRIPTS.some((s) => s.steps.some((step) => step.kind === 'diveTo'))
    ).toBe(true);
  });

  it('refuse un nom inventé, un cadrage absent et une année fausse', () => {
    const text = (en: string) => ({ en, fr: en, es: en, 'pt-BR': en });
    const bad: TourScript = {
      id: 'faux',
      title: text('t'),
      steps: [
        { kind: 'flyTo', body: 'earth' },
        { kind: 'setSurface', base: 'sentinel-2' },
        { kind: 'jumpToDate', date: new Date('2016-07-01T10:00:00Z') },
        { kind: 'diveTo', place: 'Atlantide' },
        { kind: 'diveTo', place: 'Cairo' },
        { kind: 'caption', text: text('Edition 2020') },
      ],
    };
    const problems = surfaceProblems(bad).join('\n');
    expect(problems).toContain('Atlantide');
    expect(problems).toContain('frameKm est requis');
    expect(problems).toContain('la légende dit 2020');
  });
});
