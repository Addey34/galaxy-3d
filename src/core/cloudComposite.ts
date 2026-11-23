/**
 * COMBLER LES TROUS DE FAUCHÉE D'UNE IMAGE MODIS PAR L'AUTRE INSTRUMENT MODIS (GAL-CLOUD-VISUAL-001).
 *
 * Module PUR : il travaille sur des tableaux RGBA, jamais sur le DOM. Il vit dans un morceau chargé
 * à la demande (`ui/cloudComplement`) : le démarrage ne le porte pas.
 *
 * LE DÉFAUT. Une image « True Color » MODIS du jour est une mosaïque de fauchées orbitales. Entre deux
 * fauchées, au voisinage de l'équateur, il reste des COINS NOIRS sans aucune donnée (mesuré le
 * 2026-11-21 : 4,43 % de la bande |latitude| ≤ 60° pour Terra, 11,48 % pour Aqua). Mappée sur la
 * sphère, chaque coin devient une fente rectiligne sans nuage qui coupe le champ nuageux sur
 * plusieurs milliers de kilomètres. VIIRS, qui n'en a presque pas, ne publie plus rien depuis le
 * 2026-11-03 (images noires de 3 356 octets ; le 2026-11-02 l'image est partielle) : la chaîne
 * retombe sur MODIS, et le défaut se voit.
 *
 * LA CORRECTION, ET CE QU'ELLE N'EST PAS. Terra et Aqua ont des fauchées décalées : mesuré le même
 * jour, 76 % des pixels sans donnée de Terra sont observés par Aqua. On les remplace par ces pixels
 * observés. C'est de l'OBSERVATION RÉELLE d'un autre instrument du même jour (qui passe à une autre
 * heure : au raccord, les nuages ne sont pas exactement ceux de l'image principale), pas une
 * invention et pas un modèle : un pixel que les deux instruments n'ont pas vu reste sans donnée
 * (1,07 % de la même bande), et le moteur le traite comme avant.
 */

/** Réglages du comblement (valeurs de `REALTIME_CLOUDS_SETTINGS`). */
export interface CompositeOptions {
  /**
   * Un pixel est SANS DONNÉE quand son plus grand canal (octet sRGB) est au plus cette valeur.
   * Mesuré sur GIBS : l'absence de donnée tient à 0-3, l'océan observé commence vers 24.
   */
  noDataMax: number;
  /**
   * Largeur (pixels) dont on agrandit le trou, et dont on éloigne le complément de son propre bord.
   * Le bord d'une fauchée est une frange sombre de compression (ni noire ni observée) : sans cela,
   * elle resterait autour du comblement, ou serait collée dedans.
   */
  growPx: number;
  /** Rayon (pixels) du fondu entre l'image et son complément, pour que le raccord ne se lise pas. */
  featherPx: number;
}

export interface CompositeResult {
  /** L'image comblée (nouvelle, l'entrée n'est jamais modifiée). */
  rgba: Uint8ClampedArray;
  /** Pixels sans donnée dans l'image principale. */
  primaryMissing: number;
  /** Parmi eux, ceux que le complément observe et qui ont été remplacés. */
  filled: number;
  /** Pixels que NI l'un NI l'autre n'ont observés : ils restent sans donnée. */
  stillMissing: number;
}

/** Les deux instruments MODIS qui se complètent (couches GIBS « Corrected Reflectance True Color »). */
const SIBLINGS: Record<string, string> = {
  MODIS_Terra_CorrectedReflectance_TrueColor:
    'MODIS_Aqua_CorrectedReflectance_TrueColor',
  MODIS_Aqua_CorrectedReflectance_TrueColor:
    'MODIS_Terra_CorrectedReflectance_TrueColor',
};

/**
 * L'adresse du MÊME jour et de la MÊME taille pour l'autre instrument MODIS, ou `null` quand l'image
 * n'est pas MODIS (VIIRS n'a pas de frère : il garde son comportement). Seule la couche change.
 */
export function modisSiblingUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const sibling = SIBLINGS[parsed.searchParams.get('LAYERS') ?? ''];
  if (!sibling) return null;
  parsed.searchParams.set('LAYERS', sibling);
  return parsed.toString();
}

/** Le nom court d'une couche MODIS, pour le badge de traçabilité (« MODIS Aqua »). */
export function modisLabelOf(url: string): string | null {
  try {
    const layer = new URL(url).searchParams.get('LAYERS') ?? '';
    const match = /^MODIS_(Terra|Aqua)_/.exec(layer);
    return match ? `MODIS ${match[1]}` : null;
  } catch {
    return null;
  }
}

/** 1 là où le pixel n'a pas de donnée. */
function missingMask(
  rgba: Uint8ClampedArray,
  count: number,
  noDataMax: number
): Uint8Array {
  const mask = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const brightest = Math.max(rgba[o]!, rgba[o + 1]!, rgba[o + 2]!);
    if (brightest <= noDataMax) mask[i] = 1;
  }
  return mask;
}

/**
 * Agrandit un masque de `radius` pixels, en O(pixels) par SOMMES GLISSANTES (la fenêtre avance d'un
 * pixel : on ajoute celui qui entre, on retire celui qui sort). La LONGITUDE s'enroule (l'image fait
 * le tour du globe), la latitude non. L'ancienne version re-balayait la fenêtre à chaque pixel :
 * 133 ms sur un ordinateur, 635 ms sous un frein CPU de 4 (un téléphone), d'un seul bloc.
 */
function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  if (radius <= 0) return mask;
  // Horizontal : somme glissante sur la fenêtre [x - radius, x + radius], enroulée.
  const across = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let d = -radius; d <= radius; d++)
      sum += mask[row + (((d % width) + width) % width)]!;
    for (let x = 0; x < width; x++) {
      across[row + x] = sum > 0 ? 1 : 0;
      sum += mask[row + ((x + radius + 1) % width)]!;
      sum -= mask[row + ((((x - radius) % width) + width) % width)]!;
    }
  }
  // Vertical : un compteur par colonne sur les rangées [y - radius, y + radius], bornées.
  const out = new Uint8Array(mask.length);
  const counts = new Int32Array(width);
  for (let y = 0; y <= Math.min(height - 1, radius); y++)
    for (let x = 0; x < width; x++) counts[x]! += across[y * width + x]!;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) out[row + x] = counts[x]! > 0 ? 1 : 0;
    const enter = y + radius + 1;
    const leave = y - radius;
    if (enter < height)
      for (let x = 0; x < width; x++) counts[x]! += across[enter * width + x]!;
    if (leave >= 0)
      for (let x = 0; x < width; x++) counts[x]! -= across[leave * width + x]!;
  }
  return out;
}

/** Flou de boîte d'un champ de poids 0..1 (longitude enroulée), en O(pixels) par sommes glissantes. */
function feather(
  weight: Float32Array,
  width: number,
  height: number,
  radius: number
): Float32Array {
  if (radius <= 0) return weight;
  const size = 2 * radius + 1;
  const across = new Float32Array(weight.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let d = -radius; d <= radius; d++)
      sum += weight[row + (((d % width) + width) % width)]!;
    for (let x = 0; x < width; x++) {
      across[row + x] = sum / size;
      sum += weight[row + ((x + radius + 1) % width)]!;
      sum -= weight[row + ((((x - radius) % width) + width) % width)]!;
    }
  }
  // Vertical : les bords sont PROLONGÉS (la rangée extrême compte pour les rangées absentes).
  const out = new Float32Array(weight.length);
  const sums = new Float32Array(width);
  const at = (yy: number): number => Math.min(height - 1, Math.max(0, yy));
  for (let d = -radius; d <= radius; d++)
    for (let x = 0; x < width; x++) sums[x]! += across[at(d) * width + x]!;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) out[row + x] = sums[x]! / size;
    const enter = at(y + radius + 1) * width;
    const leave = at(y - radius) * width;
    for (let x = 0; x < width; x++)
      sums[x]! += across[enter + x]! - across[leave + x]!;
  }
  return out;
}

/**
 * Remplace, dans `primary`, les pixels sans donnée par ceux de `complement` quand celui-ci les a
 * observés. Les deux images ont la MÊME taille (même requête, autre couche) : sinon `primary` est
 * rendue telle quelle, sans comblement.
 */
export function compositeObserved(
  primary: Uint8ClampedArray,
  complement: Uint8ClampedArray,
  width: number,
  height: number,
  options: CompositeOptions
): CompositeResult {
  const count = width * height;
  const out = new Uint8ClampedArray(primary);
  if (primary.length !== count * 4 || complement.length !== count * 4) {
    return {
      rgba: out,
      primaryMissing: 0,
      filled: 0,
      stillMissing: 0,
    };
  }
  const missingPrimary = missingMask(primary, count, options.noDataMax);
  let primaryMissing = 0;
  for (let i = 0; i < count; i++) primaryMissing += missingPrimary[i]!;
  if (primaryMissing === 0)
    return { rgba: out, primaryMissing: 0, filled: 0, stillMissing: 0 };

  const missingComplement = missingMask(complement, count, options.noDataMax);
  // Le trou est agrandi (sa frange sombre compte avec lui) ; le complément est écarté de son propre bord.
  const hole = dilate(missingPrimary, width, height, options.growPx);
  const edgeOfComplement = dilate(
    missingComplement,
    width,
    height,
    options.growPx
  );

  const weight = new Float32Array(count);
  for (let i = 0; i < count; i++)
    if (hole[i] && !edgeOfComplement[i]) weight[i] = 1;
  const soft = feather(weight, width, height, options.featherPx);
  // `filled` compte les pixels sans donnée EFFECTIVEMENT remplacés (poids appliqué > 0), pas ceux qui
  // auraient pu l'être : un comblement qui n'a pas eu lieu ne doit jamais se déclarer fait.
  let filled = 0;
  for (let i = 0; i < count; i++) {
    // Jamais de complément là où il n'a pas observé, même dans le fondu : on y mélangerait du noir.
    const w = edgeOfComplement[i] ? 0 : soft[i]!;
    if (w <= 0) continue;
    if (missingPrimary[i]) filled++;
    const o = i * 4;
    for (let c = 0; c < 3; c++)
      out[o + c] = primary[o + c]! * (1 - w) + complement[o + c]! * w;
  }
  return {
    rgba: out,
    primaryMissing,
    filled,
    stillMissing: primaryMissing - filled,
  };
}
