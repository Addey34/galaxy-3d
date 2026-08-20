/**
 * Diagnostic visuel du relief géométrique de la Terre (EA-03), activé par ?debug-earth.
 *
 * Rend OBSERVABLE l'état du displacement : densité de la géométrie de surface (le LOD
 * passe de GEOMETRY_SEGMENTS à GEOMETRY_SEGMENTS_HI au gros plan), présence de la
 * displacementMap et échelle appliquée. Permet à un test e2e d'attendre un ÉTAT (la
 * surface densifiée) plutôt qu'un délai arbitraire — la densification n'a lieu qu'une
 * fois la caméra suffisamment proche et la géométrie hi-res reconstruite.
 *
 * Touches d'ISOLATION (pour traquer un artefact de relief) : N = normalMap, D =
 * displacementMap, B = bumpMap, A = atmosphère, C = nuages, P = pluie. Chaque touche
 * bascule la couche/map concernée ON↔OFF sans la détruire → on identifie laquelle
 * produit l'artefact (ex. contours bleu-gris) en la coupant seule.
 */
import type { PublicAPI } from '@/SolarSystemApp';
import { hasDebugFlag } from '@/utils/debugFlags';

const NEWLINE = String.fromCharCode(10);

export function setupEarthDebug(api: PublicAPI): () => void {
  if (!hasDebugFlag('debug-earth')) {
    return () => undefined;
  }

  const earth = api.sceneSystem.getBody('earth');
  if (!earth) return () => undefined;

  // État affiché des bascules (true = actif). Les couches entières (atmosphère/nuages/pluie)
  // passent par setLayerVisible ; les maps du matériau surface par debugToggleSurfaceMap.
  // Maps du matériau surface : tri-état ('on'/'off'/'absent'). Couches entières : bool.
  const mapState: Record<string, 'on' | 'off' | 'absent'> = {
    normalMap: 'on',
    displacementMap: 'on',
    bumpMap: 'on',
  };
  const layerState: Record<string, boolean> = {
    atmosphere: true,
    clouds: true,
    precip: true,
  };
  const onKey = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (k === 'n') mapState.normalMap = earth.debugToggleSurfaceMap('normalMap');
    else if (k === 'd')
      mapState.displacementMap = earth.debugToggleSurfaceMap('displacementMap');
    else if (k === 'b')
      mapState.bumpMap = earth.debugToggleSurfaceMap('bumpMap');
    else if (k === 'a') {
      layerState.atmosphere = !layerState.atmosphere;
      earth.setLayerVisible('atmosphere', layerState.atmosphere);
    } else if (k === 'c') {
      layerState.clouds = !layerState.clouds;
      earth.setLayerVisible('clouds', layerState.clouds);
    } else if (k === 'p') {
      layerState.precip = !layerState.precip;
      earth.setLayerVisible('precip', layerState.precip);
    } else return;
    update();
  };
  window.addEventListener('keydown', onKey);

  const panel = document.createElement('pre');
  panel.id = 'earth-debug';
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

  const update = (): void => {
    // getLayerDiagnostics reflète la géométrie RÉELLEMENT rendue (vertexCount) et le
    // matériau de la couche surface : la vérité du mesh, pas la config.
    const surface = earth.getLayerDiagnostics('surface');
    const vertexCount = surface.geometry?.vertexCount ?? 0;
    // Densité hi-res : (GEOMETRY_SEGMENTS_HI+1)^2 desktop = 257^2 = 66049 ; mobile 129^2.
    // Un seuil bien au-dessus de la densité standard (65^2 = 4225) suffit à distinguer.
    const hiRes = vertexCount > 10_000;

    const onOff = (on: boolean): string => (on ? 'ON ' : 'off');
    panel.textContent = [
      'EARTH DEBUG (?debug-earth)',
      'surface verts   ' + vertexCount,
      'surface tessel  ' + (hiRes ? 'HI-RES' : 'STANDARD'),
      'material        ' + (surface.materialType ?? '—'),
      'uv count        ' + (surface.geometry?.uvCount ?? 0),
      '── toggles ──',
      '[N] normalMap   ' + mapState.normalMap,
      '[D] displacement ' + mapState.displacementMap,
      '[B] bumpMap     ' + mapState.bumpMap,
      '[A] atmosphere  ' + onOff(layerState.atmosphere),
      '[C] clouds      ' + onOff(layerState.clouds),
      '[P] precip      ' + onOff(layerState.precip),
    ].join(NEWLINE);
  };

  const unsubscribe = api.animationSystem.onFrame(update);
  update();
  return () => {
    window.removeEventListener('keydown', onKey);
    unsubscribe();
    panel.remove();
  };
}
