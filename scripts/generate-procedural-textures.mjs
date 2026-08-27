/* global Buffer, console */
/**
 * Génère des textures de surface 100% originales (bruit fractal + cratères procéduraux) pour
 * les corps qui n'ont et n'auront jamais de vraie mosaïque photo (aucune sonde ne les a visités) :
 * Orcus, Quaoar, Gonggong, Sedna (jamais imagées), et en remplacement des textures Pallas/Hygiea
 * dont la licence d'origine (source communautaire type fandom.com) est incertaine et bloquait un
 * usage commercial (cf. THIRD_PARTY_NOTICES.md).
 *
 * Contenu généré mathématiquement à partir d'un PRNG seedé par nom de corps — aucune image
 * source, donc aucun droit tiers à gérer : pas de crédit à ajouter, licence = celle du projet.
 * Sortie : équirectangulaire 2048x1024 (2:1), conforme à `scripts/audit-textures.mjs`.
 *
 * Les paramètres par corps (densité de cratères, bassins, plages de givre) ne sont pas
 * arbitraires : chacun est choisi pour refléter une donnée ou une hypothèse publiée sur ce corps
 * précis (imagerie VLT/SPHERE pour Pallas/Hygiea, spectroscopie glace/ammoniac pour Orcus/Quaoar,
 * etc.) — la source est citée en commentaire à côté de chaque entrée de `BODIES` ci-dessous.
 * L'objectif est une estimation illustrative plausible, pas une carte scientifique — aucune
 * position de cratère ou de plage de givre n'est réelle, seule leur présence/absence l'est.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEXTURE_ROOT = resolve(ROOT, 'public/assets/textures');
const WIDTH = 2048;
const HEIGHT = 1024;

/** PRNG déterministe (mulberry32) seedé par une chaîne — mêmes résultats à chaque régénération. */
function makeRng(seedString) {
  let h = 1779033703 ^ seedString.length;
  for (let i = 0; i < seedString.length; i++) {
    h = Math.imul(h ^ seedString.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bruit fractal sans couture sur une sphère : somme de sinusoïdes évaluées sur le vecteur 3D du
 * point (au lieu d'une grille 2D), donc naturellement continu au méridien 180° et aux pôles.
 * `baseFreq`/`lacunarity` contrôlent l'échelle : basse fréquence = grandes taches d'albédo,
 * haute fréquence = grain fin (plusieurs dizaines de cycles autour de la sphère).
 */
function makeSphericalNoise(rng, octaves, baseFreq, lacunarity) {
  const terms = [];
  for (let o = 0; o < octaves; o++) {
    // Trois sinusoïdes par octave (au lieu d'une) pour casser l'aspect "vagues" trop régulier.
    for (let k = 0; k < 3; k++) {
      const freq = baseFreq * lacunarity ** o;
      const dir = { x: rng() * 2 - 1, y: rng() * 2 - 1, z: rng() * 2 - 1 };
      const mag = Math.hypot(dir.x, dir.y, dir.z) || 1;
      terms.push({
        kx: (dir.x / mag) * freq,
        ky: (dir.y / mag) * freq,
        kz: (dir.z / mag) * freq,
        phase: rng() * Math.PI * 2,
        amp: 1 / (o + 1) ** 1.1,
      });
    }
  }
  const totalAmp = terms.reduce((sum, t) => sum + t.amp, 0);
  return (nx, ny, nz) => {
    let sum = 0;
    for (const t of terms) {
      sum += t.amp * Math.sin(t.kx * nx + t.ky * ny + t.kz * nz + t.phase);
    }
    return sum / totalAmp; // ~[-1, 1]
  };
}

/** Grain fin par pixel (hash déterministe, pas de dépendance sphérique) — casse l'aspect
 *  "aérographe" du bruit sinusoïdal et donne une texture rocheuse/glacée crédible de près.
 *  Une discontinuité infime au raccord x=0/x=largeur est invisible à cette échelle de grain. */
function pixelGrain(x, y) {
  let h = (x * 374761393 + y * 668265263) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1; // [-1, 1]
}

/** Point uniforme sur la sphère, calottes polaires exclues (un point centré près d'un pôle
 *  s'étire sur toute la largeur en projection équirectangulaire — artefact de projection). */
function spherePoint(rng) {
  let z = rng() * 2 - 1;
  while (Math.abs(z) > 0.88) z = rng() * 2 - 1;
  const theta = rng() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return { x: r * Math.cos(theta), y: r * Math.sin(theta), z };
}

function makeCraters(rng, count, minRadius, maxRadius) {
  const craters = [];
  for (let i = 0; i < count; i++) {
    craters.push({
      ...spherePoint(rng),
      radius: minRadius + rng() * (maxRadius - minRadius),
      depth: 0.4 + rng() * 0.6,
    });
  }
  return craters;
}

function craterHeight(craters, nx, ny, nz) {
  let h = 0;
  for (const c of craters) {
    const cosAngle = nx * c.x + ny * c.y + nz * c.z;
    const angle = Math.acos(Math.min(1, Math.max(-1, cosAngle)));
    const a = angle / c.radius; // 0 au centre, 1 au bord du cratère
    if (a > 1.08) continue;
    // Bol creusé au centre (profil plus raide = bord net) + fin bourrelet surélevé sur le rebord.
    const bowl = a < 0.92 ? -c.depth * (1 - (a / 0.92) ** 2) ** 0.6 : 0;
    // `rimStrength` à 0 pour un impact "sans éjecta" (ex. Hyperion — Thomas et al. 2007).
    const rimStrength = c.rimStrength ?? 1;
    const rim =
      rimStrength > 0 && a > 0.85 && a < 1.08
        ? c.depth * 0.4 * rimStrength * (1 - Math.abs(a - 0.96) / 0.12)
        : 0;
    // Pic central : bassins géants type Herschel (Mimas) / Pharos (Protée), dôme au fond.
    const peak =
      c.centralPeak && a < 0.18
        ? c.depth * 0.5 * (1 - (a / 0.18) ** 2)
        : 0;
    h += bowl + Math.max(0, rim) + peak;
  }
  return h;
}

/**
 * Taches claires irrégulières (glace cristalline / givre) — pas des cratères : bosse lisse sans
 * bol ni bourrelet, et le rayon effectif est modulé par du bruit pour un contour non circulaire,
 * cohérent avec un dépôt cryovolcanique/de givre plutôt qu'un impact.
 */
function makeIcePatches(rng, count, minRadius, maxRadius) {
  const patches = [];
  for (let i = 0; i < count; i++) {
    patches.push({
      ...spherePoint(rng),
      radius: minRadius + rng() * (maxRadius - minRadius),
      strength: 0.6 + rng() * 0.4,
      // Deux harmoniques à fréquences non liées : casse la symétrie en "étoile" qu'un seul
      // sin(k·θ) produit, pour un contour plus organique (givre/dépôt) que géométrique.
      wobbleFreq1: 2.3 + rng() * 2.1,
      wobblePhase1: rng() * Math.PI * 2,
      wobbleFreq2: 5.7 + rng() * 4.3,
      wobblePhase2: rng() * Math.PI * 2,
    });
  }
  return patches;
}

function patchIntensity(patches, nx, ny, nz) {
  let intensity = 0;
  for (const p of patches) {
    const cosAngle = nx * p.x + ny * p.y + nz * p.z;
    const angle = Math.acos(Math.min(1, Math.max(-1, cosAngle)));
    // Angle autour du centre de la tache, pour moduler son contour (forme non circulaire).
    const bearing = Math.atan2(
      nz - cosAngle * p.z,
      nx * p.y - ny * p.x || 1e-6
    );
    const wobble =
      1 +
      0.16 * Math.sin(p.wobbleFreq1 * bearing + p.wobblePhase1) +
      0.1 * Math.sin(p.wobbleFreq2 * bearing + p.wobblePhase2);
    const a = angle / (p.radius * wobble);
    if (a > 1) continue;
    // Bord adouci (exposant plus faible) : moins net qu'un cratère, cohérent avec un dépôt/tache.
    intensity = Math.max(intensity, p.strength * (1 - a * a) ** 2.2);
  }
  return intensity; // [0, ~1]
}

/**
 * Contraste hémisphérique doux (transition en S, pas de bruit) — pour un corps dont la
 * littérature rapporte explicitement un "hémisphère sombre"/"clair" plutôt qu'un mottling
 * aléatoire (ex. Néréide — Voyager 2, Schaefer & Schaefer 2000).
 */
function hemisphereContrast(rng, strength) {
  const axis = spherePoint(rng);
  return (nx, ny, nz) => {
    const d = nx * axis.x + ny * axis.y + nz * axis.z; // [-1, 1]
    const s = d / Math.sqrt(0.35 + d * d); // transition adoucie, pas un bord net
    return s * strength;
  };
}

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

async function generateBody({
  name,
  baseColor,
  craterCount,
  craterMinRadius,
  craterMaxRadius,
  albedoVariation,
  heightContrast,
  largeBasins = [], // grands bassins d'impact ponctuels (ex. Pallas, Mimas, Protée)
  craterRimStrength = 1, // 0 = pas de bourrelet d'éjecta (ex. Hyperion)
  patchGroups = [], // taches colorées (givre, terrain distinct, tache sombre/claire isolée…)
  hemisphere, // { strength } — contraste doux entre deux hémisphères opposés (ex. Néréide)
}) {
  const rng = makeRng(name);
  const macroNoise = makeSphericalNoise(rng, 4, 1.5, 2.3); // grandes taches d'albédo
  const mesoNoise = makeSphericalNoise(rng, 3, 10, 2.1); // relief moyen (dizaines de cycles)
  const craters = makeCraters(rng, craterCount, craterMinRadius, craterMaxRadius);
  for (const c of craters) c.rimStrength = craterRimStrength;
  for (const basin of largeBasins) {
    craters.push({ ...spherePoint(rng), rimStrength: craterRimStrength, ...basin });
  }
  const groups = patchGroups.map((g) => ({
    patches: makeIcePatches(rng, g.count, g.minRadius, g.maxRadius),
    opacity: g.opacity,
    color: g.color,
  }));
  const hemisphereFn = hemisphere
    ? hemisphereContrast(rng, hemisphere.strength)
    : null;

  const buffer = Buffer.allocUnsafe(WIDTH * HEIGHT * 3);
  const [br, bg, bb] = baseColor;

  for (let y = 0; y < HEIGHT; y++) {
    const lat = Math.PI / 2 - (y / (HEIGHT - 1)) * Math.PI;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    for (let x = 0; x < WIDTH; x++) {
      const lon = (x / WIDTH) * Math.PI * 2 - Math.PI;
      const nx = cosLat * Math.cos(lon);
      const ny = cosLat * Math.sin(lon);
      const nz = sinLat;

      const macro = macroNoise(nx, ny, nz);
      const meso = mesoNoise(nx, ny, nz);
      const grain = pixelGrain(x, y);
      const craterH = craterHeight(craters, nx, ny, nz);
      const hemi = hemisphereFn ? hemisphereFn(nx, ny, nz) : 0;

      const shade =
        1 +
        macro * albedoVariation +
        meso * albedoVariation * 0.5 +
        grain * 0.07 +
        craterH * heightContrast +
        hemi;

      let r = br * shade;
      let g = bg * shade;
      let b = bb * shade;

      for (const group of groups) {
        const intensity = patchIntensity(group.patches, nx, ny, nz) * group.opacity;
        if (intensity <= 0) continue;
        const [pr, pg, pb] = group.color;
        r = r * (1 - intensity) + pr * shade * intensity;
        g = g * (1 - intensity) + pg * shade * intensity;
        b = b * (1 - intensity) + pb * shade * intensity;
      }

      const offset = (y * WIDTH + x) * 3;
      buffer[offset] = clamp255(r);
      buffer[offset + 1] = clamp255(g);
      buffer[offset + 2] = clamp255(b);
    }
  }

  const outDir = resolve(TEXTURE_ROOT, name);
  await mkdir(outDir, { recursive: true });
  const outPath = resolve(outDir, `${name}_surface_2k.jpg`);
  await sharp(buffer, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .jpeg({ quality: 85 })
    .toFile(outPath);
  console.log(`Wrote ${outPath}`);
}

const BODIES = [
  // Barucci et al. 2008 : glace d'eau cristalline + hydrate d'ammoniac détectés — signature d'un
  // resurfaçage cryovolcanique. Peu de vieux cratères (surface renouvelée) + larges plages de
  // givre "frais" plus claires. Couleur neutre-claire (parmi les TNO les plus brillants connus).
  {
    name: 'orcus',
    baseColor: [203, 199, 192],
    craterCount: 6,
    craterMinRadius: 0.07,
    craterMaxRadius: 0.16,
    albedoVariation: 0.12,
    heightContrast: 0.45,
    patchGroups: [
      { count: 6, minRadius: 0.18, maxRadius: 0.4, opacity: 0.4, color: [235, 238, 240] },
    ],
  },
  // Jewitt & Luu 2004 : glace d'eau cristalline (± hydrate d'ammoniac/méthane) — même signature
  // de resurfaçage récent qu'Orcus, même traitement (peu de cratères, plages de givre).
  {
    name: 'quaoar',
    baseColor: [156, 136, 115],
    craterCount: 7,
    craterMinRadius: 0.06,
    craterMaxRadius: 0.15,
    albedoVariation: 0.15,
    heightContrast: 0.5,
    patchGroups: [
      { count: 5, minRadius: 0.15, maxRadius: 0.35, opacity: 0.35, color: [220, 214, 200] },
    ],
  },
  // JWST (2024) : tholins (pentes spectrales rouges) + glace d'eau + givre de méthane par plaques.
  // Cratères normaux (pas de preuve de resurfaçage massif comme Orcus/Quaoar) + givre localisé.
  {
    name: 'gonggong',
    baseColor: [194, 90, 63],
    craterCount: 10,
    craterMinRadius: 0.09,
    craterMaxRadius: 0.24,
    albedoVariation: 0.22,
    heightContrast: 0.45,
    patchGroups: [
      { count: 4, minRadius: 0.12, maxRadius: 0.28, opacity: 0.3, color: [214, 168, 140] },
    ],
  },
  // Barucci et al. 2010 : surface homogène en couleur/spectre — explication avancée par les
  // auteurs : les impacts (qui exposeraient de la glace fraîche et brisent l'homogénéité) sont
  // rares à cette distance. D'où quasi aucun cratère et aucune plage de givre ici.
  {
    name: 'sedna',
    baseColor: [184, 74, 58],
    craterCount: 2,
    craterMinRadius: 0.08,
    craterMaxRadius: 0.16,
    albedoVariation: 0.08,
    heightContrast: 0.25,
  },
  // Marsset et al. 2020 (VLT/SPHERE) : "l'objet le plus cratérisé connu de la ceinture
  // d'astéroïdes" (aspect "balle de golf") + deux grands bassins d'impact distincts.
  {
    name: 'pallas',
    baseColor: [138, 143, 153],
    craterCount: 34,
    craterMinRadius: 0.05,
    craterMaxRadius: 0.13,
    albedoVariation: 0.14,
    heightContrast: 0.55,
    largeBasins: [
      { radius: 0.34, depth: 0.9 },
      { radius: 0.27, depth: 0.75 },
    ],
  },
  // Vernazza et al. 2019 (VLT/SPHERE) : forme quasi sphérique "sans bassin", seulement deux
  // petits cratères distincts identifiés dans toute l'imagerie — la plus lisse des six ici.
  {
    name: 'hygiea',
    baseColor: [92, 86, 78],
    craterCount: 2,
    craterMinRadius: 0.09,
    craterMaxRadius: 0.14,
    albedoVariation: 0.1,
    heightContrast: 0.35,
  },

  // ── Lunes sans mosaïque photo réelle (aucun bassin/tache n'est une vraie position — voir
  //    scripts/texture-sources.json pour la limite de couverture de chaque survol). ──

  // "Death Star" — le cratère Herschel fait ~1/3 du diamètre de Mimas, parois hautes, pic
  // central de ~6 km (comparable à l'Everest) ; cratérisation dense par ailleurs.
  {
    name: 'mimas',
    baseColor: [217, 214, 205],
    craterCount: 26,
    craterMinRadius: 0.04,
    craterMaxRadius: 0.11,
    albedoVariation: 0.12,
    heightContrast: 0.5,
    largeBasins: [{ radius: 0.62, depth: 1, centralPeak: true }],
  },
  // Aspect "éponge" : cratères profonds, denses, sans bourrelet d'éjecta visible (Thomas et al.
  // 2007) — cratérisation très dense + `craterRimStrength: 0`.
  {
    name: 'hyperion',
    baseColor: [168, 158, 140],
    craterCount: 55,
    craterMinRadius: 0.04,
    craterMaxRadius: 0.1,
    albedoVariation: 0.16,
    heightContrast: 0.4,
    craterRimStrength: 0,
  },
  // Coronae (Inverness/Arden/Elsinore) : vastes terrains tectoniques en chevron, distincts du
  // terrain cratérisé environnant — approximés par de larges "taches" de terrain plutôt que des
  // cratères ; peu de grands cratères (surface partiellement renouvelée par la tectonique).
  {
    name: 'miranda',
    baseColor: [200, 198, 195],
    craterCount: 12,
    craterMinRadius: 0.05,
    craterMaxRadius: 0.12,
    albedoVariation: 0.12,
    heightContrast: 0.4,
    patchGroups: [
      { count: 3, minRadius: 0.22, maxRadius: 0.32, opacity: 0.55, color: [168, 166, 160] },
    ],
  },
  // Surface la plus brillante/jeune des lunes d'Uranus : peu de grands cratères (effacés par un
  // resurfaçage relativement récent), beaucoup de petits (Voyager 2 imaging science, 1986).
  {
    name: 'ariel',
    baseColor: [196, 194, 190],
    craterCount: 28,
    craterMinRadius: 0.03,
    craterMaxRadius: 0.08,
    albedoVariation: 0.1,
    heightContrast: 0.35,
  },
  // La plus sombre des grandes lunes d'Uranus ; cratère Wunda (plancher/parois clairs) au pôle
  // nord — seule feature isolée nommée, approximée par un unique groupe de patch à 1 élément.
  {
    name: 'umbriel',
    baseColor: [110, 106, 100],
    craterCount: 20,
    craterMinRadius: 0.04,
    craterMaxRadius: 0.14,
    albedoVariation: 0.1,
    heightContrast: 0.45,
    patchGroups: [
      { count: 1, minRadius: 0.1, maxRadius: 0.14, opacity: 0.55, color: [200, 198, 194] },
    ],
  },
  // Réseau de canyons (Messina Chasmata, ~1500 km) + cratères à pics centraux — canyons non
  // modélisés par ce générateur (pas de primitive linéaire) ; cratérisation modérée seule.
  {
    name: 'titania',
    baseColor: [166, 160, 152],
    craterCount: 18,
    craterMinRadius: 0.04,
    craterMaxRadius: 0.13,
    albedoVariation: 0.11,
    heightContrast: 0.45,
  },
  // Surface sombre, cratères jusqu'à ~200 km avec pics centraux, l'une des plus anciennes du
  // système (peu de resurfaçage) — cratérisation dense avec quelques grands bassins.
  {
    name: 'oberon',
    baseColor: [118, 112, 104],
    craterCount: 22,
    craterMinRadius: 0.04,
    craterMaxRadius: 0.12,
    albedoVariation: 0.1,
    heightContrast: 0.45,
    largeBasins: [
      { radius: 0.22, depth: 0.8, centralPeak: true },
      { radius: 0.18, depth: 0.7, centralPeak: true },
    ],
  },
  // "L'objet le plus rouge du Système solaire" (plus rouge que Mars) — dépôt de soufre en
  // provenance d'Io. Petit corps irrégulier, cratérisation modeste.
  {
    name: 'amalthea',
    baseColor: [156, 68, 56],
    craterCount: 8,
    craterMinRadius: 0.08,
    craterMaxRadius: 0.18,
    albedoVariation: 0.14,
    heightContrast: 0.4,
  },
  // Forme "polyédrique" bosselée dominée par le cratère Pharos (~250 km, plus de la moitié du
  // diamètre de Protée, dôme central) — même traitement que Mimas/Herschel. Surface sombre et
  // neutre, fortement cratérisée par ailleurs (Voyager 2, 1989).
  {
    name: 'proteus',
    baseColor: [128, 124, 118],
    craterCount: 20,
    craterMinRadius: 0.04,
    craterMaxRadius: 0.1,
    albedoVariation: 0.12,
    heightContrast: 0.45,
    largeBasins: [{ radius: 0.58, depth: 0.85, centralPeak: true }],
  },
  // Grande variabilité photométrique attribuée à un "hémisphère sombre" + rotation chaotique
  // (Schaefer & Schaefer 2000, Voyager 2) — contraste hémisphérique doux plutôt qu'un mottling
  // aléatoire, gris neutre légèrement plus clair que la moyenne des TNO/lunes glacées sombres.
  {
    name: 'nereid',
    baseColor: [176, 172, 166],
    craterCount: 5,
    craterMinRadius: 0.08,
    craterMaxRadius: 0.16,
    albedoVariation: 0.1,
    heightContrast: 0.3,
    hemisphere: { strength: 0.22 },
  },

  // ── Les 4 petites lunes de Pluton (New Horizons 2015) : albédo élevé (>50 %, exceptionnel pour
  //    un objet de la ceinture de Kuiper), composition dominée par la glace d'eau, couleur
  //    globalement neutre — base claire commune, peu de cratères vu la résolution d'imagerie
  //    limitée à quelques pixels par corps (voir texture-sources.json pour le détail). ──

  {
    name: 'styx',
    baseColor: [214, 212, 208],
    craterCount: 3,
    craterMinRadius: 0.1,
    craterMaxRadius: 0.2,
    albedoVariation: 0.08,
    heightContrast: 0.35,
  },
  // Showalter et al. 2015 : une tache rougeâtre autour d'un cratère d'impact identifié sur Nix,
  // contrastant avec le reste de la surface (grise, dominée par la glace d'eau) — seule feature
  // de couleur distincte parmi les 4 petites lunes, rendue comme un unique patch rougeâtre.
  {
    name: 'nix',
    baseColor: [212, 208, 200],
    craterCount: 3,
    craterMinRadius: 0.1,
    craterMaxRadius: 0.2,
    albedoVariation: 0.08,
    heightContrast: 0.35,
    patchGroups: [
      { count: 1, minRadius: 0.09, maxRadius: 0.13, opacity: 0.55, color: [176, 92, 76] },
    ],
  },
  {
    name: 'kerberos',
    baseColor: [206, 204, 200],
    craterCount: 3,
    craterMinRadius: 0.1,
    craterMaxRadius: 0.2,
    albedoVariation: 0.08,
    heightContrast: 0.35,
  },
  {
    name: 'hydra',
    baseColor: [216, 214, 210],
    craterCount: 3,
    craterMinRadius: 0.1,
    craterMaxRadius: 0.2,
    albedoVariation: 0.08,
    heightContrast: 0.35,
  },
];

for (const body of BODIES) await generateBody(body);
