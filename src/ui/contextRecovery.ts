/**
 * Bannière de reconnexion WebGL. Le GPU peut reprendre le contexte à tout moment (onglet
 * mobile mis en arrière-plan, reset driver, trop de contextes ouverts) : sans ce module,
 * l'app fige silencieusement sur la dernière frame rendue, sans aucun recours visible pour
 * l'utilisateur. `SceneSystem` empêche déjà le comportement par défaut du navigateur (perte
 * définitive) via `preventDefault()` sur `webglcontextlost` ; ce module se contente d'informer
 * pendant la reconnexion (généralement quasi instantanée) et propose un rechargement si elle
 * n'aboutit pas.
 */
import type { SceneSystem } from '@/components/systems/SceneSystem';
import { t } from '@/i18n';

const TIMEOUT_MS = 8000;

export function setupContextRecovery(scene: SceneSystem): void {
  const banner = document.createElement('div');
  banner.id = 'context-recovery-banner';
  banner.hidden = true;
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');

  const spinner = document.createElement('span');
  spinner.className = 'context-recovery-spinner';
  spinner.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');

  const reload = document.createElement('button');
  reload.type = 'button';
  reload.hidden = true;
  reload.textContent = t('error.retry');
  reload.addEventListener('click', () => window.location.reload());

  banner.append(spinner, label, reload);
  document.body.appendChild(banner);

  let timeoutId = 0;

  scene.onContextLost = () => {
    window.clearTimeout(timeoutId);
    banner.classList.remove('is-timeout');
    spinner.hidden = false;
    reload.hidden = true;
    label.textContent = t('error.contextLost');
    banner.hidden = false;
    timeoutId = window.setTimeout(() => {
      banner.classList.add('is-timeout');
      spinner.hidden = true;
      reload.hidden = false;
      label.textContent = t('error.contextLostTimeout');
    }, TIMEOUT_MS);
  };

  scene.onContextRestored = () => {
    window.clearTimeout(timeoutId);
    banner.hidden = true;
  };
}
