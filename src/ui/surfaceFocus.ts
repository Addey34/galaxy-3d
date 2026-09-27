/**
 * LE FOCUS ENTRE DANS LA SURFACE QU'ON VIENT D'OUVRIR (lot 19).
 *
 * Quatre surfaces sur six ouvraient leur panneau en laissant le focus sur le déclencheur :
 * réglages d'affichage, couches météo, événements terrestres, aide. La palette et les
 * événements astronomiques, eux, faisaient déjà ce qu'il faut. Ce serait défendable si le
 * contenu suivait dans l'ordre de tabulation, mais les panneaux sont déclarés APRÈS tout le
 * dock dans `index.html` : la passe lecteur d'écran a compté **quatorze tabulations** entre le
 * bouton « Réglages d'affichage » et le panneau qu'il venait d'ouvrir (défaut D5 de
 * `docs/private/LECTEUR_ECRAN_LOT19.md`).
 *
 * ET CELA EN ENTRAÎNAIT UN SECOND. L'écouteur d'Échap de ces surfaces est posé SUR LE PANNEAU :
 * tant que le focus n'y est pas entré, il ne peut pas se déclencher. Mesuré : réglages ouverts,
 * quinze tabulations plus loin, Échap n'énonce rien et ne ferme rien (défaut D10). Faire entrer
 * le focus corrige donc les deux d'un coup, sans ajouter d'écouteur global.
 *
 * Le retour est déjà correct partout et le reste : à la fermeture, le focus revient au
 * déclencheur, mais SEULEMENT s'il se trouvait encore dans le panneau. Voler le focus à
 * quelqu'un qui est passé à autre chose serait un défaut de plus.
 */

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

/** Le premier élément par lequel entrer : le bouton de fermeture, ou à défaut ce qui suit. */
function entryPoint(panel: HTMLElement): HTMLElement | null {
  const close = panel.querySelector<HTMLElement>('.surface-close');
  if (close) return close;
  return panel.querySelector<HTMLElement>(FOCUSABLE);
}

/**
 * Ce qui peut recevoir le focus à l'intérieur, dans l'ordre du document, le masqué exclu.
 *
 * On filtre sur `hidden` et NON sur une visibilité calculée. `offsetParent === null` serait le
 * réflexe, mais il vaut `null` pour tout élément en `position: fixed` — ce que sont ces
 * dialogues. Le piège ne se déclenche ici que pour le dialogue lui-même et pas pour ses
 * boutons, mais une garde ne doit pas reposer sur cette nuance : si elle se trompait, le piège
 * ne verrait plus qu'un seul élément, empêcherait le focus de bouger DU TOUT, et une garde qui
 * vérifie seulement « le focus est resté dans le dialogue » resterait verte.
 */
function focusables(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.closest('[hidden]') === null
  );
}

/**
 * ENFERME LE FOCUS DANS UN DIALOGUE MODAL, et rend de quoi le libérer.
 *
 * `aria-modal="true"` est une DÉCLARATION faite aux technologies d'assistance : « le reste de
 * la page est inerte ». Les deux dialogues de visite la faisaient sans la tenir. La passe du
 * lot 19 l'a mesuré : depuis le bouton « Fermer la visite », cinq tabulations sortent du
 * dialogue et parcourent les étiquettes de la scène, que le dialogue vient pourtant de
 * déclarer hors d'atteinte (défaut D9 de `docs/private/LECTEUR_ECRAN_LOT19.md`).
 *
 * Un dialogue qui promet une modalité qu'il n'applique pas est pire qu'un dialogue non modal :
 * le lecteur d'écran restreint sa lecture à un contenu que le focus, lui, a déjà quitté.
 */
export function trapFocus(dialog: HTMLElement): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const items = focusables(dialog);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    // Le focus a pu sortir autrement (un clic ailleurs) : on le ramène plutôt que de laisser
    // la tabulation continuer hors du dialogue.
    if (!active || !dialog.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKeyDown, true);
  return () => document.removeEventListener('keydown', onKeyDown, true);
}

/**
 * Accorde le focus à l'état d'ouverture d'une surface contextuelle.
 *
 * @param open      l'état dans lequel la surface vient de passer
 * @param panel     le panneau, déjà affiché ou déjà masqué au moment de l'appel
 * @param trigger   le bouton qui l'ouvre, à qui le focus revient
 */
export function syncSurfaceFocus(
  open: boolean,
  panel: HTMLElement | null,
  trigger: HTMLElement | null
): void {
  if (!panel) return;
  if (open) {
    entryPoint(panel)?.focus();
    return;
  }
  // `panel.contains` sur l'élément actif : un panneau qu'on referme alors que le focus est
  // ailleurs ne doit rien déplacer.
  if (document.activeElement && panel.contains(document.activeElement)) {
    trigger?.focus();
  }
}
