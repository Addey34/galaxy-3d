import { onLocaleChange } from '@/i18n';

export interface OverlayDisclosure {
  readonly isCollapsed: boolean;
  setCollapsed(collapsed: boolean): void;
  refresh(): void;
}

interface OverlayDisclosureOptions {
  container: HTMLElement;
  toggle: HTMLButtonElement;
  collapsedClass?: string;
  initialCollapsed?: boolean;
  labels: {
    expand(): string;
    collapse(): string;
  };
  onExpand?(): void;
}

/**
 * Standard collapse/expand behavior shared by all scene overlays.
 * It keeps CSS state, aria state and translated labels synchronized.
 */
export function setupOverlayDisclosure({
  container,
  toggle,
  collapsedClass = 'is-collapsed',
  initialCollapsed = false,
  labels,
  onExpand,
}: OverlayDisclosureOptions): OverlayDisclosure {
  let collapsed = initialCollapsed;

  const refresh = (): void => {
    container.classList.toggle(collapsedClass, collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute(
      'aria-label',
      collapsed ? labels.expand() : labels.collapse()
    );
  };

  const setCollapsed = (next: boolean): void => {
    if (collapsed === next) return;
    collapsed = next;
    refresh();
    if (!collapsed) onExpand?.();
  };

  toggle.addEventListener('click', () => setCollapsed(!collapsed));
  onLocaleChange(refresh);
  refresh();

  return {
    get isCollapsed() {
      return collapsed;
    },
    setCollapsed,
    refresh,
  };
}
const SCENE_OVERLAY_SELECTORS = [
  '.controls-bar',
  '.controls-collapse',
  '#orbit-options:not([hidden])',
  '#orbit-options:not([hidden]) .oo-toggle',
  '#body-info:not([hidden])',
  '#events-toggle',
  '#astronomical-events:not([hidden])',
  '#mode-controls',
  '#optical-zoom:not([hidden])',
  '#time-panel',
  '#help-btn',
  '#help-popover:not([hidden])',
  '#fullscreen-btn',
  '#fps-counter',
] as const;

/** Visible overlay bounds reserved by projected-label placement. */
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
