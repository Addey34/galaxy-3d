/**
 * Construction des couches visuelles d'un corps céleste (surface · nuages · atmosphère ·
 * lumières nocturnes · anneau). Extrait de CelestialObject : ajouter un type de couche se
 * fait ici, pas dans la classe qui n'orchestre que le cycle de vie (tilt, rotation, LOD).
 */
import * as THREE from 'three';
import {
  configureShadows,
  createAtmosphereMaterial,
  createCloudsMaterial,
  createRingMaterial,
  createSphereGeometry,
  createSurfaceMaterial,
  RING_SEGMENTS,
} from '@/config/layerConfig';
import { RENDER_SETTINGS, SHADER_SETTINGS } from '@/config/engine';
import * as NightLightsShader from '@/shaders/NightLightsShader';
import type { CelestialBodyConfig } from '@/types';

/**
 * Crée toutes les couches applicables selon la config et les renvoie indexées par nom.
 * La couche `ring` a une texture chargée à part (voir CelestialObject._loadRingTexture).
 */
export function buildLayers(
  config: CelestialBodyConfig,
  name: string
): Map<string, THREE.Mesh> {
  const layers = new Map<string, THREE.Mesh>();
  const { textures } = config;
  if (textures.surface) layers.set('surface', createSurfaceLayer(config, name));
  if (textures.clouds) layers.set('clouds', createCloudsLayer(config, name));
  if (textures.atmosphere)
    layers.set('atmosphere', createAtmosphereLayer(config, name));
  if (textures.lights) layers.set('lights', createLightsLayer(config, name));
  if (config.ring) layers.set('ring', createRingLayer(config, name));
  return layers;
}

function createSurfaceLayer(
  config: CelestialBodyConfig,
  name: string
): THREE.Mesh {
  const isSun = name === 'sun';
  const material = createSurfaceMaterial(isSun);
  const mesh = new THREE.Mesh(
    createSphereGeometry(config.radius, 'surface'),
    material
  );
  mesh.name = `${name}_surface`;
  if (RENDER_SETTINGS.shadowMap.enabled && !isSun)
    configureShadows(mesh, true, true);
  return mesh;
}

function createCloudsLayer(
  config: CelestialBodyConfig,
  name: string
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    createSphereGeometry(config.radius, 'clouds'),
    createCloudsMaterial()
  );
  mesh.name = `${name}_clouds`;
  if (RENDER_SETTINGS.shadowMap.enabled) configureShadows(mesh, false, true);
  return mesh;
}

function createAtmosphereLayer(
  config: CelestialBodyConfig,
  name: string
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    createSphereGeometry(config.radius, 'atmosphere'),
    createAtmosphereMaterial()
  );
  mesh.name = `${name}_atmosphere`;
  return mesh;
}

function createLightsLayer(
  config: CelestialBodyConfig,
  name: string
): THREE.Mesh {
  const settings = SHADER_SETTINGS.nightLights;
  const uniforms = NightLightsShader.createUniforms(settings);
  uniforms.sunPosition.value = new THREE.Vector3(0, 0, 0);

  const material = new THREE.ShaderMaterial({
    vertexShader: NightLightsShader.vertexShader,
    fragmentShader: NightLightsShader.fragmentShader,
    uniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    // depthTest: false — le depth buffer 24-bit ne peut pas distinguer le layer lights
    // (R×1.002) de la surface (R) au limbe de la sphère dès que la caméra dépasse ~12u.
    // Ça créait une barre noire verticale sur le côté ombre du limbe.
    // FrontSide + le shader (nightFactor=0 sur le jour) assurent que rien
    // d'incorrect n'est rendu — le depth test n'apporte rien ici.
    depthTest: false,
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(
    createSphereGeometry(config.radius, 'lights'),
    material
  );
  mesh.name = `${name}_lights`;
  // renderOrder > 0 : le layer lights se rend après les nuages (renderOrder=0 par défaut)
  // pour que son AdditiveBlending s'applique APRÈS le blend des nuages, pas dessous.
  mesh.renderOrder = 1;
  return mesh;
}

function createRingLayer(
  config: CelestialBodyConfig,
  name: string
): THREE.Mesh {
  const ring = config.ring!;
  const inner = config.radius * ring.innerRadius;
  const outer = config.radius * ring.outerRadius;

  const geometry = new THREE.RingGeometry(inner, outer, RING_SEGMENTS);
  correctRingUVs(geometry, inner, outer);

  const mesh = new THREE.Mesh(geometry, createRingMaterial());
  mesh.name = `${name}_ring`;
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function correctRingUVs(
  geometry: THREE.RingGeometry,
  innerRadius: number,
  outerRadius: number
): void {
  const pos = geometry.attributes['position'] as THREE.BufferAttribute;
  const uv = geometry.attributes['uv'] as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const dist = Math.sqrt(pos.getX(i) ** 2 + pos.getY(i) ** 2);
    const u = (dist - innerRadius) / (outerRadius - innerRadius);
    uv.setXY(i, u, uv.getY(i));
  }
}
