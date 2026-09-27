/**
 * Sélecteur de langue (#lang-switch) — quatre segments dans le popover d'aide.
 *
 * Reflète la langue courante et la change au clic via `setLocale` ; toute l'UI se retraduit
 * alors par ses propres abonnements `onLocaleChange`. Détection et persistance sont gérées par
 * le cœur i18n : ce module ne fait que la bascule manuelle.
 *
 * TROIS CHOSES QUE LE LOT 20 A AJOUTÉES, et chacune a sa raison :
 *
 *   - `aria-pressed` : la langue active n'était marquée que par la classe `is-active`, donc un
 *     lecteur d'écran ne pouvait PAS dire laquelle était choisie. Avec deux segments on pouvait
 *     encore deviner ; avec quatre, non. Bouton à bascule plutôt que groupe de boutons radio,
 *     délibérément : un `radiogroup` promet une navigation aux flèches qu'il faudrait
 *     implémenter, et un motif à moitié tenu est pire qu'un motif simple bien tenu ;
 *   - le changement de langue est ANNONCÉ, dans la langue d'arrivée. Sans cela, quelqu'un qui
 *     navigue au clavier entend le bouton qu'il vient d'activer, puis rien — alors que toute
 *     l'interface vient de changer de langue ;
 *   - `setLocale` est asynchrone (le dictionnaire arrive par le réseau) : le segment ne se
 *     marque actif qu'APRÈS l'arrivée, sinon il annoncerait une langue qui n'est pas affichée.
 */
import {
  getLocale,
  setLocale,
  onLocaleChange,
  isLocale,
  LOCALE_ENDONYM,
  t,
} from '@/i18n';
import { getAnnouncer } from './announcer';

export function setupLangSwitch(): void {
  const btns = Array.from(
    document.querySelectorAll<HTMLButtonElement>('#lang-switch .lang-btn')
  );
  if (btns.length === 0) return;

  // L'endonyme est POSÉ ICI, depuis `LOCALE_ENDONYM`, et non écrit dans `index.html` : une
  // chaîne figée dans le HTML sans clé de traduction est exactement ce que
  // `src/i18n/staticLabels.test.ts` refuse, et il a raison — sauf que celle-ci ne se traduit
  // pas (le segment espagnol s'appelle « Español » dans les quatre langues). Un seul
  // propriétaire, donc, et le HTML ne porte que le libellé court que l'œil lit.
  btns.forEach((b) => {
    const locale = b.dataset.locale;
    if (isLocale(locale)) b.setAttribute('aria-label', LOCALE_ENDONYM[locale]);
  });

  const sync = (): void => {
    const current = getLocale();
    btns.forEach((b) => {
      const active = b.dataset.locale === current;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });
  };

  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const locale = btn.dataset.locale;
      if (!isLocale(locale) || locale === getLocale()) return;
      void setLocale(locale).then(() => {
        // La langue n'a pu changer que si le dictionnaire est arrivé : `getLocale()` est donc
        // la seule source honnête de ce qu'il faut annoncer.
        if (getLocale() !== locale) return;
        getAnnouncer().announce(
          t('lang.changed', { language: LOCALE_ENDONYM[locale] })
        );
      });
    });
  });

  onLocaleChange(sync);
  sync();
}
