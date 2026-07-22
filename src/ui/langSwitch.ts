/**
 * Sélecteur de langue (#lang-switch) — segments EN | FR dans le popover d'aide.
 *
 * Reflète la langue courante (segment actif) et la change au clic via `setLocale` ; toute
 * l'UI se retraduit alors par ses propres abonnements `onLocaleChange`. Détection + persistance
 * sont gérées par le cœur i18n : ce module ne fait que la bascule manuelle.
 */
import { getLocale, setLocale, onLocaleChange, type Locale } from '@/i18n';

export function setupLangSwitch(): void {
  const btns = Array.from(
    document.querySelectorAll<HTMLButtonElement>('#lang-switch .lang-btn')
  );
  if (btns.length === 0) return;

  const sync = (): void => {
    const current = getLocale();
    btns.forEach((b) =>
      b.classList.toggle('is-active', b.dataset.locale === current)
    );
  };

  btns.forEach((btn) => {
    btn.addEventListener('click', () =>
      setLocale(btn.dataset.locale as Locale)
    );
  });

  onLocaleChange(sync);
  sync();
}
