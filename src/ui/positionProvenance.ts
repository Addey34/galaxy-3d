/**
 * Provenance temporelle de la position du corps affiché dans la fiche : quelle source le place
 * à la date de la scène, sa catégorie (`core/temporal.ts`) et l'écart mesuré à JPL Horizons.
 *
 * Recalculée à la cadence de l'interface (pas à chaque image) et seulement pour le corps
 * sélectionné : `OrbitalMechanics.positionSourceOf` refait le calcul de position.
 *
 * Les écarts viennent de `config/horizons-validation-summary.json`, écrit par
 * `pnpm ephemeris:validate` et chargé À LA DEMANDE (import dynamique, morceau séparé) : personne
 * ne le télécharge sans ouvrir une fiche. Tant qu'il n'est pas arrivé, le bloc reste masqué
 * plutôt que d'annoncer « non mesuré » à tort.
 */
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import {
  measuredErrorAt,
  measuredWindows,
  positionProduct,
  type AccuracyRow,
} from '@/core/positionProvenance';
import { classifyTemporal } from '@/core/temporal';
import Logger from '@/utils/Logger';
import type { PublicAPI } from '@/SolarSystemApp';
import type { BodyInfoPanel } from './bodyInfo';

const CONFIGS = flattenBodies(CELESTIAL_CONFIG);
const REFRESH_MS = 500;

export function setupPositionProvenance(
  api: PublicAPI,
  bodyInfo: BodyInfoPanel
): void {
  let rows: readonly AccuracyRow[] | null = null;
  let loading = false;
  const load = (): void => {
    if (rows || loading) return;
    loading = true;
    import('@/config/horizons-validation-summary.json')
      .then((module) => {
        rows = (module.default as { rows: AccuracyRow[] }).rows;
      })
      .catch((error) => {
        // Hors ligne avant le premier chargement : le bloc reste masqué, rien n'est inventé.
        loading = false;
        Logger.warn(
          '[PositionProvenance] validation summary unavailable',
          error
        );
      });
  };

  let lastCheck = 0;
  api.animationSystem.onFrame(() => {
    const at = performance.now();
    if (at - lastCheck < REFRESH_MS) return;
    lastCheck = at;

    const name = bodyInfo.currentBody();
    const cfg = name ? CONFIGS.get(name) : undefined;
    // Le Soleil est l'origine du repère : sa « position » n'est pas une donnée.
    if (!name || !cfg || cfg.kind === 'star') {
      bodyInfo.updatePosition(null);
      return;
    }
    load();
    const source = api.orbitalMechanics.positionSourceOf(name);
    if (!rows || !source) {
      bodyInfo.updatePosition(null);
      return;
    }
    const date = api.orbitalMechanics.simulationDate;
    const windows = measuredWindows(
      rows,
      name,
      source,
      cfg.frame === 'parentRelative'
    );
    bodyInfo.updatePosition({
      source,
      stamp: classifyTemporal(
        positionProduct(source, date, windows),
        date,
        new Date()
      ),
      error: measuredErrorAt(windows, date),
    });
  });
}
