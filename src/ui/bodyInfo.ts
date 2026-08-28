/**
 * Fiche d'information d'un corps (#body-info).
 *
 * S'ouvre à chaque sélection (barre de navigation, clic 3D, label Explo — toutes routées
 * par `PlanetNavigation.selectBody`, cf. `MainSolarSystemApp`) et affiche les données
 * documentaires du catalogue (`realData`). Purement lecture : aucun impact sur la simulation.
 * Le contenu est dérivé du catalogue — ajouter un corps n'exige aucune édition ici.
 */
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies, hasIllustrativeSurface } from '@/config/catalog';
import { TEXTURE_SETTINGS } from '@/config/engine';
import { KM_PER_AU, SQRT_K } from '@/core/ScaleService';
import { RAD_TO_DEG as RAD2DEG } from '@/core/MathConstants';
import { t, intlLocale, getLocale, onLocaleChange } from '@/i18n';
import { bodyDisplayName, bodyDescription } from '@/i18n/bodyText';
import type { CelestialBodyConfig } from '@/types';
import { bodyAccentColor, hexToRgbTriplet } from './bodyAccent';
import { safeExternalUrl } from '@/utils/safeUrl';
import type { OverlayCoordinator } from './overlayCoordinator';

const C_KM_PER_S = 299_792.458; // vitesse de la lumière

const CONFIGS = flattenBodies(CELESTIAL_CONFIG);

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

/** Durée du jour dérivée de la vitesse de rotation axiale (rad/s → h, puis j si très long). */
function formatDay(rotationSpeed: number): string | null {
  if (!rotationSpeed) return null;
  const hours = (2 * Math.PI) / (rotationSpeed * 3600);
  if (hours < 48) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${num(hours / 24)} ${t('unit.day.short')}`;
}

function formatPeriod(days: number): string {
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
  let kmStr: string;
  if (km >= 1e9) kmStr = `${num(km / 1e9, 2)} ${t('unit.billionKm')}`;
  else if (km >= 1e6) kmStr = `${num(km / 1e6, 1)} ${t('unit.millionKm')}`;
  else kmStr = `${num(Math.round(km))} km`;
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

// ── Construction des lignes de la fiche depuis la config d'un corps ──

interface Stat {
  label: string;
  value: string;
}

function buildStats(cfg: CelestialBodyConfig): Stat[] {
  const d = cfg.realData;
  if (!d) return [];
  const stats: Stat[] = [];
  const push = (label: string, value: string | null): void => {
    if (value !== null) stats.push({ label, value });
  };

  if (d.radiusKm) push(t('stat.radius'), `${num(d.radiusKm)} km`);
  if (d.distanceAU !== undefined) {
    push(
      cfg.kind === 'moon' ? t('stat.distanceEarth') : t('stat.distanceSun'),
      cfg.kind === 'moon'
        ? `${num(d.distanceAU * KM_PER_AU)} km`
        : `${num(d.distanceAU, 2)} ${t('unit.au')}`
    );
  }
  if (d.massKg) push(t('stat.mass'), formatMass(d.massKg));
  if (d.gravity) push(t('stat.gravity'), `${num(d.gravity, 2)} m/s²`);
  if (d.meanTempC !== undefined)
    push(t('stat.temperature'), `${num(d.meanTempC)} °C`);
  push(
    cfg.kind === 'moon' ? t('stat.revolution') : t('stat.day'),
    formatDay(cfg.rotationSpeed)
  );
  if (d.orbitPeriodDays)
    push(
      cfg.kind === 'moon' ? t('stat.orbit') : t('stat.year'),
      formatPeriod(d.orbitPeriodDays)
    );
  if (d.moonCount !== undefined) push(t('stat.moons'), num(d.moonCount));
  if (d.axialTilt !== undefined)
    push(t('stat.axialTilt'), `${num(d.axialTilt * RAD2DEG, 1)}°`);

  return stats;
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
}

export function setupBodyInfo(coordinator?: OverlayCoordinator): BodyInfoPanel {
  const panel = document.getElementById('body-info');
  if (!panel) return { show: () => {}, hide: () => {}, updateLive: () => {} };

  const dot = panel.querySelector<HTMLElement>('.bi-dot')!;
  const nameEl = panel.querySelector<HTMLElement>('.bi-name')!;
  const subEl = panel.querySelector<HTMLElement>('.bi-subtitle')!;
  const fictionalEl = panel.querySelector<HTMLElement>('.bi-fictional-badge')!;
  const statsEl = panel.querySelector<HTMLElement>('.bi-stats')!;
  const descEl = panel.querySelector<HTMLElement>('.bi-desc')!;
  const closeBtn = panel.querySelector<HTMLButtonElement>('.bi-close')!;
  // Déclencheur d'accès (dock haut-droit) : réaffiche la fiche du corps courant après
  // fermeture, sans reprendre le vol caméra. Masqué tant qu'aucun corps n'est sélectionné.
  const triggerBtn = document.querySelector<HTMLButtonElement>('#info-trigger');
  const moreEl = panel.querySelector<HTMLAnchorElement>('.bi-more')!;
  const liveEl = panel.querySelector<HTMLElement>('.bi-live')!;
  const liveDist = panel.querySelector<HTMLElement>('.bi-live-dist')!;
  const liveLt = panel.querySelector<HTMLElement>('.bi-live-lt')!;

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

    const accent = bodyAccentColor(cfg);
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
    for (const { label, value } of buildStats(cfg)) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      statsEl.append(dt, dd);
    }

    const desc = bodyDescription(cfg);
    descEl.textContent = desc;
    descEl.hidden = !desc;

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
    // suivante en Explo) pour ne pas laisser la distance du corps précédent.
    liveEl.hidden = true;
  };

  // Changement de langue : re-rend la fiche du corps courant (noms, sous-titre, stats,
  // description) même si elle est momentanément fermée — son contenu reste ainsi à jour pour
  // sa prochaine réouverture. Le bloc live se réactualise seul à la frame suivante.
  onLocaleChange(() => {
    if (currentName) render(currentName);
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

  return { show, hide, updateLive };
}
