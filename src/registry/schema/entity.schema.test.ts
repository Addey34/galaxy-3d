import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  entityJsonSchemaText,
  entityOrderSchema,
  entitySchema,
} from './entity';

/**
 * LE SCHÉMA DES ENTITÉS FAIT FOI, LE JSON SCHEMA COMMITÉ EN EST UNE COPIE. Mêmes promesses que
 * pour les fournisseurs et les produits : fichier commité identique à ce que Zod produit, chaque
 * fiche valide, et le schéma vu en train de refuser.
 */

const DIR = resolve(import.meta.dirname, '../entities');
const files = readdirSync(DIR).filter(
  (n) => n.endsWith('.json') && n !== 'order.json'
);

describe('JSON Schema des entités généré depuis Zod', () => {
  it('est exactement le fichier commité', () => {
    const committed = readFileSync(resolve(import.meta.dirname, 'entity.schema.json'), 'utf-8'); // prettier-ignore
    expect(
      committed,
      'le schéma Zod a changé : relancer `pnpm schema:generate` et committer le JSON Schema'
    ).toBe(entityJsonSchemaText());
  });
});

describe('chaque fiche d’entité passe le schéma', () => {
  it('trouve bien les fiches', () => {
    expect(files.length).toBeGreaterThanOrEqual(57);
  });

  it.each(files)('%s', (name) => {
    const raw = JSON.parse(readFileSync(join(DIR, name), 'utf-8')) as {
      id: string;
    };
    const parsed = entitySchema.safeParse(raw);
    expect(
      parsed.success ? null : JSON.stringify(parsed.error.issues).slice(0, 600),
      `${name} ne respecte pas le schéma`
    ).toBeNull();
    expect(raw.id).toBe(name.replace(/\.json$/, ''));
  });

  it('order.json passe le sien', () => {
    const raw = JSON.parse(readFileSync(join(DIR, 'order.json'), 'utf-8'));
    expect(entityOrderSchema.safeParse(raw).success).toBe(true);
  });
});

describe('le schéma des entités refuse', () => {
  const valid = {
    id: 'exemple',
    targetClass: 'planet',
    source: 'catalogue',
    config: {
      kind: 'planet',
      radius: 1,
      rotationSpeed: { $rotationHours: 24 },
      orbitalColor: '0x112233',
      textureResolutions: { surface: ['2k'] },
      realData: {},
      astroBody: 'Mars',
    },
    facts: {
      radiusKm: {
        value: 3389.5,
        source: 'nssdca-fact-sheets',
        method: 'measured',
      },
    },
  };
  const withConfig = (patch: object) => ({
    ...valid,
    config: { ...valid.config, ...patch },
  });
  const withFact = (fact: object) => ({ ...valid, facts: { radiusKm: fact } });

  it('accepte la fiche de référence, sinon les cas suivants ne prouveraient rien', () => {
    expect(entitySchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    [
      'une clé de config inconnue (faute de frappe)',
      withConfig({ radious: 1 }),
    ],
    ['une forme de calcul inconnue', withConfig({ radius: { $cube: 2 } })],
    ['une forme incomplète', withConfig({ radius: { $gm: 1, $oops: 2 } })],
    ['une clé en « $ » mêlée à des données', withConfig({ cameraDistance: { educ: 1, $explo: 2 } })], // prettier-ignore
    ['un corps astronomy-engine qui n’existe pas', withConfig({ astroBody: 'Vulcan' })], // prettier-ignore
    ['une couleur qui n’est pas 0xRRGGBB', withConfig({ orbitalColor: '#112233' })], // prettier-ignore
    ['une classe de cible hors EPNCore', { ...valid, targetClass: 'interstellar_object' }], // prettier-ignore
    ['un fait cité sans méthode', withFact({ value: 1, source: 'nssdca-fact-sheets' })], // prettier-ignore
    [
      'un fait non publié sans raison',
      withFact({ value: 1, published: false }),
    ],
    ['un fait non publié qui cite une source', withFact({ source: 'x', method: 'measured', published: false, reason: 'not-yet-sourced' })], // prettier-ignore
    ['un fait vide', withFact({})],
    ['un champ de fait inconnu', { ...valid, facts: { radius: { value: 1 } } }],
    ['un satellite désigné autrement que par son identifiant', withConfig({ satellites: [{ kind: 'moon' }] })], // prettier-ignore
  ])('%s', (_label, record) => {
    expect(entitySchema.safeParse(record).success).toBe(false);
  });
});
