/**
 * Halo atmosphérique par effet Fresnel (limbe lumineux autour d'un corps).
 *
 * La sphère d'atmosphère (légèrement plus grande que la surface) se rend en
 * BackSide + AdditiveBlending : on ne voit que sa face arrière, ce qui dessine
 * un anneau de lumière au bord du disque. L'intensité suit un terme Fresnel
 * `pow(1 - |N·V|, power)` (fort au limbe, nul au centre) modulé par un facteur
 * jour/nuit `N·L` — le halo s'illumine côté Soleil et s'éteint côté nuit, comme
 * la diffusion de Rayleigh réelle. Aucune passe de rendu supplémentaire : c'est
 * un simple ShaderMaterial sur un mesh déjà présent.
 */
import * as THREE from 'three';

export interface AtmosphereSettings {
  /** Puissance du Fresnel : plus haut = liseré plus fin. */
  power: number;
  /** Intensité globale du halo. */
  intensity: number;
  /** Débord côté nuit (0 = halo strictement côté jour, 1 = halo uniforme). */
  nightWrap: number;
}

export interface AtmosphereUniforms {
  uColor: THREE.IUniform<THREE.Color>;
  sunPosition: THREE.IUniform<THREE.Vector3 | null>;
  uPower: THREE.IUniform<number>;
  uIntensity: THREE.IUniform<number>;
  uNightWrap: THREE.IUniform<number>;
  // index signature requise par le type uniforms de THREE.ShaderMaterial
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: THREE.IUniform<any>;
}

export const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 sunPosition;
  uniform float uPower;
  uniform float uIntensity;
  uniform float uNightWrap;

  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    vec3 sunDir = normalize(sunPosition - vWorldPosition);

    // Fresnel : lumineux quand la surface est vue de biais (limbe), nul de face.
    float fresnel = pow(1.0 - abs(dot(normal, viewDir)), uPower);

    // Facteur jour : le halo s'illumine côté Soleil, s'éteint côté nuit.
    float dayFactor = clamp((dot(normal, sunDir) + uNightWrap) / (1.0 + uNightWrap), 0.0, 1.0);

    float glow = fresnel * dayFactor * uIntensity;
    gl_FragColor = vec4(uColor * glow, glow);
  }
`;

export function createUniforms(
  color: number,
  settings: AtmosphereSettings
): AtmosphereUniforms {
  return {
    uColor: { value: new THREE.Color(color) },
    sunPosition: { value: new THREE.Vector3(0, 0, 0) },
    uPower: { value: settings.power },
    uIntensity: { value: settings.intensity },
    uNightWrap: { value: settings.nightWrap },
  };
}
