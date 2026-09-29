import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOUR_SCRIPTS, resolveEventDate } from './tourScripts';
import { CELESTIAL_CONFIG } from './bodies';
import { flattenBodies } from './catalog';
import { isNavigableTarget } from './navigable';
import { loadTours } from '@/registry/tours';
import type { TourRecord } from '@/registry/schema/tour';
import type { AstronomicalEventKind } from '@/core/astronomicalEvents';

/**
 * LA FAÇADE DES VISITES (lot 21) : ce que le registre rend, l'application doit pouvoir l'exécuter.
 *
 * Aucun nombre de visites n'est écrit ici : il est LU dans `order.json`, seul propriétaire de
 * l'ordre. C'est ce qui rend la preuve du lot stricte — ajouter une visite est une fiche et une
 * ligne d'ordre, sans toucher ce fichier ni aucun autre `.ts`.
 */

const ORDER = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../registry/tours/order.json'),
    'utf-8'
  )
) as { order: string[] };

describe('TOUR_SCRIPTS', () => {
  const catalogNames = flattenBodies(CELESTIAL_CONFIG);

  it('rend exactement les visites déclarées, dans l’ordre déclaré', () => {
    expect(TOUR_SCRIPTS.map((script) => script.id)).toEqual(ORDER.order);
  });

  it('ne cible que des corps que la navigation sait atteindre', () => {
    for (const script of TOUR_SCRIPTS)
      for (const step of script.steps)
        if (step.kind === 'flyTo')
          expect(
            catalogNames.has(step.body) || isNavigableTarget(step.body),
            `${script.id} : « ${step.body} » n’est ni un corps du catalogue ni une cible navigable`
          ).toBe(true);
  });

  it('nomme un corps réel sur chaque événement qui en dépend', () => {
    for (const script of TOUR_SCRIPTS)
      for (const step of script.steps)
        if (step.kind === 'jumpToEvent' && step.body !== undefined)
          expect(catalogNames.has(step.body)).toBe(true);
  });

  it('a un titre dans les quatre langues et au moins une légende', () => {
    for (const script of TOUR_SCRIPTS) {
      for (const locale of ['en', 'fr', 'es', 'pt-BR'] as const)
        expect(
          script.title[locale],
          `${script.id}.title.${locale}`
        ).toBeTruthy();
      expect(
        script.steps.some((step) => step.kind === 'caption'),
        script.id
      ).toBe(true);
    }
  });
});

/**
 * NON-RÉGRESSION DU LOT 21 : les trois visites d'origine doivent se dérouler à l'identique.
 *
 * La suite d'étapes est ce qui décide du rendu ; elle est donc écrite ici telle qu'elle était
 * avant que les visites deviennent des fiches, `jumpToEvent` en tête de l'éclipse remplaçant le
 * `jumpToDate` que `ui/tourPlayer.ts` préfixait en dur quand l'identifiant valait « eclipse ».
 */
describe('les trois visites d’origine, étape par étape', () => {
  const steps = (id: string) =>
    TOUR_SCRIPTS.find((script) => script.id === id)!.steps;
  const kinds = (id: string): string[] => steps(id).map((step) => step.kind);

  it('éclipse : saut de temps, Terre, légende, Lune, légende', () => {
    expect(kinds('eclipse')).toEqual([
      'jumpToEvent',
      'flyTo',
      'caption',
      'flyTo',
      'caption',
    ]);
    expect(steps('eclipse')[0]).toEqual({
      kind: 'jumpToEvent',
      event: 'solar-eclipse',
    });
  });

  it('galiléennes : Jupiter, temps accéléré, légende datée, attente', () => {
    expect(kinds('galileans')).toEqual([
      'flyTo',
      'setTimeScale',
      'caption',
      'wait',
    ]);
    expect(steps('galileans')[1]).toEqual({
      kind: 'setTimeScale',
      scale: 200_000,
    });
  });

  it('Kuiper : cinq corps, sept légendes, et le passage à la VRAIE échelle', () => {
    expect(kinds('kuiper').filter((kind) => kind === 'flyTo')).toHaveLength(5);
    expect(kinds('kuiper').filter((kind) => kind === 'caption')).toHaveLength(
      7
    );
    // Le lot 35 a donné aux visites le droit de changer d'échelle, et cette visite est
    // l'endroit où ça se justifie : la même ceinture est une file de points bien rangés en
    // Éduc et le vide qu'elle est vraiment en Explo. Le passage précède Sedna, l'objet le plus
    // lointain du parcours — c'est là que la distance cesse d'être un mot.
    const steps_ = steps('kuiper');
    const mode = steps_.findIndex((step) => step.kind === 'setMode');
    expect(mode, 'aucun passage en Explo').toBeGreaterThan(-1);
    expect(steps_[mode]).toEqual({ kind: 'setMode', mode: 'explo' });
    const sedna = steps_.findIndex(
      (step) => step.kind === 'flyTo' && step.body === 'sedna'
    );
    expect(mode, 'le passage doit précéder Sedna').toBeLessThan(sedna);
  });
});

describe('le chargeur du registre refuse', () => {
  const fiche = (id: string): TourRecord =>
    ({
      $schema: '../schema/tour.schema.json',
      id,
      title: { en: 'A', fr: 'A', es: 'A', 'pt-BR': 'A' },
      steps: [
        { kind: 'caption', text: { en: 'A', fr: 'A', es: 'A', 'pt-BR': 'A' } },
      ],
    }) as TourRecord;

  it.each([
    ['une fiche absente de l’ordre', [fiche('a'), fiche('b')], ['a']],
    ['un ordre citant une fiche inexistante', [fiche('a')], ['a', 'b']],
    ['un doublon dans l’ordre', [fiche('a'), fiche('b')], ['a', 'a']],
  ])('%s', (_label, records, order) => {
    expect(() => loadTours(records, order)).toThrow(/registre des visites/);
  });

  it('accepte l’ordre exact, sinon les cas ci-dessus ne prouveraient rien', () => {
    expect(
      loadTours([fiche('b'), fiche('a')], ['a', 'b']).map((s) => s.id)
    ).toEqual(['a', 'b']);
  });
});

/**
 * RÉSOLUTION D'UN ÉVÉNEMENT : « aucune occurrence trouvée » doit rester un cas théorique.
 *
 * Chaque forme citée par une fiche est résolue depuis DIX dates de référence étalées sur une
 * décennie. Un seul échantillon ne dirait rien : une éclipse tombe deux fois par an, une
 * opposition de Mars une fois tous les 780 jours, et c'est justement cet écart que la fenêtre
 * élargie existe pour couvrir.
 */
describe('resolveEventDate', () => {
  const REFERENCES = Array.from(
    { length: 10 },
    (_, i) => new Date(Date.UTC(2026 + i, (i * 5) % 12, 1 + ((i * 7) % 27)))
  );

  const cited = new Set<AstronomicalEventKind>();
  for (const script of TOUR_SCRIPTS)
    for (const step of script.steps)
      if (step.kind === 'jumpToEvent') cited.add(step.event);

  it('les fiches citent bien au moins un événement', () => {
    expect(cited.size).toBeGreaterThan(0);
  });

  it.each([...cited].map((kind) => [kind]))(
    '%s se résout depuis chaque date de référence',
    (kind) => {
      for (const reference of REFERENCES) {
        const date = resolveEventDate(kind, reference);
        expect(
          date,
          `${kind} depuis ${reference.toISOString()}`
        ).not.toBeNull();
        expect(date!.getTime()).toBeGreaterThan(reference.getTime());
      }
    }
  );

  it('résout une opposition de Mars, dont la période dépasse la première fenêtre', () => {
    // 780 jours de période synodique : c'est le cas qui a motivé l'élargissement de la fenêtre.
    for (const reference of REFERENCES)
      expect(
        resolveEventDate('opposition', reference, 'mars'),
        reference.toISOString()
      ).not.toBeNull();
  });

  it('distingue les corps d’une opposition', () => {
    const reference = new Date('2026-08-28T00:00:00Z');
    const mars = resolveEventDate('opposition', reference, 'mars');
    const jupiter = resolveEventDate('opposition', reference, 'jupiter');
    expect(mars).not.toBeNull();
    expect(jupiter).not.toBeNull();
    expect(mars!.getTime()).not.toBe(jupiter!.getTime());
  });

  it('rend null pour un corps qui n’a pas d’opposition', () => {
    // Vénus est en CONJONCTION, jamais en opposition : ce cas prouve que « rien trouvé » est bien
    // rendu, et non qu'une date approchante est servie à la place.
    expect(
      resolveEventDate('opposition', new Date('2026-08-28T00:00:00Z'), 'venus')
    ).toBeNull();
  });

  it('trouve une éclipse solaire dans l’année qui suit', () => {
    const reference = new Date('2026-08-28T00:00:00Z');
    const date = resolveEventDate('solar-eclipse', reference);
    expect(date!.getTime() - reference.getTime()).toBeLessThan(
      366 * 86_400_000
    );
  });
});
