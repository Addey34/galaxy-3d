/**
 * Nudge « Essayer une visite guidée » — un toast discret, affiché une seule fois au premier
 * passage en Exploration, pour rendre visible une fonctionnalité déjà construite (tours
 * scriptés, `ui/tourPlayer.ts`) mais autrement invisible tant qu'on n'a pas pensé à ouvrir
 * l'aide : sans lui, la vue d'ensemble Explo (juste des points dans le vide) est la seule
 * première impression, alors que le vrai contenu (éclipse, lunes galiléennes, confins) est à
 * un clic de l'aide.
 *
 * Ne duplique pas la logique d'ouverture du popover d'aide ni du picker de tours : redéclenche
 * les vrais boutons (#help-btn puis .stour-start) pour rester cohérent avec eux plutôt que de
 * dupliquer leur état.
 */
import { t } from '@/i18n';
import { STORAGE_KEYS } from '@/config/storageKeys';

const STORAGE_KEY = STORAGE_KEYS.exploTourNudge;

export interface ExploTourNudge {
  /** À appeler à chaque passage en mode Exploration ; no-op après la première fois. */
  notifyExploEntered(): void;
}

function alreadySeen(): boolean {
  try {
    return !!localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Le nudge réapparaîtra si le stockage est indisponible — non bloquant, pas grave.
  }
}

export function setupExploTourNudge(): ExploTourNudge {
  let shown = false;
  let toast: HTMLDivElement | null = null;

  const dismiss = (): void => {
    if (!toast) return;
    const el = toast;
    toast = null;
    el.classList.remove('is-visible');
    window.setTimeout(() => el.remove(), 250);
  };

  const show = (): void => {
    toast = document.createElement('div');
    toast.id = 'explo-tour-nudge';
    toast.className = 'explo-tour-nudge';
    toast.setAttribute('role', 'status');

    const text = document.createElement('span');
    text.className = 'explo-tour-nudge-text';
    text.textContent = t('exploNudge.text');

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'explo-tour-nudge-action';
    action.textContent = t('exploNudge.action');
    action.addEventListener('click', () => {
      dismiss();
      // Ouvre le popover d'aide puis révèle le picker de tours via leurs propres boutons —
      // un délai court laisse le popover se rendre avant de cibler .stour-start (son enfant).
      document.getElementById('help-btn')?.click();
      window.setTimeout(() => {
        document.querySelector<HTMLButtonElement>('.stour-start')?.click();
      }, 300);
    });

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'explo-tour-nudge-close';
    close.setAttribute('aria-label', t('exploNudge.dismiss'));
    close.textContent = '×';
    close.addEventListener('click', () => dismiss());

    toast.append(text, action, close);
    document.body.append(toast);
    void toast.offsetWidth; // force le reflow avant la transition d'entrée
    toast.classList.add('is-visible');
  };

  return {
    notifyExploEntered(): void {
      if (shown || alreadySeen()) return;
      shown = true;
      markSeen();
      // Laisse le morph éduc→explo (dolly zoom, 1.2 s) se terminer avant d'apparaître —
      // un toast surgissant en pleine transition caméra distrairait plus qu'il n'aiderait.
      window.setTimeout(show, 1400);
    },
  };
}
