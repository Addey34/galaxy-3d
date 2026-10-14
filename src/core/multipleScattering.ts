/**
 * LA DIFFUSION MULTIPLE DU CIEL, PAR LA TABLE DE HILLAIRE (lot 48, 2026-10-14).
 *
 * Le ciel du pas 6 ne diffusait la lumière du Soleil qu'UNE fois : juste en plein jour, mais trop
 * sombre au crépuscule, dans l'ombre de la planète et près de l'horizon, là où la lumière qui
 * arrive à l'œil a été diffusée plusieurs fois. On l'ajoute par la méthode de S. Hillaire (« A
 * Scalable and Production Ready Sky and Atmosphere Rendering Technique », Eurographics Symposium
 * on Rendering 2020, § 5.5) : à partir du second ordre, la diffusion est supposée ISOTROPE, si bien
 * que sa contribution ne dépend que de l'altitude et de la hauteur du Soleil. Une table de 32 × 32
 * la donne, calculée une fois par modèle, et le shader l'ajoute à chaque échantillon de sa visée,
 * multipliée par le coefficient de diffusion local, sans ombre (la lumière diffusée plusieurs fois
 * éclaire aussi ce que le Soleil ne voit pas).
 *
 * Pour chaque case (altitude h, cosinus μs du Soleil) : la lumière du second ordre L₂ reçue de
 * toutes les directions de la sphère (128, cf. plus bas), sol lambertien compris, et la part f_ms d'une lumière
 * UNITÉ isotrope qui revient au point après une diffusion ; tous les ordres suivants forment alors
 * une série géométrique, Ψ = L₂ / (1 − f_ms). Ce n'est valable que pour une atmosphère MINCE
 * optiquement (la Terre) : sous les 92 bar de Vénus, l'hypothèse isotrope ne tient plus, et Vénus
 * garde son halo.
 *
 * Unités : km et km⁻¹, pour un éclairement solaire UNITÉ ; le shader multiplie par le sien.
 */
import type { SkyScattering } from './atmosphereScattering';

/** Côté de la table, en cases (altitude × cosinus du Soleil). */
export const MULTIPLE_SCATTERING_LUT_SIZE = 32;

/**
 * Directions de la sphère (azimuts × cosinus, grille stratifiée) et pas le long de chacune.
 * MESURÉ contre une référence convergée (`multipleScattering.test.ts`) : les 8 × 8 directions de
 * Hillaire laissent une case 11 % trop basse (8,4 km, Soleil à 16°), et c'est la résolution en
 * HAUTEUR qui manque (8 azimuts × 16 cosinus tiennent les 8 %, pour la moitié du coût de
 * 16 × 16) ; le nombre de pas ne change presque rien (20 ou 60 : 0,1 %), d'où 10.
 */
const SPHERE_AZIMUTHS = 8;
const SPHERE_COSINES = 16;
const RAY_STEPS = 10;

/** Table de transmittance vers le haut de l'air : altitudes × cosinus de la visée. */
const T_ALTITUDES = 32;
const T_COSINES = 128;
const T_STEPS = 40;

type Rgb = [number, number, number];

const ISOTROPIC_PHASE = 1 / (4 * Math.PI);

function densities(sky: SkyScattering, h: number): Rgb {
  return [
    Math.exp(-h / sky.rayleighScaleHeightKm),
    Math.exp(-h / sky.mieScaleHeightKm),
    Math.max(0, 1 - Math.abs(h - sky.ozonePeakKm) / sky.ozoneHalfWidthKm),
  ];
}

/** Extinction (km⁻¹) d'un canal, pour des densités (ou profondeurs) Rayleigh, Mie, ozone. */
function extinction(sky: SkyScattering, d: Rgb, c: number): number {
  return (
    sky.rayleighScatteringPerKm[c]! * d[0] +
    sky.mieExtinctionPerKm * d[1] +
    sky.ozoneAbsorptionPerKm[c]! * d[2]
  );
}

/** Distance du point de rayon r, visée de cosinus μ par rapport à la verticale, à la sphère R. */
function distanceToSphere(r: number, mu: number, radius: number): number {
  const disc = r * r * (mu * mu - 1) + radius * radius;
  return -r * mu + Math.sqrt(Math.max(0, disc));
}

/** Vrai si la visée (r, μ) descendante coupe le sol de rayon `ground`. */
function hitsGround(r: number, mu: number, ground: number): boolean {
  return mu < 0 && r * r * (mu * mu - 1) + ground * ground >= 0;
}

/**
 * La transmittance de chaque point vers le haut de l'air, interpolée dans une table (altitude,
 * cosinus) : nulle quand la visée coupe le sol. Exportée pour les tests.
 */
export function transmittanceTable(sky: SkyScattering): {
  lookup(r: number, mu: number, out: Rgb): Rgb;
} {
  const ground = sky.bottomRadiusKm;
  const top = ground + sky.thicknessKm;
  const data = new Float64Array(T_ALTITUDES * T_COSINES * 3);
  for (let i = 0; i < T_ALTITUDES; i += 1) {
    const r = ground + (i / (T_ALTITUDES - 1)) * sky.thicknessKm;
    for (let j = 0; j < T_COSINES; j += 1) {
      const mu = -1 + (2 * j) / (T_COSINES - 1);
      const o = (i * T_COSINES + j) * 3;
      if (hitsGround(r, mu, ground)) continue; // reste à zéro
      const length = distanceToSphere(r, mu, top);
      const ds = length / T_STEPS;
      const depth: Rgb = [0, 0, 0];
      for (let k = 0; k < T_STEPS; k += 1) {
        const t = (k + 0.5) * ds;
        const h = Math.sqrt(r * r + t * t + 2 * r * mu * t) - ground;
        const d = densities(sky, h);
        depth[0] += d[0] * ds;
        depth[1] += d[1] * ds;
        depth[2] += d[2] * ds;
      }
      for (let c = 0; c < 3; c += 1)
        data[o + c] = Math.exp(-extinction(sky, depth, c));
    }
  }
  return {
    lookup(r, mu, out) {
      const x =
        Math.min(1, Math.max(0, (r - ground) / sky.thicknessKm)) *
        (T_ALTITUDES - 1);
      const y = Math.min(1, Math.max(0, (mu + 1) / 2)) * (T_COSINES - 1);
      const i0 = Math.min(T_ALTITUDES - 2, Math.floor(x));
      const j0 = Math.min(T_COSINES - 2, Math.floor(y));
      const fx = x - i0;
      const fy = y - j0;
      for (let c = 0; c < 3; c += 1) {
        const a = data[(i0 * T_COSINES + j0) * 3 + c]!;
        const b = data[(i0 * T_COSINES + j0 + 1) * 3 + c]!;
        const d = data[((i0 + 1) * T_COSINES + j0) * 3 + c]!;
        const e = data[((i0 + 1) * T_COSINES + j0 + 1) * 3 + c]!;
        out[c] =
          (a * (1 - fy) + b * fy) * (1 - fx) + (d * (1 - fy) + e * fy) * fx;
      }
      return out;
    },
  };
}

/**
 * La table Ψ(h, μs) de Hillaire, en RGBA (alpha à 1), ligne = altitude, colonne = cosinus du
 * Soleil. La case (i, j) décrit h = (j + ½)/N × épaisseur et μs = 2(i + ½)/N − 1 : exactement les
 * centres de texels qu'une lecture `uv = (μs/2 + ½, h/épaisseur)` retrouve.
 */
export function multipleScatteringTable(
  sky: SkyScattering,
  size = MULTIPLE_SCATTERING_LUT_SIZE
): Float32Array {
  const table = new Float32Array(size * size * 4);
  const transmittance = transmittanceTable(sky);
  const ground = sky.bottomRadiusKm;
  const top = ground + sky.thicknessKm;
  const scattering = (d: Rgb, c: number) =>
    sky.rayleighScatteringPerKm[c]! * d[0] + sky.mieScatteringPerKm * d[1];
  const tSun: Rgb = [0, 0, 0];
  const n = SPHERE_AZIMUTHS;
  const m = SPHERE_COSINES;
  // La lumière ne dépend que de l'angle de la visée au plan (zénith, Soleil) : les directions
  // d'azimut θ et −θ donnent la même chose. La grille (k + ½)/n est symétrique, on n'en
  // parcourt que la moitié, comptée deux fois.
  const halfAzimuths = n / 2;
  const weight = (2 * 4 * Math.PI) / (n * m);

  for (let row = 0; row < size; row += 1) {
    const h = ((row + 0.5) / size) * sky.thicknessKm;
    const r = ground + h;
    for (let col = 0; col < size; col += 1) {
      const muS = (2 * (col + 0.5)) / size - 1;
      const sun = { x: Math.sqrt(Math.max(0, 1 - muS * muS)), y: muS };
      const L: Rgb = [0, 0, 0];
      const fms: Rgb = [0, 0, 0];
      for (let a = 0; a < halfAzimuths; a += 1) {
        const theta = (2 * Math.PI * (a + 0.5)) / n;
        for (let b = 0; b < m; b += 1) {
          const cosPhi = 1 - (2 * (b + 0.5)) / m;
          const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
          // Visée : composante verticale cosPhi, horizontale dans le plan du Soleil cos θ.
          const dir = {
            x: sinPhi * Math.cos(theta),
            y: cosPhi,
            z: sinPhi * Math.sin(theta),
          };
          const toGround = hitsGround(r, cosPhi, ground);
          const length = toGround
            ? -r * cosPhi -
              Math.sqrt(
                Math.max(0, r * r * (cosPhi * cosPhi - 1) + ground * ground)
              )
            : distanceToSphere(r, cosPhi, top);
          const ds = length / RAY_STEPS;
          const throughput: Rgb = [1, 1, 1];
          const lDir: Rgb = [0, 0, 0];
          const fDir: Rgb = [0, 0, 0];
          for (let k = 0; k < RAY_STEPS; k += 1) {
            const t = (k + 0.5) * ds;
            const px = dir.x * t;
            const py = r + dir.y * t;
            const pz = dir.z * t;
            const pr = Math.sqrt(px * px + py * py + pz * pz);
            const d = densities(sky, pr - ground);
            transmittance.lookup(pr, (px * sun.x + py * sun.y) / pr, tSun);
            for (let c = 0; c < 3; c += 1) {
              const sigmaS = scattering(d, c);
              const sigmaT = extinction(sky, d, c);
              const stepT = Math.exp(-sigmaT * ds);
              // Intégrale exacte sur le pas d'une source constante : (1 − e^{−σ ds}) / σ.
              const integral = sigmaT > 0 ? (1 - stepT) / sigmaT : ds;
              lDir[c] +=
                throughput[c]! * tSun[c]! * sigmaS * ISOTROPIC_PHASE * integral;
              fDir[c] += throughput[c]! * sigmaS * integral;
              throughput[c] *= stepT;
            }
          }
          if (toGround) {
            // Le sol lambertien renvoie la lumière du Soleil qu'il reçoit.
            const gx = dir.x * length;
            const gy = r + dir.y * length;
            const gz = dir.z * length;
            const gr = Math.sqrt(gx * gx + gy * gy + gz * gz);
            const cosSun = (gx * sun.x + gy * sun.y) / gr;
            transmittance.lookup(gr, cosSun, tSun);
            const lambert = (Math.max(0, cosSun) * sky.groundAlbedo) / Math.PI;
            for (let c = 0; c < 3; c += 1)
              lDir[c] += throughput[c]! * tSun[c]! * lambert;
          }
          for (let c = 0; c < 3; c += 1) {
            L[c] += lDir[c]! * weight;
            fms[c] += fDir[c]! * weight;
          }
        }
      }
      const o = (row * size + col) * 4;
      for (let c = 0; c < 3; c += 1) {
        const l2 = L[c]! * ISOTROPIC_PHASE;
        const f = fms[c]! * ISOTROPIC_PHASE;
        table[o + c] = l2 / (1 - f);
      }
      table[o + 3] = 1;
    }
  }
  return table;
}

const TABLES = new WeakMap<SkyScattering, Float32Array>();

/** La table d'un modèle, calculée une seule fois (le shader et le miroir JS lisent la même). */
export function sharedMultipleScatteringTable(
  sky: SkyScattering
): Float32Array {
  let table = TABLES.get(sky);
  if (!table) {
    table = multipleScatteringTable(sky);
    TABLES.set(sky, table);
  }
  return table;
}

/** Lecture bilinéaire de la table, comme le fait la texture (bords bloqués). */
export function sampleMultipleScattering(
  table: Float32Array,
  sky: SkyScattering,
  h: number,
  muS: number,
  size = MULTIPLE_SCATTERING_LUT_SIZE
): Rgb {
  const u = Math.min(1, Math.max(0, muS * 0.5 + 0.5)) * size - 0.5;
  const v = Math.min(1, Math.max(0, h / sky.thicknessKm)) * size - 0.5;
  const c0 = Math.max(0, Math.min(size - 1, Math.floor(u)));
  const c1 = Math.min(size - 1, c0 + 1);
  const r0 = Math.max(0, Math.min(size - 1, Math.floor(v)));
  const r1 = Math.min(size - 1, r0 + 1);
  const fu = Math.max(0, Math.min(1, u - c0));
  const fv = Math.max(0, Math.min(1, v - r0));
  const at = (r: number, c: number, k: number) =>
    table[(r * size + c) * 4 + k]!;
  const out: Rgb = [0, 0, 0];
  for (let k = 0; k < 3; k += 1)
    out[k] =
      (at(r0, c0, k) * (1 - fu) + at(r0, c1, k) * fu) * (1 - fv) +
      (at(r1, c0, k) * (1 - fu) + at(r1, c1, k) * fu) * fv;
  return out;
}
