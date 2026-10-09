/**
 * Sonde d'éclipse — ce que chaque matériau d'un corps REÇOIT, lu dans la scène. Activée par
 * `?debug-eclipse`, chargée à la demande (jamais au démarrage ordinaire).
 *
 * Pourquoi ce module existe (2026-10-07, ligne 45.2 de la file). La garde de
 * `e2e/eclipseLanding.spec.ts` lit une Lune totalement éclipsée GRISE (rouge/bleu 1,36 au lieu de
 * plus de 2,5), figée pendant 30 s, une fois sur plusieurs et seulement sur les processeurs lents
 * de la CI. Le correctif de #147 synchronise l'atténuation et l'ombre des carreaux de surface ;
 * la même valeur est revenue après lui, et elle ne se reproduit pas sur cette machine, même sous
 * CPU ×6. Lire le code n'a pas trouvé le chemin qui reste : il faut que l'échec, là où il se
 * produit, DISE l'état de chaque matériau. Le test imprime `eclipseProbe.state('moon')` quand sa
 * mesure échoue.
 */
import * as THREE from 'three';
import type { PublicAPI } from '@/SolarSystemApp';
import { getEclipseShadowUniforms } from '@/config/layerConfig';

/** Ce qu'un matériau du corps porte réellement à cet instant. */
export interface EclipseMaterialState {
  mesh: string;
  type: string;
  visible: boolean;
  /** `uLightAttenuation`, ou `null` si le matériau n'a pas ce canal. */
  lightAttenuation: number | null;
  /** Rayon de l'occulteur, 0 = aucune ombre, `null` = matériau sans ombre portée. */
  occluderRadius: number | null;
  occluderRefracts: number | null;
  umbraTint: [number, number, number] | null;
  color: string | null;
  map: string | null;
  /**
   * Le programme LIÉ lit-il les MÊMES objets d'uniformes que ceux du matériau (ligne 45.2) ?
   * `null` tant que le matériau n'a jamais été compilé. Un `false` voudrait dire que les
   * réglages écrivent dans des objets que le shader ne lit pas.
   */
  boundAttenuation: boolean | null;
  boundUmbraTint: boolean | null;
}

/** Un autre corps vu de la caméra : peut-il masquer celui qu'on regarde ? */
export interface EclipseScreenBody {
  body: string;
  x: number;
  y: number;
  radius: number;
  /** Distance à la caméra, en unités de scène. */
  distance: number;
}

export interface EclipseProbeState {
  body: string;
  followed: string | null;
  scaleMode: string;
  /**
   * Le CADRAGE : centre du corps en coordonnées normalisées de l'écran (0,0 au centre, ±1 aux
   * bords) et rayon apparent en fraction de la demi-hauteur. Distingue « mauvaise couleur » de
   * « Lune hors du carré que le test mesure ».
   */
  screen: { x: number; y: number; radius: number; inFront: boolean };
  /** Distance du corps regardé à la caméra, pour comparer à `others`. */
  distance: number;
  /**
   * Angle Soleil-corps-caméra en degrés (0 = face éclairée pleine, 180 = face nuit), au centre
   * du corps. Lu par la garde du démarrage par lien (ligne 45.9).
   */
  phaseDeg: number;
  /** Vrai pendant un vol caméra : la phase ne se lit qu'à l'arrivée. */
  cameraFlying: boolean;
  /** Date appliquée à la scène, et saut encore en attente de ses octets. */
  simulationDate: string;
  pendingJump: string | null;
  toneMappingExposure: number;
  /** Les corps qui pourraient se trouver devant (la Terre pendant une éclipse de Lune). */
  others: EclipseScreenBody[];
  materials: EclipseMaterialState[];
}

export interface EclipseProbe {
  state(body: string): EclipseProbeState | null;
}

function describe(
  mesh: THREE.Mesh,
  material: THREE.Material,
  renderer: THREE.WebGLRenderer
): EclipseMaterialState {
  const attenuation = material.userData['__lightAttenuationUniform'] as
    { value: number } | undefined;
  const shadow = getEclipseShadowUniforms(material);
  const standard = material as THREE.MeshStandardMaterial;
  const image = standard.map?.image as
    { width?: number; height?: number } | undefined;
  return {
    mesh: mesh.name || mesh.parent?.name || '(sans nom)',
    type: material.type,
    visible: mesh.visible && material.visible,
    lightAttenuation: attenuation ? attenuation.value : null,
    occluderRadius: shadow ? shadow.occluderRadius.value : null,
    occluderRefracts: shadow ? shadow.occluderRefracts.value : null,
    umbraTint: shadow
      ? [
          shadow.umbraTint.value.r,
          shadow.umbraTint.value.g,
          shadow.umbraTint.value.b,
        ]
      : null,
    color: standard.color ? `#${standard.color.getHexString()}` : null,
    map: image ? `${image.width ?? '?'}x${image.height ?? '?'}` : null,
    ...boundUniforms(material, renderer, attenuation, shadow?.umbraTint),
  };
}

function boundUniforms(
  material: THREE.Material,
  renderer: THREE.WebGLRenderer,
  attenuation: unknown,
  umbraTint: unknown
): { boundAttenuation: boolean | null; boundUmbraTint: boolean | null } {
  const uniforms = (
    renderer.properties.get(material) as {
      uniforms?: Record<string, unknown>;
    }
  ).uniforms;
  if (!uniforms) return { boundAttenuation: null, boundUmbraTint: null };
  return {
    boundAttenuation:
      attenuation === undefined
        ? null
        : uniforms['uLightAttenuation'] === attenuation,
    boundUmbraTint:
      umbraTint === undefined
        ? null
        : uniforms['uEclipseUmbraTint'] === umbraTint,
  };
}

function screenOf(
  api: PublicAPI,
  name: string
): (EclipseScreenBody & { inFront: boolean }) | null {
  const body = api.sceneSystem.getBody(name);
  if (!body) return null;
  const camera = api.sceneSystem.camera;
  const center = body.group.getWorldPosition(new THREE.Vector3());
  const distance = center.distanceTo(camera.position);
  const radius = body.getFrameRadius(api.orbitalMechanics.scaleMode);
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const ndc = center.clone().project(camera);
  return {
    body: name,
    x: ndc.x,
    y: ndc.y,
    radius: Math.atan2(radius, distance) / halfFov,
    distance,
    inFront: ndc.z < 1,
  };
}

function phaseOf(api: PublicAPI, name: string): number {
  const center = api.sceneSystem
    .getBody(name)!
    .group.getWorldPosition(new THREE.Vector3());
  const sun = api.sceneSystem
    .getBody('sun')
    ?.group.getWorldPosition(new THREE.Vector3());
  const toCamera = api.sceneSystem.camera.position.clone().sub(center);
  const toSun = (sun ?? new THREE.Vector3()).clone().sub(center);
  return THREE.MathUtils.radToDeg(toCamera.angleTo(toSun));
}

export function setupEclipseProbe(api: PublicAPI): void {
  const probe: EclipseProbe = {
    state(bodyName) {
      const body = api.sceneSystem.getBody(bodyName);
      if (!body) return null;
      const materials: EclipseMaterialState[] = [];
      body.group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const list = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        for (const material of list)
          materials.push(describe(mesh, material, api.sceneSystem.renderer));
      });
      const self = screenOf(api, bodyName)!;
      const others = ['earth', 'sun']
        .filter((name) => name !== bodyName)
        .map((name) => screenOf(api, name))
        .filter((other): other is NonNullable<typeof other> => other !== null)
        .map(({ body: name, x, y, radius, distance }) => ({
          body: name,
          x,
          y,
          radius,
          distance,
        }));
      const pending = api.orbitalMechanics.pendingJumpDate;
      return {
        body: bodyName,
        followed: api.cameraSystem.targetName ?? null,
        scaleMode: api.orbitalMechanics.scaleMode,
        screen: {
          x: self.x,
          y: self.y,
          radius: self.radius,
          inFront: self.inFront,
        },
        distance: self.distance,
        phaseDeg: phaseOf(api, bodyName),
        cameraFlying: api.cameraSystem.isFlying,
        simulationDate: api.orbitalMechanics.simulationDate.toISOString(),
        pendingJump: pending ? pending.toISOString() : null,
        toneMappingExposure: api.sceneSystem.renderer.toneMappingExposure,
        others,
        materials,
      };
    },
  };
  (window as unknown as { eclipseProbe?: EclipseProbe }).eclipseProbe = probe;
}
