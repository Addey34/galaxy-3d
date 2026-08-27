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

function makeCraters(rng, count, minRadius, maxRadius) {
  const craters = [];
  for (let i = 0; i < count; i++) {
    // Point uniforme sur la sphère (évite la concentration aux pôles d'un tirage lat/lon naïf),
    // en excluant les calottes polaires : un cratère centré près d'un pôle s'étire sur toute la
    // largeur en projection équirectangulaire — artefact de projection, pas un vrai relief.
    let z = rng() * 2 - 1;
    while (Math.abs(z) > 0.88) z = rng() * 2 - 1;
    const theta = rng() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    craters.push({
      x: r * Math.cos(theta),
      y: r * Math.sin(theta),
      z,
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
    const rim =
      a > 0.85 && a < 1.08
        ? c.depth * 0.4 * (1 - Math.abs(a - 0.96) / 0.12)
        : 0;
    h += bowl + Math.max(0, rim);
  }
  return h;
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
}) {
  const rng = makeRng(name);
  const macroNoise = makeSphericalNoise(rng, 4, 1.5, 2.3); // grandes taches d'albédo
  const mesoNoise = makeSphericalNoise(rng, 3, 10, 2.1); // relief moyen (dizaines de cycles)
  const craters = makeCraters(rng, craterCount, craterMinRadius, craterMaxRadius);

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

      const shade =
        1 +
        macro * albedoVariation +
        meso * albedoVariation * 0.5 +
        grain * 0.07 +
        craterH * heightContrast;

      const offset = (y * WIDTH + x) * 3;
      buffer[offset] = clamp255(br * shade);
      buffer[offset + 1] = clamp255(bg * shade);
      buffer[offset + 2] = clamp255(bb * shade);
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
  // Glace-roche neutre, cratères modérés (cohérent avec Charon, même famille de TNO).
  { name: 'orcus', baseColor: [203, 199, 192], craterCount: 14, craterMinRadius: 0.08, craterMaxRadius: 0.22, albedoVariation: 0.14, heightContrast: 0.5 },
  // Gris-brun, cratères modérés ; Quaoar a des anneaux mais la surface elle-même est neutre.
  { name: 'quaoar', baseColor: [156, 136, 115], craterCount: 16, craterMinRadius: 0.07, craterMaxRadius: 0.2, albedoVariation: 0.16, heightContrast: 0.55 },
  // Rouge tholins prononcé, givre de méthane par plaques plus claires.
  { name: 'gonggong', baseColor: [194, 90, 63], craterCount: 10, craterMinRadius: 0.09, craterMaxRadius: 0.24, albedoVariation: 0.22, heightContrast: 0.45 },
  // Le plus rouge des objets connus, surface très homogène (peu de relief net observé).
  { name: 'sedna', baseColor: [184, 74, 58], craterCount: 6, craterMinRadius: 0.1, craterMaxRadius: 0.26, albedoVariation: 0.12, heightContrast: 0.3 },
  // Astéroïde de type B (bleuté, sombre) ; VLT/SPHERE montre de grands cratères marqués.
  { name: 'pallas', baseColor: [138, 143, 153], craterCount: 12, craterMinRadius: 0.1, craterMaxRadius: 0.28, albedoVariation: 0.16, heightContrast: 0.6 },
  // Astéroïde de type C, très sombre, quasi sphérique et peu cratérisé (peu de relief net).
  { name: 'hygiea', baseColor: [92, 86, 78], craterCount: 5, craterMinRadius: 0.12, craterMaxRadius: 0.3, albedoVariation: 0.13, heightContrast: 0.3 },
];

for (const body of BODIES) await generateBody(body);
