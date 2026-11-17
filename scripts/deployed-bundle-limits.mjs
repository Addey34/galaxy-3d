/* global process */
/**
 * Les limites de `check-deployed-bundle.mjs`, dans un module a part pour qu'un TEST puisse les
 * lire : l'enveloppe de l'etape CI (`timeout-minutes` de « Verify production serves this build »)
 * doit rester au-dessus du PIRE cumul permis par ces valeurs, et seul un module importable permet
 * de le confronter a `ci.yml` sans recopier un nombre.
 */

export const DEFAULT_ATTEMPTS = 6;
export const DEFAULT_DELAY_MS = 10_000;
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

/** Requetes HEAD des assets a nom stable, apres la vignette (voir `assertStableAssetsRevalidate`). */
export const STABLE_ASSET_REQUESTS = 2;

const BOUNDS = {
  ATTEMPTS: { min: 1, max: 20, fallback: DEFAULT_ATTEMPTS, unit: '' },
  DELAY_MS: { min: 0, max: 60_000, fallback: DEFAULT_DELAY_MS, unit: ' ms' },
  FETCH_TIMEOUT_MS: {
    min: 50,
    max: 120_000,
    fallback: DEFAULT_FETCH_TIMEOUT_MS,
    unit: ' ms',
  },
};

/**
 * Lit les trois reglages dans l'environnement. Une valeur presente mais invalide (vide, non
 * entiere, hors bornes) LEVE : un « Number("abc") » silencieux donnait NaN, donc une boucle qui ne
 * tournait jamais ou un delai ignore, et la verification passait pour ce qu'elle n'etait pas.
 */
export function readLimits(env = process.env) {
  const out = {};
  const problems = [];
  for (const [name, { min, max, fallback, unit }] of Object.entries(BOUNDS)) {
    const raw = env[name];
    if (raw === undefined) {
      out[name] = fallback;
      continue;
    }
    if (!/^\d+$/.test(raw.trim())) {
      problems.push(`${name}="${raw}" n'est pas un entier positif`);
      continue;
    }
    const value = Number(raw.trim());
    if (value < min || value > max) {
      problems.push(
        `${name}=${value} hors bornes (${min} a ${max}${unit} attendus)`
      );
      continue;
    }
    out[name] = value;
  }
  if (problems.length > 0) throw new RangeError(problems.join('; '));
  return {
    attempts: out.ATTEMPTS,
    delayMs: out.DELAY_MS,
    timeoutMs: out.FETCH_TIMEOUT_MS,
  };
}

/**
 * Duree maximale du script : chaque tentative peut consommer tout son delai, les pauses ne
 * viennent qu'ENTRE deux tentatives, puis la vignette et les assets stables ont chacun le leur.
 */
export function worstCaseMs({ attempts, delayMs, timeoutMs }) {
  return (
    attempts * timeoutMs +
    (attempts - 1) * delayMs +
    (1 + STABLE_ASSET_REQUESTS) * timeoutMs
  );
}
