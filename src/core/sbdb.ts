/**
 * Client du JPL Small-Body Database Query API — source de masse des petits corps.
 *
 * L'API renvoie des éléments orbitaux osculateurs pour des milliers d'astéroïdes/comètes.
 * Le parsing (fonction pure `parseSbdbRows`) est séparé du réseau (`fetchSmallBodies`) pour
 * rester testable hors ligne. Les corps ainsi chargés alimentent la couche instrument 2D
 * (`SmallBodyField`) — jamais des meshes : leur taille physique réelle resterait invisible,
 * conformément à l'invariant du mode Exploration.
 *
 * Réf. : https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html
 */
import type { OrbitalElements } from './kepler';

/** Un petit corps chargé depuis SBDB : nom lisible + éléments orbitaux. */
export interface ParsedSmallBody {
  name: string;
  elements: OrbitalElements;
}

const D2R = Math.PI / 180;

/** Convertit une date julienne (JD, TDB≈UTC à cette précision) en Date JavaScript. */
export function julianDateToDate(jd: number): Date {
  // JD 2440587.5 = 1970-01-01T00:00:00Z (epoch Unix).
  return new Date((jd - 2_440_587.5) * 86_400_000);
}

/** Champs SBDB requis pour propager une orbite képlérienne. */
const REQUIRED_FIELDS = ['a', 'e', 'i', 'om', 'w', 'ma', 'epoch'] as const;

/**
 * Convertit la réponse tabulaire SBDB (`fields` + `data`) en corps exploitables.
 * Robuste : ignore silencieusement les lignes aux éléments manquants/non finis ou
 * non elliptiques (a ≤ 0, e ≥ 1), et renvoie `[]` si un champ requis est absent.
 *
 * Unités SBDB : a en UA ; i, om (Ω), w (ω), ma (M) en degrés ; epoch en JD.
 */
export function parseSbdbRows(
  fields: string[],
  data: string[][]
): ParsedSmallBody[] {
  const idx = (name: string): number => fields.indexOf(name);
  const cols = Object.fromEntries(
    REQUIRED_FIELDS.map((f) => [f, idx(f)])
  ) as Record<(typeof REQUIRED_FIELDS)[number], number>;
  if (Object.values(cols).some((i) => i < 0)) return [];

  const nameCol = idx('full_name') >= 0 ? idx('full_name') : idx('name');
  const out: ParsedSmallBody[] = [];

  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    const a = Number(row[cols.a]);
    const e = Number(row[cols.e]);
    const i = Number(row[cols.i]);
    const om = Number(row[cols.om]);
    const w = Number(row[cols.w]);
    const ma = Number(row[cols.ma]);
    const epochJd = Number(row[cols.epoch]);

    if (![a, e, i, om, w, ma, epochJd].every(Number.isFinite)) continue;
    if (a <= 0 || e >= 1) continue; // orbites elliptiques uniquement

    const rawName = nameCol >= 0 ? row[nameCol] : `sb-${r}`;
    out.push({
      name: (rawName ?? `sb-${r}`).trim(),
      elements: {
        semiMajorAxisAU: a,
        eccentricity: e,
        inclinationRad: i * D2R,
        ascendingNodeRad: om * D2R,
        argPerihelionRad: w * D2R,
        meanAnomalyAtEpochRad: ma * D2R,
        epoch: julianDateToDate(epochJd),
      },
    });
  }
  return out;
}

/** URL de requête SBDB par défaut : astéroïdes numérotés, éléments osculateurs. */
export function sbdbQueryUrl(limit = 2000): string {
  const params = new URLSearchParams({
    fields: 'full_name,a,e,i,om,w,ma,epoch',
    'sb-kind': 'a', // a = astéroïdes
    'sb-cdata': '{"AND":["a|LT|4.5"]}', // ceinture principale interne — limite le volume
    limit: String(limit),
  });
  return `https://ssd-api.jpl.nasa.gov/sbdb_query.api?${params.toString()}`;
}

/**
 * Récupère un lot de petits corps depuis SBDB. Dégradation propre : toute erreur réseau
 * ou réponse malformée renvoie `[]` (l'application fonctionne sans le champ de masse).
 */
export async function fetchSmallBodies(
  url = sbdbQueryUrl(),
  fetchImpl: typeof fetch = fetch
): Promise<ParsedSmallBody[]> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return [];
    const json = (await res.json()) as { fields?: string[]; data?: string[][] };
    if (!json.fields || !json.data) return [];
    return parseSbdbRows(json.fields, json.data);
  } catch {
    return [];
  }
}
