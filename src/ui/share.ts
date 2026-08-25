/**
 * Bouton « Partager cette vue » (#share-btn).
 *
 * Le corps/date/mode courants sont déjà encodés dans l'URL par le système de permaliens
 * (`history.replaceState` à chaque changement). Ce bouton fait deux choses : 1) capture
 * l'angle de caméra EXACT du moment (azimut/polaire/distance, cf. CameraSystem.getViewAngles)
 * et le grave dans l'URL — sans ça, ouvrir le lien retomberait sur le cadrage par défaut du
 * corps plutôt que la vue précise regardée ; 2) la RENDS PARTAGEABLE : partage natif sur
 * mobile (`navigator.share`), sinon copie presse-papier avec un retour visuel.
 */
import { t } from '@/i18n';
import Logger from '@/utils/Logger';
import type { CameraSystem } from '@/components/systems/CameraSystem';
import type { PermalinkController } from './permalink';

const btn = document.getElementById('share-btn');

/** Toast éphémère de confirmation, ancré près du bouton. Créé à la demande. */
function showToast(message: string): void {
  const existing = document.getElementById('share-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'share-toast';
  toast.className = 'share-toast';
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  document.body.appendChild(toast);

  // Force un reflow avant d'ajouter la classe visible (transition d'entrée).
  void toast.offsetWidth;
  toast.classList.add('is-visible');

  window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => toast.remove(), 250);
  }, 2200);
}

async function copyToClipboard(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    // navigator.clipboard indisponible (contexte non sécurisé, permission refusée) :
    // repli sur une sélection/exécution de copie legacy.
    try {
      const input = document.createElement('input');
      input.value = url;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      const ok = document.execCommand('copy');
      input.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function setupShare(
  camera: CameraSystem,
  permalink: PermalinkController
): void {
  if (!btn) return;

  btn.addEventListener('click', async () => {
    // Grave l'angle de vue EXACT dans l'URL avant de la lire : sans ce point de capture
    // explicite, un partage pendant un vol caméra ou après un simple drag manquerait le
    // cadrage réellement regardé (le permalien de base ne suit que corps/date/mode).
    const view = camera.getViewAngles();
    if (view) permalink.sync(view);

    const url = window.location.href;
    const title = document.title;

    // Partage natif (mobile surtout) : feuille système avec toutes les apps.
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        // Annulation par l'utilisateur : on ne fait rien. Autre erreur : on retombe
        // sur la copie presse-papier ci-dessous.
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }

    const copied = await copyToClipboard(url);
    showToast(copied ? t('share.copied') : t('share.failed'));
    if (!copied) Logger.warn('[share] clipboard copy failed');
  });
}
