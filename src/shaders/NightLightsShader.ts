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
    if (useNormalMap > 0.5) {
      normal = perturbNormal(vWorldPosition, normal, vUv);
    }

    // dot product : 1.0 = surface face au Soleil (plein jour), -1.0 = dos au Soleil (pleine nuit)
    float sunLight = dot(normal, sunDir);

    // La transition est entièrement du côté jour : nightFactor = 1.0 sur TOUT le côté nuit
    // (sunLight <= -smoothness) et décroît vers 0 au-delà du terminateur (sunLight = threshold).
    // smoothness crée une légère rampe côté nuit pour éviter un saut brutal.
    // Avec threshold >> smoothness, les lumières atteignent ~90% dès le terminateur exact,
    // éliminant toute zone morte entre l'ombre Three.js et l'activation du shader.
    float nightFactor = 1.0 - smoothstep(-smoothness, threshold, sunLight);

    vec4 lightsColor = texture2D(lightsMap, vUv);
    vec3 boostedColor = lightsColor.rgb * 1.5;

    // AdditiveBlending (défini côté THREE.js) : finalAlpha contrôle l'additivité.
    // Quand nightFactor = 0 (jour), les lumières disparaissent complètement.
    float finalAlpha = lightsColor.a * nightFactor * intensity;
    vec3 finalColor = boostedColor * intensity * (1.0 + nightFactor * 0.5);

    gl_FragColor = vec4(finalColor, finalAlpha);
  }
`;

export function createUniforms(settings: Partial<NightLightsSettings> = {}): NightLightsUniforms {
  return {
    lightsMap:    { value: null },
    sunPosition:  { value: null },
    intensity:    { value: settings.intensity  ?? 1.0 },
    threshold:    { value: settings.threshold  ?? 0.1 },
    smoothness:   { value: settings.smoothness ?? 0.3 },
    normalMap:    { value: null },
    normalScale:  { value: new THREE.Vector2(1, 1) },
    useNormalMap: { value: 0 },
  };
}
