/**
 * Sondes spatiales — couche instrument 2D (`src/ui/spacecraftOverlay.ts`).
 *
 * Données dérivées du registre `src/registry/spacecraft/` : une sonde n'a ni
 * rayon, ni texture, ni orbite képlérienne fermée (assistances gravitationnelles, halo L2 pour
 * JWST) — sa position vient exclusivement des vecteurs réels JPL Horizons
 * (`HorizonsEphemerisService`, mêmes binaires que les planètes/lunes/planètes naines).
 * `name` est la clé de jointure exacte avec `manifest.json` / `scripts/generate-horizons-ephemerides.mjs`.
 */
import type { LocalizedText, RealData } from '@/types';
import type { SatellitePhase } from '@/core/satellitePhases';
import { loadSpacecraftMissions } from '@/registry/spacecraft';

export interface SpacecraftMission {
  name: string;
  displayName: LocalizedText;
  description: LocalizedText;
  /** ISO — repli d'affichage ; la vraie borne de couverture vient du manifeste. */
  launchDate: string;
  /** Couleur du marqueur/label, 0xRRGGBB. */
  color: number;
  /**
   * Faits sourcés de la mission, prêts à être versés dans le `realData` de la fiche par
   * `config/navigable.ts` : valeurs, provenances et raisons de non-publication, redéployées
   * par le chargeur du registre comme pour n'importe quel corps du catalogue.
   */
  facts: Partial<RealData>;
  /**
   * Phases où la sonde est le satellite d'un corps du catalogue, dans l'ordre du temps (cf.
   * `core/satellitePhases.ts`). Vide pour une sonde qui n'a jamais orbité un corps du catalogue.
   */
  satelliteOf: readonly SatellitePhase[];
}

export const SPACECRAFT_MISSIONS: SpacecraftMission[] =
  loadSpacecraftMissions();
