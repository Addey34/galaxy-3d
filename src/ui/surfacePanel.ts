/**
 * IMAGERIE DE SURFACE : ce que l'utilisateur règle, et ce que le bandeau lui dit
 * (lot 9, phase 9C).
 *
 * Ce module vit dans le bundle de démarrage et pèse le strict nécessaire : une bascule de
 * réglage, un bandeau, et un `import()` DYNAMIQUE du moteur. Le moteur, les fiches de jeux de
 * tuiles et la géométrie des carreaux partent donc dans leur propre morceau, chargé à
 * l'approche d'un corps et jamais au démarrage — mesuré par comptage de requêtes en e2e.
 *
 * Le bandeau DIT ce qui est servi, pas ce qui est espéré : la résolution du niveau réellement
 * peint, le fait que ce niveau sur-échantillonne la mosaïque publiée quand c'est le cas, la
 * campagne qui a produit les images et la catégorie temporelle que `core/temporal.ts` en tire.
 * Une mosaïque ne décrit pas la date de la scène mais la surface : elle est servie telle quelle
 * quelle que soit la date, et c'est cela qu'il faut lire, pas un écart à combler.
 */
import type { PublicAPI } from '@/SolarSystemApp';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import { STORAGE_KEYS } from '@/config/storageKeys';
import { BOOT_QUALITY_PROFILE } from '@/config/engine';
import { classifyTemporal, temporalCategoryLabelKey } from '@/core/temporal';
import { intlLocale, onLocaleChange, t } from '@/i18n';
import Logger from '@/utils/Logger';
import { NOTICE_CHANGED } from './ephemerisNotice';
import type {
  PlanetarySurfaceEngine,
  SurfaceImageryState,
} from '@/components/surface/PlanetarySurfaceEngine';

/** Rayons apparents sous lesquels on daigne CHARGER le moteur. Au-delà : rien n'est demandé. */
const ENGINE_LOAD_RADII = 8;

function readStored(): boolean {
  try {
    // Par défaut ACTIVÉE : c'est la fonctionnalité. Éteinte, elle ne demande rien du tout.
    return localStorage.getItem(STORAGE_KEYS.surfaceImagery) !== '0';
  } catch {
    return true;
  }
}

function writeStored(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEYS.surfaceImagery, enabled ? '1' : '0');
  } catch {
    // Stockage plein/refusé (mode privé) : le réglage reste actif pour la session.
  }
}

export function setupSurfacePanel(api: PublicAPI): () => void {
  const radiiKm = new Map<string, number>();
  for (const [name, cfg] of flattenBodies(CELESTIAL_CONFIG)) {
    const km = cfg.realData?.radiusKm;
    if (km) radiiKm.set(name, km);
  }

  // ── Réglage ────────────────────────────────────────────────────────────────────────────
  const wrapper = document.createElement('label');
  wrapper.id = 'surface-imagery-toggle-wrapper';
  wrapper.className = 'settings-switch';
  const checkbox = document.createElement('input');
  checkbox.id = 'surface-imagery-toggle';
  checkbox.type = 'checkbox';
  checkbox.className = 'oo-checkbox settings-checkbox';
  const switchLabel = document.createElement('span');
  switchLabel.className = 'settings-switch-label';
  wrapper.append(checkbox, switchLabel);
  (
    document.getElementById('settings-section-rendering') ?? document.body
  ).append(wrapper);

  // ── Bandeau de provenance ──────────────────────────────────────────────────────────────
  const badge = document.createElement('div');
  badge.id = 'surface-imagery';
  badge.className = 'surface-imagery-badge';
  badge.hidden = true;
  const headline = document.createElement('span');
  headline.className = 'si-headline';
  const detail = document.createElement('span');
  detail.className = 'si-detail';
  // Ligne du RELIEF : elle n'existe que quand des hauteurs mesurées sont réellement posées
  // sous les carreaux, et elle nomme sa propre source, qui n'est pas celle de l'imagerie.
  const relief = document.createElement('span');
  relief.className = 'si-relief';
  relief.hidden = true;
  const credit = document.createElement('span');
  credit.className = 'si-credit';
  badge.append(headline, detail, relief, credit);
  document.body.append(badge);

  let enabled = readStored();
  checkbox.checked = enabled;

  let engine: PlanetarySurfaceEngine | null = null;
  let loading = false;
  let engineUnavailable = false;
  let state: SurfaceImageryState | null = null;

  const renderLabels = (): void => {
    switchLabel.textContent = t('settings.surfaceImagery');
    checkbox.setAttribute('aria-label', t('settings.surfaceImagery'));
    renderBadge();
  };

  function renderBadge(): void {
    if (!state || state.painted === 0) {
      badge.hidden = true;
      badge.removeAttribute('data-level');
      badge.removeAttribute('data-painted');
      badge.removeAttribute('data-attached');
      badge.removeAttribute('data-width');
      // Et le relief avec : ces attributs sont lus par `?debug-surface`, et les laisser
      // derrière annonçait un relief là où plus aucun carreau n'est posé (vu en mesurant, à
      // 10 000 km d'altitude, où le bandeau était pourtant caché).
      badge.removeAttribute('data-relief');
      badge.removeAttribute('data-relief-m');
      badge.removeAttribute('data-ground');
      return;
    }
    const stamp = classifyTemporal(
      { kind: 'measurement', validTime: state.acquired },
      api.orbitalMechanics.simulationDate,
      new Date()
    );
    headline.textContent = t('surface.imagery.headline', {
      title: state.title,
      resolution: formatResolution(state.groundResolutionM),
    });
    const parts = [
      t('surface.imagery.acquired', {
        from: formatMonth(state.acquired.from),
        to: formatMonth(state.acquired.to),
      }),
      t(temporalCategoryLabelKey(stamp.category)),
    ];
    if (state.oversampling > 1) {
      parts.push(
        t('surface.imagery.oversampled', {
          factor: decimals(state.oversampling, 2),
          published: String(state.publishedPixelsPerDegree),
        })
      );
    }
    detail.textContent = parts.join(' · ');

    const reliefState = state.relief;
    relief.hidden = reliefState === null;
    if (reliefState) {
      const reliefParts = [
        t('surface.relief.headline', {
          title: reliefState.title,
          resolution: formatResolution(reliefState.groundResolutionM),
        }),
      ];
      if (reliefState.areaName)
        reliefParts.push(
          t('surface.relief.area', { name: reliefState.areaName })
        );
      reliefParts.push(
        t('surface.relief.acquired', {
          from: formatMonth(reliefState.acquired.from),
          to: formatMonth(reliefState.acquired.to),
        })
      );
      relief.textContent = reliefParts.join(' · ');
      badge.dataset['relief'] = String(reliefState.level);
      badge.dataset['reliefM'] = reliefState.groundResolutionM.toFixed(1);
      // Lu par `?debug-surface` : l'altitude du sol, qui n'est pas celle du rayon de référence.
      if (reliefState.groundElevationM !== null)
        badge.dataset['ground'] = reliefState.groundElevationM.toFixed(0);
      else delete badge.dataset['ground'];
    } else {
      delete badge.dataset['relief'];
      delete badge.dataset['reliefM'];
      delete badge.dataset['ground'];
    }
    // Les conditions de la NASA demandent de citer la source : quand le relief vient d'ailleurs
    // que l'imagerie, les DEUX crédits sont affichés.
    credit.textContent =
      reliefState && reliefState.credit !== state.credit
        ? `${state.credit} · ${reliefState.credit}`
        : state.credit;
    badge.dataset['level'] = String(state.level);
    badge.dataset['painted'] = String(state.painted);
    badge.dataset['attached'] = String(state.attached);
    // Lu par `?debug-surface` et par l'e2e : la finesse SERVIE, en pixels sur 360°.
    badge.dataset['width'] = String(state.widthPx);
    badge.hidden = false;
    placeBadge();
  }

  /**
   * Pose le bandeau juste AU-DESSUS du dock du bas, mesuré, pas supposé.
   *
   * La règle CSS le plaçait à une hauteur de contrôle du bas, ce qui est juste sur un grand
   * écran. Sous 768 px, le sélecteur Éduc/Explo s'empile en colonne et monte deux fois plus
   * haut : vu en production à 390 px, il recouvrait la ligne de crédit du bandeau, celle que
   * les conditions de la NASA demandent d'afficher. Recopier sa hauteur ici aurait été une
   * seconde source de la même mise en page ; on lit donc sa position réelle.
   */
  function placeBadge(): void {
    if (badge.hidden) return;
    const dock = document.querySelector('.dock--bottom');
    if (!dock) return;
    const gapPx = 8;
    // Le bandeau des éphémérides manquantes (lot 15) occupe la même bande quand il existe :
    // on s'empile au-dessus de sa hauteur MESURÉE plutôt que de se recouvrir sur un écran
    // étroit, où les deux prennent toute la largeur.
    const notice = document.querySelector('#ephemeris-notice');
    const noticeHeight = notice
      ? notice.getBoundingClientRect().height + gapPx
      : 0;
    const top = dock.getBoundingClientRect().top;
    badge.style.bottom = `${Math.max(0, window.innerHeight - top + gapPx + noticeHeight)}px`;
  }

  const onState = (next: SurfaceImageryState | null): void => {
    state = next;
    renderBadge();
  };

  const disable = (): void => {
    engine?.detach();
    state = null;
    renderBadge();
  };

  const tick = (): void => {
    const name = api.cameraSystem.targetName;
    const distance = api.cameraSystem.getDistanceToTargetSceneUnits();
    if (!enabled || !name || distance === null) {
      if (engine?.attachedBody) disable();
      return;
    }
    const body = api.sceneSystem.getBody(name);
    const radiusKm = radiiKm.get(name);
    if (!body || !radiusKm) {
      if (engine?.attachedBody) disable();
      return;
    }
    const renderedRadius =
      (body.group.userData['radius'] as number | undefined) ?? 0;
    if (renderedRadius <= 0) return;
    // Rien n'est chargé, et surtout rien n'est DEMANDÉ, tant que le corps n'occupe pas
    // l'écran : survoler Jupiter de loin ne doit coûter aucune requête.
    if (distance / renderedRadius > ENGINE_LOAD_RADII) {
      if (engine?.attachedBody) disable();
      return;
    }

    if (!engine) {
      // Un seul essai de chargement : ce bloc tourne à chaque image, et un échec (hors ligne
      // au premier passage, morceau absent) aurait sinon relancé un `import()` soixante fois
      // par seconde. Sans le moteur, l'application se contente de sa texture livrée.
      if (loading || engineUnavailable) return;
      loading = true;
      void loadEngine()
        .catch((error: unknown) => {
          engineUnavailable = true;
          Logger.warn(
            `[Surface] moteur d'imagerie indisponible : ${String(error)}`
          );
        })
        .finally(() => {
          loading = false;
        });
      return;
    }

    const tileset = tilesets?.get(name);
    if (!tileset) {
      if (engine.attachedBody) disable();
      return;
    }
    // Le relief n'arrive qu'avec son manifeste, chargé une fois par corps.
    if (ensureHeights(name) === 'pending') return;
    engine.attach(body, tileset, radiusKm, heights.get(name) ?? null);
    engine.update(
      api.cameraSystem.camera,
      api.sceneSystem.renderer.domElement.clientHeight
    );
  };

  let tilesets: ReadonlyMap<
    string,
    import('@/config/surfaceTilesets').SurfaceTileset
  > | null = null;
  let heightSets: ReadonlyMap<
    string,
    import('@/config/surfaceHeights').SurfaceHeightSet
  > | null = null;
  let parseManifest:
    typeof import('@/config/surfaceHeights').parseHeightManifest | null = null;
  /** Manifeste de hauteurs par corps : `undefined` = en cours, `null` = pas de relief. */
  const heights = new Map<
    string,
    import('@/components/surface/PlanetarySurfaceEngine').AttachedHeights | null
  >();
  const heightsLoading = new Set<string>();

  /**
   * Charge le manifeste de hauteurs d'un corps, une fois.
   *
   * Tant qu'il n'a pas répondu, le moteur n'attache rien : sans cela le premier attachement se
   * ferait sans relief, le second avec, et le détachement intermédiaire remettrait le plancher
   * d'approche à la finesse de la texture livrée — la caméra remonterait toute seule.
   */
  function ensureHeights(body: string): 'pending' | 'ready' {
    if (heights.has(body)) return 'ready';
    const set = heightSets?.get(body);
    if (!set || !parseManifest) {
      heights.set(body, null);
      return 'ready';
    }
    if (heightsLoading.has(body)) return 'pending';
    heightsLoading.add(body);
    const parse = parseManifest;
    void fetch(`/${set.manifestPath}`, { credentials: 'omit' })
      .then((response) => {
        if (!response.ok) throw new Error(`manifeste ${response.status}`);
        return response.json();
      })
      .then((raw: unknown) => {
        heights.set(body, { set, manifest: parse(raw) });
      })
      .catch((error: unknown) => {
        // Sans manifeste, les carreaux restent plats : dégradation honnête, jamais d'attente.
        heights.set(body, null);
        Logger.warn(`[Surface] relief indisponible : ${String(error)}`);
      })
      .finally(() => heightsLoading.delete(body));
    return 'pending';
  }

  async function loadEngine(): Promise<void> {
    const [
      { PlanetarySurfaceEngine },
      { SURFACE_TILESETS },
      { SURFACE_HEIGHT_SETS, parseHeightManifest },
    ] = await Promise.all([
      import('@/components/surface/PlanetarySurfaceEngine'),
      import('@/config/surfaceTilesets'),
      import('@/config/surfaceHeights'),
    ]);
    tilesets = SURFACE_TILESETS;
    heightSets = SURFACE_HEIGHT_SETS;
    parseManifest = parseHeightManifest;
    engine = new PlanetarySurfaceEngine({
      budget: BOOT_QUALITY_PROFILE.surfaceTiles,
      onState,
      // La finesse servie a changé : `CameraSystem` ne repose ses bornes d'approche qu'à la
      // sélection, il faut donc le lui dire, sinon la descente reste plafonnée par la
      // texture livrée.
      onImageryWidthChanged: () => api.cameraSystem.refreshApproachBounds(),
    });
  }

  checkbox.addEventListener('change', () => {
    enabled = checkbox.checked;
    writeStored(enabled);
    if (!enabled) disable();
  });

  renderLabels();
  onLocaleChange(renderLabels);
  window.addEventListener('resize', placeBadge);
  // Le bandeau des éphémérides manquantes occupe la même bande : quand il paraît, change de
  // taille ou disparaît, on relit sa position réelle (cf. `ui/ephemerisNotice`).
  window.addEventListener(NOTICE_CHANGED, placeBadge);
  const unsubscribe = api.animationSystem.onFrame(tick);

  return () => {
    unsubscribe();
    window.removeEventListener('resize', placeBadge);
    engine?.dispose();
    engine = null;
    badge.remove();
    wrapper.remove();
  };
}

/**
 * Un nombre décimal dans la langue de la page. Le séparateur n'est pas le même des deux côtés :
 * `toFixed` écrivait « 1.20 fois plus grande » en français, où la virgule est de rigueur.
 */
function decimals(value: number, digits: number): string {
  return new Intl.NumberFormat(intlLocale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Mois et année de l'intervalle décrit : la campagne, pas un jour précis qu'elle n'a pas. */
function formatMonth(ms: number): string {
  return new Date(ms).toLocaleDateString(intlLocale(), {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

/** Mètres tant que c'est lisible, kilomètres au-delà : 83 m/px et 1,3 km/px se lisent mal ensemble. */
function formatResolution(metres: number): string {
  if (!Number.isFinite(metres)) return 'n/a';
  return metres >= 1000
    ? `${decimals(metres / 1000, metres >= 10000 ? 0 : 1)} km`
    : `${Math.round(metres)} m`;
}
