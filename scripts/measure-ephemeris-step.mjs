#!/usr/bin/env node
/* global console, process */
/**
 * LE PAS D'UN FICHIER HORIZONS, MESURÉ ET NON CHOISI (2026-10-04).
 *
 * La règle date du lot 11 et vit en tête des petits corps de
 * `scripts/generate-horizons-ephemerides.mjs` : le pas le plus GROSSIER dont l'interpolation, par
 * le chemin même du service, reste sous 20 km d'écart MAXIMAL, et jamais plus fin que 4 jours.
 * La mesure avait été faite à la main, et rien ne permettait de la refaire : ce script la rend
 * rejouable, pour les 23 corps de la vague 1 des cibles de missions et pour tout corps suivant.
 *
 * LA MÉTHODE, et sa limite écrite. Le fichier livré au pas plancher de 4 jours porte des états
 * EXACTS d'Horizons (position et vitesse). On le décime à 8, 16, 32 et 64 jours, on construit le
 * service de PRODUCTION sur ce fichier décimé (`HorizonsEphemerisService`, avec la dynamique que
 * le catalogue lui donne, donc la même branche Hermite ou deux corps que dans la scène), et on
 * l'interroge à chaque nœud écarté, où l'état vrai est connu. Pour un pas de 8 jours le nœud du
 * milieu est exactement le centre de l'intervalle, là où l'erreur d'une cubique culmine ; pour
 * 16 jours et au-delà, trois nœuds intérieurs ou plus. Le lot 11 comparait à des vecteurs d'un
 * jour : on n'échantillonne ici qu'un point tous les 4 jours, donc l'écart MAXIMAL peut être
 * légèrement sous-estimé. Il n'y a pas d'erreur de recopie possible, en revanche : aucune
 * formule d'interpolation n'est réécrite ici.
 *
 * TÉMOIN, rejoué le 2026-10-04 sur les cinq corps que le lot 11 a laissés à 4 jours : même
 * décision pour chacun (4 j), et l'écart maximal à 8 j au même ordre que sa table (Éros 46 km
 * contre 47, Itokawa 4 055 contre 3 700, Ryugu 5 798 contre 5 000, Halley 7 553 contre 6 670,
 * Bennu 15 259 contre 13 400). Les écarts qui diffèrent viennent de solutions d'orbite plus
 * récentes que celles du lot 11, pas de la méthode : aucune ne change une décision.
 *
 * Les dates passent par `core/timeScale.ts` dans les deux sens : un nœud est un jour julien TDB,
 * et le service se questionne en temps civil.
 *
 *   node scripts/measure-ephemeris-step.mjs lutetia,tempel-1     corps du manifeste, au pas de 4 j
 *   node scripts/measure-ephemeris-step.mjs --all-at-4            tous les fichiers à 4 j
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AU_KM = 149_597_870.7;
/** La cible du lot 11 : l'écart maximal déjà accepté du fichier de Cérès, 19,6 km. */
const MAX_ERROR_KM = 20;
const FACTORS = [2, 4, 8, 16];

const { createServer } = await import('vite');
const loader = await createServer({
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  resolve: { alias: { '@': join(ROOT, 'src') } },
  root: ROOT,
});
try {
  const load = (p) => loader.ssrLoadModule(p);
  const { CELESTIAL_CONFIG } = await load('/src/config/bodies.ts');
  const { bodyDynamics } = await load('/src/config/gravity.ts');
  const { HorizonsEphemerisService } = await load(
    '/src/core/HorizonsEphemerisService.ts'
  );
  const { jdTdbFromDate } = await load('/src/core/timeScale.ts');
  const { eclipticToScene } = await load('/src/core/frames.ts');

  const manifest = JSON.parse(
    readFileSync(join(ROOT, 'public/assets/ephemerides/manifest.json'), 'utf8')
  );
  const dynamics = bodyDynamics(CELESTIAL_CONFIG);

  const arg = process.argv[2];
  const names =
    arg === '--all-at-4'
      ? Object.keys(manifest.bodies).filter(
          (n) => manifest.bodies[n].stepDays === 4
        )
      : (arg ?? '').split(',').filter(Boolean);
  if (names.length === 0) {
    console.error(
      'usage : node scripts/measure-ephemeris-step.mjs <corps,…> | --all-at-4'
    );
    process.exit(1);
  }

  /** La date civile dont le jour julien TDB est `jd` (deux itérations suffisent). */
  const dateOfJdTdb = (jd) => {
    let ms = (jd - 2440587.5) * 86_400_000 - 69_184;
    for (let i = 0; i < 3; i++)
      ms += (jd - jdTdbFromDate(new Date(ms))) * 86_400_000;
    return new Date(ms);
  };

  const rows = [];
  for (const name of names) {
    const entry = manifest.bodies[name];
    if (!entry) throw new Error(`« ${name} » absent du manifeste`);
    if (entry.stepDays !== 4)
      throw new Error(
        `« ${name} » est au pas de ${entry.stepDays} j : la mesure part du pas plancher de 4 j`
      );
    if (entry.center && entry.center !== 'sun')
      throw new Error(
        `« ${name} » est relatif à ${entry.center} : ce script mesure les fichiers héliocentriques`
      );
    const file = readFileSync(
      join(ROOT, 'public/assets/ephemerides', entry.file)
    );
    const full = new Float64Array(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
    );
    const count = entry.sampleCount;
    const result = { name, errors: {} };
    for (const k of FACTORS) {
      const kept = Math.floor((count - 1) / k) + 1;
      const samples = new Float64Array(kept * 6);
      for (let i = 0; i < kept; i++)
        samples.set(full.subarray(i * k * 6, i * k * 6 + 6), i * 6);
      const loaded = new Map([
        [
          name,
          {
            manifest: {
              ...entry,
              stepDays: entry.stepDays * k,
              sampleCount: kept,
            },
            samples,
            ...(dynamics[name] !== undefined
              ? { dynamics: dynamics[name] }
              : {}),
          },
        ],
      ]);
      const service = new HorizonsEphemerisService(loaded);
      let max = 0;
      for (let j = 1; j < (kept - 1) * k; j++) {
        if (j % k === 0) continue;
        const jd = entry.startJdTdb + j * entry.stepDays;
        const got = service.getHeliocentricAU(name, dateOfJdTdb(jd));
        if (!got)
          throw new Error(
            `${name} : pas de position au nœud ${j} (pas ${k * 4} j)`
          );
        const truth = eclipticToScene(
          full[j * 6],
          full[j * 6 + 1],
          full[j * 6 + 2]
        );
        const km = got.distanceTo(truth) * AU_KM;
        if (km > max) max = km;
      }
      result.errors[k * 4] = max;
    }
    const steps = Object.entries(result.errors)
      .filter(([, km]) => km < MAX_ERROR_KM)
      .map(([step]) => Number(step));
    result.chosen = Math.max(4, ...steps);
    rows.push(result);
    console.log(
      `${name.padEnd(24)} ` +
        FACTORS.map(
          (k) => `${k * 4} j ${result.errors[k * 4].toFixed(3).padStart(10)} km`
        ).join('  ') +
        `   → ${result.chosen} j`
    );
  }
  console.log(
    `\nRègle : le pas le plus grossier sous ${MAX_ERROR_KM} km d'écart maximal, jamais sous 4 j.`
  );
} finally {
  await loader.close();
}
