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
}

export interface EclipseProbeState {
  body: string;
  followed: string | null;
  scaleMode: string;
  materials: EclipseMaterialState[];
}

export interface EclipseProbe {
  state(body: string): EclipseProbeState | null;
}

function describe(
  mesh: THREE.Mesh,
  material: THREE.Material
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
  };
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
        for (const material of list) materials.push(describe(mesh, material));
      });
      return {
        body: bodyName,
        followed: api.cameraSystem.targetName ?? null,
        scaleMode: api.orbitalMechanics.scaleMode,
        materials,
      };
    },
  };
  (window as unknown as { eclipseProbe?: EclipseProbe }).eclipseProbe = probe;
}
