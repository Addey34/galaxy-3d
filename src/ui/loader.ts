/**
 * Écran de chargement et écran d'erreur.
 *
 * Possède les éléments DOM de progression (#loader, #load-progress, #load-status) et les
 * expose via des fonctions ; aucune logique applicative ici.
 */
import Logger from '../utils/Logger';

const progressBar = document.getElementById('load-progress')!;
const loadStatus  = document.getElementById('load-status')!;
const loader      = document.getElementById('loader')!;

/** Callback de progression passé à `SolarSystemApp.init`. */
export function updateProgress(percent: number, message: string): void {
  progressBar.style.width = `${percent}%`;
  loadStatus.textContent  = message;
}

/** Fait disparaître l'écran de chargement (fondu puis retrait du flux). */
export function hideLoader(): void {
  loader.style.opacity = '0';
  setTimeout(() => (loader.style.display = 'none'), 500);
}

/** Remplace l'écran de chargement par un message d'erreur avec bouton de rechargement. */
export function showError(error: Error): void {
  Logger.error('Application Error:', error);
  loader.innerHTML = `
    <div style="text-align:center">
      <h2 style="color:red">Application Error</h2>
      <p>${error.message}</p>
      <button onclick="window.location.reload()"
              style="padding:10px 20px;margin-top:20px">Retry</button>
    </div>`;
}
