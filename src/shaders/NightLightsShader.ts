/**
 * Shader des lumières nocturnes (villes éclairées sur la face nuit de la Terre).
 *
 * Le layer `lights` se rend en AdditiveBlending par-dessus la surface. Le shader
 * calcule, par fragment, un `nightFactor` à partir du produit scalaire normale↔Soleil :
 * les lumières s'allument côté nuit et s'éteignent côté jour. La normale est perturbée
 * avec la même normalMap que la surface, pour que le terminateur des lumières épouse
 * exactement le relief (donc l'ombre de la surface), sans bande sombre au bord.
 */
import * as THREE from 'three';

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
  // Même normalMap que la surface : le shader perturbe sa normale à l'identique
  // pour que le terminateur des lumières épouse exactement l'ombre du relief.
  normalMap: THREE.IUniform<THREE.Texture | null>;
  normalScale: THREE.IUniform<THREE.Vector2>;
  useNormalMap: THREE.IUniform<number>; // 0/1 — pas de bool fiable en GLSL1
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

export const fragmentShader = /* glsl */ `
  uniform sampler2D lightsMap;
  uniform vec3 sunPosition;
  uniform float intensity;
  uniform float threshold;
  uniform float smoothness;
  uniform sampler2D normalMap;
  uniform vec2 normalScale;
  uniform float useNormalMap;

  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec2 vUv;

  // Repère tangent reconstruit en espace écran (dérivées), sans attribut tangent —
  // c'est exactement ce que fait MeshStandardMaterial (méthode de Morten Mikkelsen).
  // Calculé en espace monde car le dot produit Soleil↔normale l'est aussi.
  vec3 perturbNormal(vec3 worldPos, vec3 surfNorm, vec2 uv) {
    vec3 q0 = dFdx(worldPos);
    vec3 q1 = dFdy(worldPos);
    vec2 st0 = dFdx(uv);
    vec2 st1 = dFdy(uv);

    vec3 N = surfNorm;
    vec3 q1perp = cross(q1, N);
    vec3 q0perp = cross(N, q0);
    vec3 T = q1perp * st0.x + q0perp * st1.x;
    vec3 B = q1perp * st0.y + q0perp * st1.y;

    float det = max(dot(T, T), dot(B, B));
    float scale = (det == 0.0) ? 0.0 : inversesqrt(det);

    vec3 mapN = texture2D(normalMap, uv).xyz * 2.0 - 1.0;
    mapN.xy *= normalScale;
    return normalize(T * (mapN.x * scale) + B * (mapN.y * scale) + N * mapN.z);
  }

  void main() {
    vec3 sunDir = normalize(sunPosition - vWorldPosition);
    vec3 normal = normalize(vNormal);

    // Perturbe la normale géométrique avec la normalMap pour que le terminateur
    // des lumières suive le relief comme l'ombre de la surface (sinon : bande
    // sombre sans lumières là où le relief décale le bord de l'ombre).
    //
    // Pas de signe négatif ici : la surface (createShadowAwareStandardMaterial, via le
    // chunk three.js normal_fragment_begin) appelle getTangentFrame(-vViewPosition, ...),
    // et vViewPosition est LUI-MÊME déjà l'opposé de la position vue réelle (voir
    // lights_fragment_begin.glsl.js : geometryPosition = -vViewPosition). Donc
    // -vViewPosition == la position vue réelle, non négée — la surface reconstruit son
    // repère tangent à partir de la position réelle du fragment, pas de son opposé.
    // L'équivalent monde de "la position réelle" est +vWorldPosition. Un signe négatif
    // ici inverserait tangente et bitangente par rapport à la surface, penchant la
    // normale perturbée du côté opposé partout où le relief a une pente (visible
    // seulement là où la normalMap a du relief, jamais sur une sphère lisse : c'est ce
    // qui produit un décalage asymétrique du terminateur, pas un simple biais uniforme).
    if (useNormalMap > 0.5) {
      normal = perturbNormal(vWorldPosition, normal, vUv);
    }

    // dot product : 1.0 = surface face au Soleil (plein jour), -1.0 = dos au Soleil (pleine nuit)
    float sunLight = dot(normal, sunDir);

    // nightFactor = 0.0 tant que sunLight >= threshold — la surface (createShadowAwareStandardMaterial,
    // autre shader) est encore visible en gris crépusculaire jusque-là, donc threshold est négatif,
    // calé sur ce point précis où elle finit de s'éteindre (voir SHADER_SETTINGS.nightLights dans
    // engine.ts) — puis nightFactor monte à 1.0 (pleine intensité) une fois sunLight <= -smoothness.
    // Sans cet alignement, les deux transitions se chevauchent : les lumières s'allument alors que
    // la surface est encore éclairée, ce qui ressemble à des lumières nocturnes qui débordent sur
    // le jour.
    float nightFactor = 1.0 - smoothstep(-smoothness, threshold, sunLight);

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
    // Repli aligné sur SHADER_SETTINGS.nightLights (config/engine.ts) : voir ce fichier pour le
    // raisonnement (synchronisation avec TERMINATOR_WRAP de layerConfig.ts).
    threshold: { value: settings.threshold ?? -0.12 },
    smoothness: { value: settings.smoothness ?? 0.18 },
    normalMap: { value: null },
    normalScale: { value: new THREE.Vector2(1, 1) },
    useNormalMap: { value: 0 },
  };
}
