import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ATLAS_CHART_TOP } from '@/core/modelUv';

/**
 * La recette de l'outil de pose SPICE (`scripts/spice-pose-targets.json`, lue par
 * `scripts/spice-pose/pose.py`) confrontée à ce que l'application LIVRE. L'outil lui-même tourne
 * hors de `pnpm verify` (réseau, noyaux, minutes de calcul) ; sa garde est
 * `node scripts/spice-pose.mjs guard eros-approach`. Ce qui se vérifie sans réseau est ici :
 * qu'une cible désigne un corps qui a une fiche, une période de rotation et un modèle livré, que
 * ses témoins en ont un aussi, et que l'outil sait lire chaque niveau que le générateur produit.
 */
const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

interface PoseTarget {
  body: string;
  naifBody: string;
  spacecraft: string;
  camera: {
    instrument: string;
    lines: number;
    samples: number;
    lineAxis: string;
    sampleAxis: string;
  };
  kernelBase: string;
  kernels: string[];
  imageBase: string;
  images: string[];
  imageFormat: string;
  truthFrame?: string;
  guard?: { witnesses: string[]; maxErrorDeg: number; maxWitnessRatio: number };
}

const recipe = JSON.parse(read('scripts/spice-pose-targets.json')) as {
  targets: Record<string, PoseTarget>;
};
const targets = Object.entries(recipe.targets);
const AXES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

/** La période de rotation (heures) d'une fiche, où qu'elle soit rangée ; `pose.py` la lit pareil. */
function rotationPeriod(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const rp = (value as Record<string, unknown>).rotationPeriod as
    { value?: unknown } | undefined;
  if (rp && typeof rp.value === 'number') return rp.value;
  for (const v of Object.values(value)) {
    const found = rotationPeriod(v);
    if (found !== undefined) return found;
  }
  return undefined;
}

const shippedModels = (body: string) => {
  const dir = join(ROOT, 'public/assets/models', body);
  return existsSync(dir)
    ? readdirSync(dir).filter((f) => /_shape_\w+\.glb$/.test(f))
    : [];
};

describe('outil de pose SPICE : la recette contre ce qui est livré', () => {
  it('déclare la garde Éros, avec un repère de vérité et deux témoins', () => {
    const eros = recipe.targets['eros-approach'];
    expect(eros?.truthFrame).toBe('EROS_FIXED');
    expect(eros?.guard?.witnesses.length).toBeGreaterThanOrEqual(2);
    expect(eros?.guard?.maxErrorDeg).toBeLessThanOrEqual(2);
    expect(eros?.guard?.maxWitnessRatio).toBeLessThan(1);
  });

  it.each(targets)(
    '%s : le corps a une fiche, une période et un modèle livré',
    (_, t) => {
      const fiche = JSON.parse(read(`src/registry/entities/${t.body}.json`));
      // Rotation synchrone (les lunes d'Uranus) : la période est celle de l'orbite, comme le lit
      // `rotation_rate` de `pose.py`.
      const synchronous =
        fiche.facts?.rotationPeriod?.detail === 'synchronousRotation'
          ? fiche.facts.orbitPeriodDays?.value * 24
          : undefined;
      expect(rotationPeriod(fiche) ?? synchronous).toBeGreaterThan(0);
      // Un corps SANS modèle déclaré est une sphère au rayon de sa fiche (`posekit.load_model`) ;
      // un modèle déclaré doit, lui, être livré.
      if (fiche.elements?.model)
        expect(shippedModels(t.body).length).toBeGreaterThan(0);
      else expect(fiche.facts?.radiusKm?.value).toBeGreaterThan(0);
      for (const w of t.guard?.witnesses ?? []) {
        expect(w).not.toBe(t.body);
        expect(shippedModels(w).length, `témoin ${w}`).toBeGreaterThan(0);
      }
    }
  );

  it.each(targets)('%s : caméra, noyaux et images bien formés', (_, t) => {
    expect(AXES).toContain(t.camera.lineAxis);
    expect(AXES).toContain(t.camera.sampleAxis);
    expect(t.camera.lineAxis.slice(1)).not.toBe(t.camera.sampleAxis.slice(1));
    expect(Number.isInteger(Number(t.camera.instrument))).toBe(true);
    expect(t.kernelBase).toMatch(/^https:\/\//);
    expect(t.imageBase).toMatch(/^https:\/\//);
    expect(['fits', 'pds3', 'pds3-detached']).toContain(t.imageFormat);
    // Deux noyaux de même nom s'écraseraient dans le cache, qui les range à plat.
    const names = t.kernels.map((k) => k.split('/').pop());
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(t.images).size).toBe(t.images.length);
  });

  it("l'outil lit chaque niveau que le générateur de modèles produit", () => {
    const budgets = Object.keys(
      JSON.parse(read('scripts/shape-model-targets.json')).budgets
    );
    const order = read('scripts/spice-pose/posekit.py').match(
      /order = \[([^\]]+)\]/
    );
    expect(order).not.toBeNull();
    const read_ = order![1].match(/"(\w+)"/g)!.map((q) => q.slice(1, -1));
    for (const q of budgets) expect(read_).toContain(q);
  });

  it('les dépendances Python sont figées, et Python ne lit rien du dossier courant', () => {
    const lines = read('scripts/spice-pose/requirements.txt')
      .split(/\r?\n/)
      .filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/^[\w-]+==[\d.]+$/);
    expect(read('scripts/spice-pose.mjs')).toMatch(/\['-I'/);
  });

  it('la bande de pastille de l’atlas est la même pour la cuisson et pour l’application', () => {
    // 2026-10-06 : la cuisson remplit la bande au-dessus de ATLAS_CHART_TOP à la moyenne, et la
    // sphère de repli d'un corps à atlas y lit sa couleur. Deux constantes, une seule valeur.
    const kit = readFileSync(
      join(ROOT, 'scripts/spice-pose/posekit.py'),
      'utf8'
    );
    expect(Number(/^ATLAS_CHART_TOP = ([\d.]+)/m.exec(kit)?.[1])).toBe(
      ATLAS_CHART_TOP
    );
  });
});
