/**
 * Fiche d'information d'un corps (#body-info).
 *
 * S'ouvre à chaque sélection (barre de navigation, clic 3D, label Explo — toutes routées
 * par `PlanetNavigation.selectBody`, cf. `MainSolarSystemApp`) et affiche les données
 * documentaires du catalogue (`realData`). Purement lecture : aucun impact sur la simulation.
 * Le contenu est dérivé du catalogue — ajouter un corps n'exige aucune édition ici.
 */
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import { KM_PER_AU, SQRT_K } from '@/core/ScaleService';
import type { CelestialBodyConfig } from '@/types';

const RAD2DEG = 180 / Math.PI;
const C_KM_PER_S = 299_792.458; // vitesse de la lumière
// Accent doré pour le Soleil (son orbitalColor vaut 0x000000, inutilisable comme teinte).
const SUN_ACCENT = 0xffcc33;

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

// ── Formateurs (anglais, comme le reste de l'UI : virgule des milliers, point décimal) ──

function num(n: number, maxFractionDigits = 0): string {
  return n.toLocaleString('en-US', {
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
  return `${num(hours / 24)} d`;
}

function formatPeriod(days: number): string {
  return days < 400 ? `${num(days)} d` : `${num(days / 365.25, 1)} yr`;
}

// ── Bloc live (Explo) : distance réelle depuis la caméra + temps-lumière ──
// Fusionné depuis l'ancien HUD « TARGET ». La distance vient de la caméra en unités
// scène (explo : AU × SQRT_K) ; on la reconvertit en km puis en AU / temps-lumière.

function sceneUnitsToKm(sceneUnits: number): number {
  return (sceneUnits / SQRT_K) * KM_PER_AU;
}

function formatLiveDistance(km: number): string {
  const au = km / KM_PER_AU;
  const auStr = `${au.toLocaleString('en-US', { maximumFractionDigits: 3 })} AU`;
  let kmStr: string;
  if (km >= 1e9)
    kmStr = `${(km / 1e9).toLocaleString('en-US', { maximumFractionDigits: 2 })} B km`;
  else if (km >= 1e6)
    kmStr = `${(km / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })} M km`;
  else kmStr = `${Math.round(km).toLocaleString('en-US')} km`;
  return `${auStr} · ${kmStr}`;
}

function formatLightTime(km: number): string {
  const s = km / C_KM_PER_S;
  if (s < 1) return `${(s * 1000).toFixed(0)} ms light`;
  if (s < 60) return `${s.toFixed(1)} s light`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    return `${m} min ${Math.round(s - m * 60)} s light`;
  }
  const h = Math.floor(s / 3600);
  return `${h} h ${Math.round((s - h * 3600) / 60)} min light`;
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

  if (d.radiusKm) push('Radius', `${num(d.radiusKm)} km`);
  if (d.distanceAU !== undefined) {
    push(
      cfg.kind === 'moon' ? 'Distance (Earth)' : 'Distance (Sun)',
      cfg.kind === 'moon'
        ? `${num(d.distanceAU * KM_PER_AU)} km`
        : `${num(d.distanceAU, 2)} AU`
    );
  }
  if (d.massKg) push('Mass', formatMass(d.massKg));
  if (d.gravity) push('Gravity', `${num(d.gravity, 2)} m/s²`);
  if (d.meanTempC !== undefined) push('Temperature', `${num(d.meanTempC)} °C`);
  push(
    cfg.kind === 'moon' ? 'Revolution' : 'Day',
    formatDay(cfg.rotationSpeed)
  );
  if (d.orbitPeriodDays)
    push(
      cfg.kind === 'moon' ? 'Orbit' : 'Year',
      formatPeriod(d.orbitPeriodDays)
    );
  if (d.moonCount !== undefined) push('Moons', num(d.moonCount));
  if (d.axialTilt !== undefined)
    push('Axial tilt', `${num(d.axialTilt * RAD2DEG, 1)}°`);

  return stats;
}

/** Suffixe ordinal anglais (1 → « st », 2 → « nd », 3 → « rd », sinon « th »). */
function ordinalSuffix(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
}

/** Sous-titre selon la catégorie (« 3rd planet from the Sun », « Natural satellite »…). */
function subtitle(name: string, cfg: CelestialBodyConfig): string {
  switch (cfg.kind) {
    case 'star':
      return 'Star of the Solar System';
    case 'moon':
      return 'Natural satellite';
    case 'dwarf':
      return 'Dwarf planet';
    case 'asteroid':
      return 'Asteroid';
    case 'comet':
      return 'Comet';
    case 'planet': {
      const n = PLANET_ORDINALS.get(name);
      if (!n) return 'Planet';
      return `${n}${ordinalSuffix(n)} planet from the Sun`;
    }
    default:
      return '';
  }
}

function hexToRgbTriplet(hex: number): string {
  return `${(hex >> 16) & 0xff}, ${(hex >> 8) & 0xff}, ${hex & 0xff}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface BodyInfoPanel {
  /** Affiche la fiche du corps `name` (rien si le corps est inconnu ou sans données). */
  show(name: string): void;
  /** Masque la fiche (ex. retour Vue Globale). */
  hide(): void;
  /**
   * Met à jour le bloc live (distance réelle + temps-lumière) à chaque frame en Explo.
   * `sceneDist` = distance caméra→cible en unités scène ; `null` (Éducatif ou vue libre)
   * masque le bloc. Sans effet si la fiche est repliée ou masquée.
   */
  updateLive(sceneDist: number | null): void;
}

export function setupBodyInfo(): BodyInfoPanel {
  const panel = document.getElementById('body-info');
  if (!panel)
    return { show: () => {}, hide: () => {}, updateLive: () => {} };

  const dot = panel.querySelector<HTMLElement>('.bi-dot')!;
  const nameEl = panel.querySelector<HTMLElement>('.bi-name')!;
  const subEl = panel.querySelector<HTMLElement>('.bi-subtitle')!;
  const statsEl = panel.querySelector<HTMLElement>('.bi-stats')!;
  const descEl = panel.querySelector<HTMLElement>('.bi-desc')!;
  const toggleBtn = panel.querySelector<HTMLButtonElement>('.bi-toggle')!;
  const liveEl = panel.querySelector<HTMLElement>('.bi-live')!;
  const liveDist = panel.querySelector<HTMLElement>('.bi-live-dist')!;
  const liveLt = panel.querySelector<HTMLElement>('.bi-live-lt')!;

  // Repli : la flèche plie la fiche sur son en-tête (le corps `.bi-body` disparaît) pour
  // ne pas gâcher la vue 3D. L'état est conservé entre deux sélections.
  let collapsed = false;
  const applyCollapsed = (): void => {
    panel.classList.toggle('is-collapsed', collapsed);
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
    toggleBtn.setAttribute(
      'aria-label',
      collapsed ? 'Expand panel' : 'Collapse panel'
    );
  };
  toggleBtn.addEventListener('click', () => {
    collapsed = !collapsed;
    applyCollapsed();
  });

  const hide = (): void => panel.setAttribute('hidden', '');

  const show = (name: string): void => {
    const cfg = CONFIGS.get(name);
    // Pas de fiche pour la skybox ni les corps sans données documentaires.
    if (!cfg || cfg.kind === 'skybox' || !cfg.realData) {
      hide();
      return;
    }

    const accent = cfg.kind === 'star' ? SUN_ACCENT : cfg.orbitalColor;
    panel.style.setProperty('--planet-rgb', hexToRgbTriplet(accent));
    dot.style.background = `rgb(${hexToRgbTriplet(accent)})`;
    nameEl.textContent = capitalize(name);
    subEl.textContent = subtitle(name, cfg);

    statsEl.replaceChildren();
    for (const { label, value } of buildStats(cfg)) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      statsEl.append(dt, dd);
    }

    descEl.textContent = cfg.realData.description ?? '';
    descEl.hidden = !cfg.realData.description;

    // Neuf corps : on repart d'un bloc live masqué (updateLive le remplira à la frame
    // suivante en Explo) pour ne pas laisser la distance du corps précédent.
    liveEl.hidden = true;
    applyCollapsed();
    panel.removeAttribute('hidden');
  };

  const updateLive = (sceneDist: number | null): void => {
    if (panel.hasAttribute('hidden') || sceneDist === null) {
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
