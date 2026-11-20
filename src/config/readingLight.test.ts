import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  READING_LIGHT,
  READING_LIGHT_MAX_FLOOR,
  installReadingLight,
  isReadingLightActive,
  setReadingLight,
} from './readingLight';

const FRAGMENT = '#include <common>\n#include <opaque_fragment>\n';

function compile(material: THREE.Material): {
  uniforms: Record<string, unknown>;
  fragmentShader: string;
} {
  const shader = {
    uniforms: {} as Record<string, unknown>,
    fragmentShader: FRAGMENT,
  };
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer
  );
  return shader;
}

describe("l'éclairage de lecture", () => {
  afterEach(() => setReadingLight(0));

  it('est éteint par défaut et borne son intensité', () => {
    expect(READING_LIGHT.value).toBe(0);
    expect(isReadingLightActive()).toBe(false);
    expect(setReadingLight(5)).toBe(READING_LIGHT_MAX_FLOOR);
    expect(setReadingLight(-1)).toBe(0);
    expect(setReadingLight(Number.NaN)).toBe(0);
    setReadingLight(0.5);
    expect(isReadingLightActive()).toBe(true);
  });

  it("n'agit que par un plancher (max), jamais par une somme, et partage UN uniforme", () => {
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial();
    installReadingLight(a);
    installReadingLight(b);
    const sa = compile(a);
    const sb = compile(b);
    expect(sa.fragmentShader).toContain('outgoingLight = max( outgoingLight');
    expect(sa.fragmentShader).not.toContain('outgoingLight +=');
    expect(sa.fragmentShader).toContain('uniform float uReadingLight;');
    expect(sa.fragmentShader.endsWith('#include <opaque_fragment>\n')).toBe(
      true
    );
    // Un seul objet uniforme : l'allumer ne recompile rien.
    expect(sa.uniforms['uReadingLight']).toBe(READING_LIGHT);
    expect(sb.uniforms['uReadingLight']).toBe(READING_LIGHT);
  });

  it('se pose une seule fois par matériau et préserve le patch précédent', () => {
    const material = new THREE.MeshStandardMaterial();
    let previous = 0;
    material.onBeforeCompile = () => {
      previous += 1;
    };
    installReadingLight(material);
    installReadingLight(material);
    const shader = compile(material);
    expect(previous).toBe(1);
    expect(
      shader.fragmentShader.split('uniform float uReadingLight;').length
    ).toBe(2);
  });
});
