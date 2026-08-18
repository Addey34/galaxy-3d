/**
 * Construction des couches visuelles d'un corps céleste (surface · nuages · atmosphère ·
 * lumières nocturnes · anneau). Extrait de CelestialObject : ajouter un type de couche se
 * fait ici, pas dans la classe qui n'orchestre que le cycle de vie (tilt, rotation, LOD).
 */
import * as THREE from 'three';
import {
  configureShadows,
  createCloudsMaterial,
  createPrecipMaterial,
  createRingMaterial,
  createSphereGeometry,
  createSurfaceMaterial,
  createThermalMaterial,
  RING_SEGMENTS,
} from '@/config/layerConfig';
import { RENDER_SETTINGS, SHADER_SETTINGS } from '@/config/engine';
import * as NightLightsShader from '@/shaders/NightLightsShader';
import * as AtmosphereShader from '@/shaders/AtmosphereShader';
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
  const textures = config.textures ?? {};
  if (textures.surface || config.fallbackColor !== undefined)
    layers.set('surface', createSurfaceLayer(config, name));
  // Couche température de surface (MERRA-2) : réservée aux corps « type Terre » (lumières
  // nocturnes). Superposée AU-DESSUS des nuages (couche d'information). Texture fournie à
  // l'exécution par ui/thermalLayer (hors LOD).
  if (textures.lights) layers.set('thermal', createThermalLayer(config, name));
  if (textures.clouds) layers.set('clouds', createCloudsLayer(config, name));
  // Couche pluie IMERG : réservée aux corps « type Terre » (présence de lumières
  // nocturnes = Terre). La texture (frame de précipitation) est fournie à l'exécution
  // par ui/precipLayer, pas via config.textures → le LOD ne la touche pas.
  if (textures.lights) layers.set('precip', createPrecipLayer(config, name));
  // Une atmosphère est une capacité visuelle, pas une texture obligatoire : le shader
  // Fresnel peut être alimenté uniquement par atmosphereColor. Cela permet à la Terre
  // de conserver une atmosphère même lorsqu'aucun asset bitmap dédié n'est nécessaire.
  if (textures.atmosphere || config.atmosphereColor !== undefined)
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
  // Clair de Lune activé pour les corps à lumières nocturnes (Terre) : sa face
  // nuit peut être partiellement éclairée par la Lune (réflecteur).
  const hasNightLights = Boolean(config.textures?.lights);
  const material = createSurfaceMaterial(
    isSun,
    config.textures?.surface ? undefined : config.fallbackColor,
    hasNightLights,
    hasNightLights
  );
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

function createThermalLayer(
  config: CelestialBodyConfig,
  name: string
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    createSphereGeometry(config.radius, 'thermal'),
    createThermalMaterial()
  );
  mesh.name = `${name}_thermal`;
  // renderOrder = 4 : AU-DESSUS de la surface (0), des nuages (0) et de la pluie (2). La
  // température est une couche d'INFORMATION superposée qui doit rester lisible quand active
  // (sinon les nuages réels l'étouffent). Transparent, pas d'ombre.
  mesh.renderOrder = 4;
  mesh.visible = false; // activée à la demande (toggle du panneau météo)
  return mesh;
}

function createPrecipLayer(
  config: CelestialBodyConfig,
  name: string
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    createSphereGeometry(config.radius, 'precip'),
    createPrecipMaterial()
  );
  mesh.name = `${name}_precip`;
  // renderOrder au-dessus des nuages (0) : la pluie, transparente (depthWrite:false),
  // doit se composer PAR-DESSUS les nuages, sinon le tri des transparents peut la
  // rendre sous eux et la rendre invisible.
  mesh.renderOrder = 2;
  // Pas d'ombre : couche d'information transparente.
  return mesh;
}

function createAtmosphereLayer(
  config: CelestialBodyConfig,
  name: string
): THREE.Mesh {
  const settings = SHADER_SETTINGS.atmosphere;
  const color = config.atmosphereColor ?? settings.defaultColor;
  const material = new THREE.ShaderMaterial({
    vertexShader: AtmosphereShader.vertexShader,
    fragmentShader: AtmosphereShader.fragmentShader,
    uniforms: AtmosphereShader.createUniforms(color, settings),
    transparent: true,
    blending: THREE.AdditiveBlending,
    // BackSide : on ne voit que la face arrière de la sphère → un anneau de halo
    // au limbe. depthWrite off (couche additive), depthTest on pour être occulté
    // par les corps devant.
    side: THREE.BackSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(
    createSphereGeometry(config.radius, 'atmosphere'),
    material
  );
  mesh.name = `${name}_atmosphere`;
  mesh.renderOrder = 2;
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
    // depthTest ACTIVÉ : sans lui, les lumières de ville (AdditiveBlending) se
    // rendent par-dessus tout et « traversent » les corps qui passent devant la
    // Terre. Le test de profondeur les masque correctement derrière un occulteur ;
    // le léger sur-rayon (LAYER_RADIUS_SCALE.lights) + renderOrder les gardent
    // au-dessus de leur propre surface sans z-fighting.
    depthTest: true,
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(
    createSphereGeometry(config.radius, 'lights'),
    material
  );
  mesh.name = `${name}_lights`;
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
