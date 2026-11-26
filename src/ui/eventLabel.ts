/**
 * LE NOM D'UN ÉVÉNEMENT CÉLESTE dans la langue courante, partagé par le panneau des événements et la fiche
 * « Poursuivre l'observation » (GAL-OBSERVATION-001) : un module à part, pour que la fiche ne tire pas le
 * panneau.
 */
import type { AstronomicalEvent } from '@/core/astronomicalEvents';
import { t } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import { formatPercent } from './localNumber';

const EVENT_KEYS: Record<AstronomicalEvent['kind'], string> = {
  'new-moon': 'events.newMoon',
  'first-quarter': 'events.firstQuarter',
  'full-moon': 'events.fullMoon',
  'third-quarter': 'events.thirdQuarter',
  'solar-eclipse': 'events.solarEclipse',
  'lunar-eclipse': 'events.lunarEclipse',
  'march-equinox': 'events.marchEquinox',
  'june-solstice': 'events.juneSolstice',
  'september-equinox': 'events.septemberEquinox',
  'december-solstice': 'events.decemberSolstice',
  perihelion: 'events.perihelion',
  aphelion: 'events.aphelion',
  opposition: 'events.opposition',
  conjunction: 'events.conjunction',
};

export function eventLabel(event: AstronomicalEvent): string {
  const label = t(EVENT_KEYS[event.kind]);
  if (event.body) {
    // Opposition/conjonction : « Mars · Opposition » — le nom de la planète prime, le
    // libellé générique précise le type d'alignement.
    return `${bodyDisplayName(event.body)} · ${label}`;
  }
  if (!event.eclipseKind) return label;
  // Éclipse : type (totale/partielle…) + ampleur obscurcie.
  const parts = [t(`events.kind.${event.eclipseKind}`)];
  if (event.obscuration !== undefined && event.obscuration > 0) {
    parts.push(formatPercent(event.obscuration));
  }
  return `${label} · ${parts.join(' · ')}`;
}
