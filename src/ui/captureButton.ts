/**
 * Bouton « Capturer cette vue » (#capture-btn) : LANCEUR seulement. Le module de capture (rendu du
 * cartouche, crédit, téléchargement) n'est chargé qu'au premier clic (`ui/capture.ts`), donc hors
 * du budget de démarrage. Le clic est consommé par ce lanceur : un seul écouteur, un seul chargement
 * à la fois, pas de second clic nécessaire. Un échec de chargement est DIT (annonceur), jamais muet.
 */
import type { CameraSystem } from '@/components/systems/CameraSystem';
import type { OrbitalMechanics } from '@/core/OrbitalMechanics';
import type { PlanetNavigation } from './planetNav';
import { announceLoadFailure } from './loadFailure';

export function setupCaptureButton(
  camera: CameraSystem,
  om: OrbitalMechanics,
  navigation: PlanetNavigation
): void {
  const btn = document.getElementById('capture-btn');
  if (!btn) return;
  let busy = false;
  btn.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    void import('./capture')
      .then((m) => m.runCapture(camera, om, navigation))
      .catch(() => announceLoadFailure('capture'))
      .finally(() => {
        busy = false;
      });
  });
}
