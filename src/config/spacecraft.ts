/**
 * Sondes spatiales — couche instrument 2D (`src/ui/spacecraftOverlay.ts`).
 *
 * Données dérivées du registre `src/registry/spacecraft/` : une sonde n'a ni
 * rayon, ni texture, ni orbite képlérienne fermée (assistances gravitationnelles, halo L2 pour
 * JWST) — sa position vient exclusivement des vecteurs réels JPL Horizons
 * (`HorizonsEphemerisService`, mêmes binaires que les planètes/lunes/planètes naines).
 * `name` est la clé de jointure exacte avec `manifest.json` / `scripts/generate-horizons-ephemerides.mjs`.
 */
import type { LocalizedText } from '@/types';
import { loadSpacecraftMissions } from '@/registry/spacecraft';

export interface SpacecraftMission {
  name: string;
  displayName: LocalizedText;
  description: LocalizedText;
  /** ISO — repli d'affichage ; la vraie borne de couverture vient du manifeste. */
  launchDate: string;
  /** Couleur du marqueur/label, 0xRRGGBB. */
  color: number;
}

export const SPACECRAFT_MISSIONS: SpacecraftMission[] =
  loadSpacecraftMissions();
