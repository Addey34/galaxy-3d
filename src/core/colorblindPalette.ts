/**
 * Palette daltonienne pour les couleurs d'orbite/accent (consommée par `ui/bodyAccent.ts`).
 * La palette de base du catalogue (`orbitalColor`) a été choisie pour son réalisme visuel, pas
 * pour la distinguabilité en daltonisme — plusieurs paires (ex. teintes rouge/orange proches
 * entre certains corps) sont confondables en deutéranopie/protanopie, les deux formes les plus
 * courantes.
 *
 * Stratégie à deux niveaux :
 * - Les 8 planètes, le cas le plus visible simultanément (vue d'ensemble Éducatif, tableau de
 *   réglages), ont chacune une teinte dédiée de la palette catégorielle Okabe-Ito (Okabe & Ito,
 *   2008) — réputée sûre pour les trois formes courantes de daltonisme.
 * - Tout le reste du catalogue (lunes, naines, petits corps) reprojette sa teinte d'origine sur
 *   la teinte Okabe-Ito la plus proche, saturation et luminosité inchangées : une lune garde son
 *   regroupement visuel avec sa planète (déjà peu distinctif à dessein) sans jamais retomber sur
 *   une paire rouge/vert confondable. Limite assumée : au-delà des 8 planètes, deux corps sans
 *   lien peuvent retomber sur la même teinte Okabe-Ito — strictement meilleur que la situation
 *   actuelle (aucune garantie), mais pas une distinction garantie corps-à-corps.
 */

const OKABE_ITO_HUES: readonly number[] = [
  0x56b4e9, // bleu ciel
  0xe69f00, // orange
  0x009e73, // vert bleuté
  0xf0e442, // jaune
  0x0072b2, // bleu
  0xd55e00, // vermillon
  0xcc79a7, // pourpre rougeâtre
];

/** Assignation fixe pour les 8 planètes (clé = nom de corps en minuscules). */
const PLANET_COLORBLIND_COLORS: Readonly<Record<string, number>> = {
  mercury: 0x56b4e9,
  venus: 0xe69f00,
  earth: 0x0072b2,
  mars: 0xd55e00,
  jupiter: 0xf0e442,
  saturn: 0xcc79a7,
  uranus: 0x009e73,
  // Variante plus sombre du bleu de la Terre : Neptune reste distincte par luminosité plutôt
  // que par teinte (les 7 teintes Okabe-Ito hors noir sont déjà toutes prises).
  neptune: 0x0b4c6b,
};

function rgbToHsl(hex: number): [h: number, s: number, l: number] {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): number {
  if (s === 0) {
    const v = Math.round(l * 255);
    return (v << 16) | (v << 8) | v;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, h) * 255);
  const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);
  return (r << 16) | (g << 8) | b;
}

function circularDistanceDeg(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 360 - diff);
}

/** Teinte Okabe-Ito (0..1) la plus proche de `hue01` (0..1, cercle chromatique). */
function nearestSafeHue(hue01: number): number {
  const targetDeg = hue01 * 360;
  let best = OKABE_ITO_HUES[0];
  let bestDist = Infinity;
  for (const safeHex of OKABE_ITO_HUES) {
    const [safeHue] = rgbToHsl(safeHex);
    const dist = circularDistanceDeg(targetDeg, safeHue * 360);
    if (dist < bestDist) {
      bestDist = dist;
      best = safeHex;
    }
  }
  return rgbToHsl(best)[0];
}

/**
 * Renvoie une teinte colorblind-safe pour un corps donné. `bodyName` bénéficie de
 * l'assignation planète dédiée si applicable (insensible à la casse) ; sinon la teinte
 * d'origine (`originalHex`) est reprojetée sur la teinte Okabe-Ito la plus proche, saturation
 * et luminosité conservées.
 */
export function colorblindSafeColor(
  originalHex: number,
  bodyName?: string
): number {
  const fixed = bodyName
    ? PLANET_COLORBLIND_COLORS[bodyName.toLowerCase()]
    : undefined;
  if (fixed !== undefined) return fixed;

  const [, s, l] = rgbToHsl(originalHex);
  // Corps quasi neutre (gris/beige peu saturé) : aucune teinte à confondre — remapper
  // injecterait une couleur parasite sans bénéfice.
  if (s < 0.08) return originalHex;

  const [hue01] = rgbToHsl(originalHex);
  return hslToRgb(nearestSafeHue(hue01), s, l);
}
