/**
 * LE RIDEAU AVANT/APRÈS, côté écran (lot 50, pas 2) : une ligne verticale que le visiteur
 * déplace, l'édition COMPARÉE à sa gauche et celle de l'année de la scène à sa droite.
 *
 * Chargé avec le moteur d'imagerie, jamais au démarrage. La ligne n'est qu'un repère : ce qui
 * sépare vraiment les deux années est le shader des carreaux (`compareMaterial.ts`), qui lit
 * `COMPARE_SPLIT` en pixels du TAMPON de rendu. Le rideau convertit donc sa position, mesurée
 * sur le canevas affiché, avec la largeur du tampon, qui inclut le rapport de pixels.
 *
 * Accessible au clavier : la poignée est un `role="slider"` (flèches, Page, Début, Fin), dont la
 * valeur DIT les deux années et la part de l'écran qui montre la plus ancienne.
 */
import { onLocaleChange, t } from '@/i18n';
import { COMPARE_SPLIT } from './compareMaterial';

export interface CompareCurtain {
  /** Les deux années à montrer, ou `null` pour retirer le rideau. */
  update(years: { before: number | null; after: number | null } | null): void;
  /** À chaque image : la ligne suit le canevas (taille, rapport de pixels). */
  sync(): void;
  dispose(): void;
}

/** Pas des flèches et des touches Page, en fraction de la largeur. */
const STEP = 0.05;
const PAGE = 0.25;

export function createCompareCurtain(
  canvas: HTMLCanvasElement
): CompareCurtain {
  let fraction = 0.5;
  let years: { before: number | null; after: number | null } | null = null;

  const root = document.createElement('div');
  root.id = 'surface-compare';
  root.className = 'surface-compare';
  root.hidden = true;
  const line = document.createElement('div');
  line.className = 'sc-line';
  const handle = document.createElement('div');
  handle.className = 'sc-handle';
  handle.tabIndex = 0;
  handle.setAttribute('role', 'slider');
  handle.setAttribute('aria-valuemin', '0');
  handle.setAttribute('aria-valuemax', '100');
  handle.setAttribute('aria-orientation', 'horizontal');
  const before = document.createElement('span');
  before.className = 'sc-year sc-before';
  const after = document.createElement('span');
  after.className = 'sc-year sc-after';
  handle.append(before, after);
  root.append(line, handle);
  document.body.append(root);

  const render = (): void => {
    const percent = Math.round(fraction * 100);
    root.style.setProperty('--sc-x', `${fraction * 100}%`);
    handle.setAttribute('aria-valuenow', String(percent));
    handle.setAttribute('aria-label', t('surface.compare.slider'));
    before.textContent = String(years?.before ?? '');
    after.textContent = String(years?.after ?? '');
    handle.setAttribute(
      'aria-valuetext',
      t('surface.compare.valuetext', {
        before: String(years?.before ?? ''),
        after: String(years?.after ?? ''),
        percent: String(percent),
      })
    );
  };

  const moveTo = (next: number): void => {
    fraction = Math.min(1, Math.max(0, next));
    render();
    sync();
  };

  const fromPointer = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0) moveTo((event.clientX - rect.left) / rect.width);
  };
  handle.addEventListener('pointerdown', (event) => {
    handle.setPointerCapture(event.pointerId);
    fromPointer(event);
    event.preventDefault();
  });
  handle.addEventListener('pointermove', (event) => {
    if (handle.hasPointerCapture(event.pointerId)) fromPointer(event);
  });
  // La molette sur la poignée zoome comme sur la scène (même renvoi que les étiquettes d'Explo,
  // `ui/exploHud.ts`) : sans lui, un rideau posé sur la cible bloquait la descente.
  handle.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
        })
      );
    },
    { passive: false }
  );
  handle.addEventListener('keydown', (event) => {
    const moves: Record<string, number> = {
      ArrowLeft: fraction - STEP,
      ArrowDown: fraction - STEP,
      ArrowRight: fraction + STEP,
      ArrowUp: fraction + STEP,
      PageDown: fraction - PAGE,
      PageUp: fraction + PAGE,
      Home: 0,
      End: 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    moveTo(next);
  });

  function sync(): void {
    // `gl_FragCoord` compte en pixels du tampon, depuis le bord GAUCHE : la même origine que
    // l'écran, et la largeur du tampon, qui inclut le rapport de pixels.
    COMPARE_SPLIT.value = fraction * canvas.width;
    placeHandle();
  }

  /**
   * La LIGNE va jusqu'au bord ; la poignée reste entière à l'écran, bornée par sa largeur
   * MESURÉE. Une borne fixe en CSS ne suffisait pas : sur le coureur Linux, la police de repli
   * (DejaVu Sans) élargit la poignée et elle dépassait de 6 px à 100 % (run 38702211731).
   */
  function placeHandle(): void {
    if (root.hidden) return;
    const width = root.clientWidth;
    const half = handle.offsetWidth / 2;
    const x = fraction * width;
    handle.style.left = `${Math.min(Math.max(x, half), Math.max(half, width - half))}px`;
  }

  const unsubscribe = onLocaleChange(render);
  render();

  return {
    update(next) {
      years = next;
      root.hidden = next === null;
      render();
      placeHandle();
    },
    sync,
    dispose() {
      unsubscribe();
      root.remove();
    },
  };
}
