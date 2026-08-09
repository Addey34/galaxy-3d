import { parsePermalink, serializePermalink } from '@/core/permalink';
import type { OrbitalMechanics } from '@/core/OrbitalMechanics';
import type { PlanetNavigation } from './planetNav';
import type { ModeSwitcher } from './modeSwitcher';

const MS_PER_DAY = 86_400_000;

export interface PermalinkController {
  applyInitialState(): void;
  sync(): void;
}

export function setupPermalinks(
  om: OrbitalMechanics,
  navigation: PlanetNavigation,
  modeSwitcher: ModeSwitcher,
  validBodies: ReadonlySet<string>
): PermalinkController {
  let applying = false;

  const sync = (): void => {
    if (applying) return;
    const selectedBody = navigation.getSelectedBody();
    const nextSearch = serializePermalink(
      {
        mode: modeSwitcher.getMode(),
        body: selectedBody ?? undefined,
        date: om.simulationDate,
      },
      window.location.search
    );
    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.replaceState(null, '', nextUrl);
  };

  const applyInitialState = (): void => {
    const state = parsePermalink(window.location.search, validBodies);
    if (!state.mode && !state.body && !state.date) return;

    applying = true;
    try {
      if (state.mode) modeSwitcher.setMode(state.mode);
      if (state.date) {
        const deltaDays =
          (state.date.getTime() - om.simulationDate.getTime()) / MS_PER_DAY;
        om.addTimeOffset(deltaDays);
      }
      if (state.body) navigation.selectBody(state.body);
    } finally {
      applying = false;
    }
    sync();
  };

  window.addEventListener('popstate', applyInitialState);
  return { applyInitialState, sync };
}
