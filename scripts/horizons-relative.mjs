/* global fetch, setTimeout, URLSearchParams */
/**
 * LA POSITION D'UNE SONDE RELATIVE À UN CORPS, LUE DANS HORIZONS, AVEC CACHE DATÉ.
 *
 * Partagé par `generate-flyby-events.mjs` (le point le plus proche d'un survol) et
 * `generate-orbit-insertions.mjs` (l'instant où une sonde devient liée à un corps) : deux
 * mesures sur la même lecture, qui ne doivent pas diverger sur la façon de la faire (centre,
 * repère, échelle de temps, contrôle du nom servi). Extrait le 2026-10-14 au lot 49, octet pour
 * octet : `pnpm flybys:generate --offline --check` est resté vert.
 *
 * Chaque réponse est mise en cache sous le hachage de son URL et porte la date de SA lecture
 * (`fact-source-cache.mjs`), jamais celle de l'exécution.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stampNow, stampOf } from './fact-source-cache.mjs';

const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';

/**
 * Une fenêtre qui déborde la couverture d'une trajectoire : c'est une RÉPONSE (la rencontre
 * touche le début ou la fin de ce qu'Horizons sert), pas une panne.
 */
const COVERAGE = /Insufficient ephemeris data|No ephemeris for target/;
export class OutsideCoverage extends Error {}

const utc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/**
 * @param {{ cacheDir: string, offline: boolean, targets: object, centers: object,
 *   fallbackToDifference?: boolean }} options
 *   `targets` et `centers` : ceux de `scripts/validation-targets.json`.
 *   `fallbackToDifference` : quand Horizons ne sert pas le CENTRE à ces dates alors qu'il sert la
 *   sonde (Didymos, 920065803, rend « Insufficient ephemeris data » fin octobre 2026 quand Hera
 *   est servie jusqu'au 4 novembre ; mesuré le 2026-10-14), mesurer par différence des deux
 *   héliocentriques au lieu de conclure à la fin de la trajectoire. Désactivé pour les survols,
 *   dont le relevé livré a été écrit sans lui.
 */
export function horizonsRelative({
  cacheDir,
  offline,
  targets,
  centers,
  fallbackToDifference = false,
}) {
  async function horizons(params, label) {
    const url = `${API}?${new URLSearchParams({ format: 'text', ...params })}`;
    const key = createHash('sha256').update(url).digest('hex').slice(0, 32);
    const file = join(cacheDir, `${key}.txt`);
    if (existsSync(file))
      return { text: readFileSync(file, 'utf8'), retrieved: stampOf(file) };
    if (offline)
      throw new Error(`--offline : réponse absente du cache (${label})`);
    let text = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await fetch(url);
      text = await response.text();
      if (response.ok && text.includes('$$SOE')) break;
      if (response.ok && COVERAGE.test(text)) break;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
    if (!text.includes('$$SOE') && !COVERAGE.test(text))
      throw new Error(
        `Horizons sans table (${label}) :\n${text.slice(0, 600)}`
      );
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, text);
    return { text, retrieved: stampNow(file) };
  }

  /** États (km, km/s), écliptique J2000, dates UT, d'une cible vue d'un centre. */
  async function states(command, expect, centerId, fromMs, toMs, step, label) {
    const { text, retrieved } = await horizons(
      {
        COMMAND: `'${command}'`,
        OBJ_DATA: 'NO',
        MAKE_EPHEM: 'YES',
        EPHEM_TYPE: 'VECTORS',
        CENTER: `'500@${centerId}'`,
        START_TIME: `'${utc(fromMs)}'`,
        STOP_TIME: `'${utc(toMs)}'`,
        STEP_SIZE: `'${step}'`,
        TIME_TYPE: 'UT',
        REF_PLANE: 'ECLIPTIC',
        REF_SYSTEM: 'ICRF',
        OUT_UNITS: 'KM-S',
        VEC_TABLE: '2',
        VEC_CORR: 'NONE',
        CSV_FORMAT: 'YES',
        TIME_DIGITS: 'FRACSEC',
      },
      label
    );
    if (!text.includes('$$SOE')) throw new OutsideCoverage(label);
    const name = /Target body name: ([^{\n]*)/.exec(text)?.[1].trim() ?? '';
    if (!name.toLowerCase().includes(expect))
      throw new Error(
        `${label} : Horizons a servi « ${name} », attendu « ${expect} »`
      );
    const solution = /Target body name:[^\n]*\{source: ([^}]+)\}/.exec(
      text
    )?.[1];
    const body = text.slice(text.indexOf('$$SOE') + 5, text.indexOf('$$EOE'));
    const rows = body
      .trim()
      .split('\n')
      .map((line) => {
        const f = line.split(',').map((s) => s.trim());
        // Le jour julien UT, arrondi à la seconde : la table est au pas d'une seconde au plus fin.
        const at =
          Math.round(((Number(f[0]) - 2440587.5) * 86_400_000) / 1000) * 1000;
        return {
          at,
          p: f.slice(2, 5).map(Number),
          v: f.slice(5, 8).map(Number),
        };
      });
    return { rows, retrieved, solution };
  }

  /** Sonde relative au corps : par centre d'Horizons, ou par différence de deux héliocentriques. */
  async function relative(probeId, bodyId, fromMs, toMs, step) {
    const probe = targets[probeId];
    const label = `${probeId} / ${bodyId} ${utc(fromMs)} (${step})`;
    const center = centers[bodyId];
    if (center) {
      try {
        return {
          ...(await states(
            probe.command,
            probe.expect,
            center.id,
            fromMs,
            toMs,
            step,
            label
          )),
          measuredFrom: 'centre',
        };
      } catch (error) {
        if (!(error instanceof OutsideCoverage) || !fallbackToDifference)
          throw error;
      }
    }
    const body = targets[bodyId];
    const [a, b] = await Promise.all([
      states(probe.command, probe.expect, '10', fromMs, toMs, step, label),
      states(
        body.command,
        body.expect ?? bodyId,
        '10',
        fromMs,
        toMs,
        step,
        label
      ),
    ]);
    if (a.rows.length !== b.rows.length)
      throw new Error(`${label} : tables de longueurs différentes`);
    return {
      measuredFrom: 'difference',
      retrieved: [a.retrieved, b.retrieved].sort().at(-1),
      solution: a.solution,
      rows: a.rows.map((r, k) => {
        if (r.at !== b.rows[k].at)
          throw new Error(`${label} : dates désaccordées`);
        return {
          at: r.at,
          p: r.p.map((x, i) => x - b.rows[k].p[i]),
          v: r.v.map((x, i) => x - b.rows[k].v[i]),
        };
      }),
    };
  }

  return { relative };
}

/** Constante de la gravitation, km³ kg⁻¹ s⁻² (CODATA 2018). */
export const G_KM3 = 6.6743e-20;

export const norm = (u) => Math.hypot(...u);

/** Énergie orbitale spécifique, km²/s², d'un état relatif au corps de masse `massKg`. */
export const specificEnergy = (row, massKg) => {
  const speed = norm(row.v);
  return (speed * speed) / 2 - (G_KM3 * massKg) / norm(row.p);
};
