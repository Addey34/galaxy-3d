/**
 * LE CIEL CALCULÉ D'UN CORPS, POSÉ À L'APPROCHE (lot 48, pas 6).
 *
 * Un morceau à part, chargé par `CelestialObject` quand la caméra arrive à moins de
 * `SKY_LOAD_RADII` rayons (`core/layerDistances.ts`) d'un corps dont la fiche déclare un modèle de diffusion
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
import type { OceanMatch } from '@/core/oceanMatch';
import {
  dayZenithLuminance,
  skyScattering,
  starVisibility,
  zenithSkyLuminance,
  type SkyScatteringModelId,
} from '@/core/atmosphereScattering';
import { createSkyMaterial, getSky } from '@/shaders/SkyScatteringShader';
import {
  sampleMultipleScattering,
  sharedMultipleScatteringTable,
} from '@/core/multipleScattering';
import { LIGHTING_SETTINGS } from '@/config/engine';
import { ATTACHED_SKIES } from './skyApproach';
import { addAerialPerspective } from './aerialPerspective';
import {
  ADAPTATION_REFERENCE_SUN_DEG,
  altitudeWeight,
  skyAdaptationGain,
} from '@/core/skyAdaptation';

/** `?sky-adapt=0` : ciel et voile à l'exposition fixe d'avant (mesure A/B sur le même build). */
const SKY_ADAPTATION =
  typeof location === 'undefined' ||
  new URLSearchParams(location.search).get('sky-adapt') !== '0';

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
  createSurfaceOverlayMaterial?(oceanMatch?: OceanMatch): THREE.Material;
  /**
   * Prise en charge d'un matériau posé par un autre moteur (les carreaux de nuages régionaux,
   * `CloudShellHost`) : enveloppée pour qu'un carreau de NUAGES reçoive le voile de l'air entre l'œil et lui
   * (GAL-EARTH-LIGHTING-001).
   */
  adoptOverlayMaterial?(material: THREE.Material): void;
}

export interface SkyBinding {
  /** Gain d'adaptation posé sur la lumière de l'air à la dernière image (`core/skyAdaptation`), 1 hors de l'air. */
  airGain(): number;
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
  // La même table que la texture du shader, calculée une fois par modèle.
  const multipleTable = sharedMultipleScatteringTable(model);
  const multiple = (altitudeKm: number, sunCos: number) =>
    sampleMultipleScattering(multipleTable, model, altitudeKm, sunCos)[1];
  const seaLevelKm = (point: THREE.Vector3) =>
    radiusKm * body.figureRatioToward(point);

  // L'ŒIL ADAPTÉ AU CIEL DU LIEU (`core/skyAdaptation`) : la luminance du zénith au niveau de la mer pour la
  // hauteur du Soleil, rapportée à celle du Soleil à 45°. Ne dépend que de la hauteur du Soleil (mise en
  // cache au millième de cosinus), posée sur la lumière de l'AIR seulement (`uSunIntensity`).
  const zenithAtSeaLevel = (sunCos: number) =>
    zenithSkyLuminance(
      model,
      radiusKm,
      radiusKm + 0.002,
      sunCos,
      1,
      undefined,
      multiple
    );
  const referenceZenith = zenithAtSeaLevel(
    Math.sin((ADAPTATION_REFERENCE_SUN_DEG * Math.PI) / 180)
  );
  let adaptationKey = Number.NaN;
  let adaptationZenith = referenceZenith;
  let airGain = 1;

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
    u.uSunIntensity.value = sunIntensity * airGain;
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
  // LES NUAGES : le voile du sol sous eux (`AERIAL_VERTEX_MAIN_BELOW`). En mélange alpha
  // au-dessus d'un sol déjà voilé, `nuage × T + diffusé` est exact : la part du sol vue à travers
  // le nuage porte déjà le diffusé du trajet entier. Vérifié sur le matériau COURANT avant chaque
  // rendu, parce que la couche du modèle (`setDataOverlay`) le remplace puis rend l'original, qui
  // peut ne pas être en place à la pose du ciel. Seulement un matériau soumis à la courbe de tons :
  // le voile est une radiance LINÉAIRE, et le matériau du modèle (`toneMapped: false`) écrit des
  // couleurs d'affichage, où l'ajouter blanchirait la palette. Ils posent aussi la géométrie, au
  // cas où la sphère du sol ne serait pas dessinée à cette image.
  for (const child of mesh.parent?.children ?? []) {
    if (!(child instanceof THREE.Mesh) || !child.name.endsWith('_clouds'))
      continue;
    const clouds = child;
    hooked.push({ mesh: clouds, hook: clouds.onBeforeRender });
    clouds.onBeforeRender = (_renderer, _scene, camera) => {
      place(camera);
      for (const m of [clouds.material].flat())
        if (m.toneMapped) addAerialPerspective(m, sky.uniforms, 'below');
    };
  }
  const createTileMaterial = body.createSurfaceOverlayMaterial;
  if (createTileMaterial)
    body.createSurfaceOverlayMaterial = (oceanMatch?: OceanMatch) => {
      const tile = createTileMaterial.call(body, oceanMatch);
      addAerialPerspective(tile, sky.uniforms);
      return tile;
    };

  // LES NUAGES RÉGIONAUX (GAL-EARTH-LIGHTING-001) : le voile de l'air entre l'œil et le carreau, par la même
  // intégrale (`vertex` : jusqu'au point du nuage, juste vu d'en dessous comme d'au-dessus ; le mode `below` de la
  // couche mondiale irait au niveau de la mer, faux vu du sol). Ils prennent ainsi la lumière de l'air adaptée du
  // crépuscule devant eux, comme le ciel derrière. Aucune épaisseur ni lumière interne n'est supposée.
  const adoptOverlay = body.adoptOverlayMaterial;
  if (adoptOverlay)
    body.adoptOverlayMaterial = (overlay: THREE.Material) => {
      if (overlay.userData['__regionalClouds'] === true)
        addAerialPerspective(overlay, sky.uniforms, 'vertex');
      adoptOverlay.call(body, overlay);
    };

  const binding: SkyBinding = {
    airGain: () => airGain,
    starVisibilityFrom(cameraWorld) {
      body.group.getWorldPosition(centre);
      const kmPerUnit = radiusKm / body.renderedRadius();
      const up = toCamera.subVectors(cameraWorld, centre);
      const cameraKm = up.length() * kmPerUnit;
      airGain = 1;
      if (!(cameraKm > 0)) return 1;
      up.normalize();
      const groundKm = seaLevelKm(cameraWorld);
      if (cameraKm >= groundKm + model.thicknessKm) return 1;
      const sunCos = toSun
        .subVectors(body.sunWorld, centre)
        .normalize()
        .dot(up);
      if (SKY_ADAPTATION) {
        const key = Math.round(sunCos * 1000);
        if (key !== adaptationKey) {
          adaptationKey = key;
          adaptationZenith = zenithAtSeaLevel(key / 1000);
        }
        airGain = skyAdaptationGain(
          adaptationZenith,
          referenceZenith,
          altitudeWeight(cameraKm - groundKm, model.thicknessKm)
        );
      }
      return starVisibility(
        zenithSkyLuminance(
          model,
          groundKm,
          cameraKm,
          sunCos,
          sunIntensity,
          undefined,
          multiple
        ),
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
      if (adoptOverlay) body.adoptOverlayMaterial = adoptOverlay;
      material.dispose();
    },
  };
  ATTACHED_SKIES.add(binding);
  return binding;
}
