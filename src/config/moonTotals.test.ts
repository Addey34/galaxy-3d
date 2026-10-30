import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import index from './discoveryIndex.json';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * DEUX NOMBRES DE LUNES, UN SEUL TOTAL (audit des panneaux, C8).
 *
 * La fiche affiche « Lunes connues » (fait du registre, daté) et « Lunes déjà vues à cette date :
 * n sur N » (table du JPL). Si N et le fait divergeaient, la même fiche se contredirait. Le test
 * confronte les deux pour chaque système que la table du JPL couvre.
 */
describe('total des lunes : registre et table du JPL', () => {
  const systems = Object.entries(index.systems).filter(
    ([, system]) => system.source === 'jpl-sats'
  );

  it('couvre au moins les cinq systèmes de planètes à lunes', () => {
    expect(systems.map(([name]) => name).sort()).toEqual(
      expect.arrayContaining(['jupiter', 'mars', 'neptune', 'saturn', 'uranus'])
    );
  });

  it.each(systems)(
    '%s : le fait « moonCount » égale le total de la table',
    (name, system) => {
      const entity = JSON.parse(
        readFileSync(
          join(ROOT, 'src/registry/entities', `${name}.json`),
          'utf8'
        )
      ) as { facts?: Record<string, { value?: number }> };
      const facts =
        entity.facts ?? (entity as Record<string, { value?: number }>);
      expect(facts.moonCount?.value, name).toBe(system.total);
    }
  );
});
