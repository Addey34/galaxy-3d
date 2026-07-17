/**
 * Bouton crédits (#credits-btn) + popover (#credits-popover) — coin bas-droite.
 *
 * Empreinte permanente réduite à une icône `ⓘ` ; tout le contenu (copyright, licence,
 * crédits textures/données, futur don) vit dans le popover. Ouverture au clic (pas un
 * hover pur : inutilisable au tactile), fermeture par Échap ou clic à l'extérieur.
 */
const btn = document.getElementById('credits-btn')!;
const popover = document.getElementById('credits-popover')!;

export function setupCredits(): void {
  let open = false;

  const setOpen = (next: boolean): void => {
    open = next;
    popover.hidden = !next;
    btn.setAttribute('aria-expanded', String(next));
  };

  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(!open);
  });

  // Clic à l'extérieur : referme (le clic sur le popover lui-même ne remonte pas jusqu'ici
  // grâce au stopPropagation, on garde donc les liens cliquables).
  popover.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', () => setOpen(false));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) {
      setOpen(false);
      btn.focus();
    }
  });
}
