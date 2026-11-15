/**
 * Un chargement différé (`import()`) qui échoue est DIT au visiteur. Le premier échec invite à
 * réessayer. Un second échec de la même fonction change le texte : WebKit (Safari, iOS) garde en
 * mémoire l'échec d'un module et ne le redemande pas avant un rechargement de la page (mesuré sur
 * le build de production, iPhone 15 émulé), alors que Chromium le redemande. Redire « réessayez »
 * à quelqu'un qui vient de réessayer pour rien serait un mensonge, d'où le texte distinct.
 */
import { t } from '@/i18n';
import { getAnnouncer } from './announcer';

const failures = new Map<string, number>();

export function announceLoadFailure(feature: string): void {
  const count = (failures.get(feature) ?? 0) + 1;
  failures.set(feature, count);
  getAnnouncer().announce(
    t(count > 1 ? 'feature.loadFailedAgain' : 'feature.loadFailed')
  );
}
