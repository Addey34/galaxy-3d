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
import { splitUrls } from '@/core/textLinks';
import { safeExternalUrl } from '@/utils/safeUrl';
import { getLocale, intlLocale, t } from '@/i18n';
import {
  HttpStatusError,
  PermanentFetchError,
  classifyTransportFailure,
  mayRequest,
  parseRetryAfter,
  recordFailure,
  retryAfterOf,
  type FailureRecord,
} from '@/core/fetchRetry';
import { GALAXY_DATA_ORIGIN } from '@/core/galaxyData';
import { readQualityMode, resolveQualityTier } from '@/core/qualityTier';
import Logger from '@/utils/Logger';

/** Les manifestes et l'index sont des fichiers de l'application, pas du service de données. */
const SITE_ORIGIN = (): string =>
  typeof location === 'undefined' ? '' : location.origin;

/** Marge autour d'un jeu où l'on prépare déjà ses tuiles (une tuile déborde de son emprise). */
const COVERAGE_MARGIN_DEG = 0.02;

/**
 * Hôtes dont une adresse peut apparaître dans l'attribution d'un jeu (licence ou page de crédit
 * exigée par la source). Une adresse d'un autre hôte reste du texte. Chaque manifeste publié est
 * confronté à cette liste par `buildingCreditLinks.test.ts`.
 */
export const LICENCE_HOSTS: ReadonlySet<string> = new Set([
  'opendatacommons.org',
  'docs.3dbag.nl',
  'data.cityofnewyork.us',
]);

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

/** Lit un fichier JSON de l'application ; les échecs portent leur nature (HTTP, réponse d'un autre type). */
const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url);
  if (!response.ok)
    throw new HttpStatusError(
      response.status,
      parseRetryAfter(response.headers.get('retry-after'), Date.now())
    );
  // La réécriture SPA de l'hébergeur rend du HTML pour un fichier absent : définitif.
  if (!(response.headers.get('content-type') ?? '').includes('json'))
    throw new PermanentFetchError('réponse non JSON');
  // Lire le corps puis l'analyser à part : un corps interrompu (réseau) lève ICI une erreur de
  // transport, passagère ; un JSON mal formé n'est pas une panne et ne se répare pas en le
  // redemandant.
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new PermanentFetchError(`JSON mal formé : ${String(error)}`);
  }
};

export function createBuildingsOverlay(
  mount: HTMLElement,
  options: {
    fetchJson?: (url: string) => Promise<unknown>;
    now?: () => number;
  } = {}
): BuildingsOverlay {
  const getJson = options.fetchJson ?? fetchJson;
  const now = options.now ?? ((): number => performance.now());
  let index: BuildingSetIndex | null = null;
  /** `ready` : l'index valide est gardé, plus jamais redemandé. */
  let indexState: 'idle' | 'loading' | 'ready' = 'idle';
  let indexFailure: FailureRecord | undefined;
  const manifests = new Map<string, BuildingSetManifest | 'loading'>();
  const manifestFailures = new Map<string, FailureRecord>();
  /**
   * Échecs des tuiles, gardés tant que l'overlay vit : détruire la couche (zone quittée, caméra
   * remontée) ne rend pas ses essais aux tuiles. Borné par `rememberFailure`.
   */
  const tileFailures = new Map<string, FailureRecord>();
  let layer: BuildingLayer | null = null;
  let layerHost: BuildingTarget | null = null;

  /**
   * Charge un JSON puis le fait valider. Un échec de TRANSPORT se classe (passager ou définitif) ;
   * un document qui ne passe pas la validation est définitif.
   */
  const load = (
    url: string,
    accept: (json: unknown) => void,
    fail: (
      kind: 'transient' | 'permanent',
      retryAfterMs: number | null
    ) => void,
    label: string
  ): void => {
    getJson(url).then(
      (json) => {
        try {
          accept(json);
        } catch (error: unknown) {
          fail('permanent', null);
          Logger.warn(`[Bâtiments] ${label} invalide : ${String(error)}`);
        }
      },
      (error: unknown) => {
        const kind = classifyTransportFailure(error);
        if (kind === 'abort') return;
        fail(kind, retryAfterOf(error));
        Logger.warn(`[Bâtiments] ${label} indisponible : ${String(error)}`);
      }
    );
  };

  const loadIndex = (): void => {
    if (indexState !== 'idle' || !mayRequest(indexFailure, now())) return;
    indexState = 'loading';
    load(
      `${SITE_ORIGIN()}/assets/buildings/index.json`,
      (json) => {
        index = parseBuildingSetIndex(json);
        indexState = 'ready';
        indexFailure = undefined;
      },
      (kind, retryAfterMs) => {
        indexState = 'idle';
        indexFailure = recordFailure(indexFailure, kind, now(), retryAfterMs);
      },
      'index'
    );
  };

  const loadManifest = (id: string, path: string): void => {
    if (manifests.has(id) || !mayRequest(manifestFailures.get(id), now()))
      return;
    manifests.set(id, 'loading');
    load(
      `${SITE_ORIGIN()}/${path}`,
      (json) => {
        manifests.set(id, parseBuildingSetManifest(json));
        manifestFailures.delete(id);
      },
      (kind, retryAfterMs) => {
        manifests.delete(id);
        manifestFailures.set(
          id,
          recordFailure(manifestFailures.get(id), kind, now(), retryAfterMs)
        );
      },
      `manifeste « ${id} »`
    );
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
    // Le texte reste celui du manifeste (le mode capture le relit tel quel) ; seule l'adresse de la
    // licence devient un lien, et seulement vers un hôte de licence connu.
    credit.append(
      ...splitUrls(st.attribution ?? '').map((part) => {
        const href =
          part.kind === 'url'
            ? safeExternalUrl(part.value, LICENCE_HOSTS)
            : null;
        if (!href) return document.createTextNode(part.value);
        const link = document.createElement('a');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = part.value;
        return link;
      })
    );
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
      if (!manifest || manifest === 'loading') return;

      if (layer && (layer.setId !== manifest.id || layerHost !== host)) drop();
      if (!layer) {
        const tier = resolveQualityTier(readQualityMode(), isMobile());
        layer = new BuildingLayer({
          host,
          radiusKm,
          set: manifest,
          origin: GALAXY_DATA_ORIGIN,
          budget: PROVISIONAL_BUILDING_BUDGET[tier],
          failures: tileFailures,
          now,
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
