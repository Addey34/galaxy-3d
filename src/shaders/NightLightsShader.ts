/**
 * Shader des lumières nocturnes (villes éclairées sur la face nuit de la Terre).
 *
 * Le layer `lights` se rend en AdditiveBlending par-dessus la surface. Le shader
 * calcule, par fragment, un `nightFactor` à partir du produit scalaire normale↔Soleil :
 * les lumières s'allument côté nuit et s'éteignent côté jour.
 *
 * La normale employée est la normale GÉOMÉTRIQUE, jamais une normale perturbée par la
 * normalMap — parce que c'est celle que la surface utilise elle aussi sur toute la bande où
 * ce masque se construit (`RELIEF_FADE_END`, cf. `core/terminator.ts` pour l'historique du
 * bug que ce choix corrige). Deux couches concentriques qui décident d'un même terminateur à
 * partir de deux normales différentes ne peuvent pas coïncider.
 */
import * as THREE from 'three';
import { CIVIL_TWILIGHT_DOT, TERMINATOR_GLSL } from '@/core/terminator';

interface NightLightsSettings {
  intensity: number;
  threshold: number;
  smoothness: number;
}

export interface NightLightsUniforms {
  lightsMap: THREE.IUniform<THREE.Texture | null>;
  sunPosition: THREE.IUniform<THREE.Vector3 | null>;
  intensity: THREE.IUniform<number>;
  threshold: THREE.IUniform<number>;
  smoothness: THREE.IUniform<number>;
  // Pas de normalMap ici, volontairement : voir l'en-tête du module. Le masque nuit se
  // décide sur la normale géométrique, la seule que la surface utilise elle aussi dans
  // cette bande.
  // index signature required by THREE.ShaderMaterial uniforms type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: THREE.IUniform<any>;
}

export const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const fragmentShader =
  TERMINATOR_GLSL +
  /* glsl */ `
  uniform sampler2D lightsMap;
  uniform vec3 sunPosition;
  uniform float intensity;
  uniform float threshold;
  uniform float smoothness;

  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;

  void main() {
    vec3 sunDir = normalize(sunPosition - vWorldPosition);
    // Normale GÉOMÉTRIQUE, jamais perturbée par la normalMap.
    //
    // Le shader perturbait autrefois sa normale à l'identique de la surface, pour que le
    // terminateur des lumières épouse le relief comme l'ombre. Cet argument est devenu FAUX
    // le jour où la surface a cessé, elle, de suivre le relief près du terminateur : elle
    // fond sa normale perturbée vers la géométrique et l'a totalement abandonnée dès
    // dot(N, Soleil) ≤ RELIEF_FADE_END = 0 (cf. core/terminator.ts). Or c'est exactement là
    // que vit la rampe des villes — elle part de 0 vers le négatif. Les deux couches
    // décidaient donc du même terminateur avec deux normales différentes sur 100 % de la
    // bande utile, d'où un bord de lumières qui suit les pentes du terrain au lieu de suivre
    // l'ombre : villes côté jour d'un côté, sol noir sans villes de l'autre.
    //
    // On ne peut pas non plus « rétablir » la perturbation côté surface : elle y a été
    // coupée pour une raison physique (à lumière rasante, les micro-facettes passent en fort
    // contraste et dessinent des contours durs sur la face nuit). La seule normale sur
    // laquelle les deux couches peuvent s'accorder dans cette bande est donc la géométrique.
    // Y appliquer reliefFade() serait un no-op coûteux : il vaut 0 sur toute la bande.
    vec3 normal = normalize(vNormal);

    // dot product : 1.0 = surface face au Soleil (plein jour), -1.0 = dos au Soleil (pleine nuit)
    float sunLight = dot(normal, sunDir);

    // nightFactor = 0.0 tant que sunLight >= threshold, puis monte à 1.0 une fois
    // sunLight <= threshold - smoothness. Avec threshold = 0 (le coucher du soleil : le Soleil
    // pile à l'horizon) la rampe couvre 0° → 6° sous l'horizon — les villes s'allument AU
    // coucher, comme un vrai éclairage public, et finissent de monter pendant le crépuscule
    // civil. Voir SHADER_SETTINGS.nightLights dans engine.ts pour le raisonnement complet.
    //
    // Aucun débordement possible sur le jour : au-dessus du seuil le clamp force t = 0 donc
    // nightFactor = 0 EXACTEMENT. C'est la crainte qui avait fait reculer le seuil à -0.12
    // (~27 min de retard à l'allumage, ~70 min au plein régime) — elle était infondée, et le
    // retard se voyait comme une bande noire entre le terminateur et les premières lumières.
    //
    // La borne basse DOIT rester threshold - smoothness, pas -smoothness seule : cette
    // confusion donnait une rampe de 0.06 en dot (~3.4°) au lieu de la largeur voulue,
    // quasi un cutoff dur perçu comme « noir d'un coup » — bug corrigé ici.
    //
    // smootherstep (Ken Perlin, 6t^5-15t^4+10t^3) plutôt que smoothstep cubique : dérivée SECONDE
    // nulle aux deux bornes (pas seulement la première), donc le raccord avec les paliers plats
    // (0 avant, 1 après) est imperceptible — pas de « coude » visible au début/fin de la rampe.
    float nightFactor = terminatorNight(sunLight, threshold, smoothness);

    vec4 lightsColor = texture2D(lightsMap, vUv);

    // La texture « black marble » NASA n'a PAS un fond noir : océans et continents
    // non éclairés sont d'un bleu nuit sombre. En AdditiveBlending, ce fond bleu
    // s'ajoute sur TOUTE la face nuit → halo bleuté irréaliste au lieu de villes
    // ponctuelles. On isole donc les vraies lumières : on retire un plancher de
    // luminance (le fond) et on ne garde que ce qui dépasse, ce qui éteint le bleu
    // diffus tout en préservant les points de ville (ambrés, haute luminance).
    float lum = dot(lightsColor.rgb, vec3(0.299, 0.587, 0.114));
    // Plancher = niveau du fond bleu ; en dessous → éteint. Remap au-dessus pour
    // restaurer le contraste des villes.
    float cityMask = smoothstep(0.06, 0.16, lum);
    vec3 cityColor = lightsColor.rgb * cityMask;

    // AdditiveBlending (défini côté THREE.js) : finalAlpha contrôle l'additivité.
    // Quand nightFactor = 0 (jour), les lumières disparaissent complètement.
    float finalAlpha = cityMask * nightFactor * intensity;
    vec3 finalColor = cityColor * intensity * 1.5;

    gl_FragColor = vec4(finalColor, finalAlpha);
  }
`;

export function createUniforms(
  settings: Partial<NightLightsSettings> = {}
): NightLightsUniforms {
  return {
    lightsMap: { value: null },
    sunPosition: { value: null },
    intensity: { value: settings.intensity ?? 1.0 },
    // Repli aligné sur SHADER_SETTINGS.nightLights (config/engine.ts) : allumage au coucher
    // (0 strict — rien côté jour) et plein régime à la fin du crépuscule civil, soit
    // exactement la bande que couvre le crépuscule du sol.
    threshold: { value: settings.threshold ?? 0.0 },
    smoothness: { value: settings.smoothness ?? CIVIL_TWILIGHT_DOT },
  };
}
