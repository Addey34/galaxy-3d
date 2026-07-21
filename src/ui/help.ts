/**
 * Bouton d'aide (#help-btn) + popover (#help-popover) — coin haut-gauche (desktop).
 *
 * Empreinte permanente réduite à un « ? » ; tout le contenu (astuces de navigation puis
 * crédits, licence et don) vit dans le popover. Ouverture au clic (pas un hover pur :
 * inutilisable au tactile), fermeture par Échap ou clic à l'extérieur.
 */
const btn = document.getElementById('help-btn')!;
const popover = document.getElementById('help-popover')!;

export function setupHelp(): void {
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
