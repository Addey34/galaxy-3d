/**
 * LES QUATRE BLOCS DE LA FICHE QUI NE SERVENT QU'UNE FOIS UNE FICHE OUVERTE, en un seul morceau
 * chargé à la PREMIÈRE ouverture (lot 44).
 *
 * POURQUOI, MESURÉ : le lot 43 avait laissé le budget JavaScript du démarrage à 22 063 octets de
 * marge, et son handoff disait que le lot suivant ajoutant du code statique devait d'abord faire
 * de la place. Le bloc « Découverte » en coûtait environ huit kilo-octets. Or ces quatre blocs
 * n'agissent pas avant qu'une fiche existe : ils interrogent `bodyInfo.currentBody()` à la cadence
 * de l'interface et restent masqués tant qu'il rend `null`. Les payer au démarrage, c'était payer
 * pour rien la visite de quelqu'un qui n'ouvre aucune fiche.
 *
 * Ce qui RESTE au démarrage, délibérément : la fiche elle-même (`ui/bodyInfo.ts`) et le bloc de
 * position, que `bodyInfo` appelle directement. Les chaînes anglaises restent aussi dans le
 * dictionnaire statique, qui est le repli de `t()` et dérive `MessageKey`.
 */
import type { PublicAPI } from '@/SolarSystemApp';
import type { BodyInfoPanel } from './bodyInfo';
import { setupDiscoveryBlock } from './discoveryBlock';
import { setupInstrumentsBlock } from './instrumentsBlock';
import { setupMissionsBlock } from './missionsBlock';
import { setupPlacesBlock } from './placesBlock';

export function setupCardBlocks(api: PublicAPI, bodyInfo: BodyInfoPanel): void {
  setupDiscoveryBlock(api, bodyInfo);
  setupMissionsBlock(api, bodyInfo);
  setupInstrumentsBlock(api, bodyInfo);
  setupPlacesBlock(api, bodyInfo);
}
