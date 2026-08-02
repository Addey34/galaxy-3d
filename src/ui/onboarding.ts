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
    } catch {
      /* best-effort */
    }
    card.classList.remove('ob-visible');
    card.addEventListener(
      'transitionend',
      () => {
        unsub?.();
        card.remove();
      },
      { once: true }
    );
  }

  function render(): void {
    card.setAttribute('aria-label', t('onboarding.aria'));
    card.replaceChildren();

    const title = document.createElement('h3');
    title.className = 'ob-title';
    title.textContent = t('onboarding.title');

    const list = document.createElement('ul');
    list.className = 'ob-list';
    for (const key of [
      'onboarding.tip.select',
      'onboarding.tip.explo',
      'onboarding.tip.time',
      'onboarding.tip.help',
    ]) {
      const item = document.createElement('li');
      item.textContent = t(key);
      list.append(item);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ob-dismiss';
    button.textContent = t('onboarding.dismiss');
    button.addEventListener('click', dismiss, { once: true });
    card.append(title, list, button);
  }

  render();
  unsub = onLocaleChange(render);

  document.body.appendChild(card);
  // Double rAF : le premier frame attache le DOM, le second déclenche la transition CSS.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => card.classList.add('ob-visible'))
  );
}
