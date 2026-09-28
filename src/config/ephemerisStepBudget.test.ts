import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import {
  FULL_COVERAGE_DAYS,
  REFUSED_STEP_REFINEMENTS,
  TARGET_MEDIAN_RADII,
  refusedRefinementBytes,
  shippedBytesForStep,
} from './ephemerisStepBudget';
import summary from './horizons-validation-summary.json';

/**
 * LE REFUS DE RAFFINER UN PAS, CONFRONTÉ À CE QUE LE DÉPÔT LIVRE.
 *
 * Un manque écrit avec sa raison ne vaut que si la raison reste VRAIE. Ces gardes empêchent les
 * trois façons dont une liste de refus pourrit : un corps qui s'améliore et qu'on oublie d'en
 * retirer, un corps qui se dégrade et qu'on oublie d'y mettre, et un coût recopié qui cesse de
 * correspondre à son pas.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EPHEMERIDES = join(ROOT, 'public/assets/ephemerides');
const manifest = JSON.parse(
  readFileSync(join(EPHEMERIDES, 'manifest.json'), 'utf8')
) as {
  coverage: { start: string; stop: string };
  bodies: Record<
    string,
    { file: string; center: string; stepDays: number; sampleCount: number }
  >;
};

/** Écart médian SERVI, en rayons du corps : la ligne « production » du relevé. */
function servedMedianRadii(body: string): number | null {
  const row = summary.rows.find(
    (r) => r.body === body && r.provider === 'production'
  );
  return row?.radii?.median ?? null;
}

/** Les corps dont le pas livré ne résout pas l'orbite : moins de 2 échantillons par révolution. */
function underSampledSatellites(): string[] {
  const periods = new Map<string, number>();
  for (const [name, cfg] of flattenBodies(CELESTIAL_CONFIG)) {
    const period = cfg.realData?.orbitPeriodDays;
    if (period !== undefined && period > 0) periods.set(name, period);
  }
  const out: string[] = [];
  for (const [name, entry] of Object.entries(manifest.bodies)) {
    const period = periods.get(name);
    if (period === undefined || !entry.center || entry.center === 'sun')
      continue;
    if (period / entry.stepDays >= 2) continue;
    out.push(name);
  }
  return out;
}

describe('pas des satellites : ce qui est refusé, et pourquoi', () => {
  it('la couverture déclarée est celle du manifeste, et elle reproduit CHAQUE compte livré', () => {
    // Le nombre n'est pas choisi : il se dérive des deux dates que le manifeste publie, et la
    // troncature qui l'accompagne doit rendre le compte d'échantillons de tous les fichiers de
    // pleine couverture, à chacun de leurs pas. Une régénération qui changerait la plage
    // rougit donc ici, au lieu de fausser tous les coûts en silence.
    const declared =
      (Date.parse(`${manifest.coverage.stop}T00:00:00Z`) -
        Date.parse(`${manifest.coverage.start}T00:00:00Z`)) /
      86_400_000;
    expect(declared).toBe(FULL_COVERAGE_DAYS);

    let checked = 0;
    for (const entry of Object.values(manifest.bodies)) {
      const expected = Math.floor(FULL_COVERAGE_DAYS / entry.stepDays) + 1;
      // Les sondes ont leur propre fenêtre, bornée par leur trajectoire : seuls les fichiers
      // de pleine couverture sont concernés, et on compte ceux qu'on a vérifiés.
      if (entry.sampleCount !== expected) continue;
      checked++;
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('le coût d’un pas se DÉRIVE, et il reproduit un fichier livré', () => {
    const amalthea = manifest.bodies.amalthea;
    expect(amalthea.stepDays).toBe(4);
    const onDisk = statSync(join(EPHEMERIDES, amalthea.file)).size;
    expect(shippedBytesForStep(amalthea.stepDays)).toBe(onDisk);
  });

  it('chaque écart déclaré est celui du relevé committé', () => {
    for (const refusal of REFUSED_STEP_REFINEMENTS) {
      const served = servedMedianRadii(refusal.body);
      expect(served, refusal.body).not.toBeNull();
      // Deux décimales : le relevé en publie autant, et un corps qui bouge doit forcer une
      // relecture de son refus plutôt que de glisser.
      expect(Number(served).toFixed(2), refusal.body).toBe(
        refusal.medianRadii.toFixed(2)
      );
    }
  });

  it('tout satellite sous-échantillonné au-dessus de la cible est DÉCLARÉ, et lui seul', () => {
    const declared = new Set(REFUSED_STEP_REFINEMENTS.map((r) => r.body));
    const over = new Set<string>();
    for (const body of underSampledSatellites()) {
      const served = servedMedianRadii(body);
      if (served !== null && served > TARGET_MEDIAN_RADII) over.add(body);
    }
    expect([...over].sort()).toEqual([...declared].sort());
  });

  it('un refus « hors modèle » ne chiffre pas un pas, et un refus chiffré en porte un', () => {
    for (const refusal of REFUSED_STEP_REFINEMENTS) {
      if (refusal.reason === 'beyond-the-model')
        expect(refusal.neededStepMinutes, refusal.body).toBeNull();
      else expect(refusal.neededStepMinutes, refusal.body).toBeGreaterThan(0);
    }
  });

  it('le coût total des raffinements refusés est ÉNORME devant ce qui est livré', () => {
    // C'est la raison du refus, et elle se recalcule : trois corps chiffrables valent plus de
    // dix fois l'ensemble des éphémérides livrées, pour des lunes de 84 à 252 km de rayon.
    let shipped = 0;
    for (const entry of Object.values(manifest.bodies))
      shipped += statSync(join(EPHEMERIDES, entry.file)).size;
    const refused = refusedRefinementBytes();
    expect(refused).toBeGreaterThan(shipped * 10);
  });
});
