/**
 * Sonde de terminateur — lit le RENDU, pas le modèle. Activée par `?debug-terminator`.
 *
 * Pourquoi ce module existe. Le contrat jour/nuit (`core/terminator.ts`) est testé en JS, et
 * ses courbes sont justes. Mais deux défauts livrés de suite ont échappé à ces tests parce
 * qu'ils ne portaient pas sur la courbe : une garantie exprimée en RELATIF par rapport à une
 * référence elle-même sous le plancher d'affichage (la bande de crépuscule rendait 0 % de
 * pixels visibles alors que « la somme ne descend jamais sous sa valeur au terminateur »
 * était vraie), et une couche modèle qui remplaçait le matériau de sa couche par un matériau
 * nu (les nuages Open-Meteo brillaient à plein régime sur la face nuit là où les nuages
 * satellite s'éteignaient). Aucun test unitaire ne pouvait les voir : il fallait compter des
 * pixels.
 *
 * Cette sonde rend cette mesure REPRODUCTIBLE, donc automatisable (`e2e/terminator.spec.ts`).
 * Elle fait deux choses et rien d'autre :
 *
 *   - `frame(nom)` place la caméra à 90° du Soleil autour du corps, si bien que le
 *     terminateur traverse le CENTRE du disque — le cadrage où la bande est la plus large et
 *     la géométrie la mieux conditionnée ;
 *   - `sample()` renvoie, pour chaque tranche d'éclairement `raw = dot(normale, Soleil)`, ce
 *     que l'écran montre réellement : part de pixels au-dessus du plancher d'affichage,
 *     luminance moyenne et maximale.
 *
 * Deux pièges appris à la dure, tous deux encodés ici :
 *
 *   1. **L'instantané doit être ATOMIQUE.** Pixels, pose de caméra et position du corps se
 *      lisent dans la même frame. Lus séparément, la caméra bouge entre-temps (elle suit sa
 *      cible) et la correspondance pixel → `raw` devient fausse sans que rien ne le signale.
 *   2. **Il faut exclure le BORD du disque.** Près de la silhouette le rayon est tangent : une
 *      erreur d'un pixel déplace `raw` de bout en bout, et le halo atmosphérique (additif,
 *      BackSide) y est brillant. Sans ce filtre, CHAQUE tranche de `raw` ramasse un pixel de
 *      limbe et la mesure sort plate — c'est ce qui a fait perdre deux tours à la main.
 */
import * as THREE from 'three';
import type { PublicAPI } from '@/SolarSystemApp';
import { hasDebugFlag } from '@/utils/debugFlags';

/** Une tranche d'éclairement et ce que l'écran y montre. */
export interface TerminatorBin {
  /** `dot(normale monde, direction du Soleil)` — le sinus de la hauteur solaire. */
  raw: number;
  pixels: number;
  /** Part des pixels au-dessus du plancher d'affichage 8 bits. */
  litFraction: number;
  meanLuminance: number;
  maxLuminance: number;
}

export interface TerminatorProbe {
  /** Place la caméra à 90° du Soleil : le terminateur passe par le centre du disque. */
  frame(bodyName?: string): boolean;
  /** Mesure le rendu courant, tranche d'éclairement par tranche d'éclairement. */
  sample(options?: { bodyName?: string; step?: number }): TerminatorBin[];
}

/**
 * Plancher d'affichage : en dessous, le pixel est noir à l'écran. C'est la seule unité dans
 * laquelle « il n'y a rien » se dit sans ambiguïté — la leçon du défaut précédent.
 */
const DISPLAY_FLOOR = 2;

/** Cosinus d'incidence minimal : en deçà on est sur le bord, mesure non fiable (piège 2). */
const MIN_VIEW_COS = 0.45;

/** Distance de cadrage, en rayons du corps. Assez près pour que la bande soit large. */
const FRAME_DISTANCE_RADII = 4.2;

const luminance = (r: number, g: number, b: number): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

export function setupTerminatorProbe(api: PublicAPI): () => void {
  if (!hasDebugFlag('debug-terminator')) return () => undefined;

  const scene = api.sceneSystem;
  const readout = document.createElement('canvas');
  const readoutCtx = readout.getContext('2d', { willReadFrequently: true });

  const bodyCenter = new THREE.Vector3();
  const sunCenter = new THREE.Vector3();
  const toBody = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  const resolve = (
    bodyName: string
  ): { center: THREE.Vector3; radius: number; sun: THREE.Vector3 } | null => {
    const body = scene.getBody(bodyName);
    if (!body) return null;
    body.group.getWorldPosition(bodyCenter);
    scene.getBody('sun')?.group.getWorldPosition(sunCenter);
    return {
      center: bodyCenter.clone(),
      radius: body.getFrameRadius(api.orbitalMechanics.scaleMode),
      sun: sunCenter.clone(),
    };
  };

  const frame = (bodyName = 'earth'): boolean => {
    const target = resolve(bodyName);
    if (!target) return false;
    toBody.subVectors(target.center, target.sun).normalize();
    // Perpendiculaire à la ligne Soleil→corps : on regarde le terminateur par la tranche.
    side.crossVectors(toBody, up).normalize();
    const camera = scene.camera;
    camera.position
      .copy(target.center)
      .addScaledVector(side, FRAME_DISTANCE_RADII * target.radius)
      // Léger décalage en latitude : évite de regarder pile le long de l'axe de rotation.
      .addScaledVector(up, 0.3 * target.radius);
    camera.lookAt(target.center);
    camera.updateMatrixWorld(true);
    return true;
  };

  const sample = (
    options: { bodyName?: string; step?: number } = {}
  ): TerminatorBin[] => {
    const bodyName = options.bodyName ?? 'earth';
    const step = Math.max(1, Math.round(options.step ?? 2));
    const canvas = scene.renderer.domElement;
    if (!readoutCtx) return [];

    // INSTANTANÉ ATOMIQUE (piège 1) : les pixels et la géométrie qui les explique sont lus
    // dans la même frame, jamais dans deux appels séparés.
    readout.width = canvas.width;
    readout.height = canvas.height;
    readoutCtx.drawImage(canvas, 0, 0);
    const pixels = readoutCtx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    ).data;
    const camera = scene.camera;
    const cameraPosition = camera.position.clone();
    const matrixWorld = camera.matrixWorld.clone();
    const projectionInverse = camera.projectionMatrixInverse.clone();
    const target = resolve(bodyName);
    if (!target) return [];

    const ray = new THREE.Vector3();
    const origin = new THREE.Vector3();
    const hit = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const toSun = new THREE.Vector3();
    const bins = new Map<
      number,
      { pixels: number; lit: number; sum: number; max: number }
    >();
    const radiusSquared = target.radius * target.radius;

    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        ray
          .set((x / canvas.width) * 2 - 1, -((y / canvas.height) * 2 - 1), 0.5)
          .applyMatrix4(projectionInverse)
          .applyMatrix4(matrixWorld)
          .sub(cameraPosition)
          .normalize();
        origin.subVectors(cameraPosition, target.center);
        const b = 2 * origin.dot(ray);
        const c = origin.dot(origin) - radiusSquared;
        const discriminant = b * b - 4 * c;
        if (discriminant < 0) continue;
        const distance = (-b - Math.sqrt(discriminant)) / 2;
        if (distance <= 0) continue;
        hit.copy(cameraPosition).addScaledVector(ray, distance);
        normal.subVectors(hit, target.center).normalize();
        // Bord du disque : rayon tangent, `raw` non fiable et halo brillant (piège 2).
        if (-normal.dot(ray) < MIN_VIEW_COS) continue;

        toSun.subVectors(target.sun, hit).normalize();
        const raw = normal.dot(toSun);
        const index = (y * canvas.width + x) * 4;
        const level = luminance(
          pixels[index] ?? 0,
          pixels[index + 1] ?? 0,
          pixels[index + 2] ?? 0
        );
        const key = Math.round(raw * 100) / 100;
        let bin = bins.get(key);
        if (!bin) {
          bin = { pixels: 0, lit: 0, sum: 0, max: 0 };
          bins.set(key, bin);
        }
        bin.pixels++;
        if (level >= DISPLAY_FLOOR) bin.lit++;
        bin.sum += level;
        if (level > bin.max) bin.max = level;
      }
    }

    return [...bins.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([raw, bin]) => ({
        raw,
        pixels: bin.pixels,
        litFraction: bin.lit / bin.pixels,
        meanLuminance: bin.sum / bin.pixels,
        maxLuminance: bin.max,
      }));
  };

  const probe: TerminatorProbe = { frame, sample };
  (window as unknown as { terminatorProbe?: TerminatorProbe }).terminatorProbe =
    probe;

  return () => {
    delete (window as unknown as { terminatorProbe?: TerminatorProbe })
      .terminatorProbe;
  };
}
