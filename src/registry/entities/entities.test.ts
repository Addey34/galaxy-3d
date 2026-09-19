import { describe, expect, it } from 'vitest';
import { ENTITY_ORDER, ENTITY_RECORDS } from './index';
import { decode, loadCatalogue, type EntityRecord } from '../load';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { allBodies } from '@/config/catalog';

/**
 * LE REGISTRE DES ENTITÉS, APRÈS LA BASCULE (lot 7, phase 4).
 *
 * Pendant la migration, ce fichier comparait le registre au littéral TypeScript, bit à bit et
 * ordre des clés compris. Depuis la bascule, `CELESTIAL_CONFIG` EST le registre : cette
 * comparaison serait une tautologie, et une tautologie verte ne prouve rien (le dépôt en a déjà
 * payé une, `SUMMARY_PROVIDER`, au lot 7 phase 1). La bascule elle-même a été prouvée une fois,
 * au moment de la faire : le catalogue entier, sérialisé canoniquement avant et après, est
 * identique octet pour octet (`docs/private/REGISTRES_LOT7.md` § 10). Ce qui garde la suite :
 * l'empreinte des documents générés, les tests de fond (Horizons, sources relevées), et ici les
 * gardes du chargeur, chacune vue en train de refuser.
 */

const catalogueRecord = (
  id: string,
  config: Record<string, unknown>,
  facts?: EntityRecord['facts']
): EntityRecord =>
  ({
    id,
    targetClass: 'planet',
    source: 'catalogue',
    config: {
      kind: 'planet',
      radius: 1,
      rotationSpeed: 0,
      orbitalColor: '0x112233',
      textureResolutions: {},
      ...config,
    },
    ...(facts ? { facts } : {}),
  }) as EntityRecord;

describe('arbre du catalogue', () => {
  it('place chaque fiche une fois, dans l’ordre déclaré', () => {
    expect(Object.keys(CELESTIAL_CONFIG.bodies)).toEqual([...ENTITY_ORDER]);
    const placed = allBodies(CELESTIAL_CONFIG).map(({ name }) => name);
    expect(placed.sort()).toEqual(ENTITY_RECORDS.map((r) => r.id).sort());
  });

  it('donne à chaque corps la classe EPNCore qui correspond à son rôle de rendu', () => {
    const expected: Record<string, string> = {
      star: 'star',
      planet: 'planet',
      moon: 'satellite',
      skybox: 'sky',
      dwarf: 'dwarf_planet',
      asteroid: 'asteroid',
      comet: 'comet',
    };
    const byId = new Map(ENTITY_RECORDS.map((r) => [r.id, r]));
    for (const { name, config } of allBodies(CELESTIAL_CONFIG))
      expect(byId.get(name)!.targetClass, name).toBe(expected[config.kind]);
  });
});

describe('le chargeur refuse', () => {
  it('une fiche que l’arbre n’atteint pas', () => {
    expect(() =>
      loadCatalogue([catalogueRecord('a', {}), catalogueRecord('b', {})], ['a'])
    ).toThrow('jamais placées');
  });

  it('une fiche placée deux fois', () => {
    expect(() =>
      loadCatalogue(
        [catalogueRecord('a', { satellites: ['b'] }), catalogueRecord('b', {})],
        ['a', 'b']
      )
    ).toThrow('deux fois');
  });

  it('un satellite qui n’existe pas', () => {
    expect(() =>
      loadCatalogue([catalogueRecord('a', { satellites: ['x'] })], ['a'])
    ).toThrow('inconnue');
  });

  it('une forme de calcul hors de l’ensemble fermé', () => {
    expect(() => decode({ $cube: 3 }, 'test')).toThrow(
      'forme déclarée inconnue'
    );
  });

  it('une couleur mal écrite', () => {
    expect(() => decode('#112233', 'test', 'orbitalColor')).toThrow('0xRRGGBB');
  });

  it('une forme numérique qui produit Infinity', () => {
    expect(() => decode({ $rotationHours: 0 }, 'test')).toThrow('non fini');
  });

  it('une incertitude négative ou non numérique', () => {
    const record = (uncertainty: unknown) =>
      catalogueRecord(
        'a',
        { realData: {} },
        {
          radiusKm: {
            value: 1,
            source: 's',
            method: 'measured',
            uncertainty: uncertainty as never,
          },
        }
      );
    expect(() => loadCatalogue([record(-1)], ['a'])).toThrow(
      'nombre fini positif ou nul'
    );
    expect(() => loadCatalogue([record('large')], ['a'])).toThrow(
      'nombre fini positif ou nul'
    );
  });

  it('des faits sans emplacement realData', () => {
    expect(() =>
      loadCatalogue(
        [
          catalogueRecord(
            'a',
            {},
            {
              radiusKm: { value: 1, source: 's', method: 'measured' },
            }
          ),
        ],
        ['a']
      )
    ).toThrow('realData');
  });

  it('une valeur de rotation dans un fait du catalogue (elle vit dans rotationSpeed)', () => {
    expect(() =>
      loadCatalogue(
        [
          catalogueRecord(
            'a',
            { realData: {} },
            {
              rotationPeriod: { value: 24, source: 's', method: 'measured' },
            }
          ),
        ],
        ['a']
      )
    ).toThrow('ne porte pas de valeur');
  });

  it('une précision qui n’existe pas dans DETAIL', () => {
    expect(() =>
      loadCatalogue(
        [
          catalogueRecord(
            'a',
            { realData: {} },
            {
              radiusKm: {
                value: 1,
                source: 's',
                method: 'measured',
                detail: 'inventee',
              },
            }
          ),
        ],
        ['a']
      )
    ).toThrow('précision inconnue');
  });

  it('et évalue une forme exactement comme le littéral qu’elle remplace', () => {
    // Même opération, même ordre : `7.25 * D2R`, `_R(609.12)`, `5772 - 273.15`.
    expect(Object.is(decode({ $deg: 7.25 }, 't'), 7.25 * (Math.PI / 180))).toBe(
      true
    );
    expect(
      Object.is(
        decode({ $rotationHours: 609.12 }, 't'),
        (Math.PI * 2) / (609.12 * 3_600)
      )
    ).toBe(true);
    expect(Object.is(decode({ $kelvin: 5772 }, 't'), 5772 - 273.15)).toBe(true);
  });
});
