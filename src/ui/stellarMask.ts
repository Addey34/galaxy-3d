/**
 * Masquer puis rétablir les éléments de la scène solaire pendant la vue stellaire.
 *
 * La vue pose `data-stellar-hidden` et `inert`. Un élément qui était DÉJÀ inerte (une surface fermée,
 * une boîte inactive) doit le rester à la fermeture : on mémorise l'état initial de chaque élément et
 * on le rend tel quel, au lieu de retirer `inert` partout.
 */
export interface MaskableElement {
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export interface MaskedElement<E extends MaskableElement = MaskableElement> {
  element: E;
  /** Valeur initiale de `inert`, ou `null` si l'attribut était absent. */
  inert: string | null;
}

export function maskElements<E extends MaskableElement>(
  elements: readonly E[]
): MaskedElement<E>[] {
  return elements.map((element) => {
    const inert = element.hasAttribute('inert')
      ? (element.getAttribute('inert') ?? '')
      : null;
    element.setAttribute('data-stellar-hidden', '');
    element.setAttribute('inert', '');
    return { element, inert };
  });
}

export function restoreElements(masked: readonly MaskedElement[]): void {
  for (const { element, inert } of masked) {
    element.removeAttribute('data-stellar-hidden');
    if (inert === null) element.removeAttribute('inert');
    else element.setAttribute('inert', inert);
  }
}
