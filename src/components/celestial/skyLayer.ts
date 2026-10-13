/**
 * LE CIEL CALCULÉ D'UN CORPS, POSÉ À L'APPROCHE (lot 48, pas 6).
 *
 * Un morceau à part, chargé par `CelestialObject` quand la caméra arrive à moins de
 * `SKY_LOAD_RADII` rayons (`skyApproach.ts`) d'un corps dont la fiche déclare un modèle de diffusion
 * (`skyScattering`), jamais au démarrage. Le shader, les coefficients et le miroir JS des étoiles
 * pèsent ~10 ko : au démarrage ils dépassaient le plafond du JavaScript de 7 332 octets (mesuré par
 * `pnpm budget:startup` le 2026-10-13), et de loin le halo de Fresnel suffit, la Terre n'y faisant
 * que quelques pixels. Contrat : `docs/ARCHITECTURE.md` § « Le ciel de la Terre ».
 *
 * Il REMPLACE le matériau de la couche atmosphère par celui du ciel, puis lui donne sa géométrie
 * juste avant chaque rendu, depuis la caméra qui le dessine (celle d'une session XR comprise) : le
 * centre du corps et la direction du Soleil dans le repère de la VUE, calculés ici en double
 * précision, l'échelle en km, et le niveau de la mer SOUS la caméra (l'ellipsoïde dans sa
 * direction, pas la sphère moyenne, et pas les montagnes : au-dessus d'un plateau l'air est
 * vraiment plus mince).
 */
import * as THREE from 'three';
import {
  dayZenithLuminance,
  skyScattering,
  starVisibility,
  zenithSkyLuminance,
  type SkyScatteringModelId,
} from '@/core/atmosphereScattering';
import { createSkyMaterial, getSky } from '@/shaders/SkyScatteringShader';
import { LIGHTING_SETTINGS } from '@/config/engine';
import { ATTACHED_SKIES } from './skyApproach';
import { addAerialPerspective } from './aerialPerspective';

/** Ce que le ciel demande d'un corps. Plus petit qu'un `CelestialObject`, et c'est écrit. */
export interface SkyBody {
  readonly group: THREE.Object3D;
  /** Rayon RENDU courant (le morph Éduc↔Explo le fait varier). */
  renderedRadius(): number;
  /** Niveau de la mer dans la direction d'un point monde, en rapport au rayon moyen. */
  figureRatioToward(worldPoint: THREE.Vector3): number;
  /** Position monde du Soleil (la dernière connue). */
  readonly sunWorld: THREE.Vector3;
  /**
   * Fabrique du matériau d'un carreau d'imagerie : enveloppée pour que chaque carreau NEUF reçoive
   * la perspective aérienne (`aerialPerspective.ts`). Absente, seuls les sols déjà posés l'ont.
   */
  createSurfaceOverlayMaterial?(): THREE.Material;
}

export interface SkyBinding {
  /** Part des étoiles visible depuis cette caméra à travers cet air (1 hors de lui). */
  starVisibilityFrom(cameraWorld: THREE.Vector3): number;
  /** Rend le matériau d'avant et défait la liaison. */
  dispose(): void;
}

/** Pose le ciel calculé sur la couche atmosphère du corps. */
export function attachSky(
  body: SkyBody,
  modelId: SkyScatteringModelId,
  radiusKm: number,
  mesh: THREE.Mesh
): SkyBinding {
  const model = skyScattering(modelId);
  const previous = mesh.material;
  const material = createSkyMaterial(model);
  const sky = getSky(material)!;
  mesh.material = material;
  const sunIntensity = LIGHTING_SETTINGS.sun.intensity;
  const seaLevelKm = (point: THREE.Vector3) =>
    radiusKm * body.figureRatioToward(point);

  const centre = new THREE.Vector3();
  const toCamera = new THREE.Vector3();
  const toSun = new THREE.Vector3();

  // La géométrie du ciel, posée par la PREMIÈRE des deux surfaces dessinées à chaque image : le sol
  // (opaque, dessiné avant) pour sa perspective aérienne, puis la voûte, qui retrouve les mêmes
  // valeurs. Sans le sol, le voile aurait lu la position de l'image précédente.
  const place = (camera: THREE.Camera) => {
    const u = sky.uniforms;
    body.group.getWorldPosition(centre);
    u.uKmPerUnit.value = radiusKm / body.renderedRadius();
    u.uGroundKm.value = seaLevelKm(camera.position);
    u.uTopKm.value = u.uGroundKm.value + sky.thicknessKm;
    u.uSunDirView.value
      .subVectors(body.sunWorld, centre)
      .normalize()
      .transformDirection(camera.matrixWorldInverse);
    u.uCenterView.value.copy(centre).applyMatrix4(camera.matrixWorldInverse);
    u.uSunIntensity.value = sunIntensity;
  };
  const previousHook = mesh.onBeforeRender;
  mesh.onBeforeRender = (_renderer, _scene, camera) => place(camera);

  // LE SOL : la sphère du corps et ses carreaux, voisins de la coque dans le groupe en rotation.
  const ground = (child: THREE.Object3D): child is THREE.Mesh =>
    child instanceof THREE.Mesh &&
    (child.name.endsWith('_surface') || child.name.startsWith('tile_'));
  const hooked: { mesh: THREE.Mesh; hook: THREE.Mesh['onBeforeRender'] }[] = [];
  for (const child of mesh.parent?.children ?? []) {
    if (!ground(child)) continue;
    for (const m of [child.material].flat())
      addAerialPerspective(m, sky.uniforms);
    if (child.name.endsWith('_surface')) {
      hooked.push({ mesh: child, hook: child.onBeforeRender });
      child.onBeforeRender = (_renderer, _scene, camera) => place(camera);
    }
  }
  const createTileMaterial = body.createSurfaceOverlayMaterial;
  if (createTileMaterial)
    body.createSurfaceOverlayMaterial = () => {
      const tile = createTileMaterial.call(body);
      addAerialPerspective(tile, sky.uniforms);
      return tile;
    };

  const binding: SkyBinding = {
    starVisibilityFrom(cameraWorld) {
      body.group.getWorldPosition(centre);
      const kmPerUnit = radiusKm / body.renderedRadius();
      const up = toCamera.subVectors(cameraWorld, centre);
      const cameraKm = up.length() * kmPerUnit;
      if (!(cameraKm > 0)) return 1;
      up.normalize();
      const groundKm = seaLevelKm(cameraWorld);
      if (cameraKm >= groundKm + model.thicknessKm) return 1;
      const sunCos = toSun
        .subVectors(body.sunWorld, centre)
        .normalize()
        .dot(up);
      return starVisibility(
        zenithSkyLuminance(model, groundKm, cameraKm, sunCos, sunIntensity),
        dayZenithLuminance(model, sunIntensity)
      );
    },
    dispose() {
      ATTACHED_SKIES.delete(binding);
      mesh.material = previous;
      mesh.onBeforeRender = previousHook;
      for (const { mesh: surface, hook } of hooked)
        surface.onBeforeRender = hook;
      if (createTileMaterial)
        body.createSurfaceOverlayMaterial = createTileMaterial;
      material.dispose();
    },
  };
  ATTACHED_SKIES.add(binding);
  return binding;
}
