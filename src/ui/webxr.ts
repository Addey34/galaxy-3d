/**
 * Entrée VR (WebXR) — jalon 1, minimal : entrer/sortir d'une session immersive-vr et voir la
 * scène existante en stéréo, sans nouvelle locomotion (à venir dans un jalon ultérieur, une fois
 * ce premier jalon éprouvé). Réutilise Éduc/Explo tels quels — aucun changement d'échelle pour
 * la VR, conformément à l'invariant de réalisme Explo (voir CLAUDE.md).
 *
 * Même philosophie que `share.ts` : détection de capacité au démarrage, repli silencieux plutôt
 * qu'un bouton mort — Safari/iOS n'expose pas `navigator.xr` du tout.
 */
import { VRButton } from 'three/addons/webxr/VRButton.js';
import type { CameraSystem } from '@/components/systems/CameraSystem';

export function setupWebXR(camera: CameraSystem): void {
  if (!navigator.xr) return;

  void navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
    if (!supported) return;

    const button = VRButton.createButton(camera.renderer);
    document.body.appendChild(button);

    // Pendant la session, renderer.xr pilote seul la pose caméra (cf. CameraSystem.update) —
    // désactiver OrbitControls évite en plus que ses écouteurs pointeur/molette interfèrent.
    camera.renderer.xr.addEventListener('sessionstart', () => {
      camera.controls.enabled = false;
    });
    camera.renderer.xr.addEventListener('sessionend', () => {
      camera.controls.enabled = true;
    });
  });
}
