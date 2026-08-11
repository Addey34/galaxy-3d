/**
 * Emprises des surfaces de l'overlay réservées par le placement des labels projetés.
 *
 * L'`ExploHud` évite de poser un label sous une surface visible : il interroge ici les
 * rectangles des docks et surfaces actuellement à l'écran. Garder cette liste synchronisée
 * avec la structure de l'overlay (docks + surfaces contextuelles).
 */
const SCENE_OVERLAY_SELECTORS = [
  '.dock--top-left',
  '.dock--top-right',
  '.dock--bottom',
  '#body-palette:not([hidden])',
  '#body-info:not([hidden])',
  '#orbit-options:not([hidden])',
  '#astronomical-events:not([hidden])',
  '#help-popover:not([hidden])',
] as const;

/** Rectangles (avec marge) des surfaces overlay visibles, en coordonnées viewport. */
export function getSceneOverlayRects(padding = 6): Array<{
  left: number;
  right: number;
  top: number;
  bottom: number;
}> {
  return SCENE_OVERLAY_SELECTORS.flatMap((selector) => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) return [];
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      rect.width <= 0 ||
      rect.height <= 0
    )
      return [];
    return [
      {
        left: rect.left - padding,
        right: rect.right + padding,
        top: rect.top - padding,
        bottom: rect.bottom + padding,
      },
    ];
  });
}
