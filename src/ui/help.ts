/**
 * Aide & crédits (#help-btn dans le dock + #help-popover en surface contextuelle).
 *
 * Empreinte permanente réduite à une icône « ? » ; astuces de navigation puis crédits /
 * licence / don vivent dans une surface, mutuellement exclusive avec les autres (fiche,
 * réglages, événements, palette). Fermeture par la croix, Échap, le scrim ou une autre surface.
 */
import type { OverlayCoordinator } from './overlayCoordinator';

const btn = document.getElementById('help-btn')!;
const popover = document.getElementById('help-popover')!;
const closeBtn = popover.querySelector<HTMLButtonElement>('.surface-close');

export function setupHelp(coordinator?: OverlayCoordinator): void {
  let open = false;

  const setOpen = (next: boolean): void => {
    if (next) coordinator?.requestOpen('help');
    open = next;
    popover.hidden = !next;
    btn.setAttribute('aria-expanded', String(next));
  };
  coordinator?.register('help', () => setOpen(false));

  btn.addEventListener('click', () => setOpen(!open));
  closeBtn?.addEventListener('click', () => {
    setOpen(false);
    btn.focus();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) {
      setOpen(false);
      btn.focus();
    }
  });
}
