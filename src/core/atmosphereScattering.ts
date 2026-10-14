/**
 * LE CIEL VU DE DESSOUS L'ATMOSPHÈRE, ET LE HALO VU DE L'ORBITE : UNE SEULE PHYSIQUE (lot 48, pas 6,
 * 2026-10-13).
 *
 * La couche atmosphère était un liseré de Fresnel (`pow(1 − |n·v|, p)`) : juste au limbe vu de
 * l'orbite, NOIR vu de dessous, où la visée est parallèle à la normale. La descente vers l'horizon
 * (pas 5) montrait donc des Alpes ensoleillées sous un ciel de nuit. On calcule désormais, par
 * pixel, la lumière du Soleil diffusée une fois le long de la visée (Rayleigh et Mie, avec
 * l'absorption de l'ozone), ce qui rend à la fois le halo vu de l'espace et le ciel bleu, plus
 * clair à l'horizon et orangé au crépuscule, vu du sol.
 *
 * LES COEFFICIENTS NE SONT PAS RECOPIÉS : ils se DÉRIVENT ici des constantes publiées du modèle
 * d'Eric Bruneton (`precomputed_atmospheric_scattering`, `atmosphere/demo/demo.cc`, 2017, licence
 * BSD à trois clauses), lues à la source le 2026-10-13, aux trois longueurs d'onde que ce même
 * fichier associe au rouge, au vert et au bleu. Le test confronte le résultat à un calcul fait à
 * la main depuis ces mêmes constantes.
 *
 * Un corps déclare son modèle dans sa fiche (`skyScattering`), un vocabulaire FERMÉ : le code ne
 * connaît aucun nom de corps. Vénus garde son halo : sous 92 bar, la diffusion MULTIPLE domine,
 * et un modèle à diffusion simple y serait faux.
 */

/** Longueurs d'onde du rouge, du vert et du bleu, en nm (`kLambdaR/G/B` de la source). */
export const SKY_WAVELENGTHS_NM = [680, 550, 440] as const;

/** Les modèles publiés qu'une fiche peut déclarer. */
export const SKY_SCATTERING_MODELS = ['bruneton-2017'] as const;
export type SkyScatteringModelId = (typeof SKY_SCATTERING_MODELS)[number];

/** Ce que le shader consomme, en km et km⁻¹, triplets dans l'ordre rouge, vert, bleu. */
export interface SkyScattering {
  /** Épaisseur de l'atmosphère au-dessus du niveau de la mer. */
  thicknessKm: number;
  rayleighScatteringPerKm: [number, number, number];
  rayleighScaleHeightKm: number;
  mieScatteringPerKm: number;
  mieExtinctionPerKm: number;
  mieScaleHeightKm: number;
  /** Asymétrie de la fonction de phase de Mie (Cornette-Shanks). */
  mieG: number;
  /** Absorption de l'ozone au pic de la couche. */
  ozoneAbsorptionPerKm: [number, number, number];
  /** Couche d'ozone en tente : nulle à `peak ± halfWidth`, pleine au pic. */
  ozonePeakKm: number;
  ozoneHalfWidthKm: number;
  /** Rayon du sol du modèle, pour sa table de diffusion multiple. */
  bottomRadiusKm: number;
  /** Albédo du sol (lambertien), qui renvoie la lumière dans l'air. */
  groundAlbedo: number;
}

/**
 * Les constantes de `demo.cc`, telles qu'écrites dans la source (SI : m, m⁻¹, m²). Seules les
 * sections efficaces de l'ozone des trois canaux sont reprises de la table de 48 valeurs (pas de
 * 10 nm depuis 360 nm, 233 K, base de Brême) : index `(λ − 360) / 10`.
 */
const BRUNETON_2017 = {
  kRayleigh: 1.24062e-6,
  kRayleighScaleHeight: 8000,
  kMieScaleHeight: 1200,
  kMieAngstromAlpha: 0,
  kMieAngstromBeta: 5.328e-3,
  kMieSingleScatteringAlbedo: 0.9,
  kMiePhaseFunctionG: 0.8,
  kGroundAlbedo: 0.1,
  kBottomRadius: 6_360_000,
  kTopRadius: 6_420_000,
  kDobsonUnit: 2.687e20,
  /** `kOzoneCrossSection[32]`, `[19]`, `[8]` : 680, 550 et 440 nm. */
  ozoneCrossSection: { 680: 1.209e-25, 550: 3.5e-25, 440: 1.582e-26 },
  /** Profil de l'ozone : de 0 à 1 entre 10 et 25 km, de 1 à 0 entre 25 et 40 km. */
  ozonePeak: 25_000,
  ozoneHalfWidth: 15_000,
} as const;

const PER_KM = 1000;

/** Les coefficients du modèle de Bruneton, dérivés de ses constantes. */
function bruneton2017(): SkyScattering {
  const k = BRUNETON_2017;
  const lambdaMicrons = SKY_WAVELENGTHS_NM.map((nm) => nm / 1000);
  const rgb = (f: (lambda: number, nm: number) => number) =>
    SKY_WAVELENGTHS_NM.map((nm, i) => f(lambdaMicrons[i]!, nm)) as [
      number,
      number,
      number,
    ];
  // Mie : l'extinction suit la loi d'Ångström (α = 0, donc grise), divisée par la hauteur
  // d'échelle comme le fait la source ; la diffusion en est la fraction `albédo simple`.
  const mieExtinction =
    (k.kMieAngstromBeta / k.kMieScaleHeight) *
    Math.pow(lambdaMicrons[1]!, -k.kMieAngstromAlpha);
  // Densité maximale d'ozone : 300 unités Dobson réparties sur 15 km.
  const maxOzone = (300 * k.kDobsonUnit) / 15_000;
  return {
    thicknessKm: (k.kTopRadius - k.kBottomRadius) / PER_KM,
    rayleighScatteringPerKm: rgb(
      (lambda) => k.kRayleigh * Math.pow(lambda, -4) * PER_KM
    ),
    rayleighScaleHeightKm: k.kRayleighScaleHeight / PER_KM,
    mieScatteringPerKm: mieExtinction * k.kMieSingleScatteringAlbedo * PER_KM,
    mieExtinctionPerKm: mieExtinction * PER_KM,
    mieScaleHeightKm: k.kMieScaleHeight / PER_KM,
    mieG: k.kMiePhaseFunctionG,
    ozoneAbsorptionPerKm: rgb(
      (_, nm) =>
        maxOzone *
        k.ozoneCrossSection[nm as keyof typeof k.ozoneCrossSection] *
        PER_KM
    ),
    ozonePeakKm: k.ozonePeak / PER_KM,
    ozoneHalfWidthKm: k.ozoneHalfWidth / PER_KM,
    bottomRadiusKm: k.kBottomRadius / PER_KM,
    groundAlbedo: k.kGroundAlbedo,
  };
}

const MODELS = new Map<SkyScatteringModelId, SkyScattering>();

/**
 * Les coefficients du modèle qu'une fiche déclare : le MÊME objet à chaque appel, ce qui permet
 * de calculer une seule fois ce qui en dérive (la table de diffusion multiple).
 */
export function skyScattering(model: SkyScatteringModelId): SkyScattering {
  let known = MODELS.get(model);
  if (!known) {
    switch (model) {
      case 'bruneton-2017':
        known = bruneton2017();
    }
    MODELS.set(model, known);
  }
  return known;
}

/**
 * LES ÉTOILES DERRIÈRE L'AIR S'EFFACENT QUAND LE CIEL EST CLAIR.
 *
 * Les étoiles de la scène sont dessinées à un éclat d'affichage fixe, pas à leur luminance
 * réelle : sans règle, elles restaient visibles en plein jour sous un ciel bleu (mesuré au pas 6,
 * Alpes à 3 km). En vrai, elles disparaissent parce que le ciel de jour est des millions de fois
 * plus lumineux que celui de nuit. On les estompe donc selon la luminance CALCULÉE du ciel,
 * rapportée à celle du zénith de jour que le modèle lui-même donne (Soleil au zénith, une hauteur
 * d'échelle de Rayleigh, phase au zénith, canal vert) : visibles sous
 * {@link STARS_VISIBLE_BELOW} de cette luminance (crépuscule avancé), effacées au-dessus de
 * {@link STARS_HIDDEN_ABOVE} (vers la fin du crépuscule civil). Ce sont des ORDRES DE GRANDEUR
 * choisis, pas des mesures : le ciel de jour vaut environ 10⁴ cd/m², celui de la fin du
 * crépuscule civil quelques cd/m².
 */
export const STARS_VISIBLE_BELOW = 1e-5;
export const STARS_HIDDEN_ABOVE = 1e-3;

/** Luminance de référence du zénith de jour, dans les unités du rendu (`sunIntensity` = E). */
export function dayZenithLuminance(
  sky: SkyScattering,
  sunIntensity: number
): number {
  const rayleighPhaseZenith = (3 / (16 * Math.PI)) * 2;
  return (
    sunIntensity *
    sky.rayleighScatteringPerKm[1] *
    sky.rayleighScaleHeightKm *
    rayleighPhaseZenith
  );
}

/** Part des étoiles qui reste visible derrière un ciel de luminance `luminance` (miroir du GLSL). */
export function starVisibility(
  luminance: number,
  dayLuminance: number
): number {
  const lo = Math.log10(dayLuminance * STARS_VISIBLE_BELOW);
  const hi = Math.log10(dayLuminance * STARS_HIDDEN_ABOVE);
  const t = (Math.log10(Math.max(luminance, 1e-30)) - lo) / (hi - lo);
  const x = Math.max(0, Math.min(1, t));
  return 1 - x * x * (3 - 2 * x);
}

/**
 * Luminance (canal vert) du ciel au ZÉNITH d'une caméra, par la même diffusion simple que le
 * shader (`shaders/SkyScatteringShader.ts`, mêmes échantillons, mêmes fonctions de phase) : le
 * miroir JS qui décide des étoiles, et que les tests peuvent confronter.
 *
 * `cameraRadiusKm` : distance de la caméra au centre ; `groundKm` : niveau de la mer sous elle ;
 * `sunCosZenith` : cosinus de l'angle entre le zénith de la caméra et le Soleil.
 */
export function zenithSkyLuminance(
  sky: SkyScattering,
  groundKm: number,
  cameraRadiusKm: number,
  sunCosZenith: number,
  sunIntensity: number,
  samples = { view: 16, light: 6 },
  /**
   * La diffusion multiple Ψ (canal vert) à une altitude et une hauteur de Soleil, lue dans la
   * table du shader (`core/multipleScattering.ts`) ; absente, le miroir ne compte que l'ordre un.
   * Passée en argument pour que ce module, chargé au démarrage, n'importe pas la table.
   */
  multiple?: (altitudeKm: number, sunCosZenith: number) => number
): number {
  const topKm = groundKm + sky.thicknessKm;
  if (cameraRadiusKm >= topKm) return 0;
  const sunSin = Math.sqrt(Math.max(0, 1 - sunCosZenith * sunCosZenith));
  // Repère 2D : la caméra sur l'axe vertical, le Soleil dans le plan (x, z).
  const sun = { x: sunSin, z: sunCosZenith };
  const start = Math.max(cameraRadiusKm, groundKm);
  const ds = (topKm - start) / samples.view;
  const density = (h: number) => ({
    r: Math.exp(-h / sky.rayleighScaleHeightKm),
    m: Math.exp(-h / sky.mieScaleHeightKm),
    o: Math.max(0, 1 - Math.abs(h - sky.ozonePeakKm) / sky.ozoneHalfWidthKm),
  });
  const g = 1;
  const ext = (d: { r: number; m: number; o: number }) =>
    sky.rayleighScatteringPerKm[g]! * d.r +
    sky.mieExtinctionPerKm * d.m +
    sky.ozoneAbsorptionPerKm[g]! * d.o;
  let view = { r: 0, m: 0, o: 0 };
  let sumR = 0;
  let sumM = 0;
  let sumMultiple = 0;
  for (let i = 0; i < samples.view; i += 1) {
    const z = start + (i + 0.5) * ds;
    const d0 = density(z - groundKm);
    const rho = { r: d0.r * ds, m: d0.m * ds, o: d0.o * ds };
    view = {
      r: view.r + rho.r / 2,
      m: view.m + rho.m / 2,
      o: view.o + rho.o / 2,
    };
    if (multiple)
      sumMultiple +=
        Math.exp(-ext(view)) *
        (sky.rayleighScatteringPerKm[g]! * rho.r +
          sky.mieScatteringPerKm * rho.m) *
        multiple(z - groundKm, sunCosZenith);
    // Route vers le Soleil depuis (0, z) : coupée par le sol, l'échantillon est à l'ombre.
    const b = z * sun.z;
    const cGround = z * z - groundKm * groundKm;
    const discGround = b * b - cGround;
    const hitsGround = discGround >= 0 && -b - Math.sqrt(discGround) > 0;
    if (!hitsGround) {
      const cTop = z * z - topKm * topKm;
      const lightEnd = -b + Math.sqrt(b * b - cTop);
      const dl = lightEnd / samples.light;
      let light = { r: 0, m: 0, o: 0 };
      for (let j = 0; j < samples.light; j += 1) {
        const t = (j + 0.5) * dl;
        const qx = sun.x * t;
        const qz = z + sun.z * t;
        const d = density(Math.hypot(qx, qz) - groundKm);
        light = {
          r: light.r + d.r * dl,
          m: light.m + d.m * dl,
          o: light.o + d.o * dl,
        };
      }
      const transmittance = Math.exp(
        -ext({ r: view.r + light.r, m: view.m + light.m, o: view.o + light.o })
      );
      sumR += transmittance * rho.r;
      sumM += transmittance * rho.m;
    }
    view = {
      r: view.r + rho.r / 2,
      m: view.m + rho.m / 2,
      o: view.o + rho.o / 2,
    };
  }
  const mu = sunCosZenith;
  const rayleighPhase = (3 / (16 * Math.PI)) * (1 + mu * mu);
  const gg = sky.mieG;
  const miePhase =
    (((3 / (8 * Math.PI)) * (1 - gg * gg)) / (2 + gg * gg)) *
    ((1 + mu * mu) / Math.pow(1 + gg * gg - 2 * gg * mu, 1.5));
  return (
    sunIntensity *
    (sky.rayleighScatteringPerKm[g]! * sumR * rayleighPhase +
      sky.mieScatteringPerKm * sumM * miePhase +
      sumMultiple)
  );
}
