/**
 * Analytic single-pass atmosphere: spectral Rayleigh plus anisotropic Mie scattering.
 * The shell is rendered BackSide + AdditiveBlending. This is intentionally a lightweight
 * approximation, not a volumetric ray marcher: it preserves the useful visual signals
 * (blue daylight, warm twilight edge, deep-night extinction) at one fragment pass.
 */
import * as THREE from 'three';

export interface AtmosphereSettings {
  /** Edge profile power: higher values make the atmospheric rim thinner. */
  power: number;
  /** Global scattering intensity. */
  intensity: number;
  /** Small twilight wrap; deep night remains extinguished. */
  nightWrap: number;
  /** Wavelength-dependent Rayleigh gain. */
  rayleighStrength: number;
  /** White, forward-peaked Mie gain. */
  mieStrength: number;
  /** Henyey-Greenstein anisotropy, clamped in the shader. */
  mieG: number;
  /** Solar optical-path scale near the terminator. */
  opticalDepth: number;
}

export interface AtmosphereUniforms {
  uColor: THREE.IUniform<THREE.Color>;
  sunPosition: THREE.IUniform<THREE.Vector3 | null>;
  uPower: THREE.IUniform<number>;
  uIntensity: THREE.IUniform<number>;
  uNightWrap: THREE.IUniform<number>;
  uRayleighStrength: THREE.IUniform<number>;
  uMieStrength: THREE.IUniform<number>;
  uMieG: THREE.IUniform<number>;
  uOpticalDepth: THREE.IUniform<number>;
  // Required by THREE.ShaderMaterial's uniform type.
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
  uniform float uRayleighStrength;
  uniform float uMieStrength;
  uniform float uMieG;
  uniform float uOpticalDepth;

  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    vec3 sunDir = normalize(sunPosition - vWorldPosition);

    float viewCos = abs(dot(normal, viewDir));
    float rim = pow(1.0 - viewCos, uPower);
    float sunCos = dot(normal, sunDir);

    // The shell fades through the terminator and is black on deep night.
    float dayFactor = smoothstep(-uNightWrap, 0.28, sunCos);
    float twilight = exp(-pow(abs(sunCos) / 0.32, 2.0)) * dayFactor;

    // Rayleigh phase: wavelength-dependent and symmetric front/back.
    float mu = dot(sunDir, viewDir);
    float rayleighPhase = 0.0596831 * (1.0 + mu * mu); // 3 / (16*pi)
    vec3 rayleighBeta = vec3(0.58, 1.35, 3.31);

    // Mie phase: white and forward-peaked around the solar direction.
    float g = clamp(uMieG, 0.0, 0.95);
    float mieDenominator = pow(1.0 + g * g - 2.0 * g * mu, 1.5);
    float miePhase = (1.0 - g * g) / (12.56637 * max(mieDenominator, 0.0001));

    // Longer solar paths near the terminator remove more short wavelengths.
    float sunPath = 1.0 + uOpticalDepth * twilight;
    vec3 transmission = exp(-rayleighBeta * sunPath * 0.18);
    vec3 rayleigh = rayleighBeta * rayleighPhase * transmission * uRayleighStrength;
    vec3 mie = vec3(miePhase) * transmission * uMieStrength;

    vec3 dayColor = rayleigh + mie;
    vec3 warmColor = vec3(1.0, 0.32, 0.08) * (rayleighPhase + miePhase);
    vec3 scattering = mix(dayColor, mix(dayColor, warmColor, 0.72), twilight);
    float glow = rim * dayFactor * uIntensity;

    gl_FragColor = vec4(uColor * scattering * glow, glow);
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
    uRayleighStrength: { value: settings.rayleighStrength },
    uMieStrength: { value: settings.mieStrength },
    uMieG: { value: settings.mieG },
    uOpticalDepth: { value: settings.opticalDepth },
  };
}
