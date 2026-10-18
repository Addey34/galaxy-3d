/**
 * LES FAITS QU'UNE ACTIVITÉ CITE, lus dans le catalogue (lot 58) : le lecteur que
 * `core/activityValues.ts` reçoit en argument, et la provenance que la fiche imprimée affiche.
 * Rien n'est recopié : la valeur est celle que la fiche de la Terre affiche, la source celle que
 * `config/factProvenance.test.ts` confronte déjà au relevé des faits.
 */
import type { CelestialConfig, FactProvenance } from '@/types';
import type { FactReader } from '@/core/activityValues';
import { flattenBodies } from './catalog';

export function catalogueFactReader(config: CelestialConfig): FactReader {
  const bodies = flattenBodies(config);
  return (body, fact) => {
    // `axialTilt` est en RADIANS dans le catalogue (la scène le lit tel quel) : la fiche le
    // déclare en degrés (`{"$deg": …}`), c'est en degrés qu'une activité le cite.
    const radians = bodies.get(body)?.realData?.[fact];
    return typeof radians === 'number' ? (radians * 180) / Math.PI : undefined;
  };
}

export function catalogueFactProvenance(
  config: CelestialConfig,
  body: string,
  fact: 'axialTilt'
): FactProvenance | undefined {
  return flattenBodies(config).get(body)?.realData?.sources?.[fact];
}
