import { describe, expect, it } from 'vitest';
import { loadEntityCatalogue, loadSmallBodyElements } from './index';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { SMALL_BODY_ELEMENTS } from '@/config/smallBodies';
import { deriveTextures, forEachBody, ringTexturePath } from '@/config/catalog';
import type { CelestialConfig } from '@/types';

/**
 * ÉGALITÉ STRICTE entre le registre et le catalogue TypeScript, pendant toute la migration
 * (`docs/private/REGISTRES_LOT7.md` § 7) : le littéral fait foi, et le registre doit le
 * reproduire À L'IDENTITÉ DE BITS PRÈS.
 *
 *   - chaque nombre est comparé par `Object.is`, JAMAIS avec une tolérance : un dernier bit
 *     différent déplacerait l'empreinte des pages sans qu'aucun test d'arrondi ne le voie ;
 *   - l'ORDRE des clés est comparé partout où il est lu (corps, satellites, couches de texture) :
 *     il pilote la navigation, le sitemap et les pages. Seul `realData` est comparé comme un
 *     ensemble, parce que personne ne parcourt ses clés dans l'ordre ;
 *   - les dates par leur instant.
 */

type Diff = string[];

function compare(
  a: unknown,
  b: unknown,
  path: string,
  inRealData: boolean,
  out: Diff
): void {
  if (out.length > 20) return;
  if (a instanceof Date || b instanceof Date) {
    if (
      !(a instanceof Date) ||
      !(b instanceof Date) ||
      !Object.is(a.getTime(), b.getTime())
    )
      out.push(`${path} : date ${String(a)} ≠ ${String(b)}`);
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      out.push(`${path} : tableau ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
      return;
    }
    a.forEach((v, i) => compare(v, b[i], `${path}[${i}]`, inRealData, out));
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    const same = inRealData
      ? [...ka].sort().join() === [...kb].sort().join()
      : ka.join() === kb.join();
    if (!same) {
      out.push(`${path} : clés [${ka.join(', ')}] ≠ [${kb.join(', ')}]`);
      return;
    }
    for (const k of ka)
      compare(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${path}.${k}`,
        inRealData || k === 'realData',
        out
      );
    return;
  }
  if (!Object.is(a, b)) out.push(`${path} : ${String(a)} ≠ ${String(b)}`);
}

/** Même post-traitement que `bodies.ts` : chemins de texture dérivés de la clé du corps. */
function withDerivedTextures(
  bodies: CelestialConfig['bodies']
): CelestialConfig {
  const config: CelestialConfig = { bodies };
  forEachBody(config, ({ name, config: body }) => {
    body.textures = deriveTextures(name, body);
    if (body.ring && !body.ring.textures)
      body.ring.textures = ringTexturePath(name);
  });
  return config;
}

describe('registre des entités contre le catalogue TypeScript', () => {
  const loaded = withDerivedTextures(loadEntityCatalogue());

  it('reproduit le catalogue à l’identité de bits près', () => {
    const diff: Diff = [];
    compare(loaded.bodies, CELESTIAL_CONFIG.bodies, 'bodies', false, diff);
    expect(diff).toEqual([]);
  });

  it('reproduit les éléments publiés des petits corps', () => {
    // Comparés comme des ENSEMBLES de clés : `smallBodyToConfig` impose son propre ordre à la
    // config (vérifié bit à bit ci-dessus), et les lecteurs des éléments (`smallBodies.test.ts`,
    // `/methodology`) les lisent par nom. Les valeurs, elles, sont comparées par `Object.is`.
    //
    // `bodies.ts` MUTE les satellites des petits corps (il y dérive `textures`), et ces objets
    // sont partagés avec `SMALL_BODY_ELEMENTS` : on applique la même dérivation avant de comparer.
    const elements = loadSmallBodyElements();
    for (const el of elements)
      if (el.satellites) withDerivedTextures(el.satellites);
    const diff: Diff = [];
    compare(elements, SMALL_BODY_ELEMENTS, 'elements', true, diff);
    expect(diff).toEqual([]);
  });

  it('voit vraiment une différence d’un bit', () => {
    // Falsification intégrée : un comparateur qui ne voit rien rendrait le premier test vert.
    const diff: Diff = [];
    compare({ x: 0.1 + 0.2 }, { x: 0.3 }, 'x', false, diff);
    compare({ a: 1, b: 2 }, { b: 2, a: 1 }, 'ordre', false, diff);
    compare({ a: 1, b: 2 }, { b: 2, a: 1 }, 'realData', true, diff);
    compare(0, -0, 'zéro', false, diff);
    expect(diff).toHaveLength(3);
  });
});
