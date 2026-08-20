/** Visual diagnostic for the Earth terminator, enabled only with ?debug-solar. */
import * as THREE from 'three';
import type { PublicAPI } from '@/SolarSystemApp';
import { RAD_TO_DEG as DEG } from '@/core/MathConstants';

const NEWLINE = String.fromCharCode(10);

export function setupSolarDebug(api: PublicAPI): () => void {
  if (
    typeof window === 'undefined' ||
    !new URLSearchParams(window.location.search).has('debug-solar')
  ) {
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
  let lastLogMs = 0;

  const update = (): void => {
    earth.group.getWorldPosition(earthWorld);
    sun.group.getWorldPosition(sunWorld);
    sunDirection.subVectors(sunWorld, earthWorld).normalize();
    earth.getAxisDirection(north);

    const northDot = north.dot(sunDirection);
    const southDot = -northDot;
    const subsolarLatitude =
      Math.asin(THREE.MathUtils.clamp(northDot, -1, 1)) * DEG;
    const date = api.orbitalMechanics.simulationDate.toISOString();
    panel.textContent = [
      'SOLAR DEBUG (?debug-solar)',
      'date       ' + date,
      'sun dir    ' + formatVector(sunDirection),
      'north axis ' + formatVector(north),
      'north dot  ' + northDot.toFixed(4) + ' (' + (northDot >= 0 ? 'DAY' : 'NIGHT') + ')',
      'south dot  ' + southDot.toFixed(4) + ' (' + (southDot >= 0 ? 'DAY' : 'NIGHT') + ')',
      'subsolar   ' + subsolarLatitude.toFixed(2) + ' deg latitude',
    ].join(NEWLINE);

    const now = performance.now();
    if (now - lastLogMs >= 1000) {
      lastLogMs = now;
      console.info('[solar-debug]', {
        date,
        northDot: Number(northDot.toFixed(4)),
        southDot: Number(southDot.toFixed(4)),
        subsolarLatitude: Number(subsolarLatitude.toFixed(2)),
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