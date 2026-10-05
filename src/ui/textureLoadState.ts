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

/**
 * LA SCÈNE EN MOUVEMENT, publiée sur le canvas (2026-10-05) : `data-scene-moving` vaut `1`
 * pendant un vol de caméra ou le glissement d'une échelle à l'autre, `0` sinon.
 *
 * Le compte de textures en vol ne suffit pas à dire « plus rien ne va se charger ». Pendant un
 * vol, la distance change et chaque palier franchi demandera ses textures ; or le niveau de détail
 * n'est réévalué qu'une image sur cinq (`LOD_UPDATE_INTERVAL`), donc le compte vaut `0` entre deux
 * paliers. Mesuré ce jour-là, frein CPU × 4 : deux fois sur cinq, l'attente de calme se déclarait
 * satisfaite une seconde après la sélection de la Terre, et ses textures au gros plan partaient
 * juste après, sans aucun clic (run de `main` `37268935169`, `e2e/modes.spec.ts`, réessai).
 *
 * Lu dans `onFrame`, en fin d'image, et écrit sur CHANGEMENT seulement : une comparaison de
 * booléen par image, aucune écriture au repos.
 */
export function setupSceneMotionState(
  canvas: HTMLCanvasElement,
  isMoving: () => boolean,
  onFrame: (cb: () => void) => () => void
): () => void {
  let published: string | undefined;
  const publish = (): void => {
    const value = isMoving() ? '1' : '0';
    if (value === published) return;
    published = value;
    canvas.dataset['sceneMoving'] = value;
  };
  publish();
  return onFrame(publish);
}
