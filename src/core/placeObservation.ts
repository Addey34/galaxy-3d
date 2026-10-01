/**
 * QUELLES OBSERVATIONS ONT VU CETTE FORMATION : la part PURE (ligne 40.3).
 *
 * Les empreintes viennent de l'Orbital Data Explorer (`scripts/pull-ode-footprints.mjs`), les
 * formations du Gazetteer of Planetary Nomenclature de l'UAI (lot 37). Les deux publient la même
 * convention, lue dans leurs documents et non supposée : latitude PLANÉTOCENTRIQUE, longitude
 * EST de 0 à 360 (manuel REST de l'ODE § 3.1, page des téléchargements de l'UAI). Aucune
 * conversion n'est donc appliquée, et c'est écrit ici pour que personne n'en ajoute une.
 *
 * Ce module ne connaît ni le réseau ni le disque : le générateur lui passe des anneaux et des
 * formations, il rend un verdict.
 */

/** Un anneau d'empreinte : des sommets `[longitude est 0-360, latitude]`, en degrés. */
export type Ring = ReadonlyArray<readonly [number, number]>;

/** Ce que le croisement lit d'une formation. */
export interface PlaceDisc {
  readonly lat: number;
  /** Longitude EST, 0 à 360. */
  readonly lon: number;
  readonly diameterKm: number;
}

const RAD = Math.PI / 180;

/** Distance angulaire entre deux points, en radians. */
export function angularDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const a =
    Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 +
    Math.cos(lat1 * RAD) *
      Math.cos(lat2 * RAD) *
      Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Projection AZIMUTALE ÉQUIDISTANTE centrée sur la formation, en kilomètres : la distance au
 * centre y est EXACTE, ce qui est la seule grandeur que le test compare au rayon. Une projection
 * équirectangulaire locale serait fausse près des pôles, où l'ODE a justement beaucoup de
 * produits (ShadowCam n'observe que les régions en ombre permanente).
 */
export function projectAround(
  centre: PlaceDisc,
  lat: number,
  lon: number,
  radiusKm: number
): [number, number] {
  const c = angularDistance(centre.lat, centre.lon, lat, lon);
  if (c === 0) return [0, 0];
  const phi0 = centre.lat * RAD;
  const phi = lat * RAD;
  const dLon = (lon - centre.lon) * RAD;
  const bearing = Math.atan2(
    Math.sin(dLon) * Math.cos(phi),
    Math.cos(phi0) * Math.sin(phi) -
      Math.sin(phi0) * Math.cos(phi) * Math.cos(dLon)
  );
  const d = c * radiusKm;
  return [d * Math.sin(bearing), d * Math.cos(bearing)];
}

/** Point dans un polygone plan (règle pair-impair). */
function insidePlane(
  x: number,
  y: number,
  pts: ReadonlyArray<readonly [number, number]>
): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/**
 * UN INDEX DE SEGMENTS pour les grandes formes. Mesuré le 2026-10-01 : une carte micro-onde de
 * Chang'e porte 1 014 sommets et touche 8 838 formations candidates, et tester chacune en parcourant
 * TOUS les sommets coûtait 600 ms par produit, donc une cinquantaine d'heures pour la Lune. L'index
 * ne change PAS le test : il ne fait que choisir les segments qui PEUVENT y répondre, et une garde
 * compare ses verdicts à ceux du parcours complet sur des formes tirées au hasard.
 */
let indexMinVertices = 64;

/**
 * POUR LES TESTS SEULEMENT : exécute `fn` sans index, par le parcours complet. C'est ce qui permet
 * à la garde de comparer les deux chemins sur les mêmes formes.
 */
export function withoutIndex<T>(fn: () => T): T {
  const saved = indexMinVertices;
  indexMinVertices = Number.POSITIVE_INFINITY;
  try {
    return fn();
  } finally {
    indexMinVertices = saved;
  }
}

interface RingIndex {
  /** Rangée de latitude entière → segments dont l'étendue en latitude la couvre. */
  readonly rows: Map<number, number[]>;
  /** Cellule de 1° (rangée × 360 + colonne) → segments dont la boîte, élargie d'une cellule, la couvre. */
  readonly cells: Map<number, number[]>;
}

const indexes = new WeakMap<Ring, RingIndex>();

function bucket(
  map: Map<number, number[]>,
  key: number,
  segment: number
): void {
  const a = map.get(key);
  if (a) {
    if (a[a.length - 1] !== segment) a.push(segment);
  } else map.set(key, [segment]);
}

/** L'index d'une forme, construit une fois ; `null` pour une forme assez petite pour le parcours complet. */
function indexOf(shape: Ring): RingIndex | null {
  if (shape.length < indexMinVertices) return null;
  const cached = indexes.get(shape);
  if (cached) return cached;
  const rows = new Map<number, number[]>();
  const cells = new Map<number, number[]>();
  const n = shape.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = shape[i];
    const [x2, y2] = shape[(i + 1) % n];
    const r0 = Math.floor(Math.min(y1, y2));
    const r1 = Math.floor(Math.max(y1, y2));
    for (let r = r0; r <= r1; r++) bucket(rows, r, i);
    // La boîte du segment, élargie d'UNE cellule : le segment PROJETÉ autour d'une formation n'est
    // pas exactement le segment droit en longitude-latitude, et la marge absorbe l'écart.
    const lo = Math.min(x1, x2);
    const hi = Math.max(x1, x2);
    const ranges: Array<[number, number]> =
      hi - lo > 180
        ? [
            [hi, 360],
            [0, lo],
          ]
        : [[lo, hi]];
    for (let r = Math.max(-91, r0 - 1); r <= Math.min(90, r1 + 1); r++)
      for (const [a, b] of ranges)
        for (let c = Math.floor(a) - 1; c <= Math.floor(b) + 1; c++)
          bucket(cells, r * 360 + (((c % 360) + 360) % 360), i);
  }
  const index = { rows, cells };
  indexes.set(shape, index);
  return index;
}

/** Point dans un polygone plan, par l'index : seuls les segments de la rangée du point comptent. */
function insidePlaneIndexed(
  x: number,
  y: number,
  pts: Ring,
  index: RingIndex
): boolean {
  const segs = index.rows.get(Math.floor(y));
  if (!segs) return false;
  const n = pts.length;
  let inside = false;
  for (const i of segs) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[(i + 1) % n];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/**
 * UN ANNEAU QUI TRAVERSE LE MÉRIDIEN 0 EST DÉROULÉ avant d'être lu dans le plan. J'avais écrit ici
 * que les anneaux du fichier `ga` de l'ODE ne le traversent jamais, parce que c'était vrai chez
 * ShadowCam (43 532 enregistrements pour 38 464 produits, tous découpés) : c'était FAUX pour la
 * caméra HDTV de Kaguya, dont un anneau va de 348° à 353° puis à 5°. Lu tel quel dans le plan, ce
 * petit triangle de 17° devient un triangle qui couvre presque toutes les longitudes : il
 * « contenait » Copernic (faux positifs, 3 489 produits là où la boîte de l'ODE en rend 2 433) et
 * l'antipode de Tycho (faux « globaux », donc des observations PERDUES). Mesuré le 2026-10-01 par le
 * contrôle des bornes de l'ODE, qui a vu les deux défauts en même temps.
 *
 * Un anneau est dit traversant si un de ses côtés saute de plus de 180° en longitude ; ses
 * longitudes sont alors rendues CONTINUES, et le point est testé à x et à x ± 360.
 */
const unwrapped = new WeakMap<Ring, Ring>();

function planar(ring: Ring): Ring {
  const cached = unwrapped.get(ring);
  if (cached) return cached;
  // Un côté de 359,5° ou plus n'est PAS une traversée : c'est un tour complet, que les grilles
  // globales (`[0, 360]`) et les bandes polaires portent pour dire exactement cela.
  let crosses = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const jump = Math.abs(ring[i][0] - ring[j][0]);
    if (jump > 180 && jump < 359.5) {
      crosses = true;
      break;
    }
  }
  let out: Ring = ring;
  if (crosses) {
    const pts: [number, number][] = [[ring[0][0], ring[0][1]]];
    for (let i = 1; i < ring.length; i++) {
      let x = ring[i][0];
      const prev = pts[i - 1][0];
      while (x - prev > 180) x -= 360;
      while (prev - x > 180) x += 360;
      pts.push([x, ring[i][1]]);
    }
    // Le déroulé n'est retenu que s'il est plus ÉTROIT que l'original : c'est ce qui distingue un
    // petit anneau à cheval sur la couture (17° au lieu de 343°) d'un vrai grand anneau.
    const extent = (r: Ring) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const [x] of r) {
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
      return hi - lo;
    };
    if (extent(pts) < extent(ring)) out = pts;
  }
  unwrapped.set(ring, out);
  return out;
}

export function ringContainsPoint(
  ring: Ring,
  lat: number,
  lon: number
): boolean {
  // SUR LA COUTURE, les deux côtés. Le gazetteer publie des formations EXACTEMENT à 360° (Cydonia,
  // Chalce… six sur Mars), et un anneau découpé au méridien s'arrête sur cette même valeur : le
  // test pair-impair n'y tranche pas, et ces six formations sortaient « jamais observées ».
  const x = ((lon % 360) + 360) % 360;
  const flat = planar(ring);
  // L'index ne range les segments que par LATITUDE pour ce test : il vaut donc pour l'anneau
  // déroulé comme pour l'original, segment pour segment.
  const index = indexOf(ring);
  const test = (px: number): boolean =>
    index
      ? insidePlaneIndexed(px, lat, flat, index)
      : insidePlane(px, lat, flat);
  const inside = (px: number): boolean =>
    flat === ring ? test(px) : test(px) || test(px + 360) || test(px - 360);
  if (x === 0) return inside(1e-9) || inside(360 - 1e-9);
  return inside(x);
}

/** Distance du point origine au segment AB, dans le plan. */
function distanceToSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/**
 * Au-delà de ce rayon angulaire autour de la formation, la projection n'est plus un test fiable :
 * un SEGMENT dont une extrémité est aussi loin est ignoré. Les anneaux et les traces de l'ODE sont
 * échantillonnés finement (jusqu'à 373 sommets par anneau chez ShadowCam), donc un segment qui
 * passe près de la formation a ses deux extrémités dans ce rayon.
 */
const LOCAL_LIMIT = 60 * RAD;

/** Les segments indexés dont une cellule touche la boîte du disque de la formation. */
function nearSegments(
  index: RingIndex,
  place: PlaceDisc,
  rAngle: number
): number[] {
  const rDeg = rAngle / RAD + 1e-6;
  const lat0 = Math.floor(place.lat - rDeg);
  const lat1 = Math.floor(place.lat + rDeg);
  const maxLat = Math.min(
    89.999,
    Math.max(Math.abs(place.lat - rDeg), Math.abs(place.lat + rDeg))
  );
  const dLon = rDeg / Math.cos(maxLat * RAD);
  const all = Math.abs(place.lat) + rDeg >= 89 || dLon >= 180;
  const out = new Set<number>();
  for (let r = Math.max(-91, lat0); r <= Math.min(90, lat1); r++) {
    const c0 = all ? 0 : Math.floor(place.lon - dLon);
    const c1 = all ? 359 : Math.floor(place.lon + dLon);
    for (let c = c0; c <= c1; c++) {
      const segs = index.cells.get(r * 360 + (((c % 360) + 360) % 360));
      if (segs) for (const s of segs) out.add(s);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Un bord de la forme passe-t-il à moins de `r` km du centre de la formation ? */
function edgeWithin(
  shape: Ring,
  place: PlaceDisc,
  r: number,
  bodyRadiusKm: number,
  closed: boolean
): boolean {
  const rAngle = r / bodyRadiusKm;
  const last = closed ? shape.length : shape.length - 1;
  const index = indexOf(shape);
  const segments = index ? nearSegments(index, place, rAngle) : null;
  const d = new Map<number, number>();
  const dist = (k: number): number => {
    let v = d.get(k);
    if (v === undefined) {
      v = angularDistance(place.lat, place.lon, shape[k][1], shape[k][0]);
      d.set(k, v);
    }
    return v;
  };
  const order = segments ?? Array.from({ length: last }, (_, k) => k);
  for (const i of order) {
    if (i >= last) continue;
    const j = (i + 1) % shape.length;
    const di = dist(i);
    const dj = dist(j);
    if (di > LOCAL_LIMIT || dj > LOCAL_LIMIT) continue;
    // INÉGALITÉ TRIANGULAIRE, donc EXACTE et non une heuristique : tout point du segment est à
    // au moins max(dᵢ, dⱼ) − longueur du centre. Un segment qui ne peut pas entrer dans le disque
    // n'est pas projeté. C'est ce qui rend supportables les traces de MARSIS (976 sommets).
    const len = angularDistance(
      shape[i][1],
      shape[i][0],
      shape[j][1],
      shape[j][0]
    );
    if (Math.max(di, dj) - len > rAngle) continue;
    const a = projectAround(place, shape[i][1], shape[i][0], bodyRadiusKm);
    const b = projectAround(place, shape[j][1], shape[j][0], bodyRadiusKm);
    if (distanceToSegment(a[0], a[1], b[0], b[1]) <= r) return true;
  }
  return false;
}

/**
 * L'anneau TOUCHE-t-il le disque de la formation ? Le centre dedans, ou un bord à moins d'un
 * rayon. Une formation ponctuelle (diamètre publié nul) se réduit à son centre.
 */
export function ringTouchesPlace(
  ring: Ring,
  place: PlaceDisc,
  bodyRadiusKm: number
): boolean {
  if (ring.length < 3) return false;
  if (ringContainsPoint(ring, place.lat, place.lon)) return true;
  const r = Math.max(0, place.diameterKm / 2);
  return r > 0 && edgeWithin(ring, place, r, bodyRadiusKm, true);
}

/**
 * UNE TRACE AU SOL (les sondeurs radar comme MARSIS publient des LIGNES, fichiers `_gl`, et non
 * des surfaces) observe une formation si elle passe à moins d'un rayon de son centre. Une ligne
 * ne CONTIENT rien : la règle de parité pair-impair lui ferait dire n'importe quoi, et elle
 * n'est donc jamais appliquée ici.
 */
export function trackTouchesPlace(
  track: Ring,
  place: PlaceDisc,
  bodyRadiusKm: number
): boolean {
  if (track.length === 1) {
    const [lon, lat] = track[0];
    return (
      angularDistance(place.lat, place.lon, lat, lon) * bodyRadiusKm <=
      place.diameterKm / 2
    );
  }
  return edgeWithin(
    track,
    place,
    Math.max(0, place.diameterKm / 2),
    bodyRadiusKm,
    false
  );
}

/** L'antipode d'une formation, dans la même convention. */
export function antipode(place: PlaceDisc): { lat: number; lon: number } {
  return { lat: -place.lat, lon: (place.lon + 180) % 360 };
}

/**
 * UN PRODUIT QUI COUVRE À LA FOIS UN LIEU ET SON ANTIPODE NE L'OBSERVE PAS.
 *
 * Mesuré à Tycho : sur 37 338 « observations » que l'ODE rend pour la boîte du cratère, 30 450
 * rendent EXACTEMENT le même compte à l'antipode. Ce sont des grilles globales (les `GDR` de
 * Diviner ont une empreinte [-90, 90] × [0, 360]), qui répondent identiquement partout. La règle
 * est posée PAR PRODUIT et se dérive de sa géométrie : aucune liste de types exclus n'est tenue.
 */
export function coversAntipode(
  rings: ReadonlyArray<Ring>,
  place: PlaceDisc
): boolean {
  const a = antipode(place);
  return rings.some((ring) => ringContainsPoint(ring, a.lat, a.lon));
}

/** Verdict d'un produit pour une formation. */
export type PlaceVerdict = 'observed' | 'global' | 'none';

/**
 * La forme d'un produit, telle que l'ODE la publie : une SURFACE (`a`), une TRACE (`l`) ou des
 * POINTS (`p`). Le suffixe du fichier du shapefile le dit ; rien n'est déduit de l'instrument.
 */
export type FootprintKind = 'a' | 'l' | 'p';

export function observes(
  rings: ReadonlyArray<Ring>,
  place: PlaceDisc,
  bodyRadiusKm: number,
  kind: FootprintKind = 'a'
): PlaceVerdict {
  if (kind !== 'a') {
    // Une trace qui passe sur un lieu PUIS sur son antipode les a observés tous les deux : la
    // règle de l'antipode ne vaut que pour une SURFACE qui couvre les deux à la fois.
    return rings.some((shape) =>
      kind === 'p'
        ? shape.some((pt) => trackTouchesPlace([pt], place, bodyRadiusKm))
        : trackTouchesPlace(shape, place, bodyRadiusKm)
    )
      ? 'observed'
      : 'none';
  }
  if (!rings.some((ring) => ringTouchesPlace(ring, place, bodyRadiusKm)))
    return 'none';
  return coversAntipode(rings, place) ? 'global' : 'observed';
}

/** Les formes d'un produit, rangées par type : une même page de l'ODE peut porter les trois. */
export type FootprintShapes = Partial<
  Record<FootprintKind, ReadonlyArray<Ring>>
>;

/**
 * Le verdict d'un produit qui porte PLUSIEURS types de formes (PFS publie des surfaces ET des
 * points). Il observe la formation si l'une de ses formes l'observe ; il n'est écarté comme
 * GLOBAL que si seule sa surface la touche, et en couvrant aussi l'antipode.
 */
export function observesShapes(
  shapes: FootprintShapes,
  place: PlaceDisc,
  bodyRadiusKm: number
): PlaceVerdict {
  let global = false;
  for (const kind of ['l', 'p', 'a'] as const) {
    const rings = shapes[kind];
    if (!rings?.length) continue;
    const v = observes(rings, place, bodyRadiusKm, kind);
    if (v === 'observed') return 'observed';
    if (v === 'global') global = true;
  }
  return global ? 'global' : 'none';
}
