/**
 * Le centrage de l'écran sur un point du ciel (voir `core/skyCentering.ts` pour le principe et les
 * calculs purs). Ce morceau n'est chargé qu'à la première ouverture d'une fiche d'objet du ciel :
 * il ne fait pas partie du démarrage, `CameraSystem` ne garde que des points d'accroche minces.
 */
import TWEEN, { Group as TweenGroup, type Tween } from '@tweenjs/tween.js';
import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  bodyAngularRadiusRad,
  centeringTurnRad,
  halfHorizontalFieldRad,
  projectedTangents,
  viewOffsetPixels,
} from '@/core/skyCentering';
import { viewAnglesFromDirection } from '@/core/viewAngles';
import { prefersReducedMotion } from '@/utils/reducedMotion';

/** Ce dont le centrage a besoin de la caméra (`CameraSystem` s'y conforme) : lire sa pose et la reposer. */
export interface SkyCenteringHost {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  renderer: THREE.WebGLRenderer;
  tweenGroup: TweenGroup;
  /** Le corps suivi, s'il y en a un : son rayon fixe l'angle dont on tourne la visée. */
  readonly currentTarget: { group: THREE.Group } | null;
  /** Vrai pendant le vol vers un corps. */
  readonly isFlying: boolean;
  /** Exécute l'action à la fin du vol en cours (tout de suite s'il n'y en a pas). */
  whenSettled(action: () => void): void;
  /** Pose la caméra autour de sa cible selon des angles, sans animation. */
  applyViewAngles(azimuthDeg: number, polarDeg: number, distance: number): void;
}

const FLIGHT_MS = 650;
const RELEASE_MS = 250;
/** Garde l'ancre loin des bords : une ancre à 0 ou 1 enverrait l'objet hors de l'écran. */
const ANCHOR_MIN = 0.1;
const ANCHOR_MAX = 0.9;

export class SkyCenteringView {
  /**
   * Où la direction se projette sur le plan image (tangentes), l'avancement `k` du décalage de la
   * fenêtre de projection (0 à 1) et la hauteur d'écran visée.
   */
  private state: {
    tx: number;
    ty: number;
    k: number;
    anchorY: number;
  } | null = null;
  /** Dernier état appliqué à la caméra : `setViewOffset` n'est refait que si quelque chose change. */
  private key = '';
  private readonly size = new THREE.Vector2();
  /** Publié sur le canvas : `data-sky-centered` vaut `1` une fois l'objet arrivé, `0` sinon (cf. `data-scene-moving`). */
  private publish(value: '0' | '1'): void {
    this.host.renderer.domElement.dataset['skyCentered'] = value;
  }
  /** L'animation en cours (vol vers la vue centrée, ou retour) : seule celle-ci est arrêtée, jamais le groupe. */
  private animation: Tween<object> | null = null;
  /** Le corps suivi au moment du centrage : un autre corps, ou la vue d'ensemble, rend la vue d'origine. */
  private followed: unknown = null;
  private raf = 0;
  /** Un geste des contrôles est en cours (de `start` à `end`). */
  private gesture = false;
  /** La vue d'origine est en train de revenir : évite de relancer le retour à chaque image du geste. */
  private releasing = false;

  constructor(private readonly host: SkyCenteringHost) {
    // Une rotation ou un zoom rend la vue d'origine, mais PAS un simple clic : `start` arrive dès
    // l'appui, et rendre la vue à ce moment-là déplacerait l'objet sous le doigt avant le relâchement,
    // le clic sur l'objet centré raterait (instantané avec « réduire les animations »). On attend
    // que la caméra BOUGE réellement sous le geste.
    const { controls } = host;
    controls.addEventListener('start', () => {
      this.gesture = true;
    });
    controls.addEventListener('change', () => {
      if (this.gesture) this.release();
    });
    controls.addEventListener('end', () => {
      this.gesture = false;
    });
  }

  /**
   * Amène `direction` (unitaire, repère de la scène) à la hauteur `anchorY` de l'écran, au centre
   * en largeur. La caméra tourne d'un petit angle autour de l'axe vertical de l'écran, qui dégage
   * le disque du corps suivi : il sort de côté, à gauche.
   */
  center(direction: readonly [number, number, number], anchorY = 0.5): void {
    const { camera, controls, tweenGroup } = this.host;
    // Un vol vers un corps est en cours : on attend qu'il finisse, sans le couper.
    if (this.host.isFlying) {
      this.host.whenSettled(() => this.center(direction, anchorY));
      return;
    }
    // En WebXR la tête pilote la caméra : un décalage de projection n'aurait aucun sens.
    if (this.host.renderer.xr.isPresenting) return;
    const toSky = new THREE.Vector3(...direction);
    if (!(toSky.lengthSq() > 0)) return;
    toSky.normalize();

    this.animation?.stop();
    const target = controls.target;
    const distance = camera.position.distanceTo(target);
    if (!(distance > 0)) return;
    const turn = centeringTurnRad(
      bodyAngularRadiusRad(
        (this.host.currentTarget?.group.userData['radius'] as
          number | undefined) ?? 0,
        distance
      ),
      halfHorizontalFieldRad(
        THREE.MathUtils.degToRad(camera.fov),
        camera.aspect
      )
    );

    const right = new THREE.Vector3().crossVectors(
      toSky,
      new THREE.Vector3(0, 1, 0)
    );
    if (right.lengthSq() < 1e-9) right.set(1, 0, 0);
    right.normalize();
    const screenUp = new THREE.Vector3().crossVectors(right, toSky).normalize();
    const sight = toSky.clone().applyAxisAngle(screenUp, turn);

    // Orientation finale : on la pose pour lire où l'objet se projette, puis on revient au départ
    // pour l'animer. Les angles du départ sont relus AVANT la pose finale.
    const startOffset = camera.position.clone().sub(target);
    const start = viewAnglesFromDirection(startOffset);
    const end = viewAnglesFromDirection(sight.clone().negate());
    if (!start || !end) return;
    this.host.applyViewAngles(end.azimuthDeg, end.polarDeg, distance);
    camera.updateMatrixWorld();
    const local = toSky
      .clone()
      .applyQuaternion(camera.quaternion.clone().invert());
    const projected = projectedTangents([local.x, local.y, local.z]);
    if (!projected) {
      this.host.applyViewAngles(start.azimuthDeg, start.polarDeg, distance);
      return;
    }

    this.state = {
      tx: projected.tx,
      ty: projected.ty,
      k: 0,
      anchorY: THREE.MathUtils.clamp(anchorY, ANCHOR_MIN, ANCHOR_MAX),
    };
    this.key = '';
    this.releasing = false;
    this.followed = this.host.currentTarget;
    this.publish('0');
    this.watch();
    if (prefersReducedMotion()) {
      this.state.k = 1;
      this.sync();
      this.publish('1');
      return;
    }
    this.host.applyViewAngles(start.azimuthDeg, start.polarDeg, distance);
    const from = startOffset.normalize();
    const to = sight.clone().negate();
    const flight = { t: 0 };
    this.animation = new TWEEN.Tween(flight, tweenGroup)
      .to({ t: 1 }, FLIGHT_MS)
      .easing(TWEEN.Easing.Cubic.InOut)
      .onUpdate(() => {
        // Interpolation sphérique : la caméra reste à `distance` du corps tout du long.
        const angles = viewAnglesFromDirection(slerp(from, to, flight.t));
        if (angles)
          this.host.applyViewAngles(
            angles.azimuthDeg,
            angles.polarDeg,
            distance
          );
        if (this.state) this.state.k = flight.t;
      })
      .onComplete(() => this.publish('1'))
      .start();
  }

  /** Rend la vue d'origine : en douceur après un geste, d'un coup si `instant`. */
  release(instant = false): void {
    const state = this.state;
    if (!state || this.releasing) return;
    if (instant || prefersReducedMotion() || state.k <= 0) {
      this.drop();
      return;
    }
    this.releasing = true;
    this.publish('0');
    const fade = { k: state.k };
    this.animation?.stop();
    this.animation = new TWEEN.Tween(fade, this.host.tweenGroup)
      .to({ k: 0 }, RELEASE_MS)
      .easing(TWEEN.Easing.Quadratic.Out)
      .onUpdate(() => {
        if (this.state) this.state.k = fade.k;
      })
      .onComplete(() => this.drop())
      .start();
  }

  /** Efface le décalage tout de suite (choix d'un corps, retour à la vue d'ensemble). */
  drop(): void {
    this.animation?.stop();
    this.animation = null;
    this.releasing = false;
    this.publish('0');
    if (!this.state && this.key === '') return;
    this.state = null;
    this.key = '';
    this.host.camera.clearViewOffset();
  }

  /**
   * Une boucle d'images tient la vue tant que le centrage dure : elle reporte le décalage sur la
   * caméra (la taille de l'écran peut changer) et le rend dès que le corps suivi n'est plus le même.
   * `CameraSystem` ne sait rien de ce morceau : il n'a aucun point d'accroche dans le démarrage.
   */
  private watch(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  private readonly loop = (): void => {
    if (this.host.currentTarget !== this.followed) this.drop();
    this.sync();
    this.raf = this.state ? requestAnimationFrame(this.loop) : 0;
  };

  /** Reporte le décalage sur la caméra, seulement s'il a changé. */
  private sync(): void {
    const state = this.state;
    if (!state) return;
    const { camera, renderer } = this.host;
    const size = renderer.getSize(this.size);
    const key = `${size.x}|${size.y}|${camera.fov}|${state.k}|${state.anchorY}`;
    if (key === this.key) return;
    this.key = key;
    const offset = viewOffsetPixels(
      state.tx,
      state.ty,
      size.y,
      THREE.MathUtils.degToRad(camera.fov),
      state.k,
      state.anchorY
    );
    camera.setViewOffset(size.x, size.y, offset.x, offset.y, size.x, size.y);
  }
}

function slerp(
  from: THREE.Vector3,
  to: THREE.Vector3,
  t: number
): THREE.Vector3 {
  const turn = new THREE.Quaternion().setFromUnitVectors(from, to);
  const part = new THREE.Quaternion().slerp(turn, t);
  return from.clone().applyQuaternion(part);
}
