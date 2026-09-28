import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOUR_MAX_TIME_SCALE, tourJsonSchemaText, tourSchema } from './tour';
import { ASTRONOMICAL_EVENT_KINDS } from '@/core/astronomicalEvents';
import { MAX_SIMULATION_SCALE } from '@/ui/speedSlider';

/**
 * LE SCHÉMA DES VISITES FAIT FOI, LE JSON SCHEMA COMMITÉ EN EST UNE COPIE.
 *
 * Mêmes promesses que les quatre autres registres : le fichier commité est ce que Zod produit
 * aujourd'hui, chaque fiche passe le schéma, et le schéma refuse ce qu'il doit refuser. Une
 * cinquième est propre aux visites : le plafond de vitesse recopié dans le schéma est confronté à
 * son propriétaire (`MAX_SIMULATION_SCALE`), parce que deux sources qui décrivent la même chose
 * doivent être croisées par un test — c'est la règle du dépôt, pas un raffinement.
 */

const TOURS = resolve(import.meta.dirname, '../tours');

function tourFiles(): string[] {
  return readdirSync(TOURS)
    .filter((name) => name.endsWith('.json') && name !== 'order.json')
    .map((name) => join(TOURS, name));
}

describe('JSON Schema des visites généré depuis Zod', () => {
  it('est exactement le fichier commité', () => {
    const committed = readFileSync(resolve(import.meta.dirname, 'tour.schema.json'), 'utf-8'); // prettier-ignore
    expect(
      committed,
      'le schéma Zod a changé : relancer `pnpm schema:generate` et committer le JSON Schema'
    ).toBe(tourJsonSchemaText());
  });

  it('décrit bien les six formes d’étape', () => {
    const schema = JSON.stringify(JSON.parse(tourJsonSchemaText()));
    for (const kind of [
      'flyTo',
      'jumpToDate',
      'jumpToEvent',
      'setTimeScale',
      'caption',
      'wait',
    ])
      expect(schema).toContain(`"${kind}"`);
  });

  it('cite toutes les formes d’événement, et rien d’autre', () => {
    const schema = JSON.parse(tourJsonSchemaText()) as {
      properties: { steps: { items: { oneOf: { properties: Record<string, { enum?: string[] }> }[] } } }; // prettier-ignore
    };
    const withEvent = schema.properties.steps.items.oneOf.find(
      (form) => form.properties.event?.enum
    );
    expect(withEvent?.properties.event?.enum).toEqual([
      ...ASTRONOMICAL_EVENT_KINDS,
    ]);
  });

  it('plafonne la vitesse à ce que le curseur sait représenter', () => {
    expect(TOUR_MAX_TIME_SCALE).toBe(MAX_SIMULATION_SCALE);
  });
});

describe('chaque fiche de visite passe le schéma', () => {
  const files = tourFiles();

  it('trouve bien les fiches', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it.each(files.map((f) => [f.slice(TOURS.length + 1), f]))(
    '%s',
    (_name, file) => {
      const raw = JSON.parse(readFileSync(file, 'utf-8')) as {
        id: string;
        $schema?: string;
      };
      const parsed = tourSchema.safeParse(raw);
      expect(
        parsed.success ? null : JSON.stringify(parsed.error.issues),
        `${file} ne respecte pas le schéma`
      ).toBeNull();
      // Le nom du fichier EST l'identifiant.
      expect(raw.id).toBe(basename(file, '.json'));
      expect(raw.$schema).toBe('../schema/tour.schema.json');
    }
  );
});

describe('le schéma des visites refuse', () => {
  const valid = {
    $schema: '../schema/tour.schema.json',
    id: 'exemple',
    title: { en: 'Example', fr: 'Exemple', es: 'Ejemplo', 'pt-BR': 'Exemplo' },
    steps: [
      { kind: 'flyTo', body: 'earth' },
      { kind: 'caption', text: { en: 'A', fr: 'A', es: 'A', 'pt-BR': 'A' } },
    ],
  };

  it('accepte la fiche de référence, sinon les cas suivants ne prouveraient rien', () => {
    expect(tourSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['une visite sans aucune étape', { ...valid, steps: [] }],
    ['une visite qui ne dit rien', { ...valid, steps: [{ kind: 'flyTo', body: 'earth' }] }], // prettier-ignore
    ['un titre à trois langues', { ...valid, title: { en: 'A', fr: 'A', es: 'A' } }], // prettier-ignore
    ['une légende à trois langues', { ...valid, steps: [{ kind: 'caption', text: { en: 'A', fr: 'A', es: 'A' } }] }], // prettier-ignore
    ['une forme d’étape inconnue', { ...valid, steps: [...valid.steps, { kind: 'setMode', mode: 'explo' }] }], // prettier-ignore
    ['un champ inconnu dans une étape (faute de frappe)', { ...valid, steps: [...valid.steps, { kind: 'flyTo', body: 'mars', durationMs: 10 }] }], // prettier-ignore
    ['un événement inconnu', { ...valid, steps: [...valid.steps, { kind: 'jumpToEvent', event: 'supernova' }] }], // prettier-ignore
    ['une opposition sans corps', { ...valid, steps: [...valid.steps, { kind: 'jumpToEvent', event: 'opposition' }] }], // prettier-ignore
    ['un corps sur un événement qui n’en dépend pas', { ...valid, steps: [...valid.steps, { kind: 'jumpToEvent', event: 'solar-eclipse', body: 'mars' }] }], // prettier-ignore
    ['une date sans fuseau UTC', { ...valid, steps: [...valid.steps, { kind: 'jumpToDate', date: { $date: '2030-01-01T00:00:00' } }] }], // prettier-ignore
    ['une vitesse nulle', { ...valid, steps: [...valid.steps, { kind: 'setTimeScale', scale: 0 }] }], // prettier-ignore
    ['une vitesse hors de portée du curseur', { ...valid, steps: [...valid.steps, { kind: 'setTimeScale', scale: MAX_SIMULATION_SCALE + 1 }] }], // prettier-ignore
    ['une attente négative', { ...valid, steps: [...valid.steps, { kind: 'wait', ms: -1 }] }], // prettier-ignore
    ['un nom de corps en majuscules', { ...valid, steps: [{ kind: 'flyTo', body: 'Earth' }, valid.steps[1]] }], // prettier-ignore
  ])('%s', (_label, record) => {
    expect(tourSchema.safeParse(record).success).toBe(false);
  });

  it('accepte une opposition qui nomme son corps, et une vitesse négative', () => {
    // Le temps qui remonte est une capacité réelle du curseur : le plafond borne la MAGNITUDE.
    expect(
      tourSchema.safeParse({
        ...valid,
        steps: [
          ...valid.steps,
          { kind: 'jumpToEvent', event: 'opposition', body: 'mars' },
          { kind: 'setTimeScale', scale: -200_000 },
        ],
      }).success
    ).toBe(true);
  });
});
