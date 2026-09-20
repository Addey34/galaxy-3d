/**
 * Diagnostic de la PHASE GÉOGRAPHIQUE de la Terre, activé par `?debug-geo` seulement.
 *
 * Question posée, et à laquelle aucun test unitaire ne peut répondre : un point posé à des
 * coordonnées publiées tombe-t-il réellement là où il devrait, sur la Terre TELLE QU'ELLE EST
 * RENDUE ? La position d'un marqueur d'événement dépend de la phase de rotation de surface,
 * recalculée à chaque image depuis la date. Une erreur de phase ne déforme rien : elle glisse
 * les épicentres par rapport aux continents, exactement comme elle glissait les lumières de
 * ville par rapport au terminateur (cf. `e2e/subsolar.spec.ts`).
 *
 * MESURE, ET POURQUOI ELLE N'EST PAS CIRCULAIRE. Pour chaque site, on compare la direction du
 * Soleil vue depuis ce site par DEUX chemins qui n'ont en commun que l'éphéméride du Soleil :
 *
 *   - le chemin RENDU : `CelestialObject.surfacePointToWorld` (translation du corps, quaternion
 *     du pôle IAU, phase de surface), puis le repère local Est-Nord-Haut construit sur l'axe de
 *     rotation rendu, puis l'azimut et la hauteur du Soleil dans ce repère ;
 *   - le chemin ASTRONOMIQUE : `Observer(lat, lon)` + `Equator` + `Horizon` d'astronomy-engine,
 *     qui passe par le temps sidéral et ne touche ni `frames.ts`, ni le graphe de scène, ni la
 *     phase de surface.
 *
 * L'écart publié (`sep`) est l'angle entre les deux directions. Une erreur de phase δ déplace
 * le site de δ·cos(latitude) sur la sphère, donc se lit ici directement — et, contrairement à
 * la seule hauteur, elle ne s'annule ni au midi local ni nulle part ailleurs hors des pôles.
 *
 * Les sites ne sont pas choisis au hasard : ce sont les épicentres PUBLIÉS par l'USGS de
 * séismes majeurs, c'est-à-dire exactement la donnée que la couche affiche.
 */
import * as THREE from 'three';
// Installe la convention TT-UTC d'Horizons dans astronomy-engine. Obligatoire dans tout module
// qui lui passe une date : sans elle, la vérité de comparaison serait calculée sur une autre
// échelle de temps que la scène, et l'écart mesuré ici ne voudrait plus rien dire.
import '@/core/timeScale';
import { Body, Equator, Horizon, Observer } from 'astronomy-engine';
import type { PublicAPI } from '@/SolarSystemApp';
import { RAD_TO_DEG as DEG } from '@/core/MathConstants';
import { hasDebugFlag } from '@/utils/debugFlags';

const NEWLINE = String.fromCharCode(10);

/**
 * Épicentres publiés par l'USGS (page « Significant Earthquakes », consultée le 2026-09-20),
 * choisis sur trois hémisphères et trois longitudes bien séparées : une erreur de phase ne
 * peut pas les laisser tous d'accord.
 */
export const GEO_DEBUG_SITES: readonly {
  id: string;
  latitudeDeg: number;
  longitudeDeg: number;
}[] = [
  // 2011 Tōhoku, M9.1 (official20110311054624120_30).
  { id: 'tohoku', latitudeDeg: 38.297, longitudeDeg: 142.373 },
  // 2010 Maule, Chili, M8.8 (official20100227063411530_30).
  { id: 'maule', latitudeDeg: -36.122, longitudeDeg: -72.898 },
  // 2004 Sumatra-Andaman, M9.1 (official20041226005853450_30).
  { id: 'sumatra', latitudeDeg: 3.295, longitudeDeg: 95.982 },
  // 1906 San Francisco, M7.9 (iscgem16957675).
  { id: 'sanfrancisco', latitudeDeg: 37.75, longitudeDeg: -122.55 },
];

/** Direction unitaire d'un couple (azimut depuis le nord vers l'est, hauteur), en degrés. */
function directionFromAzimuthAltitude(
  azimuthDeg: number,
  altitudeDeg: number,
  out: THREE.Vector3
): THREE.Vector3 {
  const azimuth = azimuthDeg / DEG;
  const altitude = altitudeDeg / DEG;
  const horizontal = Math.cos(altitude);
  // Repère local : x = est, y = nord, z = haut.
  return out
    .set(
      horizontal * Math.sin(azimuth),
      horizontal * Math.cos(azimuth),
      Math.sin(altitude)
    )
    .normalize();
}

export function setupGeoDebug(api: PublicAPI): () => void {
  if (!hasDebugFlag('debug-geo')) return () => undefined;

  const earth = api.sceneSystem.getBody('earth');
  const sun = api.sceneSystem.getBody('sun');
  if (!earth || !sun) return () => undefined;

  const panel = document.createElement('pre');
  panel.id = 'geo-debug';
  panel.style.cssText = [
    'position:fixed',
    'right:8px',
    'bottom:8px',
    'z-index:10000',
    'margin:0',
    'padding:8px 10px',
    'background:rgba(0,0,0,.82)',
    'color:#9fe7ff',
    'font:12px/1.35 monospace',
    'white-space:pre',
    'pointer-events:none',
  ].join(';');
  document.body.appendChild(panel);

  const earthWorld = new THREE.Vector3();
  const sunWorld = new THREE.Vector3();
  const sunDirection = new THREE.Vector3();
  const north = new THREE.Vector3();
  const site = new THREE.Vector3();
  const up = new THREE.Vector3();
  const localNorth = new THREE.Vector3();
  const east = new THREE.Vector3();
  const rendered = new THREE.Vector3();
  const truth = new THREE.Vector3();

  const update = (): void => {
    const date = api.orbitalMechanics.simulationDate;
    earth.group.getWorldPosition(earthWorld);
    sun.group.getWorldPosition(sunWorld);
    sunDirection.subVectors(sunWorld, earthWorld).normalize();
    earth.getAxisDirection(north);

    const lines = [
      'GEO DEBUG (?debug-geo)',
      `date       ${date.toISOString()}`,
    ];

    for (const { id, latitudeDeg, longitudeDeg } of GEO_DEBUG_SITES) {
      earth.surfacePointToWorld(latitudeDeg, longitudeDeg, site);
      up.subVectors(site, earthWorld).normalize();
      // Nord local = composante de l'axe de rotation orthogonale à la verticale.
      localNorth.copy(north).addScaledVector(up, -north.dot(up)).normalize();
      east.crossVectors(localNorth, up).normalize();
      rendered
        .set(
          sunDirection.dot(east),
          sunDirection.dot(localNorth),
          sunDirection.dot(up)
        )
        .normalize();

      const observer = new Observer(latitudeDeg, longitudeDeg, 0);
      const equatorial = Equator(Body.Sun, date, observer, true, true);
      const horizontal = Horizon(date, observer, equatorial.ra, equatorial.dec);
      directionFromAzimuthAltitude(
        horizontal.azimuth,
        horizontal.altitude,
        truth
      );

      const separation =
        Math.acos(THREE.MathUtils.clamp(rendered.dot(truth), -1, 1)) * DEG;
      const altitudeDeg =
        Math.asin(THREE.MathUtils.clamp(rendered.z, -1, 1)) * DEG;
      lines.push(
        `${id.padEnd(13)}alt ${altitudeDeg.toFixed(3)} deg  truth ${horizontal.altitude.toFixed(3)} deg  sep ${separation.toFixed(4)} deg`
      );
    }

    panel.textContent = lines.join(NEWLINE);
  };

  const unsubscribe = api.animationSystem.onFrame(update);
  update();
  return () => {
    unsubscribe();
    panel.remove();
  };
}
