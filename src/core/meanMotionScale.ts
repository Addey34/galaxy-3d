/**
 * FACTEUR D'ÉCHELLE DU TEMPS DE PROPAGATION, et pourquoi il ne peut pas se calculer sur une
 * fenêtre.
 *
 * Autour d'une planète aplatie (J2), l'état osculateur surestime le demi-grand axe, donc la
 * période : la conique propagée parcourt la bonne ellipse au mauvais rythme (Mimas : 5 355 ppm,
 * environ 4 degrés de phase au milieu d'un intervalle de 4 jours). On la fait avancer au rythme
 * moyen sans toucher à sa géométrie, par un facteur CONSTANT : la MÉDIANE, sur tout le fichier,
 * du rapport période osculatrice sur période sidérale du catalogue. Le rapport état par état
 * corrige aussi le bruit à courte période et dégradait tout le monde, d'où la médiane.
 *
 * Ce module n'existe que parce que ce facteur est une propriété du FICHIER ENTIER : il
 * échantillonne de l'index 0 à l'index `count - 1`. Un service qui ne tient qu'une fenêtre en
 * calculerait un autre, et placerait donc le corps ailleurs — mesuré sur Encelade au 2026-09-23,
 * en construisant le même service sur sa fenêtre et sur son fichier : **27 mètres d'écart**,
 * silencieux. C'est la décision D5 du plan `docs/private/EPHEMERIDES_LOT17.md` : le facteur est
 * calculé une fois hors ligne et PUBLIÉ au manifeste, pour que le lecteur n'ait plus besoin du
 * fichier entier.
 *
 * La formule vit ici, et ici seulement : le service la lit, le script qui remplit le manifeste
 * la lit, et le test qui confronte le manifeste au binaire la lit. Trois copies auraient dérivé.
 */

/** Composantes d'un état : position puis vitesse. */
const COMPONENTS_PER_SAMPLE = 6;

/**
 * Nombre d'états prélevés pour la médiane, répartis de l'index 0 à l'index `count - 1`.
 * 257 plutôt qu'un nombre rond : 256 intervalles, donc les deux extrémités du fichier sont
 * prélevées exactement.
 */
export const MEAN_MOTION_SAMPLE_COUNT = 257;

/**
 * Médiane du rapport « période osculatrice du fichier / période sidérale du catalogue ».
 *
 * `samples` est la série `[x,y,z,vx,vy,vz]` du fichier ENTIER, en UA et UA/jour ; `mu` le
 * paramètre gravitationnel qui gouverne ce corps (UA³/jour²) ; `periodDays` sa période
 * publiée. Rend `1` quand aucun état lié ne se présente, c'est-à-dire quand il n'y a rien à
 * corriger.
 */
export function medianMeanMotionScale(
  samples: Float64Array | Float32Array | readonly number[],
  sampleCount: number,
  mu: number,
  periodDays: number
): number {
  const ratios: number[] = [];
  const last = sampleCount - 1;
  for (let k = 0; k < MEAN_MOTION_SAMPLE_COUNT; k++) {
    const i =
      Math.floor((k * last) / (MEAN_MOTION_SAMPLE_COUNT - 1)) *
      COMPONENTS_PER_SAMPLE;
    const rx = samples[i];
    const ry = samples[i + 1];
    const rz = samples[i + 2];
    const vx = samples[i + 3];
    const vy = samples[i + 4];
    const vz = samples[i + 5];
    const r = Math.sqrt(rx * rx + ry * ry + rz * rz);
    const energy = (vx * vx + vy * vy + vz * vz) / 2 - mu / r;
    // Un état non lié n'a pas de demi-grand axe : il ne dit rien du rythme moyen.
    if (!(energy < 0)) continue;
    const a = -mu / (2 * energy);
    ratios.push((2 * Math.PI * Math.sqrt((a * a * a) / mu)) / periodDays);
  }
  if (ratios.length === 0) return 1;
  ratios.sort((x, y) => x - y);
  return ratios[Math.floor(ratios.length / 2)];
}
