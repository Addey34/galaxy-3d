/**
 * EXPLORER UN SYSTÈME DEPUIS LE CIEL (GAL-UNIVERSE-007) : l'ENVELOPPE, et seulement elle.
 *
 * L'exploration elle-même est celle de GAL-UNIVERSE-006 (`ui/systemExplorer`, `SystemScene`, modèle
 * `core/exoplanetSystems`) : aucune seconde architecture. Ce module ne fait que ce que la vue du voisinage
 * fait pour elle quand on l'ouvre depuis une étoile voisine : prêter le rendu de remplacement de
 * l'application (`AnimationSystem.setRenderOverride`, un renderer, une boucle), masquer la scène solaire
 * (`ui/stellarMask`, état initial rendu tel quel), tenir l'adresse (`?view=system&host=`, `core/stellarPermalink`)
 * et l'historique (une entrée par geste, Retour et Suivant), rendre la main à l'observation d'origine.
 *
 * Un hôte du ciel qui est une étoile du voisinage s'explore avec ses composantes du catalogue
 * (`neighbourSystemOf`, même règle que la visite) ; les autres sont connus de l'archive seule.
 */
import type * as THREE from 'three';
import type { ExoplanetFile, ExoplanetSystem } from '@/core/exoplanets';
import {
  groupSystems,
  systemName,
  type NeighbourFile,
} from '@/core/neighbours';
import { neighbourSystemOf } from '@/core/exoplanetSystems';
import {
  parseSystemAddress,
  serializeSystemAddress,
  solarIdentity,
  starSlug,
} from '@/core/stellarPermalink';
import { loadDeferredMessages } from '@/i18n/deferredMessages';
import { t } from '@/i18n';
import Logger from '@/utils/Logger';
import { getAnnouncer } from './announcer';
import { claimHistory } from './permalink';
import type { OverlayCoordinator } from './overlayCoordinator';
import {
  maskElements,
  restoreElements,
  type MaskedElement,
} from './stellarMask';
import type { SystemExplorer } from './systemExplorer';
import './stellarView.css';

const EXOPLANETS_URL = '/assets/sky/exoplanets.json';
const NEIGHBOURS_URL = '/assets/sky/neighbours.json';

export interface SystemViewHost {
  animation: {
    setRenderOverride(render: ((delta: number) => void) | null): void;
  };
  renderer: THREE.WebGLRenderer;
  coordinator: OverlayCoordinator;
  /** L'instantané du ciel déjà lu par la couche des exoplanètes, s'il l'est : il n'est pas relu. */
  skyArchive(): {
    systems: readonly ExoplanetSystem[];
    retrieved: string | null;
  } | null;
  /**
   * L'exploration se ferme : l'observation d'origine reprend (la fiche du système, recentrée, quand
   * la couche est allumée). `host` : le nom d'hôte exploré.
   */
  onReturn?(host: string): void;
}

export interface SystemView {
  /** Ouvre l'exploration d'un hôte du ciel ; `fromAddress` : l'adresse la demande (lien, Suivant). */
  open(host: string, fromAddress?: boolean): void;
  readonly isOpen: boolean;
}

export async function setupSystemView(
  host: SystemViewHost,
  fetchImpl: typeof fetch = fetch
): Promise<SystemView> {
  await loadDeferredMessages();
  let archive: Promise<ExoplanetFile | null> | null = null;
  const exoplanets = (): Promise<ExoplanetFile | null> =>
    (archive ??= (async () => {
      const held = host.skyArchive();
      if (held && held.retrieved)
        return {
          source: { retrieved: held.retrieved },
          systems: held.systems,
        } as unknown as ExoplanetFile;
      const res = await fetchImpl(EXOPLANETS_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ExoplanetFile;
    })().catch((error: unknown) => {
      Logger.warn('[systemView] archive des exoplanètes illisible', error);
      archive = null;
      return null;
    }));
  let neighbours: Promise<NeighbourFile | null> | null = null;
  const readNeighbours = (): Promise<NeighbourFile | null> =>
    (neighbours ??= fetchImpl(NEIGHBOURS_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<NeighbourFile>;
      })
      .catch(() => {
        neighbours = null;
        return null;
      }));

  interface Session {
    host: string;
    explorer: SystemExplorer | null;
    close(viaHistory?: boolean): void;
  }
  let opened: Session | null = null;
  let opening = false;
  /** Vrai quand CETTE ouverture a ajouté son entrée d'historique : fermer la retire par « Retour ». */
  let pushed = false;
  let baseAddress: string | null = null;
  const here = (search = window.location.search): string =>
    `${window.location.pathname}${search}${window.location.hash}`;
  const write = (
    address: { host: string; planet?: string | null } | null,
    how: 'push' | 'replace'
  ): void => {
    const next = here(serializeSystemAddress(window.location.search, address));
    if (next === here()) return;
    window.history[how === 'push' ? 'pushState' : 'replaceState'](
      null,
      '',
      next
    );
  };
  const solarNow = (): string =>
    solarIdentity(window.location.pathname, window.location.search);

  // Retour et Suivant : l'exploration suit l'adresse ; le permalien solaire n'y touche pas quand seul
  // ce mouvement a changé (même règle que la vue du voisinage, `claimHistory`).
  claimHistory((): boolean => {
    const address = parseSystemAddress(window.location.search);
    const viewOnly = baseAddress !== null && solarNow() === baseAddress;
    if (opened && !address) opened.close(true);
    else if (!opened && address?.host) {
      open(address.host, true);
      if (viewOnly) pushed = true;
    }
    return viewOnly;
  });

  function open(wanted: string, fromAddress = false): void {
    if (opened || opening) return;
    const refuse = (announce: string | null): void => {
      if (announce) getAnnouncer().announce(t(announce));
      if (fromAddress && parseSystemAddress(window.location.search))
        write(null, 'replace');
    };
    if (host.renderer.xr.isPresenting) return refuse(null);
    if (host.renderer.getContext().isContextLost())
      return refuse('st.unavailable');
    opening = true;
    const active =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : null;
    void (async () => {
      const sky = await exoplanets();
      const slug = starSlug(wanted);
      const system = sky?.systems.find((s) => starSlug(s[0]) === slug) ?? null;
      if (!sky || !system) {
        opening = false;
        return refuse(sky ? 'sx.unknownHost' : 'st.dataUnavailable');
      }
      const file = await readNeighbours();
      const neighbour = file
        ? neighbourSystemOf(system[0], groupSystems(file.stars), sky.systems)
        : null;
      const module = await import('./systemExplorer');
      host.coordinator.closeAll();

      // ---- la vue : un conteneur plein écran (les boîtes `sv-*`), la scène solaire masquée et inerte
      const root = document.createElement('section');
      root.className = 'stellar-view';
      root.id = 'system-view';
      document.body.append(root);
      const toMask: Element[] = [];
      for (const child of Array.from(document.body.children)) {
        if (
          child === root ||
          child === host.renderer.domElement ||
          /^(SCRIPT|STYLE|LINK|NOSCRIPT)$/.test(child.tagName) ||
          child.hasAttribute('aria-live') ||
          child.classList.contains('sr-only') ||
          child.hasAttribute('data-stellar-hidden')
        )
          continue;
        toMask.push(child);
      }
      const inert: MaskedElement[] = maskElements(toMask);
      document.body.classList.add('stellar-view-active');
      let render: (() => void) | null = null;
      host.animation.setRenderOverride(() => render?.());

      const requested = fromAddress
        ? parseSystemAddress(window.location.search)
        : null;
      let closingViaHistory = false;
      const session: Session = {
        host: system[0],
        explorer: null,
        close(viaHistory = false) {
          closingViaHistory = viaHistory;
          session.explorer?.close();
        },
      };
      const undo = (): void => {
        host.animation.setRenderOverride(null);
        root.remove();
        document.body.classList.remove('stellar-view-active');
        restoreElements(inert);
      };
      let explorer: SystemExplorer;
      try {
        explorer = await module.openSystemExplorer({
          root,
          renderer: host.renderer,
          setRender: (fn) => {
            render = fn;
          },
          system: neighbour,
          skyHost: neighbour ? undefined : system,
          name: neighbour ? systemName(neighbour) : system[0],
          returnTo: 'sky',
          exoplanets,
          fetchImpl,
          initialPlanet: requested?.planet ?? null,
          onPlanet: (planet) => {
            if (opened === session)
              write({ host: starSlug(system[0]), planet }, 'replace');
          },
          onClose: () => {
            // D'abord rendre la boucle à la scène solaire, puis le DOM et le focus, puis l'adresse.
            undo();
            opened = null;
            const viaHistory = closingViaHistory;
            if (viaHistory) pushed = false;
            else if (pushed) {
              pushed = false;
              window.history.back();
            } else write(null, 'replace');
            (active && document.contains(active)
              ? active
              : host.renderer.domElement
            ).focus?.();
            host.onReturn?.(system[0]);
          },
        });
      } catch (error) {
        // Une exploration qui n'a pas pu s'ouvrir ne laisse rien derrière elle : scène solaire rendue.
        undo();
        throw error;
      }
      session.explorer = explorer;
      opened = session;
      opening = false;
      baseAddress = solarNow();
      const address = {
        host: starSlug(system[0]),
        planet: requested?.planet ?? null,
      };
      if (fromAddress) {
        pushed = false;
        write(address, 'replace');
      } else {
        pushed = true;
        write(address, 'push');
      }
    })().catch((error: unknown) => {
      opening = false;
      Logger.warn('[systemView] exploration indisponible', error);
      getAnnouncer().announce(t('sx.unavailable'));
    });
  }

  return {
    open,
    get isOpen() {
      return opened !== null;
    },
  };
}
