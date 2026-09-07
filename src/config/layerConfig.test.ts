import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createCloudsMaterial,
  createPrecipMaterial,
  createSurfaceMaterial,
  createThermalMaterial,
  getThermalUniforms,
  THERMAL_DEFAULT_OPACITY,
} from './layerConfig';
import { EARTH_OCEAN_ROUGHNESS_SETTINGS, SHADER_SETTINGS } from './engine';
import {
  RELIEF_FADE_END,
  RELIEF_FADE_START,
  reliefFade,
  TERMINATOR_WRAP_ATMOSPHERE,
  TERMINATOR_WRAP_ATMOSPHERE_SHELL,
  TERMINATOR_WRAP_CLOUDS,
  TERMINATOR_WRAP_STORM,
  TERMINATOR_WRAP_VACUUM,
  terminatorLight,
  terminatorNight,
} from '@/core/terminator';
import { fragmentShader as nightLightsFragment } from '@/shaders/NightLightsShader';

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

    // Compression douce et NON un min(). Le clamp dur ecretait toute l'incidence rasante
    // (Fresnel -> 1) sur la meme valeur : un lisere gris uniforme, a bord franc, le long du
    // limbe — 0.20 lineaire, soit ~121/255 en sRGB, la couleur exactement relevee a l'ecran.
    // Le plafond reste le meme, mais plus aucun intervalle ne ressort constant.
    expect(shader.fragmentShader).toContain(
      'vec3 boundedSpecular = totalSpecular / ( 1.0 + totalSpecular / vec3( 0.20 ) );'
    );
    expect(shader.fragmentShader).not.toContain('min( totalSpecular');
    // Et l'extinction en incidence rasante : sans elle le plafond seul laisse un plateau
    // (mesure a l'ecran : 120/255 avec le min() dur, 83/255 avec la seule compression douce
    // — plat dans les deux cas). C'est cette ligne qui supprime la bande, pas la compression.
    expect(shader.fragmentShader).toContain(
      'boundedSpecular *= terminatorDay( specGraze - 0.125, 0.125 );'
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

  it('lights the cities at sunset, and nothing before it', () => {
    // Le coucher, c'est dot = 0 exactement — le soleil pile a l'horizon. Au-dessus, rien :
    // aucune lumiere de ville nulle part sur le cote eclaire.
    const { threshold, smoothness } = SHADER_SETTINGS.nightLights;
    expect(threshold).toBe(0);
    for (let raw = 1; raw >= 0; raw -= 0.001) {
      expect(terminatorNight(raw, threshold, smoothness)).toBe(0);
    }
    // Ne PAS reculer ce seuil : voir le commentaire de SHADER_SETTINGS.nightLights. Un seuil
    // recule rouvre le bandeau noir entre l'ombre et les premieres lumieres.
    expect(smoothness).toBe(TERMINATOR_WRAP_ATMOSPHERE);
  });

  it('covers exactly the same band as the ground twilight', () => {
    // Le calage qui empeche les villes de briller a plein regime sur un sol encore eclaire :
    // les deux rampes couvrent la MEME bande (0 -> -w) et s'eteignent ensemble.
    const { threshold, smoothness } = SHADER_SETTINGS.nightLights;
    const w = TERMINATOR_WRAP_ATMOSPHERE;
    const bothEndAt = threshold - smoothness;
    expect(bothEndAt).toBe(-w);
    expect(terminatorNight(bothEndAt, threshold, smoothness)).toBeCloseTo(
      1,
      12
    );
    expect(terminatorLight(bothEndAt, w)).toBe(0);
    // Croisement reel a mi-bande : sol encore allume, villes deja bien montees.
    const mid = threshold - smoothness / 2;
    expect(terminatorLight(mid, w)).toBeGreaterThan(0);
    expect(terminatorNight(mid, threshold, smoothness)).toBeGreaterThan(0.3);
    // Mais la lueur a deja nettement baisse : moins de la moitie de sa valeur au coucher.
    expect(terminatorLight(mid, w)).toBeLessThan(
      terminatorLight(threshold, w) * 0.5
    );
  });

  it('decides the night mask on the same normal the surface shades with', () => {
    // LE defaut de centrage : deux couches concentriques qui decident du MEME terminateur a
    // partir de deux normales differentes ne peuvent pas coincider. La surface abandonne la
    // normal map avant le terminateur (reliefFade) ; la rampe des villes vit entierement dans
    // cette zone. Le masque doit donc s'y calculer sur la normale geometrique.
    const { threshold, smoothness } = SHADER_SETTINGS.nightLights;

    // 1. La coupe de relief est TERMINEE avant que la rampe des villes ne commence.
    expect(reliefFade(threshold)).toBe(0);
    // ... et sur toute la bande ou elle varie, jusqu'a son plein regime.
    for (let raw = threshold; raw >= threshold - smoothness; raw -= 0.001) {
      expect(reliefFade(raw)).toBe(0);
    }

    // 2. Le shader ne perturbe donc AUCUNE normale : pas de normalMap, pas de repere tangent.
    // Une regression y reintroduirait un bord de lumieres sculpte par le relief, en avance
    // la ou le terrain penche a l'oppose du Soleil et en retard la ou il penche vers lui.
    // Sur le CODE seul : les commentaires du shader parlent legitimement de la normal map
    // pour expliquer pourquoi elle n'est pas la.
    const code = nightLightsFragment.replace(/\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/normalMap|perturbNormal|dFdx/);
    expect(code).toContain('float sunLight = dot(normal, sunDir)');
  });

  it('derives every terminator direction per fragment, never from the body centre', () => {
    // Le dernier defaut de centrage, invisible en Explo et bien reel en Educatif : une
    // direction du Soleil unique pour toute la sphere est fausse de asin(R/D), le demi-angle
    // sous lequel le corps voit le Soleil. En Educatif les distances sont compressees mais
    // pas les rayons — la Terre y fait 1 unite pour 35 de distance, soit 1,64°, l'ordre de
    // grandeur des largeurs de crepuscule elles-memes.
    //
    // Les couches qui calculent DEJA par fragment (eclairage direct three.js, lumieres de
    // ville, halo atmospherique, pluie) fixent la reference : toute autre formule s'en ecarte
    // d'un biais systematique. On verrouille donc la forme du calcul, pas une valeur.
    const surface = createSurfaceMaterial(
      false,
      undefined,
      true,
      true,
      true,
      true
    );
    const clouds = createCloudsMaterial();

    for (const material of [surface, clouds]) {
      const shader = {
        uniforms: {},
        vertexShader: '#include <common>\n#include <worldpos_vertex>',
        fragmentShader:
          '#include <common>\n#include <map_fragment>\n#include <normal_fragment_maps>\n' +
          'vec3 outgoingLight = (totalDiffuse + totalSpecular) * uLightAttenuation + totalEmissiveRadiance;',
      } as Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0];
      material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);

      // L'uniform porte une POSITION monde, dont le shader derive sa direction par fragment.
      expect(shader.uniforms).toHaveProperty('uMoonSunPos');
      expect(shader.fragmentShader).toContain(
        'return normalize( uMoonSunPos - vMoonWorldPos );'
      );
      // Aucun masque ne consomme l'uniform directement comme s'il etait deja une direction.
      const code = shader.fragmentShader.replace(/\/\/[^\n]*/g, '');
      expect(code).not.toMatch(/normalize\(\s*uMoonSunPos\s*\)/);
      expect(code).not.toContain('uMoonSunDir');
      material.dispose();
    }
  });

  it('keeps every night-only layer off the lit side, not just the city lights', () => {
    // La regle produit ne vaut pas que pour les villes : TOUTE couche qui n'existe que la
    // nuit doit etre a zero strict des que le Soleil est au-dessus de l'horizon. Le clair de
    // Lune y derogeait en roulant sa propre formule (1 - terminatorDay), dont la bande part
    // de +wrap au lieu de 0 : 49,8 % de masque au terminateur, encore visible 6° au-dessus.
    // Invisible a l'oeil vu MOONLIGHT_MAX_STRENGTH, mais c'est une divergence de regle — et
    // une formule de moins a maintenir a part depuis qu'elle passe par la fonction partagee.
    const w = TERMINATOR_WRAP_ATMOSPHERE;
    for (let raw = 0; raw <= w; raw += 0.002) {
      expect(terminatorNight(raw, 0, w)).toBe(0);
    }

    // Et le shader consomme bien la fonction partagee, pas une formule maison.
    const surface = createSurfaceMaterial(
      false,
      undefined,
      true,
      true,
      true,
      true
    );
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <worldpos_vertex>',
      fragmentShader:
        '#include <common>\nvec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
    } as Parameters<NonNullable<THREE.Material['onBeforeCompile']>>[0];
    surface.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain(
      'float nightMask = terminatorNight('
    );
    expect(shader.fragmentShader).not.toContain('1.0 - terminatorDay(');
    surface.dispose();
  });

  it('fades the relief out over a band that sits entirely in daylight', () => {
    // La coupe doit se terminer AVANT l'ombre, jamais dedans : une normal map encore active
    // dans la bande deja sombre dessine des contours durs sur la face nuit.
    expect(RELIEF_FADE_END).toBe(0);
    expect(RELIEF_FADE_START).toBeGreaterThan(RELIEF_FADE_END);
    expect(reliefFade(RELIEF_FADE_END)).toBe(0);
    expect(reliefFade(RELIEF_FADE_START)).toBe(1);
    // Monotone et strictement interieure entre les deux bornes.
    let previous = 0;
    for (let raw = RELIEF_FADE_END; raw <= RELIEF_FADE_START; raw += 0.005) {
      const value = reliefFade(raw);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('leaves no dark gap between the shadow and the first lights', () => {
    // LE defaut a ne jamais reintroduire : un intervalle ou le sol est deja eteint et ou les
    // villes ne sont pas encore allumees se voit comme un bandeau noir le long du terminateur.
    //
    // Ce test verifiait autrefois que les deux rampes sont STRICTEMENT POSITIVES sur la bande.
    // C'etait vide de sens : deux smootherstep sur un intervalle ouvert le sont toujours, et
    // 0,5 % + 0,5 % passe l'assertion en etant noir a l'ecran. Il n'a donc rien vu quand la
    // marge sombre etait bien la — mesuree a 0,65 du niveau au terminateur vers 1,9°.
    //
    // La vraie propriete est un CREUX : la somme des deux contributions, normalisee par sa
    // valeur au terminateur, ne doit jamais redescendre en dessous de 1. Le sol part de
    // wrap/4 et s'effondre ; les villes doivent monter au moins aussi vite, des le coucher.
    const { threshold, smoothness } = SHADER_SETTINGS.nightLights;
    const w = TERMINATOR_WRAP_ATMOSPHERE;
    const reference = terminatorLight(0, w);
    expect(reference).toBeGreaterThan(0);

    for (let raw = 0; raw > -w; raw -= 0.0005) {
      const ground = terminatorLight(raw, w) / reference;
      const cities = terminatorNight(raw, threshold, smoothness);
      expect(ground + cities).toBeGreaterThanOrEqual(1);
    }

    // Et les deux bornes dures que la forme de la courbe ne doit jamais sacrifier.
    expect(terminatorNight(threshold, threshold, smoothness)).toBe(0);
    expect(terminatorNight(1e-9, threshold, smoothness)).toBe(0);
    expect(terminatorNight(threshold - smoothness, threshold, smoothness)).toBe(
      1
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

describe('thermal layer at rest', () => {
  it('draws nothing until real temperature data arrives', () => {
    // Meme classe de bug que la pluie, declenchee par le TOGGLE au lieu du boot :
    // observedTextureLayer rend le mesh visible des le clic, la tuile GIBS n'arrive
    // qu'ensuite. Entre les deux, un MeshBasicMaterial sans map rend sa couleur de base —
    // blanc opaque, non eclaire — sur toute la planete. Le `mesh.visible = false` initial
    // ne protegeait que le boot, pas l'activation.
    const material = createThermalMaterial();
    expect(material.opacity).toBe(0);
    expect(material.transparent).toBe(true);
    expect(material.map).toBeNull();
    material.dispose();
  });

  it('carries the configured opacity as the value to restore, not a hardcoded one', () => {
    // L'opacite cible vit dans userData et n'est appliquee au materiau qu'a l'assignation
    // de la map (CelestialObject.setThermalTexture). Elle doit donc rester lisible ici,
    // sinon la couche resterait invisible une fois la donnee arrivee.
    const material = createThermalMaterial();
    const uniforms = getThermalUniforms(material);
    expect(uniforms?.opacity.value).toBe(THERMAL_DEFAULT_OPACITY);
    expect(THERMAL_DEFAULT_OPACITY).toBeGreaterThan(0);
    expect(uniforms?.enabled.value).toBe(0);
    material.dispose();
  });
});
