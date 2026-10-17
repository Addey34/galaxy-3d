/**
 * LE RENDU EST-IL LOGICIEL ? (lot 54) Deux décisions mesurées en dépendent, et elles lisent la
 * MÊME règle : le décodage des textures hors du fil principal (`TextureSystem`) et le budget de
 * carreaux du moteur de surface (`ui/surfacePanel.ts`). En rendu logiciel (SwiftShader, celui de la
 * CI et des machines sans GPU, ou llvmpipe), le processeur rastérise lui-même : ce qui soulage un
 * vrai GPU l'alourdit, et deux runs de CI simultanés l'ont montré pour le décodage.
 */
import type * as THREE from 'three';

const SOFTWARE = /swiftshader|llvmpipe|software|basic render/i;

/** Le nom du moteur de rendu tel que le pilote le publie, ou `''` s'il ne le publie pas. */
export function rendererName(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
}

/** Vrai pour un rendu logiciel reconnu à son nom. */
export function isSoftwareRenderer(renderer: THREE.WebGLRenderer): boolean {
  return SOFTWARE.test(rendererName(renderer));
}
