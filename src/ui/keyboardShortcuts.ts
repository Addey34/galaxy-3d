import {
  resolveShortcut,
  type ShortcutCommand,
  type ShortcutTarget,
} from '@/core/keyboardShortcuts';

/**
 * Les raccourcis clavier (Espace lecture/pause, `/` recherche, `?` aide, `F` plein écran, `T` le
 * présent, `M` l'autre mode). La DÉCISION vit dans `core/keyboardShortcuts.ts` ; ici on lit le
 * contexte de la page et on CLIQUE le bouton qui porte déjà la commande, jamais une seconde voie :
 * l'état du bouton (pause, mode, ouverture) reste celui que l'écran montre.
 */

/** Ce que le clic vise, par commande. `null` : rien à cliquer en ce moment. */
const BUTTONS: Readonly<Record<ShortcutCommand, () => HTMLElement | null>> = {
  playPause: () => document.getElementById('play-pause-btn'),
  search: () => document.querySelector<HTMLElement>('.chip--search'),
  help: () => document.getElementById('help-btn'),
  fullscreen: () => document.getElementById('fullscreen-btn'),
  today: () => document.getElementById('time-today'),
  toggleMode: () =>
    document.querySelector<HTMLElement>('.mode-btn:not(.is-active)'),
};

const INTERACTIVE =
  'button, a[href], summary, [role="button"], [role="slider"], [role="tab"], [role="switch"], [role="menuitem"], [role="option"], input[type="range"], input[type="checkbox"], input[type="radio"], input[type="button"], input[type="submit"]';

function classify(target: EventTarget | null): ShortcutTarget {
  if (!(target instanceof Element)) return 'other';
  if (target.closest('[contenteditable=""], [contenteditable="true"]'))
    return 'editable';
  if (target.closest(INTERACTIVE)) return 'interactive';
  if (target.closest('input, textarea, select')) return 'editable';
  return 'other';
}

function isUsable(el: HTMLElement | null): el is HTMLElement {
  if (!el || el.hidden || el.closest('[hidden]')) return false;
  return !(el as HTMLButtonElement).disabled;
}

export function setupKeyboardShortcuts(): void {
  document.addEventListener('keydown', (event) => {
    const loader = document.getElementById('loader');
    const command = resolveShortcut(event, {
      target: classify(event.target),
      tourActive: document.documentElement.dataset.tour === 'on',
      modalOpen:
        document.querySelector('[aria-modal="true"]:not([hidden])') !== null,
      loading:
        !!loader &&
        !loader.hidden &&
        getComputedStyle(loader).display !== 'none',
    });
    if (!command) return;
    const button = BUTTONS[command]();
    if (!isUsable(button)) return;
    // Espace fait défiler la page par défaut : la scène ne défile pas, elle lit ou met en pause.
    event.preventDefault();
    button.click();
  });
}
