import type * as THREE from 'three';

import {
  createCloudShellHost,
  type CloudShellEarth,
  type CloudShellHost,
} from '@/components/surface/CloudShellHost';
import {
  defaultFetcher,
  PlanetarySurfaceEngine,
} from '@/components/surface/PlanetarySurfaceEngine';
import { LAYER_RADIUS_SCALE } from '@/config/layerConfig';
import {
  cloudTilesetForSource,
  type SurfaceTileset,
} from '@/config/surfaceTilesets';
import { cloudsOnScreen } from '@/core/cloudsOnScreen';
import { cloudShellScale } from '@/core/cloudShellAltitude';

/**
 * LES NUAGES RÉGIONAUX (GAL-EARTH-CLOUD-REGIONAL-001) : la couche mondiale (une image de 2 048 px, 19,7 km
 * par texel) s'efface dès que son texel dépasse quelques pixels d'écran. Cette couche reprend la MÊME
 * observation (même satellite, même jour : `cloudsOnScreen.source`) à sa résolution native, 250 m, par le
 * moteur de tuiles du sol, posé sur la coque des nuages. Elle est indépendante du fond terrestre : le sol
 * garde sa mosaïque fine, les nuages viennent par-dessus.
 *
 * Ce qu'elle ne fait JAMAIS : poser une image d'un autre jour ou d'un autre instrument (une couche sans fiche
 * à 250 m, MODIS, la laisse éteinte), compléter un trou de fauchée, ajouter un détail. Une zone sans tuile
 * reste la couche mondiale.
 */

/** Au-delà, rien n'est demandé : la couche mondiale est encore pleine (son texel fait moins de 3 pixels). */
export const CLOUD_SHELL_CEILING_RADII = 1.8;
/** Hystérésis du plafond : une fois dans la bande on n'en sort qu'un peu plus haut. */
export const CLOUD_SHELL_CEILING_EXIT_RADII = 1.9;
/**
 * Sans AUCUNE tuile peinte, et sans RIEN en vol, pendant ce délai passé dans la bande (service en panne, réseau coupé),
 * la source est déclarée indisponible jusqu'au prochain changement de source : retour au fond du jour de #579,
 * et pas de bascule de fond d'une image à l'autre. Un chargement normal peint sa première tuile en 1 à 3 s
 * (descentes mesurées le 2026-11-25).
 */
export const CLOUD_SHELL_UNAVAILABLE_AFTER_MS = 15_000;
/**
 * Échecs de tuiles, SANS aucun succès pour cette source, qui la déclarent indisponible. Le moteur redemande une
 * tuile en échec toutes les 8 s : pendant une panne il a presque toujours une requête en vol, et la règle
 * d'inactivité seule ne voyait jamais la panne (349 requêtes en 38 s, mesuré le 2026-11-25).
 */
export const CLOUD_SHELL_FAILURES_BEFORE_UNAVAILABLE = 8;

export interface CloudShell {
  /** La source posée a-t-elle une fiche à 250 m, et n'a-t-elle pas été déclarée indisponible ? */
  serves(): boolean;
  /**
   * La couche couvre-t-elle VRAIMENT ce que la couche mondiale montre : au moins une tuile de cette source peinte.
   * C'est elle, et pas `serves`, qui autorise le sol fin sans nuages cuits ; une fois vraie, elle le reste pour
   * cette source (pas d'oscillation entre deux fonds).
   */
  ready(): boolean;
  /** À appeler à chaque image, avec le corps suivi et sa distance en rayons. */
  drive(
    body: CloudShellEarth,
    radiusKm: number,
    distanceInRadii: number,
    camera: THREE.PerspectiveCamera,
    viewportHeightPx: number
  ): void;
  /** Tuiles posées et voulues, pour le bandeau et les mesures. */
  stats(): {
    painted: number;
    requested: number;
    level: number;
    day: string | null;
  } | null;
  /** Le résultat d'une requête de tuile (le pilote l'observe sur le moteur qu'il crée ; les essais l'appellent). */
  recordFetch(ok: boolean): void;
  /** Carreaux de nuages en vol ou en fondu. */
  busy(): number;
  /** Retire les carreaux (le panneau de surface se désactive, ou la cible change). */
  release(): void;
  dispose(): void;
}

export function createCloudShell(options: {
  budget: { maxTiles: number; maxConcurrentLoads: number };
  /** Un jeu de rechange pour les essais. */
  engine?: PlanetarySurfaceEngine;
  /** Horloge, en millisecondes (par défaut `performance.now`). */
  now?: () => number;
}): CloudShell {
  const now = options.now ?? (() => performance.now());
  // Succès et échecs des requêtes de tuiles de la source COURANTE : c'est le signal d'une panne.
  const fetches = { ok: 0, failed: 0 };
  const recordFetch = (ok: boolean): void => {
    if (ok) fetches.ok += 1;
    else fetches.failed += 1;
  };
  const engine =
    options.engine ??
    new PlanetarySurfaceEngine({
      budget: options.budget,
      fetchTile: async (url, signal) => {
        try {
          const image = await defaultFetcher(url, signal);
          recordFetch(true);
          return image;
        } catch (error) {
          // Une requête annulée (la vue a bougé) n'est pas une panne.
          if ((error as Error)?.name !== 'AbortError') recordFetch(false);
          throw error;
        }
      },
    });
  let host: CloudShellHost | null = null;
  let hostFor: CloudShellEarth | null = null;
  let inBand = false;

  // Le MÊME objet tant que la source ne change pas : `attach` compare les jeux par identité, et un jeu
  // neuf à chaque image relancerait toute la génération (mesuré : 37 tuiles redemandées ~370 fois en 18 s).
  // L'état de la source y est attaché : depuis quand on attend, si une tuile a été peinte, si elle a échoué.
  let memo: {
    id: string;
    tileset: SurfaceTileset | undefined;
    waitingSince: number | null;
    painted: boolean;
    unavailable: boolean;
  } | null = null;
  const sourceNow = () => {
    const id =
      cloudsOnScreen.value && cloudsOnScreen.source
        ? cloudsOnScreen.source.id
        : null;
    if (id === null) return null;
    if (memo?.id !== id) {
      // Un AUTRE jour (ou un autre satellite) : les tuiles de l'ancien sont jetées AVANT d'attacher le nouveau.
      // Le moteur les aurait gardées sous les nouvelles (même grille), deux jours mêlés sans le dire.
      if (memo) engine.detach();
      fetches.ok = 0;
      fetches.failed = 0;
      memo = {
        id,
        tileset: cloudTilesetForSource('earth', id),
        waitingSince: null,
        painted: false,
        unavailable: false,
      };
    }
    return memo;
  };
  const withdraw = (): void => {
    inBand = false;
    if (memo) memo.waitingSince = null;
    engine.detach();
    // La coque mondiale retrouve son altitude d'orbite dès que la couche régionale se retire.
    host?.setShellScale(1);
  };

  return {
    serves: () => {
      const source = sourceNow();
      return !!source?.tileset && !source.unavailable;
    },
    ready: () => {
      const source = sourceNow();
      return !!source?.tileset && !source.unavailable && source.painted;
    },
    drive(body, radiusKm, distanceInRadii, camera, viewportHeightPx) {
      const ceiling = inBand
        ? CLOUD_SHELL_CEILING_EXIT_RADII
        : CLOUD_SHELL_CEILING_RADII;
      const source = sourceNow();
      const tileset =
        source && !source.unavailable ? source.tileset : undefined;
      if (!source || !tileset || distanceInRadii >= ceiling) {
        withdraw();
        return;
      }
      inBand = true;
      const scale = LAYER_RADIUS_SCALE['clouds'] ?? 1.01;
      if (!host || hostFor !== body) {
        host?.dispose();
        host = createCloudShellHost(body, { scale });
        hostFor = body;
      }
      // La coque descend vers une altitude réaliste quand la caméra approche (`core/cloudShellAltitude`).
      host.setShellScale(
        cloudShellScale((distanceInRadii - 1) * radiusKm, radiusKm, scale)
      );
      engine.attach(host, tileset, radiusKm * scale, null);
      engine.update(camera, viewportHeightPx);
      if ((engine.state?.painted ?? 0) > 0) source.painted = true;
      if (source.painted) return;
      if (
        fetches.ok === 0 &&
        fetches.failed >= CLOUD_SHELL_FAILURES_BEFORE_UNAVAILABLE
      ) {
        source.unavailable = true;
        withdraw();
        return;
      }
      const t = now();
      // LENT n'est pas EN PANNE : tant qu'une tuile est en vol ou en fondu, le délai ne court pas. Une vraie panne
      // laisse le moteur sans rien en vol entre deux nouveaux essais, et c'est là qu'il court. La première
      // version comptait le temps écoulé tout court : des tuiles servies en 20 s déclaraient la source
      // indisponible à 11 s, pour de bon (mesuré ; e2e `cloudShell.spec.ts` rouge sur un runner lent,
      // campagne 45541325650).
      if (engine.busyCount > 0) {
        source.waitingSince = null;
        return;
      }
      source.waitingSince ??= t;
      if (t - source.waitingSince >= CLOUD_SHELL_UNAVAILABLE_AFTER_MS) {
        source.unavailable = true;
        withdraw();
      }
    },
    stats: () => {
      const state = engine.state;
      return state
        ? {
            painted: state.painted,
            requested: state.requested,
            level: state.level,
            day: state.day,
          }
        : null;
    },
    busy: () => engine.busyCount,
    recordFetch,
    release: withdraw,
    dispose: () => {
      engine.dispose();
      host?.dispose();
      host = null;
      hostFor = null;
      memo = null;
    },
  };
}
