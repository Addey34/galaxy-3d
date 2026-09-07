/** Visual diagnostic for the Earth terminator, enabled only with ?debug-solar. */
import * as THREE from 'three';
import type { PublicAPI } from '@/SolarSystemApp';
import { RAD_TO_DEG as DEG } from '@/core/MathConstants';
import { localDirectionToGeographic } from '@/core/frames';
import {
  computeGreenwichSubsolarLongitude,
  computeSubsolarLatitude,
} from '@/core/OrbitalMechanics';
import { hasDebugFlag } from '@/utils/debugFlags';

const NEWLINE = String.fromCharCode(10);

export function setupSolarDebug(api: PublicAPI): () => void {
  if (!hasDebugFlag('debug-solar')) {
    return () => undefined;
  }

  const earth = api.sceneSystem.getBody('earth');
  const sun = api.sceneSystem.getBody('sun');
  if (!earth || !sun) return () => undefined;

  const panel = document.createElement('pre');
  panel.id = 'solar-debug';
  panel.style.cssText = [
    'position:fixed',
    'left:8px',
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
  const localSunDir = new THREE.Vector3();
  const surfaceQuaternion = new THREE.Quaternion();
  let lastLogMs = 0;

  // Mesure la longitude du point subsolaire TELLE QUE RENDUE : on ramène la direction du
  // Soleil dans le repère local du mesh de surface, puis on applique la convention
  // SphereGeometry + texture équirectangulaire. Comparée à la vérité astronomique, l'écart
  // est exactement le décalage entre les continents/lumières et le terminateur.
  const measureRenderedSubsolar = (): {
    latitudeDeg: number;
    longitudeDeg: number;
  } | null => {
    const surface = earth.group.getObjectByName('earth_surface');
    if (!surface) return null;
    surface.getWorldQuaternion(surfaceQuaternion);
    localSunDir
      .copy(sunDirection)
      .applyQuaternion(surfaceQuaternion.invert())
      .normalize();
    return localDirectionToGeographic(localSunDir);
  };

  const update = (): void => {
    earth.group.getWorldPosition(earthWorld);
    sun.group.getWorldPosition(sunWorld);
    sunDirection.subVectors(sunWorld, earthWorld).normalize();
    earth.getAxisDirection(north);

    const northDot = north.dot(sunDirection);
    const southDot = -northDot;
    const subsolarLatitude =
      Math.asin(THREE.MathUtils.clamp(northDot, -1, 1)) * DEG;
    const simDate = api.orbitalMechanics.simulationDate;
    const date = simDate.toISOString();
    const rendered = measureRenderedSubsolar();
    const truthLongitude = computeGreenwichSubsolarLongitude(simDate) * DEG;
    const truthLatitude = computeSubsolarLatitude(simDate);
    const latitudeError =
      rendered === null ? null : rendered.latitudeDeg - truthLatitude;
    // Erreur signee, ramenee dans [-180, 180] : c'est l'angle dont il faudrait faire pivoter
    // la Terre pour recaler les lumieres de ville sur l'ombre.
    const longitudeError =
      rendered === null
        ? null
        : ((((rendered.longitudeDeg - truthLongitude + 180) % 360) + 360) %
            360) -
          180;
    const renderedText =
      rendered === null
        ? 'n/a (no surface mesh)'
        : rendered.latitudeDeg.toFixed(2) +
          ' lat, ' +
          rendered.longitudeDeg.toFixed(2) +
          ' lon';
    const errorText =
      longitudeError === null ? 'n/a' : longitudeError.toFixed(3) + ' deg';
    panel.textContent = [
      'SOLAR DEBUG (?debug-solar)',
      'date       ' + date,
      'sun dir    ' + formatVector(sunDirection),
      'north axis ' + formatVector(north),
      'north dot  ' +
        northDot.toFixed(4) +
        ' (' +
        (northDot >= 0 ? 'DAY' : 'NIGHT') +
        ')',
      'south dot  ' +
        southDot.toFixed(4) +
        ' (' +
        (southDot >= 0 ? 'DAY' : 'NIGHT') +
        ')',
      'subsolar   ' + subsolarLatitude.toFixed(2) + ' deg latitude',
      'rendered   ' + renderedText,
      'truth lon  ' + truthLongitude.toFixed(2) + ' deg',
      'lon error  ' + errorText,
      'truth lat  ' + truthLatitude.toFixed(2) + ' deg',
      'lat error  ' +
        (latitudeError === null ? 'n/a' : latitudeError.toFixed(3) + ' deg'),
    ].join(NEWLINE);

    const now = performance.now();
    if (now - lastLogMs >= 1000) {
      lastLogMs = now;
      console.info('[solar-debug]', {
        date,
        northDot: Number(northDot.toFixed(4)),
        southDot: Number(southDot.toFixed(4)),
        subsolarLatitude: Number(subsolarLatitude.toFixed(2)),
        renderedLatitude: rendered
          ? Number(rendered.latitudeDeg.toFixed(3))
          : null,
        renderedLongitude: rendered
          ? Number(rendered.longitudeDeg.toFixed(3))
          : null,
        truthLongitude: Number(truthLongitude.toFixed(3)),
        longitudeError:
          longitudeError === null ? null : Number(longitudeError.toFixed(3)),
        truthLatitude: Number(truthLatitude.toFixed(3)),
        latitudeError:
          latitudeError === null ? null : Number(latitudeError.toFixed(3)),
      });
    }
  };

  const unsubscribe = api.animationSystem.onFrame(update);
  update();
  return () => {
    unsubscribe();
    panel.remove();
  };
}

function formatVector(vector: THREE.Vector3): string {
  return (
    '(' +
    vector.x.toFixed(3) +
    ', ' +
    vector.y.toFixed(3) +
    ', ' +
    vector.z.toFixed(3) +
    ')'
  );
}
