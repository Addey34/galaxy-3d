/**
 * Contrôles de lecture : play/pause et vitesse de simulation (#play-pause-btn, #speed-range).
 *
 * `om.setSimulationSpeed(scale)` prend un ratio SIGNÉ par rapport au temps réel. Le curseur est
 * bidirectionnel et exponentiel, du 1:1 au centre à un an simulé par seconde réelle au bord,
 * dans les deux sens (cf. `ui/speedSlider`, qui porte toute l'arithmétique).
 *
 * La liste discrète que ce bandeau citait jusqu'au 2026-09-24 (« 3 600, 10 800, 21 600 ») est
 * SUPERSEDED depuis longtemps : budgéter pour 21 600x se tromperait d'un facteur 1 461, ce qui
 * compte pour tout ce qui charge de la donnée contre l'horloge.
 *
 * Depuis la phase 17D la vitesse est PLAFONNÉE à ce que la connexion soutient, et le plafond est
 * dit à l'écran : la date reste exacte plutôt que d'attendre des octets en silence.
 */
import type { AnimationSystem } from '@/components/systems/AnimationSystem';
import type { OrbitalMechanics } from '@/core/OrbitalMechanics';
import { getLocale, onLocaleChange, t } from '@/i18n';
import { applyCeiling, SPEED_SLIDER_CENTER } from './speedSlider';

const SPEED_UNITS = [
  { scale: 31_557_600, fr: 'an', en: 'y' },
  { scale: 2_592_000, fr: 'mois', en: 'mo' },
  { scale: 604_800, fr: 'sem', en: 'wk' },
  { scale: 86_400, fr: 'j', en: 'd' },
  { scale: 3_600, fr: 'h', en: 'h' },
  { scale: 60, fr: 'min', en: 'min' },
] as const;

const SVG_NS = 'http://www.w3.org/2000/svg';

function createPlaybackIcon(paused: boolean): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '11');
  svg.setAttribute('height', '13');
  svg.setAttribute('viewBox', '0 0 11 13');
  svg.setAttribute('fill', 'currentColor');

  if (paused) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M1 0.8L10.5 6.5L1 12.2V0.8Z');
    svg.append(path);
  } else {
    for (const x of ['0', '7.2']) {
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', '0');
      rect.setAttribute('width', '3.8');
      rect.setAttribute('height', '13');
      rect.setAttribute('rx', '1.4');
      svg.append(rect);
    }
  }

  return svg;
}

/** Poignée exposée au panneau date-heure pour revenir au temps réel (bouton reset). */
export interface PlaybackControls {
  selectRealtime(): void;
  /** Met la simulation en pause et synchronise le bouton lecture/pause. */
  pause(): void;
  /**
   * Relit le plafond de vitesse mesuré et réapplique la vitesse s'il a bougé.
   *
   * Appelée à chaque image par la composition : au démarrage aucun débit n'est encore mesuré,
   * donc le plafond n'existe pas, et il apparaît quand les premières fenêtres sont arrivées.
   * Le calcul complet n'a lieu que si le débit ou le jour affiché a changé.
   */
  syncCeiling(): void;
}

/**
 * Ce que la connexion soutient, en secondes simulées par seconde réelle, ou `null` s'il n'y a
 * rien à plafonner. Fourni par la composition, qui seule connaît le service d'éphémérides.
 */
export type PlaybackCeiling = () => number | null;

const playPauseBtn = document.getElementById('play-pause-btn')!;
const speedRange = document.getElementById('speed-range') as HTMLInputElement;
const speedValue = document.getElementById('speed-value')!;
function formatQuantity(value: number): string {
  if (value < 10) return value.toFixed(1).replace(/\.0$/, '');
  if (value < 100) return String(Math.round(value));
  return String(Math.round(value / 10) * 10);
}

function speedLabel(scale: number): string {
  if (scale === 1)
    return getLocale() === 'fr'
      ? '1:1 · Échelle réelle Terre'
      : '1:1 · Earth real time';

  // Vitesse signée : magnitude commune, préfixe directionnel pour le passé (temps qui recule).
  const magnitude = Math.abs(scale);
  const reversed = scale < 0;
  const unit = SPEED_UNITS.find((candidate) => magnitude >= candidate.scale);
  const body = unit
    ? `${formatQuantity(magnitude / unit.scale)} ${
        getLocale() === 'fr' ? unit.fr : unit.en
      }/s`
    : `× ${formatQuantity(magnitude)}`;
  if (!reversed) return body;
  // Préfixe « ◀ » + mention passé : on remonte le temps.
  return getLocale() === 'fr' ? `◀ ${body} (passé)` : `◀ ${body} (past)`;
}

/**
 * Applique une position de curseur, PLAFONNÉE à ce que la connexion soutient.
 *
 * Décision du § 9b du plan du lot 17, prise le 2026-09-24 : la date reste exacte (D3), et c'est
 * le curseur qui renonce, en le disant. Le plafond est mesuré (`core/playbackBudget` sur le
 * débit de `core/transferRate`) ; l'arithmétique vit dans `ui/speedSlider`, ce module ne fait
 * que la câbler au DOM.
 */
function applySpeed(
  sliderValue: number,
  om: OrbitalMechanics,
  ceiling: number | null
): void {
  const {
    scale,
    sliderValue: value,
    limited,
  } = applyCeiling(sliderValue, ceiling);
  const label = limited
    ? `${speedLabel(scale)} · ${t('speed.limited')}`
    : speedLabel(scale);
  om.setSimulationSpeed(scale);
  speedRange.value = String(value);
  speedRange.setAttribute('aria-valuetext', label);
  speedValue.textContent = label;
  // Lu par la garde e2e : un plafond ANNONCÉ doit être celui qui a servi.
  if (limited) speedRange.dataset['capped'] = String(Math.abs(scale));
  else delete speedRange.dataset['capped'];
}

export function setupPlayback(
  anim: AnimationSystem,
  om: OrbitalMechanics,
  ceiling: PlaybackCeiling = () => null
): PlaybackControls {
  let cap: number | null = null;
  /**
   * La position que l'utilisateur a DEMANDÉE, distincte de celle qu'on affiche.
   *
   * Défaut trouvé en relisant ce fichier : sans cette mémoire, un plafonnement passager était
   * définitif. La poignée revenant sur le plafond, la valeur du curseur DEVENAIT la vitesse
   * plafonnée, et une amélioration du lien ne rendait plus la vitesse demandée : un creux de
   * connexion de trois secondes aurait brimé la lecture pour le reste de la session.
   */
  let askedValue = SPEED_SLIDER_CENTER;
  // Synchronise l'icône, les classes et l'ARIA du bouton sur l'état de pause donné.
  const syncPauseButton = (paused: boolean): void => {
    playPauseBtn.replaceChildren(createPlaybackIcon(paused));
    playPauseBtn.classList.toggle('is-paused', paused);
    playPauseBtn.setAttribute('aria-pressed', String(paused));
    playPauseBtn.setAttribute(
      'aria-label',
      t(paused ? 'playback.play' : 'playback.pause')
    );
  };

  playPauseBtn.addEventListener('click', () => {
    syncPauseButton(anim.togglePause());
  });

  speedRange.addEventListener('input', () => {
    askedValue = Number(speedRange.value);
    applySpeed(askedValue, om, cap);
  });

  // Démarrage au CENTRE = temps réel 1:1.
  applySpeed(askedValue, om, cap);
  playPauseBtn.setAttribute('aria-label', t('playback.pause'));
  onLocaleChange(() => {
    applySpeed(askedValue, om, cap);
    playPauseBtn.setAttribute(
      'aria-label',
      playPauseBtn.classList.contains('is-paused')
        ? t('playback.play')
        : t('playback.pause')
    );
  });

  return {
    selectRealtime: () => {
      askedValue = SPEED_SLIDER_CENTER;
      applySpeed(askedValue, om, cap);
    },
    pause: () => {
      anim.setPaused(true);
      syncPauseButton(true);
    },
    syncCeiling: () => {
      const next = ceiling();
      if (next === cap) return;
      cap = next;
      // Depuis la position DEMANDÉE : un plafond qui se relâche rend la vitesse demandée.
      applySpeed(askedValue, om, cap);
    },
  };
}
