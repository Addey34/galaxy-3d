/**
 * Fiche d'information d'un corps (#body-info).
 *
 * S'ouvre à chaque sélection (barre de navigation, clic 3D, label Explo — toutes routées
 * par `PlanetNavigation.selectBody`, cf. `MainSolarSystemApp`) et affiche les données
 * documentaires du catalogue (`realData`). Purement lecture : aucun impact sur la simulation.
 * Le contenu est dérivé du catalogue — ajouter un corps n'exige aucune édition ici.
 */
import { CELESTIAL_CONFIG } from '@/config/bodies';
import {
  allBodies,
  flattenBodies,
  hasIllustrativeSurface,
} from '@/config/catalog';
import { TEXTURE_SETTINGS } from '@/config/engine';
import { KM_PER_AU, SQRT_K } from '@/core/ScaleService';
import { RAD_TO_DEG as RAD2DEG } from '@/core/MathConstants';
import { t, intlLocale, getLocale, onLocaleChange } from '@/i18n';
import { bodyDisplayName, bodyDescription } from '@/i18n/bodyText';
import type { CelestialBodyConfig, FactField } from '@/types';
import {
  bodyFact,
  citationOrder,
  displayedUncertainty,
  type FactEntry,
} from '@/core/bodyFacts';
import { FACT_SOURCE_HOSTS, factSource } from '@/config/factSources';
import { bodyAccentColor, hexToRgbTriplet, onAccentChange } from './bodyAccent';
import {
  convertDistanceKm,
  distanceDecimals,
  convertTemperatureC,
  onUnitSystemChange,
} from '@/core/units';
import { safeExternalUrl } from '@/utils/safeUrl';
import type { MeasuredWindow, PositionSource } from '@/core/positionProvenance';
import {
  DAY_MS,
  temporalCategoryLabelKey,
  type TemporalStamp,
} from '@/core/temporal';
import type { OverlayCoordinator } from './overlayCoordinator';

const C_KM_PER_S = 299_792.458; // vitesse de la lumière

const CONFIGS = flattenBodies(CELESTIAL_CONFIG);
/** Parent réel de chaque satellite, lu dans l'imbrication du catalogue — jamais déduit du `kind`. */
const PARENT_OF = new Map(
  allBodies(CELESTIAL_CONFIG).map((e) => [e.name, e.parentName])
);

/** Rang de chaque planète (1 = Mercure) dérivé de l'ordre du catalogue, pour le sous-titre. */
const PLANET_ORDINALS = ((): Map<string, number> => {
  const map = new Map<string, number>();
  let n = 0;
  for (const [name, cfg] of Object.entries(CELESTIAL_CONFIG.bodies)) {
    if (cfg.kind === 'planet') map.set(name, ++n);
  }
  return map;
})();

// ── Formateurs (locale courante : séparateurs de milliers/décimales adaptés à la langue) ──

function num(n: number, maxFractionDigits = 0): string {
  return n.toLocaleString(intlLocale(), {
    maximumFractionDigits: maxFractionDigits,
  });
}

/** Exposant en chiffres exposants Unicode (24 → « ²⁴ »). */
function superscript(n: number): string {
  const map: Record<string, string> = {
    '0': '⁰',
    '1': '¹',
    '2': '²',
    '3': '³',
    '4': '⁴',
    '5': '⁵',
    '6': '⁶',
    '7': '⁷',
    '8': '⁸',
    '9': '⁹',
    '-': '⁻',
  };
  return String(n)
    .split('')
    .map((c) => map[c] ?? c)
    .join('');
}

function formatMass(kg: number): string {
  const exp = Math.floor(Math.log10(kg));
  const mantissa = kg / 10 ** exp;
  return `${num(mantissa, 2)} × 10${superscript(exp)} kg`;
}

/**
 * Période de rotation SIDÉRALE, en heures (puis en jours si très longue), telle que la lit
 * `core/bodyFacts.factValue` dans la vitesse de rotation axiale. Ce n'est pas le jour solaire :
 * Mercure tourne en 58,6 j mais son jour solaire dure 176 j. La valeur est déjà absolue : le
 * signe porte le sens (Triton rétrograde), pas la durée ; sans cela Triton affichait « -142h 57m ».
 */
function formatSiderealRotation(hours: number): string {
  if (hours < 48) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${num(hours / 24)} ${t('unit.day.short')}`;
}

function formatPeriod(days: number): string {
  // Deux décimales sous dix jours : Protée (1,12 j) s'affichait « 1 j ».
  if (days < 10) return `${num(days, 2)} ${t('unit.day.short')}`;
  return days < 400
    ? `${num(days)} ${t('unit.day.short')}`
    : `${num(days / 365.25, 1)} ${t('unit.year.short')}`;
}

// ── Bloc live (Explo) : distance réelle depuis la caméra + temps-lumière ──
// Fusionné depuis l'ancien HUD « TARGET ». La distance vient de la caméra en unités
// scène (explo : AU × SQRT_K) ; on la reconvertit en km puis en AU / temps-lumière.

/** Exportée pour `ui/capture.ts` (cartouche d'export image) — même conversion, pas de doublon. */
export function sceneUnitsToKm(sceneUnits: number): number {
  return (sceneUnits / SQRT_K) * KM_PER_AU;
}

export function formatLiveDistance(km: number): string {
  const au = km / KM_PER_AU;
  const auStr = `${num(au, 3)} ${t('unit.au')}`;
  const { value: dist, unit } = convertDistanceKm(km);
  let kmStr: string;
  if (dist >= 1e9) kmStr = `${num(dist / 1e9, 2)} ${t('unit.billion')} ${unit}`;
  else if (dist >= 1e6)
    kmStr = `${num(dist / 1e6, 1)} ${t('unit.million')} ${unit}`;
  else kmStr = `${num(Math.round(dist))} ${unit}`;
  return `${auStr} · ${kmStr}`;
}

export function formatLightTime(km: number): string {
  const s = km / C_KM_PER_S;
  const light = t('unit.light');
  if (s < 1) return `${(s * 1000).toFixed(0)} ms ${light}`;
  if (s < 60) return `${s.toFixed(1)} s ${light}`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    return `${m} min ${Math.round(s - m * 60)} s ${light}`;
  }
  const h = Math.floor(s / 3600);
  return `${h} h ${Math.round((s - h * 3600) / 60)} min ${light}`;
}

// ── Provenance temporelle de la position (source, catégorie, écart mesuré) ──

/** Ce que la fiche affiche de la position du corps à la date de la scène. */
export interface PositionProvenanceView {
  source: PositionSource;
  stamp: TemporalStamp;
  /** Écart moyen mesuré à Horizons sur la fenêtre la plus étroite qui contient la date. */
  error: MeasuredWindow | null;
}

/**
 * Fenêtre mesurée affichée en ANNÉES. Le jour exact donnerait une précision que la fenêtre n'a
 * pas (elles tombent à quelques jours d'un 1er janvier : 1900-01-02, 2035-12-31), et aucune des
 * deux bornes ne doit annoncer plus que ce qui a été mesuré :
 *   - début : année la PLUS PROCHE (2015-12-31 → 2016, et non 2015) ;
 *   - fin : année du DERNIER JOUR mesuré (fin stockée exclusive), donc jamais arrondie vers le
 *     haut (2100-12-29 → 2100, et non 2101).
 */
function windowYears(from: number, toExclusive: number): [string, string] {
  const startYear = new Date(from).getUTCFullYear();
  const nextYear = Date.UTC(startYear + 1, 0, 1);
  const start =
    from - Date.UTC(startYear, 0, 1) <= nextYear - from
      ? startYear
      : startYear + 1;
  return [
    String(start),
    String(new Date(toExclusive - DAY_MS).getUTCFullYear()),
  ];
}

/**
 * Deux lignes : « source · catégorie (· confiance) » puis l'écart mesuré, ou le fait qu'il ne
 * l'a pas été à cette date. La catégorie et l'écart sont deux axes : « prédit » ne dit rien de
 * l'exactitude, le chiffre si.
 */
export function formatPositionProvenance(view: PositionProvenanceView): {
  source: string;
  error: string;
} {
  const parts = [
    t(`position.source.${view.source}`),
    t(temporalCategoryLabelKey(view.stamp.category)),
  ];
  if (view.stamp.confidence === 'reduced')
    parts.push(t('time.confidence.reduced'));
  if (!view.error)
    return { source: parts.join(' · '), error: t('position.error.none') };
  const { value, unit } = convertDistanceKm(view.error.meanKm);
  const [from, to] = windowYears(view.error.from, view.error.to);
  return {
    source: parts.join(' · '),
    error: t('position.error', {
      distance: `${value.toLocaleString(intlLocale(), { maximumSignificantDigits: 2 })} ${unit}`,
      from,
      to,
    }),
  };
}

// ── Construction des lignes de la fiche depuis la config d'un corps ──

export interface Stat {
  label: string;
  value: string;
  /** Raison, quand la valeur n'est pas affichée (non publiée, ou pas encore sourcée). */
  note?: string;
  /** Numéro de la source dans la liste « Sources » de la fiche. */
  sourceIndex?: number;
  /** Date de validité mise en forme, pour un fait qui évolue (« août 2026 »). */
  asOf?: string;
  /** Méthode, précision et source, lisibles en infobulle et par un lecteur d'écran. */
  provenance?: string;
}

/**
 * Marque une valeur non affichée, distincte d'un zéro ou d'une absence. Traduite (« n/a »,
 * « n.d. ») plutôt qu'un tiret cadratin, qu'aucun texte affiché n'emploie.
 */
const unknownMark = (): string => t('stat.unknown.value');

const localeKey = (): 'en' | 'fr' => (getLocale() === 'fr' ? 'fr' : 'en');

/** `2026-08` ou `2026-08-17` → « August 2026 » / « août 2026 » dans la langue courante. */
function formatAsOf(asOf: string): string {
  const [year, month] = asOf.split('-').map(Number);
  if (!month) return String(year);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
    intlLocale(),
    { month: 'long', year: 'numeric', timeZone: 'UTC' }
  );
}

function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(
    intlLocale(),
    { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
  );
}

/** Valeur mise en forme d'un fait, dans l'unité choisie par l'utilisateur. */
function formatFact(name: string, field: FactField, value: number): string {
  switch (field) {
    case 'radiusKm': {
      const radius = convertDistanceKm(value);
      // Décimales selon l'ordre de grandeur. Sans ça un corps sous le kilomètre s'affichait
      // « 0 km » : Bennu, 242 mètres de rayon, annonçait donc zéro. L'arrondi par défaut
      // convient aux planètes parce qu'elles se comptent en milliers de kilomètres, pas parce
      // qu'il serait correct en général.
      return `${num(radius.value, distanceDecimals(radius.value))} ${radius.unit}`;
    }
    case 'distanceAU': {
      // Demi-grand axe mesuré depuis le PARENT pour un satellite (Titan → Saturne).
      if (PARENT_OF.get(name)) {
        const fromParent = convertDistanceKm(value * KM_PER_AU);
        return `${num(fromParent.value)} ${fromParent.unit}`;
      }
      return `${num(value, 2)} ${t('unit.au')}`;
    }
    case 'massKg':
      return formatMass(value);
    case 'gravity':
      // Deux décimales effaçaient la gravité des petites lunes : Phobos (0,0057) lisait « 0,01 ».
      return `${num(value, value < 0.1 ? 4 : 2)} m/s²`;
    case 'meanTempC': {
      const temp = convertTemperatureC(value);
      return `${num(temp.value)} ${temp.unit}`;
    }
    case 'rotationPeriod':
      return formatSiderealRotation(value);
    case 'orbitPeriodDays':
      return formatPeriod(value);
    case 'moonCount':
      return num(value);
    case 'axialTilt':
      return `${num(value * RAD2DEG, 1)}°`;
  }
}

function factLabel(name: string, field: FactField): string {
  const parent = PARENT_OF.get(name) ?? null;
  switch (field) {
    case 'radiusKm':
      return t('stat.radius');
    case 'distanceAU':
      // L'ancien libellé disait « Distance (Terre) » pour toutes les lunes, faux sauf pour la Lune.
      return parent
        ? t('stat.meanDistanceFrom', { parent: bodyDisplayName(parent) })
        : t('stat.meanDistanceSun');
    case 'massKg':
      return t('stat.mass');
    case 'gravity':
      return t('stat.gravity');
    case 'meanTempC':
      return t('stat.meanTemperature');
    case 'rotationPeriod':
      return t('stat.siderealRotation');
    case 'orbitPeriodDays':
      return parent ? t('stat.orbit') : t('stat.year');
    case 'moonCount':
      return t('stat.knownMoons');
    case 'axialTilt':
      return t('stat.axialTilt');
  }
}

/** Ordre des lignes de la fiche. */
export const CARD_FACT_ORDER: readonly FactField[] = [
  'radiusKm',
  'distanceAU',
  'massKg',
  'gravity',
  'meanTempC',
  'rotationPeriod',
  'orbitPeriodDays',
  'moonCount',
  'axialTilt',
];

const cardEntries = (cfg: CelestialBodyConfig): FactEntry[] =>
  CARD_FACT_ORDER.map((field) => bodyFact(cfg, field));

/**
 * Lignes de la fiche. La décision de ce qui s'affiche comme un fait appartient à
 * `core/bodyFacts.ts`, partagée avec la page publique du corps ; ce module ne fait que
 * mettre en forme. Exportée pour les tests : les libellés sont une affirmation scientifique.
 */
export function bodyStats(name: string, cfg: CelestialBodyConfig): Stat[] {
  if (!cfg.realData) return [];
  const entries = cardEntries(cfg);
  const citations = citationOrder(entries);
  const stats: Stat[] = [];
  for (const entry of entries) {
    if (entry.status === 'absent') continue;
    const label = factLabel(name, entry.field);
    if (entry.status === 'unknown') {
      // La ligne reste, avec sa raison : une ligne absente est ambiguë, l'utilisateur ne peut
      // pas distinguer « la science ne donne pas ce chiffre » de « le catalogue l'a oublié ».
      const prefix = entry.reason.unsourced
        ? t('stat.unsourced')
        : t('stat.unknown');
      stats.push({
        label,
        value: unknownMark(),
        note: `${prefix} : ${entry.reason[localeKey()]}`,
      });
      continue;
    }
    const { provenance } = entry;
    const formatted = formatFact(name, entry.field, entry.value);
    const uncertainty = displayedUncertainty(entry);
    const source = factSource(provenance.source);
    stats.push({
      label,
      value:
        uncertainty === null
          ? formatted
          : // Insécables : « (± 94 %) » ne doit jamais se couper entre ses signes.
            `${formatted} (±\u00a0${num(uncertainty * 100)}\u00a0%)`,
      sourceIndex: citations.get(provenance.source),
      ...(provenance.asOf ? { asOf: formatAsOf(provenance.asOf) } : {}),
      provenance: [
        t(`fact.method.${provenance.method}`),
        provenance.detail?.[localeKey()],
        provenance.citation,
        source ? `${source.publisher}, ${source.title}` : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }
  return stats;
}

export interface SourceItem {
  index: number;
  publisher: string;
  title: string;
  url: string;
  /** Revue ou prépublication, année, date de consultation. */
  reference: string;
  /** Champs appuyés par cette source, avec leur méthode (« Rayon : mesuré »). */
  supports: string;
}

/** Sources citées par la fiche d'un corps, dans l'ordre de leurs numéros. */
export function bodySources(
  name: string,
  cfg: CelestialBodyConfig
): SourceItem[] {
  if (!cfg.realData) return [];
  const entries = cardEntries(cfg);
  const items: SourceItem[] = [];
  for (const [id, index] of citationOrder(entries)) {
    const source = factSource(id);
    if (!source) continue;
    // Regroupé par méthode : « Valeurs mesurées : rayon, masse · Valeurs dérivées : gravité ».
    const byMethod = new Map<string, string[]>();
    for (const e of entries)
      if (e.status === 'value' && e.provenance.source === id) {
        const labels = byMethod.get(e.provenance.method) ?? [];
        labels.push(factLabel(name, e.field));
        byMethod.set(e.provenance.method, labels);
      }
    const supports = [...byMethod]
      .map(
        ([method, labels]) =>
          `${t(`fact.methods.${method}`)} : ${labels.join(', ')}`
      )
      .join(' · ');
    items.push({
      index,
      publisher: source.publisher,
      title: source.title,
      url: source.url,
      reference: [
        source.kind === 'preprint' ? t('fact.kind.preprint') : source.journal,
        source.published?.slice(0, 4),
        t('fact.accessed', { date: formatDay(source.accessed) }),
      ]
        .filter(Boolean)
        .join(', '),
      supports,
    });
  }
  return items;
}

/**
 * Jeton ordinal localisé pour le rang planétaire.
 * Anglais : « 1st », « 2nd », « 3rd », sinon « nth ». Français (planète est féminin) :
 * « 1ʳᵉ », sinon « nᵉ ».
 */
function ordinalToken(n: number): string {
  if (getLocale() === 'fr') return n === 1 ? '1ʳᵉ' : `${n}ᵉ`;
  const t100 = n % 100;
  const suffix =
    t100 >= 11 && t100 <= 13
      ? 'th'
      : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/** Sous-titre selon la catégorie (« 3rd planet from the Sun », « Natural satellite »…). */
function subtitle(name: string, cfg: CelestialBodyConfig): string {
  switch (cfg.kind) {
    case 'star':
      return t('subtitle.star');
    case 'moon':
      return t('subtitle.moon');
    case 'dwarf':
      return t('subtitle.dwarf');
    case 'asteroid':
      return t('subtitle.asteroid');
    case 'comet':
      return t('subtitle.comet');
    case 'planet': {
      const n = PLANET_ORDINALS.get(name);
      if (!n) return t('subtitle.planet');
      return t('subtitle.planetOrdinal', { ordinal: ordinalToken(n) });
    }
    default:
      return '';
  }
}

export interface BodyInfoPanel {
  /** Affiche la fiche du corps `name` (rien si le corps est inconnu ou sans données). */
  show(name: string): void;
  /** Masque la fiche (ex. retour Vue Globale). */
  hide(): void;
  /**
   * Met à jour le bloc live (distance réelle + temps-lumière) à chaque frame en Explo.
   * `sceneDist` = distance caméra→cible en unités scène ; `null` (Éducatif ou vue libre)
   * masque le bloc. Sans effet si la fiche est masquée.
   */
  updateLive(sceneDist: number | null): void;
  /**
   * Provenance temporelle de la position du corps affiché, recalculée par
   * `ui/positionProvenance.ts` quand la date de la scène change. `null` masque le bloc.
   */
  updatePosition(view: PositionProvenanceView | null): void;
  /** Corps dont la fiche est ouverte (ou repliée mais sélectionné), sinon `null`. */
  currentBody(): string | null;
}

export function setupBodyInfo(coordinator?: OverlayCoordinator): BodyInfoPanel {
  const panel = document.getElementById('body-info');
  if (!panel)
    return {
      show: () => {},
      hide: () => {},
      updateLive: () => {},
      updatePosition: () => {},
      currentBody: () => null,
    };

  const dot = panel.querySelector<HTMLElement>('.bi-dot')!;
  const nameEl = panel.querySelector<HTMLElement>('.bi-name')!;
  const subEl = panel.querySelector<HTMLElement>('.bi-subtitle')!;
  const fictionalEl = panel.querySelector<HTMLElement>('.bi-fictional-badge')!;
  const statsEl = panel.querySelector<HTMLElement>('.bi-stats')!;
  const descEl = panel.querySelector<HTMLElement>('.bi-desc')!;
  const creditEl = panel.querySelector<HTMLElement>('.bi-credit');
  const sourcesEl = panel.querySelector<HTMLDetailsElement>('.bi-sources');
  const sourcesList = sourcesEl?.querySelector<HTMLOListElement>('ol');
  const closeBtn = panel.querySelector<HTMLButtonElement>('.bi-close')!;
  // Déclencheur d'accès (dock haut-droit) : réaffiche la fiche du corps courant après
  // fermeture, sans reprendre le vol caméra. Masqué tant qu'aucun corps n'est sélectionné.
  const triggerBtn = document.querySelector<HTMLButtonElement>('#info-trigger');
  const moreEl = panel.querySelector<HTMLAnchorElement>('.bi-more')!;
  const liveEl = panel.querySelector<HTMLElement>('.bi-live')!;
  const liveDist = panel.querySelector<HTMLElement>('.bi-live-dist')!;
  const liveLt = panel.querySelector<HTMLElement>('.bi-live-lt')!;
  const positionEl = panel.querySelector<HTMLElement>('.bi-position');
  const positionSource = positionEl?.querySelector<HTMLElement>(
    '.bi-position-source'
  );
  const positionError =
    positionEl?.querySelector<HTMLElement>('.bi-position-error');
  let lastPosition: PositionProvenanceView | null = null;

  let visible = false;

  const setVisible = (next: boolean): void => {
    visible = next;
    panel.hidden = !next;
    triggerBtn?.setAttribute('aria-expanded', String(next));
  };

  // Ferme la fiche mais garde le déclencheur (le corps reste sélectionné).
  const collapse = (): void => setVisible(false);
  coordinator?.register('body-info', collapse);

  closeBtn.addEventListener('click', collapse);
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      collapse();
      triggerBtn?.focus();
    }
  });
  triggerBtn?.addEventListener('click', () => {
    if (visible) collapse();
    else if (currentName) {
      coordinator?.requestOpen('body-info');
      setVisible(true);
    }
  });

  // Masque totalement la fiche ET son déclencheur (retour Vue globale : plus de corps).
  const hide = (): void => {
    currentName = null;
    setVisible(false);
    if (triggerBtn) triggerBtn.hidden = true;
  };

  // Dernier corps affiché : permet de re-rendre la fiche telle quelle au changement de langue.
  let currentName: string | null = null;

  const render = (name: string): void => {
    const cfg = CONFIGS.get(name);
    // Pas de fiche pour la skybox ni les corps sans données documentaires.
    if (!cfg || cfg.kind === 'skybox' || !cfg.realData) {
      hide();
      return;
    }

    const accent = bodyAccentColor(cfg, name);
    panel.style.setProperty('--planet-rgb', hexToRgbTriplet(accent));
    dot.style.background = `rgb(${hexToRgbTriplet(accent)})`;
    nameEl.textContent = bodyDisplayName(name);
    subEl.textContent = subtitle(name, cfg);

    // Badge « surface fictive » : texture illustrative, pas une mosaïque scientifique fidèle.
    const illustrative = hasIllustrativeSurface(name);
    fictionalEl.hidden = !illustrative;
    if (illustrative) {
      fictionalEl.textContent = t('bi.fictional');
      fictionalEl.title = t('bi.fictional.hint');
    }

    statsEl.replaceChildren();
    for (const stat of bodyStats(name, cfg)) {
      const dt = document.createElement('dt');
      dt.textContent = stat.label;
      const dd = document.createElement('dd');
      dd.textContent = stat.value;
      if (stat.note) {
        // `title` pour la souris, `aria-label` pour un lecteur d'ecran : une marque seule
        // n'annonce rien d'utile sans la raison qui l'accompagne.
        dd.title = stat.note;
        dd.setAttribute('aria-label', stat.note);
        dd.classList.add('is-unknown');
      }
      if (stat.asOf) {
        // Un fait qui évolue n'est vrai qu'à une date : elle se lit à côté du chiffre.
        const asOf = document.createElement('span');
        asOf.className = 'bi-asof';
        asOf.textContent = t('fact.asOf', { date: stat.asOf });
        dd.append(' ', asOf);
      }
      if (stat.sourceIndex !== undefined) {
        // Renvoi numéroté vers la liste des sources, comme une note de bas de page. La méthode
        // et la source complète sont dans l'infobulle et annoncées au lecteur d'écran.
        const ref = document.createElement('sup');
        ref.className = 'bi-ref';
        ref.textContent = String(stat.sourceIndex);
        dd.append(ref);
        if (stat.provenance) {
          dd.title = stat.provenance;
          const spoken = stat.asOf
            ? `${stat.value} ${t('fact.asOf', { date: stat.asOf })}`
            : stat.value;
          dd.setAttribute(
            'aria-label',
            `${spoken} (${t('bi.source')} ${stat.sourceIndex} : ${stat.provenance})`
          );
        }
      }
      statsEl.append(dt, dd);
    }

    // Sources citées : repliées par défaut pour garder la fiche compacte, toujours présentes.
    if (sourcesEl && sourcesList) {
      const items = bodySources(name, cfg);
      sourcesList.replaceChildren(
        ...items.map((item) => {
          const li = document.createElement('li');
          li.value = item.index;
          const link = document.createElement('a');
          const url = safeExternalUrl(item.url, FACT_SOURCE_HOSTS);
          if (url) {
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
          }
          link.textContent = `${item.publisher}, ${item.title}`;
          const reference = document.createElement('span');
          reference.className = 'bi-source-ref';
          reference.textContent = item.reference;
          const supports = document.createElement('span');
          supports.className = 'bi-source-supports';
          supports.textContent = item.supports;
          li.append(link, reference, supports);
          return li;
        })
      );
      sourcesEl.hidden = items.length === 0;
    }

    const desc = bodyDescription(cfg);
    descEl.textContent = desc;
    descEl.hidden = !desc;

    // Crédit du modèle de forme affiché. Il n'existait que dans la configuration et dans le
    // fichier glTF : nulle part où un visiteur le voit, alors que la politique ISAS/JAXA exige
    // de citer la source (et les modifications) de tout usage de ses données.
    if (creditEl) {
      const locale = getLocale() === 'fr' ? 'fr' : 'en';
      const credit = cfg.model?.credit[locale];
      const colour = cfg.model?.colourSource?.[locale];
      // La carte de couleur est une donnée tierce elle aussi : citée à côté de la forme.
      creditEl.textContent = credit
        ? `${t('bi.modelCredit')} : ${credit}${colour ? ` · ${t('bi.colourCredit')} : ${colour}` : ''}`
        : '';
      creditEl.hidden = !credit;
    }

    // Lien « En savoir plus » — article Wikipédia dans la langue courante (realData.wiki).
    const wiki = cfg.realData.wiki;
    const wikiUrl = safeExternalUrl(
      wiki ? (getLocale() === 'fr' ? wiki.fr : wiki.en) : undefined,
      new Set(['fr.wikipedia.org', 'en.wikipedia.org'])
    );
    if (wikiUrl) {
      moreEl.href = wikiUrl;
      moreEl.rel = 'noopener noreferrer';
      moreEl.target = '_blank';
      moreEl.textContent = t('bi.more');
      moreEl.hidden = false;
    } else {
      moreEl.hidden = true;
    }

    // Fond d'en-tête : la texture de surface du corps (plus petite résolution disponible,
    // déjà en cache navigateur puisque chargée pour le mesh) derrière un dégradé sombre.
    const surface = cfg.textures?.surface;
    const resolutions = cfg.textureResolutions.surface;
    const res = resolutions?.[resolutions.length - 1];
    if (surface && res) {
      panel.style.setProperty(
        '--bi-hero',
        `url("${TEXTURE_SETTINGS.basePath}${surface}_${res}.jpg")`
      );
      panel.classList.add('has-hero');
    } else {
      panel.classList.remove('has-hero');
      panel.style.removeProperty('--bi-hero');
    }

    if (triggerBtn) triggerBtn.hidden = false;
  };

  const show = (name: string): void => {
    const cfg = CONFIGS.get(name);
    // Corps sans fiche (skybox, sans données) : ne pas ouvrir de surface vide.
    if (!cfg || cfg.kind === 'skybox' || !cfg.realData) {
      hide();
      return;
    }
    currentName = name;
    render(name);
    // La sélection ouvre la fiche : sur toutes tailles, la surface s'affiche (elle est
    // désormais compacte et n'occulte pas la scène). L'utilisateur peut la fermer.
    coordinator?.requestOpen('body-info');
    setVisible(true);
    // Neuf corps : on repart d'un bloc live masqué (updateLive le remplira à la frame
    // suivante en Explo) pour ne pas laisser la distance du corps précédent. Même règle pour
    // la provenance de la position, qui décrivait l'autre corps.
    liveEl.hidden = true;
    updatePosition(null);
  };

  // Changement de langue : re-rend la fiche du corps courant (noms, sous-titre, stats,
  // description) même si elle est momentanément fermée — son contenu reste ainsi à jour pour
  // sa prochaine réouverture. Le bloc live se réactualise seul à la frame suivante.
  onLocaleChange(() => {
    if (currentName) render(currentName);
    updatePosition(lastPosition);
  });
  // Mode daltonien basculé : recolore l'accent de la fiche du corps courant.
  onAccentChange(() => {
    if (currentName) render(currentName);
  });
  // Système d'unités basculé (métrique/impérial) : reformate les stats affichées.
  onUnitSystemChange(() => {
    if (currentName) render(currentName);
    updatePosition(lastPosition);
  });

  const updateLive = (sceneDist: number | null): void => {
    if (!visible || sceneDist === null) {
      liveEl.hidden = true;
      return;
    }
    const km = sceneUnitsToKm(sceneDist);
    liveDist.textContent = formatLiveDistance(km);
    liveLt.textContent = formatLightTime(km);
    liveEl.hidden = false;
  };

  function updatePosition(view: PositionProvenanceView | null): void {
    lastPosition = view;
    if (!positionEl || !positionSource || !positionError) return;
    if (!view) {
      positionEl.hidden = true;
      return;
    }
    const text = formatPositionProvenance(view);
    // Écrire seulement ce qui change : appelé à la cadence de l'horloge de la scène.
    if (positionSource.textContent !== text.source)
      positionSource.textContent = text.source;
    if (positionError.textContent !== text.error)
      positionError.textContent = text.error;
    positionEl.hidden = false;
  }

  return {
    show,
    hide,
    updateLive,
    updatePosition,
    currentBody: () => currentName,
  };
}
