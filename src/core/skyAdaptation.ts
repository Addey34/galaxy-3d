/**
 * L'ŒIL ADAPTÉ AU CIEL DU LIEU (GAL-EARTH-LIGHTING-001, 2026-11-28).
 *
 * LE DÉFAUT, ET SA CAUSE. Le ciel calculé (`shaders/SkyScatteringShader.ts`, diffusion simple et table de
 * diffusion multiple de Hillaire) donne une radiance JUSTE : au zénith, depuis le sol, 0,83 du zénith de
 * référence avec le Soleil à 45°, 0,095 au coucher, 1,4·10⁻² à −3°, 3,8·10⁻⁴ à −6°, 1,9·10⁻⁶ à −12°
 * (miroir JS `zenithSkyLuminance`, table multiple comprise), dans l'ordre de grandeur des ciels réels. Mais la
 * scène est rendue à UNE exposition, fixée pour le jour : le zénith de midi y sort déjà à (34, 61, 91) sur 255,
 * donc le coucher à ~13 et tout le crépuscule à 0. Le ciel n'était pas faux ; il était montré sans l'adaptation
 * de l'œil, qui fait voir un ciel de crépuscule lumineux.
 *
 * LA RÈGLE. Le facteur de Ward (1994, « A Contrast-Based Scalefactor for Luminance Display », Graphics Gems IV,
 * VII.2) rend visibles à l'écran les écarts juste visibles dans la scène, d'après les seuils de Blackwell :
 * m = [(1,219 + L_da^0,4) / (1,219 + L_wa^0,4)]^2,5 (formule lue dans G. Matkovic, thèse TU Wien 1997, § 4.3,
 * éq. 4.16). Entre deux niveaux d'adaptation L et L_ref du monde, le terme de l'écran s'annule :
 * gain = [(1,219 + L_ref^0,4) / (1,219 + L^0,4)]^2,5.
 *  - L est la luminance du zénith AU NIVEAU DE LA MER sous la caméra, pour la hauteur du Soleil du moment :
 *    l'état lumineux du lieu (jour, crépuscule, nuit), pas celui de l'air au-dessus de la caméra (à 30 km de
 *    jour, le ciel est sombre et l'œil reste adapté au sol éclairé : rien n'y est relevé).
 *  - Les luminances absolues viennent du modèle lui-même : sa radiance est exprimée en part de l'éclairement
 *    solaire, multipliée par la constante solaire lumineuse {@link LUMINOUS_SOLAR_CONSTANT_LX} (le canal vert
 *    sert de luminance, approximation dite).
 *  - L_ref est la même luminance avec le Soleil à 45° : le gain ne descend jamais sous 1, donc un ciel de jour
 *    (Soleil plus haut) reste exactement celui d'avant.
 *  - Il s'affaiblit avec l'altitude de la caméra jusqu'à 1 au sommet de l'air ({@link altitudeWeight}) : vu de
 *    l'orbite rien ne change, et la sortie de l'air est continue.
 *
 * CE QU'IL TOUCHE, ET SEULEMENT CELA : la lumière de l'AIR, ciel et voile de perspective aérienne (un seul
 * uniforme partagé, `uSunIntensity`). Le sol éclairé, les nuages, les étoiles, la Voie lactée et les lumières
 * des villes ne sont pas relevés : une exposition globale ×500 éclairerait le sol de nuit par la lumière
 * ambiante constante et brûlerait les villes, défaut déjà mesuré dans ce dépôt (« l'éclairage et non
 * l'exposition »). C'est une APPROXIMATION d'exposition, documentée comme telle : l'œil réel adapte toute la
 * scène, et passe à la vision des bâtonnets sous ~10⁻³ cd/m², que ce modèle ne représente pas.
 */

/**
 * Constante solaire lumineuse, moyenne annuelle (lx) : Darula, Kittler & Gueymard, « Reference luminous solar
 * constant and solar luminance for illuminance calculations », Solar Energy 79 (2005) 559-565, valeur reprise
 * par Kittler & Darula (Lighting Res. Technol., 2015).
 */
export const LUMINOUS_SOLAR_CONSTANT_LX = 133_800;

/** Hauteur du Soleil (degrés) de la luminance de référence : au-dessus, aucune adaptation. */
export const ADAPTATION_REFERENCE_SUN_DEG = 45;

/** Constantes de Blackwell reprises par Ward (1994). */
const WARD_OFFSET = 1.219;
const WARD_EXPONENT = 0.4;
const WARD_POWER = 2.5;

/** Le multiplicateur de Ward entre une luminance d'adaptation `worldCdM2` et la référence `referenceCdM2`. */
export function wardGain(worldCdM2: number, referenceCdM2: number): number {
  const l = Math.max(0, worldCdM2);
  const r = Math.max(0, referenceCdM2);
  return (
    ((WARD_OFFSET + r ** WARD_EXPONENT) / (WARD_OFFSET + l ** WARD_EXPONENT)) **
    WARD_POWER
  );
}

/**
 * Poids de l'adaptation selon l'altitude de la caméra : 1 au niveau de la mer, 0 au sommet de l'air
 * (`thicknessKm` du modèle), linéaire entre les deux. Le gain appliqué vaut `gain ** poids`.
 */
export function altitudeWeight(
  altitudeKm: number,
  thicknessKm: number
): number {
  if (!(thicknessKm > 0) || !Number.isFinite(altitudeKm)) return 0;
  return Math.max(0, Math.min(1, 1 - altitudeKm / thicknessKm));
}

/**
 * Le gain appliqué à la lumière de l'air. `zenithRelative` et `referenceRelative` sont des luminances du
 * modèle en part de l'éclairement solaire (sortie de `zenithSkyLuminance` divisée par l'intensité solaire).
 */
export function skyAdaptationGain(
  zenithRelative: number,
  referenceRelative: number,
  weight: number
): number {
  if (!(weight > 0)) return 1;
  const gain = Math.max(
    1,
    wardGain(
      zenithRelative * LUMINOUS_SOLAR_CONSTANT_LX,
      referenceRelative * LUMINOUS_SOLAR_CONSTANT_LX
    )
  );
  return gain ** Math.min(1, weight);
}
