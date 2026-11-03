/**
 * Bascule des FIGURES DES CONSTELLATIONS : surface Réglages, section « scène ».
 *
 * Contenu de la scène, donc ÉTEINT par défaut et JAMAIS mémorisé (règle du dépôt : le rendu et
 * la lecture persistent, le contenu de la scène jamais). La case reste désactivée tant que les
 * figures ne sont pas chargées (le fichier est facultatif : un échec laisse le ciel intact).
 */
import type { Starfield } from '@/components/celestial/Starfield';
import { onLocaleChange, t } from '@/i18n';

export function setupConstellationsToggle(starfield: Starfield | null): void {
  if (!starfield) return;
  const wrapper = document.createElement('label');
  wrapper.id = 'constellations-toggle-wrapper';
  wrapper.className = 'settings-switch';

  const checkbox = document.createElement('input');
  checkbox.id = 'constellations-toggle';
  checkbox.type = 'checkbox';
  checkbox.className = 'oo-checkbox settings-checkbox';
  checkbox.checked = false;
  checkbox.disabled = !starfield.hasConstellations;

  const text = document.createElement('span');
  text.className = 'settings-switch-label';

  wrapper.append(checkbox, text);
  const host =
    document.getElementById('settings-section-scene') ?? document.body;
  host.append(wrapper);

  const refresh = (): void => {
    text.textContent = t('settings.constellations');
    checkbox.setAttribute('aria-label', t('settings.constellations'));
  };
  refresh();

  checkbox.addEventListener('change', () => {
    starfield.setConstellationsVisible(checkbox.checked);
  });
  onLocaleChange(refresh);

  // Les figures arrivent après les étoiles : la case s'active à leur arrivée, sans sondage
  // d'état dans la boucle de rendu (un court rappel, arrêté dès qu'elles sont là ou après 30 s).
  if (checkbox.disabled) {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (starfield.hasConstellations) {
        checkbox.disabled = false;
        window.clearInterval(timer);
      } else if (Date.now() - started > 30_000) window.clearInterval(timer);
    }, 500);
  }
}
