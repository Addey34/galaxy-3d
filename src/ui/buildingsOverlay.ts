/**
 * LES BÂTIMENTS 3D SOUS LA VISÉE (lot 63, étape C.3b) : le fil entre la couche de bâtiments et
 * l'approche d'un corps. Chargé À LA DEMANDE par `surfacePanel` (un `import()` dynamique, jamais
 * dans la clôture de démarrage), et seulement quand la caméra est basse.
 *
 * Il lit l'index des jeux (un seul fichier, demandé une fois), garde celui qui couvre la visée pour
 * CE corps, charge son manifeste, puis délègue à `BuildingLayer`. Aucun nom de corps ici : un jeu
 * déclare l'identifiant du corps qu'il couvre, comme le font les fiches de tuiles.
 */
import { BuildingLayer } from '@/components/surface/BuildingLayer';
import {
  PROVISIONAL_BUILDING_BUDGET,
  type BuildingHost,
} from '@/components/surface/BuildingLayer';
import {
  parseBuildingSetIndex,
  parseBuildingSetManifest,
  setCovering,
  type BuildingSetIndex,
  type BuildingSetManifest,
} from '@/config/buildingSets';
import { isMobile } from '@/config/engine';
import { HEIGHT_ORIGIN } from '@/core/buildingTile';
import { originColour } from '@/core/buildingOriginStyle';
import { getLocale, intlLocale, t } from '@/i18n';
import { GALAXY_DATA_ORIGIN } from '@/core/galaxyData';
import { readQualityMode, resolveQualityTier } from '@/core/qualityTier';
import Logger from '@/utils/Logger';

/** Les manifestes et l'index sont des fichiers de l'application, pas du service de données. */
const SITE_ORIGIN = (): string =>
  typeof location === 'undefined' ? '' : location.origin;

/** Marge autour d'un jeu où l'on prépare déjà ses tuiles (une tuile déborde de son emprise). */
const COVERAGE_MARGIN_DEG = 0.02;

export interface BuildingTarget extends BuildingHost {
  worldPointToGeographic(worldPoint: import('three').Vector3): {
    latitudeDeg: number;
    longitudeDeg: number;
  };
}

export interface BuildingsOverlay {
  /** À appeler à chaque image où la caméra est basse sur un corps. */
  update(input: {
    bodyId: string;
    host: BuildingTarget;
    radiusKm: number;
    cameraPosition: import('three').Vector3;
  }): void;
  /** Retire tout (caméra remontée, corps quitté). */
  suspend(): void;
  /** Ce que la couche publie, pour la sonde et les tests navigateur. */
  readonly state: {
    setId: string | null;
    loaded: number;
    buildings: number;
    origins: number[];
    /** Attribution exigée par la licence du jeu servi, à afficher tant que ses bâtiments le sont. */
    attribution: string | null;
  };
}

/** Clé de légende de chaque origine de hauteur (`HEIGHT_ORIGIN`), dans l'ordre d'affichage. */
const ORIGIN_KEYS = [
  [HEIGHT_ORIGIN.measured, 'measured'],
  [HEIGHT_ORIGIN.interpolated, 'interpolated'],
  [HEIGHT_ORIGIN.derivedFromFloors, 'derivedFromFloors'],
  [HEIGHT_ORIGIN.unspecified, 'unspecified'],
  [HEIGHT_ORIGIN.absent, 'absent'],
] as const;

export function createBuildingsOverlay(mount: HTMLElement): BuildingsOverlay {
  let index: BuildingSetIndex | null = null;
  let indexState: 'idle' | 'loading' | 'failed' = 'idle';
  const manifests = new Map<
    string,
    BuildingSetManifest | 'loading' | 'failed'
  >();
  let layer: BuildingLayer | null = null;
  let layerHost: BuildingTarget | null = null;

  const getJson = async (url: string): Promise<unknown> => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // La réécriture SPA de l'hébergeur rend du HTML pour un fichier absent : refusé ici.
    if (!(response.headers.get('content-type') ?? '').includes('json'))
      throw new Error('réponse non JSON');
    return response.json();
  };

  const loadIndex = (): void => {
    if (indexState !== 'idle') return;
    indexState = 'loading';
    getJson(`${SITE_ORIGIN()}/assets/buildings/index.json`)
      .then((json) => {
        index = parseBuildingSetIndex(json);
        indexState = 'idle';
      })
      .catch((error: unknown) => {
        // Pas d'index : pas de bâtiments, et pas de nouvel essai à chaque image.
        indexState = 'failed';
        Logger.warn(`[Bâtiments] index indisponible : ${String(error)}`);
      });
  };

  const loadManifest = (id: string, path: string): void => {
    if (manifests.has(id)) return;
    manifests.set(id, 'loading');
    getJson(`${SITE_ORIGIN()}/${path}`)
      .then((json) => manifests.set(id, parseBuildingSetManifest(json)))
      .catch((error: unknown) => {
        manifests.set(id, 'failed');
        Logger.warn(
          `[Bâtiments] manifeste « ${id} » indisponible : ${String(error)}`
        );
      });
  };

  const drop = (): void => {
    layer?.dispose();
    layer = null;
    layerHost = null;
    renderLegend();
  };

  /**
   * La légende et l'attribution, sous les yeux tant que des bâtiments sont dessinés : la hauteur
   * d'un bâtiment n'a pas la même origine partout (mesurée, interpolée, absente), et la licence du
   * jeu EXIGE sa mention. Redessinée seulement quand ce qu'elle dit change, langue comprise.
   */
  let drawn = '';
  const renderLegend = (): void => {
    const st = currentState();
    const visible = st.setId !== null && st.buildings > 0;
    const key = visible
      ? `${st.setId}|${st.buildings}|${st.origins.join(',')}|${st.attribution}|${getLocale()}`
      : '';
    if (key === drawn) return;
    drawn = key;
    mount.hidden = !visible;
    if (!visible) {
      mount.replaceChildren();
      return;
    }
    const head = document.createElement('span');
    head.textContent = t('surface.buildings.headline', {
      count: st.buildings.toLocaleString(intlLocale()),
    });
    const items = ORIGIN_KEYS.filter(([origin]) =>
      st.origins.includes(origin)
    ).map(([origin, name]) => {
      const item = document.createElement('span');
      item.className = 'si-legend-item';
      const swatch = document.createElement('span');
      swatch.className = 'si-swatch';
      swatch.setAttribute('aria-hidden', 'true');
      swatch.style.background = `#${originColour(origin).toString(16).padStart(6, '0')}`;
      item.append(swatch, t(`surface.buildings.origin.${name}`));
      return item;
    });
    const credit = document.createElement('span');
    credit.className = 'si-buildings-credit';
    credit.textContent = st.attribution ?? '';
    mount.replaceChildren(head, ...items, credit);
  };

  const currentState = () => {
    const s = layer?.state;
    return {
      setId: layer?.setId ?? null,
      loaded: s?.loaded ?? 0,
      buildings: s?.buildings ?? 0,
      origins: s?.origins ?? [],
      attribution: layer?.set.source.attribution ?? null,
    };
  };

  return {
    update({ bodyId, host, radiusKm, cameraPosition }) {
      loadIndex();
      if (!index) return;
      const aim = host.worldPointToGeographic(cameraPosition.clone());
      const entry = setCovering(
        index,
        bodyId,
        aim.longitudeDeg,
        aim.latitudeDeg,
        COVERAGE_MARGIN_DEG
      );
      if (!entry) {
        if (layer) drop();
        return;
      }
      loadManifest(entry.id, entry.manifest);
      const manifest = manifests.get(entry.id);
      if (!manifest || manifest === 'loading' || manifest === 'failed') return;

      if (layer && (layer.setId !== manifest.id || layerHost !== host)) drop();
      if (!layer) {
        const tier = resolveQualityTier(readQualityMode(), isMobile());
        layer = new BuildingLayer({
          host,
          radiusKm,
          set: manifest,
          origin: GALAXY_DATA_ORIGIN,
          budget: PROVISIONAL_BUILDING_BUDGET[tier],
        });
        layerHost = host;
      }
      layer.update(aim);
      renderLegend();
    },
    suspend: drop,
    get state() {
      return currentState();
    },
  };
}
