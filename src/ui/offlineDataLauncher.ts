/**
 * Section « Hors ligne » des réglages : LANCEUR seulement. `ui/offlineData.ts` (lecture du
 * magasin, boutons Préparer et Libérer) n'est chargé qu'à la première ouverture des réglages, donc
 * hors du budget de démarrage. Le déclencheur est le bouton des réglages lui-même, seule porte du
 * panneau : le clic qui l'ouvre lance le chargement, sans second clic. Un échec est DIT et le
 * prochain clic réessaie ; une fois chargé, l'écouteur est retiré (aucune initialisation double).
 */
import { t } from '@/i18n';
import type { HorizonsEphemerisService } from '@/core/HorizonsEphemerisService';
import { getAnnouncer } from './announcer';

export function setupOfflineDataOnDemand(
  service: HorizonsEphemerisService
): void {
  const trigger = document.getElementById('settings-trigger');
  if (!trigger) return;
  let loading = false;
  const load = (): void => {
    if (loading) return;
    loading = true;
    void import('./offlineData')
      .then((m) => {
        m.setupOfflineData(service);
        trigger.removeEventListener('click', load);
      })
      .catch(() => {
        getAnnouncer().announce(t('feature.loadFailed'));
      })
      .finally(() => {
        loading = false;
      });
  };
  trigger.addEventListener('click', load);
}
