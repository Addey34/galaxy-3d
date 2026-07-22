/**
 * Liaison des chaînes statiques du HTML aux traductions.
 *
 * Les éléments porteurs de `data-i18n` (texte), `data-i18n-title` (attribut `title`) ou
 * `data-i18n-aria` (attribut `aria-label`) sont remplis depuis le dictionnaire. `applyStaticI18n`
 * est appelée au démarrage et à chaque changement de langue — la couche UI dynamique
 * (bodyInfo, loader…) se retraduit de son côté via `onLocaleChange`.
 */
import { t, getLocale, onLocaleChange } from './index';

/** Applique les traductions à tous les nœuds `data-i18n*` sous `root`. */
export function applyStaticI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n!);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle!);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria!));
  });
}

/**
 * Initialise l'i18n statique : synchronise `<html lang>` sur la langue détectée, applique une
 * première passe, puis se réabonne pour retraduire à chaque changement de langue.
 */
export function initStaticI18n(): void {
  document.documentElement.lang = getLocale() === 'fr' ? 'fr' : 'en-GB';
  applyStaticI18n();
  onLocaleChange(() => applyStaticI18n());
}
