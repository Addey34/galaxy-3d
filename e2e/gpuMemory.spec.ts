import { expect, test } from '@playwright/test';
import { GPU_SCENE_CEILINGS } from '../src/core/gpuBudget';
import { bootAndSettle } from './mainThread';
import { blockExternalNetwork } from './netBlock';

/**
 * LA MÉMOIRE GPU RÉELLE D'UNE SCÈNE TIENT SOUS SON PLAFOND (lot 56).
 *
 * Comptée par le registre des allocations du PILOTE (`core/gpuLedger.ts`, accroché avant le
 * premier appel WebGL sous `?debug-perf`), et non par les textures des matériaux : c'est ainsi que
 * la cubemap du ciel (~512 Mio) a échappé à la sonde jusqu'au 2026-10-18. Falsifiée le 2026-10-18 :
 * `scene.background` remis sur l'image des étoiles, la Terre en Explo passe de 867 à 1 764 Mio et
 * une cubemap de 512 Mio apparaît, ce qui fait rougir les trois contrôles ci-dessous.
 *
 * Le rapprochement texture par texture (`mismatches`) prouve que les deux comptes parlent de la
 * même chose : une texture qu'un matériau atteint et que le pilote tient doit peser pareil dans
 * l'estimation et dans le registre.
 */
const THREE_EMPTY_CUBEMAP_BYTES = 6 * 1 * 1 * 4;

interface DriverSnapshot {
  total: number;
  textures: { cubeBytes: number };
  materialUploaded: number;
  mismatches: string[];
  unknownFormats: number[];
  largest: string[];
}

for (const scene of GPU_SCENE_CEILINGS) {
  test(`GPU memory of ${scene.id} stays under ${scene.ceilingMiB} MiB, with no cubemap`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await blockExternalNetwork(page);
    await bootAndSettle(page, `/${scene.query}`, {
      loaderTimeoutMs: 120_000,
      timeoutMs: 120_000,
    });
    await page.waitForFunction(() => 'perfProbe' in window, null, {
      timeout: 60_000,
    });
    const driver = await page.evaluate(
      () =>
        (
          window as unknown as {
            perfProbe: { snapshot: () => { driver: DriverSnapshot | null } };
          }
        ).perfProbe.snapshot().driver
    );
    expect(
      driver,
      'registre du pilote accroché avant l’application'
    ).not.toBeNull();
    const d = driver!;
    const detail = d.largest.join(' ; ');
    // Three.js crée au démarrage une cubemap VIDE de 1 × 1 par face pour ses liaisons par défaut
    // (`emptyTextures` de `WebGLState`) : 6 × 4 = 24 octets, mesurés. Rien d'autre n'est admis.
    expect(
      d.textures.cubeBytes,
      `octets de cubemap : ${detail}`
    ).toBeLessThanOrEqual(THREE_EMPTY_CUBEMAP_BYTES);
    expect(d.unknownFormats, 'formats internes sans taille connue').toEqual([]);
    expect(
      d.materialUploaded,
      'des textures de matériaux téléversées'
    ).toBeGreaterThan(0);
    expect(d.mismatches, 'estimation et pilote, texture par texture').toEqual(
      []
    );
    expect(
      d.total / 1048576,
      `total du pilote (mesuré ${scene.measuredMiB} Mio le ${scene.measuredOn}) : ${detail}`
    ).toBeLessThanOrEqual(scene.ceilingMiB);
  });
}
