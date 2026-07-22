import { t, onLocaleChange } from '@/i18n';

const STORAGE_KEY = 'ssv-onboarding-v1';

/**
 * Affiche une carte d'accueil non-bloquante à la première visite (localStorage).
 * Le bouton « Got it » la fait disparaître et ne la réaffiche jamais.
 * Se retraduire à chaud via onLocaleChange.
 */
export function initOnboarding(): void {
  try {
    if (localStorage.getItem(STORAGE_KEY)) return;
  } catch {
    return;
  }

  const card = document.createElement('aside');
  card.className = 'ob-card';

  let dismissed = false;
  let unsub: (() => void) | null = null;

  function dismiss(): void {
    if (dismissed) return;
    dismissed = true;
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch { /* best-effort */ }
    card.classList.remove('ob-visible');
    card.addEventListener('transitionend', () => { unsub?.(); card.remove(); }, { once: true });
  }

  function render(): void {
    card.setAttribute('aria-label', t('onboarding.aria'));
    card.innerHTML = `
      <h3 class="ob-title">${t('onboarding.title')}</h3>
      <ul class="ob-list">
        <li>${t('onboarding.tip.select')}</li>
        <li>${t('onboarding.tip.explo')}</li>
        <li>${t('onboarding.tip.time')}</li>
        <li>${t('onboarding.tip.help')}</li>
      </ul>
      <button class="ob-dismiss">${t('onboarding.dismiss')}</button>
    `;
    card.querySelector('.ob-dismiss')!.addEventListener('click', dismiss, { once: true });
  }

  render();
  unsub = onLocaleChange(render);

  document.body.appendChild(card);
  // Double rAF : le premier frame attache le DOM, le second déclenche la transition CSS.
  requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('ob-visible')));
}
