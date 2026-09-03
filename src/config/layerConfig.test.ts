import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createCloudsMaterial,
  createPrecipMaterial,
  createSurfaceMaterial,
} from './layerConfig';
import { EARTH_OCEAN_ROUGHNESS_SETTINGS, SHADER_SETTINGS } from './engine';
import {
  TERMINATOR_WRAP_ATMOSPHERE,
  TERMINATOR_WRAP_ATMOSPHERE_SHELL,
  TERMINATOR_WRAP_CLOUDS,
  TERMINATOR_WRAP_STORM,
  TERMINATOR_WRAP_VACUUM,
  terminatorLight,
  terminatorNight,
} from '@/core/terminator';

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

describe('day/night terminator wiring', () => {
  // La COURBE elle-même (Lambert exact au-dessus de +w, extinction à pente nulle,
  // monotonie, plafond anti-inondation w/4) est testée dans src/core/terminator.test.ts,
  // sa source unique. Ici on ne teste que le CÂBLAGE : quelle largeur reçoit quelle
  // couche, et le remplacement de chaîne dans le chunk three.js.

  const wrapOf = (material: THREE.Material, uniform: string): number => {
    const shader = {
      uniforms: {},
      vertexShader: '',
      fragmentShader: '#include <common>',
    } as Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0];
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    return (shader.uniforms as Record<string, { value: number }>)[uniform]
      .value;
  };

  it('routes every layer through the shared core/terminator source', () => {
    // Le problème d'origine : six couches concentriques, six formules jour/nuit
    // indépendantes, extinctions étalées de -0.08 à -0.31 (facteur 4) — d'où des bandes
    // et des décalages au terminateur. Chaque couche doit maintenant appeler les
    // fonctions partagées, pas re-dériver sa propre rampe.
    for (const material of [
      createSurfaceMaterial(false, undefined, false, false, false, true),
      createCloudsMaterial(),
      createPrecipMaterial(),
    ]) {
      const shader = {
        uniforms: {},
        vertexShader: '',
        fragmentShader: '#include <common>\n#include <map_fragment>',
      } as Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0];
      material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      expect(shader.fragmentShader).toContain('float terminatorLight( float');
      expect(shader.fragmentShader).toContain('float terminatorDay( float');
      material.dispose();
    }
  });

  it('derives each layer width from its real altitude, not from its mesh radius', () => {
    // Une couche en altitude reste au soleil APRÈS le coucher au sol (son horizon est
    // abaissé) : c'est pourquoi les nuages rougeoient sur un sol déjà sombre. La largeur
    // vient de l'altitude réelle — les rayons de mesh (LAYER_RADIUS_SCALE) sont exagérés
    // pour la lisibilité et ne disent rien de la physique.
    const clouds = createCloudsMaterial();
    const precip = createPrecipMaterial();
    expect(wrapOf(clouds, 'uTerminatorWrap')).toBeCloseTo(
      TERMINATOR_WRAP_CLOUDS,
      12
    );
    expect(wrapOf(precip, 'uPrecipWrap')).toBeCloseTo(
      TERMINATOR_WRAP_STORM,
      12
    );
    expect(wrapOf(precip, 'uPrecipWrap')).toBeGreaterThan(
      wrapOf(clouds, 'uTerminatorWrap')
    );
    expect(wrapOf(clouds, 'uTerminatorWrap')).toBeGreaterThan(
      TERMINATOR_WRAP_ATMOSPHERE
    );
    clouds.dispose();
    precip.dispose();
  });

  it('gives the atmospheric halo the widest twilight of all', () => {
    // Le halo au limbe survit au sol ET aux nuages : c'est la dernière chose éteinte.
    expect(SHADER_SETTINGS.atmosphere.nightWrap).toBe(
      TERMINATOR_WRAP_ATMOSPHERE_SHELL
    );
    expect(SHADER_SETTINGS.atmosphere.nightWrap).toBeGreaterThan(
      TERMINATOR_WRAP_STORM
    );
  });

  it('lights the cities at sunset, not an hour later', () => {
    // Un éclairage public s'allume au COUCHER du soleil. Le réglage précédent
    // (-0.12 → -0.30) ne les allumait qu'à 6.9° sous l'horizon (~27 min après) et
    // n'atteignait le plein régime qu'à 17.5° (~70 min) : une heure de retard,
    // visible comme une bande noire entre le terminateur et les premières lumières.
    const { threshold, smoothness } = SHADER_SETTINGS.nightLights;
    // Le coucher, c'est dot = 0 exactement — le soleil pile à l'horizon.
    expect(threshold).toBe(0);
    // Plein régime à la fin du crépuscule civil (6°), ~24 min après le coucher.
    const lightsFullAt = threshold - smoothness;
    expect(-lightsFullAt).toBeCloseTo(Math.sin((6 * Math.PI) / 180), 2);
  });

  it('keeps a ground glow while the cities come up (real crossfade)', () => {
    // Au crépuscule les deux coexistent réellement : sol encore faiblement éclairé ET
    // villes allumées. Le crépuscule de surface court jusqu'à -w (18°), bien au-delà du
    // plein régime des lumières (6°) — donc aucune des deux couches ne saute.
    const { threshold, smoothness } = SHADER_SETTINGS.nightLights;
    const w = TERMINATOR_WRAP_ATMOSPHERE;
    const lightsFullAt = threshold - smoothness;
    expect(lightsFullAt).toBeGreaterThan(-w);
    expect(terminatorNight(lightsFullAt, threshold, smoothness)).toBeCloseTo(
      1,
      12
    );
    expect(terminatorLight(lightsFullAt, w)).toBeGreaterThan(0);
    // Mais la lueur a déjà nettement baissé : moins de la moitié de sa valeur au coucher.
    expect(terminatorLight(lightsFullAt, w)).toBeLessThan(
      terminatorLight(threshold, w) * 0.5
    );
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
    expect(wrapOf(withAtmosphere, 'uTerminatorWrap')).toBeGreaterThan(
      wrapOf(airless, 'uTerminatorWrap')
    );
    // 0.31 en dot = 18° = fin du crépuscule astronomique réel.
    expect(wrapOf(withAtmosphere, 'uTerminatorWrap')).toBeCloseTo(
      TERMINATOR_WRAP_ATMOSPHERE,
      12
    );
    expect(wrapOf(airless, 'uTerminatorWrap')).toBe(TERMINATOR_WRAP_VACUUM);
    withAtmosphere.dispose();
    airless.dispose();
  });
});

describe('precip layer at rest', () => {
  // Regression : la Terre s'affichait comme un soleil blanc eblouissant pendant tout le
  // chargement. La texture IMERG arrive a l'execution, donc au boot ce materiau n'a pas de
  // map : `USE_MAP` non defini => tout le remap (qui vit dans ce #ifdef) absent du programme
  // => il ne restait que la couleur de base d'un MeshBasicMaterial, blanc OPAQUE et NON
  // eclaire, sur une sphere posee devant la Terre. La couche thermique y echappait via
  // `mesh.visible = false` ; la pluie demarre visible et n'avait aucun garde-fou.
  it('draws nothing until real precipitation data arrives', () => {
    const material = createPrecipMaterial();
    // Le seul etat que voit un fragment sans map : il DOIT etre transparent.
    expect(material.opacity).toBe(0);
    expect(material.transparent).toBe(true);
    material.dispose();
  });

  it('also blanks the fragment when a map exists but the layer is not armed', () => {
    // Second etat mort, distinct du premier : map presente, uPrecipEnabled encore a 0.
    // Sans branche else, c'est de nouveau le blanc opaque du materiau qui subsiste.
    const material = createPrecipMaterial();
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <worldpos_vertex>',
      fragmentShader: '#include <common>\n#include <map_fragment>',
    } as Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0];
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('} else {');
    expect(shader.fragmentShader).toContain('diffuseColor.a = 0.0;');
    // La cle de cache doit changer avec la source, sinon un programme compile avant le
    // correctif serait reutilise tel quel.
    expect(material.customProgramCacheKey()).toBe('precip-remap-v5-sharedterm');
    material.dispose();
  });
});
