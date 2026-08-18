/**
 * Diagnostic météo visuel et console, activé uniquement par ?debug-meteo.
 *
 * Le module ne corrige rien et ne modifie aucun matériau : il expose l'état réellement observé
 * par les couches afin de localiser un bug avant de toucher à la géométrie ou aux shaders.
 */
import type { MeteoLayerDiagnostics } from '@/core/meteoDiagnostics';
import type { PublicAPI } from '@/SolarSystemApp';
import type { WeatherLayerHandle } from './earthLayer';

const NEWLINE = String.fromCharCode(10);

export function setupMeteoDebug(
  api: PublicAPI,
  layers: WeatherLayerHandle[]
): () => void {
  if (
    typeof window === 'undefined' ||
    !new URLSearchParams(window.location.search).has('debug-meteo')
  ) {
    return () => undefined;
  }

  const panel = document.createElement('pre');
  panel.id = 'meteo-debug';
  panel.style.cssText = [
    'position:fixed',
    'top:8px',
    'right:8px',
    'z-index:10000',
    'max-width: min(620px, calc(100vw - 16px))',
    'max-height: calc(100vh - 16px)',
    'overflow:auto',
    'margin:0',
    'padding:8px 10px',
    'background:rgba(0,0,0,.86)',
    'color:#d8f4ff',
    'font:11px/1.35 ui-monospace,Consolas,monospace',
    'white-space:pre',
    'pointer-events:none',
  ].join(';');
  document.body.appendChild(panel);

  let lastLogMs = 0;

  const update = (): void => {
    const date = api.orbitalMechanics.simulationDate.toISOString();
    const snapshots = layers
      .map((layer) => layer.diagnostics?.())
      .filter(
        (snapshot): snapshot is MeteoLayerDiagnostics => snapshot !== undefined
      );

    const lines = [
      'METEO DEBUG (?debug-meteo)',
      'date: ' + date,
      '',
      ...snapshots.map(formatSnapshot),
    ];
    if (snapshots.length === 0)
      lines.push('Aucun diagnostic fourni par les couches.');

    panel.textContent = lines.join(NEWLINE);

    const now = performance.now();
    if (now - lastLogMs >= 1000) {
      lastLogMs = now;
      console.info('[meteo-debug]', { date, layers: snapshots });
    }
  };

  const unsubscribe = api.animationSystem.onFrame(update);
  update();

  return () => {
    unsubscribe();
    panel.remove();
  };
}

function formatSnapshot(snapshot: MeteoLayerDiagnostics): string {
  const source = snapshot.source
    ? snapshot.source.label +
      ' ' +
      snapshot.source.realDate.slice(0, 19) +
      (snapshot.source.approx ? ' approx' : '')
    : '-';
  const grid = snapshot.grid
    ? snapshot.grid.nLon +
      'x' +
      snapshot.grid.nLat +
      ' step=' +
      snapshot.grid.step +
      '° lat=' +
      snapshot.grid.latMin +
      '..' +
      snapshot.grid.latMax +
      ' samples=' +
      snapshot.grid.sampleCount
    : '-';
  const map = snapshot.render?.map;
  const texture = map
    ? map.width +
      'x' +
      map.height +
      ' S=' +
      map.wrapS +
      ' T=' +
      map.wrapT +
      ' min=' +
      map.minFilter +
      ' mip=' +
      (map.generateMipmaps ? 'on' : 'off') +
      ' cs=' +
      map.colorSpace
    : '-';
  const render = snapshot.render
    ? (snapshot.render.visible ? 'visible' : 'hidden') +
      ' material=' +
      (snapshot.render.materialType ?? '-') +
      ' opacity=' +
      (snapshot.render.opacity ?? '-')
    : '-';

  return [
    snapshot.id +
      ' [' +
      snapshot.family +
      '] ' +
      snapshot.phase +
      ' ' +
      (snapshot.visible ? 'ON' : 'OFF'),
    '  target: ' + (snapshot.targetLayer ?? '-'),
    '  geometry: ' +
      (snapshot.render?.geometry
        ? snapshot.render.geometry.type +
          ' radius=' +
          snapshot.render.geometry.radius.toFixed(5) +
          ' vertices=' +
          snapshot.render.geometry.vertexCount +
          ' uvs=' +
          snapshot.render.geometry.uvCount
        : '-'),
    '  source: ' + source,
    '  coverage: ' +
      (snapshot.source?.coverage
        ? snapshot.source.coverage.policy +
          ' lat=' +
          snapshot.source.coverage.minLatitude +
          '..' +
          snapshot.source.coverage.maxLatitude
        : '-'),
    ...(snapshot.message ? ['  detail: ' + snapshot.message] : []),
    '  grid: ' + grid,
    '  texture: ' + texture,
    '  render: ' + render,
  ].join(NEWLINE);
}
