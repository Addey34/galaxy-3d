/**
 * Entrée VR (WebXR) — point de composition : détection de capacité, cycle de vie de session,
 * contrôleurs, locomotion et sélection. Réutilise Éduc/Explo tels quels — aucun changement
 * d'échelle pour la VR, conformément à l'invariant de réalisme Explo (voir CLAUDE.md).
 *
 * Même philosophie que `share.ts` : détection de capacité au démarrage, repli silencieux plutôt
 * qu'un bouton mort — Safari/iOS n'expose pas `navigator.xr` du tout.
 */
import { VRButton } from 'three/addons/webxr/VRButton.js';
import type { CameraSystem } from '@/components/systems/CameraSystem';
import type { SceneSystem } from '@/components/systems/SceneSystem';
import type { AnimationSystem } from '@/components/systems/AnimationSystem';
import type { PlanetNavigation } from './planetNav';
import { PlayerLocomotionController } from './webxrReferenceSpace';
import {
  pollMovement,
  pollSnapTurn,
  resetSnapTurnArming,
} from './webxrLocomotion';
import {
  aimController,
  computeTeleportTarget,
  createReticle,
  setupControllerSelection,
  type WebXRReticle,
  type WebXRSelectionHandle,
} from './webxrSelection';
import { createInfoPanel, type XRInfoPanel } from './webxrInfoPanel';
import { CAMERA_SETTINGS } from '@/config/engine';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import { bodyDisplayName } from '@/i18n/bodyText';
import { t } from '@/i18n';
import * as THREE from 'three';

export interface WebXRHandle {
  /** À appeler depuis le callback de bascule de mode (Éduc ↔ Explo). */
  setMode(mode: 'educ' | 'explo'): void;
}

export function setupWebXR(
  camera: CameraSystem,
  scene: SceneSystem,
  animationSystem: AnimationSystem,
  nav: PlanetNavigation,
  bodyNames: ReadonlySet<string>
): WebXRHandle {
  let mode: 'educ' | 'explo' = 'educ';
  const handle: WebXRHandle = {
    setMode: (next) => {
      mode = next;
    },
  };

  if (!navigator.xr) return handle;

  const catalog = flattenBodies(CELESTIAL_CONFIG);

  void navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
    if (!supported) return;

    const button = VRButton.createButton(camera.renderer);
    document.body.appendChild(button);

    const infoPanel: XRInfoPanel = createInfoPanel();
    scene.scene.add(infoPanel.mesh);

    const locomotion = new PlayerLocomotionController();
    let controllers: THREE.XRTargetRaySpace[] = [];
    let reticles: WebXRReticle[] = [];
    let selectionHandles: WebXRSelectionHandle[] = [];
    let unsubFrame: (() => void) | null = null;
    let lastTime: number | null = null;

    camera.renderer.xr.addEventListener('sessionstart', () => {
      // Pendant la session, renderer.xr pilote seul la pose caméra (cf. CameraSystem.update) —
      // désactiver OrbitControls évite en plus que ses écouteurs pointeur/molette interfèrent.
      camera.controls.enabled = false;

      // En tout premier : avant tout setReferenceSpace, sinon on capturerait un espace déjà décalé.
      locomotion.captureBaseSpace(camera.renderer);

      controllers = [
        camera.renderer.xr.getController(0),
        camera.renderer.xr.getController(1),
      ];
      reticles = controllers.map(() => createReticle());
      for (const controller of controllers) scene.scene.add(controller);
      for (const reticle of reticles) scene.scene.add(reticle.mesh);

      const onSelect = (name: string): void => {
        const config = catalog.get(name);
        const body = scene.getBody(name);
        if (config && body) {
          body.group.updateWorldMatrix(true, false);
          const worldPos = body.group.getWorldPosition(new THREE.Vector3());
          const radius = body.getFrameRadius(mode);
          const lines = [
            config.realData?.radiusKm
              ? `${Math.round(config.realData.radiusKm).toLocaleString()} km`
              : '',
            config.realData?.distanceAU
              ? `${config.realData.distanceAU.toFixed(2)} ${t('unit.au')}`
              : '',
          ].filter(Boolean);
          infoPanel.show(bodyDisplayName(name), lines, worldPos, radius);
        }

        // Téléportation uniquement en Explo (vraie échelle = distances impraticables en vol
        // libre) ; en Éduc la gâchette ne fait que sélectionner, le vol libre suffit à se
        // déplacer. Réutilise cameraDistance.explo, la même distance de cadrage que le vol
        // caméra desktop (cf. CameraSystem.getDefaultDistance).
        if (mode !== 'explo' || !body) return;
        body.group.updateWorldMatrix(true, false);
        const bodyWorldPos = body.group.getWorldPosition(new THREE.Vector3());
        const viewDistance =
          body.cameraDistance?.explo ?? CAMERA_SETTINGS.defaultBodyDistance;
        locomotion.state.offset.copy(
          computeTeleportTarget(bodyWorldPos, viewDistance, locomotion.state.offset)
        );
        locomotion.applyOffset(camera.renderer);
      };
      selectionHandles = controllers.map((controller) =>
        setupControllerSelection(controller, scene.scene, bodyNames, nav, onSelect)
      );

      lastTime = null;
      unsubFrame = animationSystem.onFrame(() => {
        if (!camera.renderer.xr.isPresenting) return;
        const session = camera.renderer.xr.getSession();
        if (!session) return;

        const now = performance.now();
        const dt = lastTime === null ? 0 : Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;

        let changed = pollSnapTurn(session, locomotion.state);
        if (mode === 'educ') {
          changed = pollMovement(session, camera.camera, locomotion.state, dt) || changed;
        }
        if (changed) locomotion.applyOffset(camera.renderer);

        controllers.forEach((controller, i) => {
          reticles[i]?.update(
            aimController(controller, scene.scene, bodyNames),
            controller
          );
        });
        infoPanel.updateBillboard(camera.camera);
      });
    });

    camera.renderer.xr.addEventListener('sessionend', () => {
      camera.controls.enabled = true;
      unsubFrame?.();
      unsubFrame = null;
      for (const h of selectionHandles) h.dispose();
      selectionHandles = [];
      for (const controller of controllers) scene.scene.remove(controller);
      for (const reticle of reticles) scene.scene.remove(reticle.mesh);
      controllers = [];
      reticles = [];
      infoPanel.hide();
      resetSnapTurnArming();
      locomotion.reset();
    });
  });

  return handle;
}
