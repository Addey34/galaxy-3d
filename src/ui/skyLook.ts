/**
 * LA COMMANDE « REGARDER LE CIEL » (GAL-EARTH-ATMOSPHERE-003, finalisation produit, 2026-11-28).
 *
 * Près du sol, un curseur vertical relève la visée au-dessus du cadrage d'horizon (`CameraSystem.skyTiltRad`) :
 * vers le haut, le ciel et le plafond nuageux ; tout en bas, l'horizon. Le bouton « Horizon » rend le cadrage
 * initial. La position de la caméra ne change jamais : rotation, zoom, plongée et glisser restent ceux du suivi.
 *
 * Un morceau à part, chargé par `ui/surfacePanel` la première fois que la caméra arrive près du sol
 * (`core/skyLook`) : rien au démarrage. Clavier et toucher sont ceux d'un `<input type="range">` natif (flèches,
 * Début, Fin, Page) ; ses phrases sont dans les dictionnaires différés (`i18n/deferredMessages`).
 *
 * La commande se retire, et la visée revient à l'horizon, dès que le cadrage d'horizon faiblit (remontée vers
 * l'orbite, vol vers un autre corps, mode Éducatif) ou quand le corps suivi change.
 */
import { loadDeferredMessages } from '@/i18n/deferredMessages';
import { onLocaleChange, t } from '@/i18n';
import { SKY_LOOK_MAX_DEG, skyLookShown, skyTiltFromDeg } from '@/core/skyLook';
import type { PublicAPI } from '@/SolarSystemApp';

export interface SkyLookHandle {
  dispose(): void;
}

export async function setupSkyLook(api: PublicAPI): Promise<SkyLookHandle> {
  await loadDeferredMessages();
  const camera = api.cameraSystem;

  const root = document.createElement('div');
  root.id = 'sky-look';
  root.className = 'sky-look';
  root.setAttribute('role', 'group');
  root.hidden = true;
  const label = document.createElement('label');
  label.id = 'sky-look-label';
  label.className = 'sky-look__label';
  label.htmlFor = 'sky-look-range';
  const range = document.createElement('input');
  range.type = 'range';
  range.id = 'sky-look-range';
  range.className = 'sky-look__range';
  range.min = '0';
  range.max = String(SKY_LOOK_MAX_DEG);
  range.step = '1';
  range.value = '0';
  range.setAttribute('aria-orientation', 'vertical');
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.id = 'sky-look-reset';
  reset.className = 'sky-look__reset';
  root.setAttribute('aria-labelledby', label.id);
  root.append(label, range, reset);
  document.body.appendChild(root);

  const render = (): void => {
    label.textContent = t('sky.look.label');
    reset.textContent = t('sky.look.reset');
    reset.title = t('sky.look.resetHint');
    range.title = t('sky.look.hint');
    range.setAttribute(
      'aria-valuetext',
      t('sky.look.value', { deg: Number(range.value) })
    );
  };
  const apply = (deg: number): void => {
    range.value = String(deg);
    camera.skyTiltRad = skyTiltFromDeg(deg);
    range.setAttribute('aria-valuetext', t('sky.look.value', { deg }));
    root.dataset['skyLook'] = String(deg);
  };
  range.addEventListener('input', () => apply(Number(range.value)));
  reset.addEventListener('click', () => apply(0));
  render();
  const stopLocale = onLocaleChange(render);

  let shown = false;
  let target = camera.targetName;
  const stopFrame = api.animationSystem.onFrame(() => {
    // Un autre corps : la visée revient à l'horizon avant toute autre chose.
    if (camera.targetName !== target) {
      target = camera.targetName;
      if (Number(range.value) !== 0) apply(0);
    }
    const next = skyLookShown(shown, camera.horizonTiltNow);
    if (next === shown) return;
    shown = next;
    root.hidden = !shown;
    // Retirée : le cadrage initial, et le focus ne reste pas sur une commande masquée.
    if (!shown) {
      if (root.contains(document.activeElement))
        (document.activeElement as HTMLElement).blur();
      apply(0);
    }
  });

  return {
    dispose(): void {
      stopFrame();
      stopLocale();
      camera.skyTiltRad = 0;
      root.remove();
    },
  };
}
