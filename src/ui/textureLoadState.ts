/**
 * LE NOMBRE DE TEXTURES EN VOL, publié sur le canvas (ligne 44.3, 2026-10-02).
 *
 * Chaque texture chargée se termine par un décodage et un upload GPU synchrones
 * (`TextureSystem.loadTexture` → `initTexture`). Sur un vrai GPU c'est l'affaire de quelques
 * millisecondes ; en rendu LOGICIEL, celui des coureurs de CI, mesuré ce jour-là sur un AMD EPYC
 * 7763, l'arrivée sur la Terre fige des images de 2,5 à 5,5 s, couche après couche, pendant
 * ~23 s (runs `37064022225`, six machines, même profil). Un clic lancé dans cette fenêtre reste
 * bloqué sur « waiting for scheduled navigations », et une attente de calme fondée sur la seule
 * durée des images peut se déclarer satisfaite ENTRE deux couches, juste avant la suivante.
 *
 * `data-textures-loading` porte donc l'état réel : la suite e2e attend qu'il vaille `0` avant de
 * mesurer le calme du thread (`e2e/mainThread.ts`). Même patron que `data-markers` des couches
 * d'instrument : un attribut de données, écrit sur ÉVÉNEMENT, donc sans coût au repos.
 */
import type { TextureSystem } from '@/components/systems/TextureSystem';

export function setupTextureLoadState(
  canvas: HTMLCanvasElement,
  textures: TextureSystem
): () => void {
  const publish = (pending: number): void => {
    canvas.dataset['texturesLoading'] = String(pending);
  };
  publish(textures.pendingLoads);
  return textures.onPendingLoadsChange(publish);
}
