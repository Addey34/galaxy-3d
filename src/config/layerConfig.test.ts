import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createCloudsMaterial, createSurfaceMaterial } from './layerConfig';
import { EARTH_OCEAN_ROUGHNESS_SETTINGS, SHADER_SETTINGS } from './engine';

describe('MODIS cloud-fraction shader', () => {
  it('converts NASA percentage palette values to shader fractions', () => {
    const material = createCloudsMaterial();
    const shader = {
      uniforms: {},
      vertexShader: '',
      fragmentShader: '#include <common>\n#include <map_fragment>',
    } as Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0];

    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);

    expect(shader.fragmentShader).toContain('return (12.0 + g) / 100.0;');
    expect(shader.fragmentShader).toContain('return (95.0 + b) / 100.0;');
    expect(shader.fragmentShader).not.toContain('return 12.0 + g / 100.0;');
    expect(shader.fragmentShader).toContain(
      'float dayGapAlpha = dayAlpha * ( 1.0 - nightCoverage )'
    );
    expect(shader.fragmentShader).toContain('uCloudOpticalBlendRadiusTexels');
    expect(shader.fragmentShader).toContain(
      'float supplementalAlpha = max( nightFallbackAlpha, dayGapAlpha );'
    );
    // Jonction True Color ↔ masques MODIS : la True Color n'est JAMAIS atténuée (max, pas mix →
    // les nuages ne peuvent pas disparaître) ; le masque ne COMBLE que là où l'optique est faible
    // (pas de doublon en plein jour), pour une jonction douce au Sud sans « déchirure ».
    expect(shader.fragmentShader).toContain(
      'float supplementalFill = supplementalAlpha * ( 1.0 - opticalAvailability );'
    );
    expect(shader.fragmentShader).toContain(
      'rcAlpha = max( rcAlpha, supplementalFill );'
    );
    expect(shader.fragmentShader).toContain('( 1.0 - nightCoverage );');
    expect(shader.fragmentShader).not.toContain(
      'mix( rcAlpha, dayAlpha, dayCoverage )'
    );
    material.dispose();
  });
});

describe('Earth ocean PBR shader', () => {
  it('keeps Three.js specular lighting and maps white ocean data to low roughness', () => {
    const material = createSurfaceMaterial(false, undefined, false, true);
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <worldpos_vertex>',
      fragmentShader:
        '#include <common>\n' +
        'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n' +
        'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;\n' +
        '#include <map_fragment>\n' +
        'roughnessFactor *= texelRoughness.g;',
    } as Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0];

    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);

    expect(shader.fragmentShader).toContain(
      'vec3 boundedSpecular = min( totalSpecular, vec3( 0.20 ) );'
    );
    expect(shader.fragmentShader).toContain(
      'roughnessFactor = mix( 0.92, earthOceanRoughness( vMapUv ), texelRoughness.g );'
    );
    expect(shader.fragmentShader).toContain(
      'uniform float uEarthOceanRoughnessVariation;'
    );
    expect(material.customProgramCacheKey()).toContain('-invrough-v2');
    expect(material.customProgramCacheKey()).toContain('-oceanrough-v1');
    expect(EARTH_OCEAN_ROUGHNESS_SETTINGS.oceanBase).toBe(0.06);
    expect(EARTH_OCEAN_ROUGHNESS_SETTINGS.oceanMin).toBeGreaterThanOrEqual(
      0.03
    );
    expect(EARTH_OCEAN_ROUGHNESS_SETTINGS.oceanMax).toBeLessThanOrEqual(0.15);
    expect(EARTH_OCEAN_ROUGHNESS_SETTINGS.oceanVariation).toBeLessThan(0.04);
    expect(shader.fragmentShader).toContain('cloudDirectFactor');
    expect(
      shader.fragmentShader.indexOf('float cloudDirectFactor')
    ).toBeLessThan(shader.fragmentShader.indexOf('#ifdef USE_MAP'));
    expect(shader.fragmentShader).not.toContain('gOceanSpec');
    expect(shader.fragmentShader).not.toContain('uGlintStrength');
    material.dispose();
  });
});

describe('day/night terminator falloff', () => {
  // Réplique EXACTE de TERMINATOR_FALLOFF_GLSL (layerConfig.ts). Si la formule du
  // shader change, ce miroir doit changer avec — les assertions ci-dessous décrivent
  // les propriétés que la courbe DOIT garder, pas la formule elle-même.
  const dotNL = (raw: number, w: number): number => {
    const t = Math.min(Math.max((raw + w) / (2 * w), 0), 1);
    return Math.min(Math.max(Math.max(raw, w * t * t), 0), 1);
  };

  const wrapOf = (material: THREE.Material): number => {
    const shader = {
      uniforms: {},
      vertexShader: '',
      fragmentShader: '#include <common>',
    } as Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0];
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    return (shader.uniforms as Record<string, { value: number }>)[
      'uTerminatorWrap'
    ].value;
  };

  it('leaves the lit side as exact Lambert', () => {
    // Le wrap linéaire précédent surexposait TOUT le disque (+11 % à raw=0.5) : le jour
    // était délavé. Au-delà de w la courbe doit rendre le dot brut, à l'identique.
    for (const raw of [0.31, 0.5, 0.75, 1.0])
      expect(dotNL(raw, 0.31)).toBeCloseTo(raw, 6);
  });

  it('reaches zero with a zero slope, not a hard edge', () => {
    // La cause du « noir d'un coup » : le wrap linéaire touchait 0 avec une pente non
    // nulle → cassure de dérivée = arête franche visible. Ici l'extinction est tangente,
    // donc la dérivée doit tendre vers 0 en approchant -w.
    const w = 0.31;
    expect(dotNL(-w, w)).toBe(0);
    const eps = 1e-4;
    const slopeNearEnd = (dotNL(-w + eps, w) - dotNL(-w, w)) / eps;
    const slopeMidBand = (dotNL(-w / 2 + eps, w) - dotNL(-w / 2, w)) / eps;
    expect(slopeNearEnd).toBeLessThan(0.01);
    expect(slopeMidBand).toBeGreaterThan(slopeNearEnd * 10);
  });

  it('stays continuous and monotonic across the whole band', () => {
    const w = 0.31;
    let previous = -1;
    for (let raw = -1; raw <= 1.0001; raw += 0.005) {
      const value = dotNL(raw, w);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = value;
    }
  });

  it('keeps the geometric terminator dim enough not to flood the night side', () => {
    // Le garde-fou qui rend l'élargissement à 18° sûr : un wrap LINÉAIRE à w=0.31
    // éclairerait la bande à w/(1+w) ≈ 0.237 (le « flood bleu »). La queue quadratique
    // ne donne que w/4 — c'est pourquoi on peut élargir sans inonder la face nuit.
    const w = 0.31;
    expect(dotNL(0, w)).toBeCloseTo(w / 4, 6);
    expect(dotNL(0, w)).toBeLessThan(w / (1 + w) / 3);
  });

  it('hands over to the city lights before the twilight glow dies', () => {
    // Fondu-enchaîné surface ↔ lumières : à threshold la lueur du sol doit avoir
    // largement retombé (sinon les villes « bavent » sur le jour), et elle doit
    // s'éteindre APRÈS que les lumières aient atteint leur plein régime.
    const w = 0.31;
    const { threshold, smoothness } = SHADER_SETTINGS.nightLights;
    const lightsFullAt = threshold - smoothness;
    expect(dotNL(threshold, w)).toBeLessThan(dotNL(0, w) * 0.4);
    expect(lightsFullAt).toBeGreaterThan(-w);
    expect(dotNL(lightsFullAt, w)).toBeLessThan(0.001);
  });

  it('still matches the string three.js actually ships (upgrade guard)', () => {
    // Le crepuscule est injecte par un remplacement de chaine dans le chunk three.js.
    // Si une mise a jour de three reformule cette ligne, le remplacement devient un
    // no-op SILENCIEUX : plus de degrade du tout, et aucune erreur nulle part. Ce test
    // est le seul endroit ou cette rupture est detectable.
    const chunk = THREE.ShaderChunk['lights_physical_pars_fragment'];
    const target =
      'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );';
    expect(chunk).toContain(target);
    // Une seule occurrence : String.replace ne remplace que la premiere.
    expect(chunk.split(target).length - 1).toBe(1);
  });

  it('gives an atmosphere-bearing body a wider terminator than an airless one', () => {
    // La largeur est une propriété du CORPS (l'atmosphère diffuse), pas un réglage global :
    // élargir la Terre ne doit pas adoucir la Lune ou Mercure.
    const withAtmosphere = createSurfaceMaterial(
      false,
      undefined,
      false,
      false,
      false,
      true
    );
    const airless = createSurfaceMaterial(false, undefined, false, false);
    expect(wrapOf(withAtmosphere)).toBeGreaterThan(wrapOf(airless));
    // 0.31 en dot = 18° = fin du crépuscule astronomique réel.
    expect(wrapOf(withAtmosphere)).toBeCloseTo(
      Math.sin((18 * Math.PI) / 180),
      2
    );
    withAtmosphere.dispose();
    airless.dispose();
  });
});
