/**
 * Bouton plein écran (#fullscreen-btn) — bascule l'API Fullscreen du document.
 */
import Logger from '../utils/Logger';

const fullscreenBtn = document.getElementById('fullscreen-btn')!;

export function setupFullscreen(): void {
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
        .catch((err) => Logger.error('Fullscreen error', err));
    } else {
      document.exitFullscreen()
        .catch((err) => Logger.error('Fullscreen exit error', err));
    }
  });
}
