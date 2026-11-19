/**
 * Du rayon à la latitude / longitude (GAL-METEO-INSPECT-003), sur une hiérarchie Three.js qui
 * reproduit celle d'un corps : groupe translaté > groupe incliné (pôle IAU) > mesh qui tourne
 * (phase de rotation). Déterministe : aucune texture, aucun rendu.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  geographicToLocalDirection,
  localDirectionToGeographic,
} from './frames';
import {
  bodyCenter,
  isFacingCamera,
  pickGeographic,
  raySphereHit,
  type SurfaceBody,
} from './surfacePick';

const RADIUS = 35;

function makeBody(options: {
  position: THREE.Vector3;
  tilt: THREE.Quaternion;
  phase: number;
}): SurfaceBody {
  const group = new THREE.Group();
  group.position.copy(options.position);
  const tilt = new THREE.Group();
  tilt.quaternion.copy(options.tilt);
  const mesh = new THREE.Group();
  mesh.rotation.y = options.phase;
  group.add(tilt);
  tilt.add(mesh);
  group.updateMatrixWorld(true);
  return {
    surfacePointToWorld(lat, lon, out = new THREE.Vector3()) {
      geographicToLocalDirection(lat, lon, out).multiplyScalar(RADIUS);
      return mesh.localToWorld(out);
    },
    worldPointToGeographic(point) {
      return localDirectionToGeographic(mesh.worldToLocal(point.clone()));
    },
  };
}

const rayTo = (from: THREE.Vector3, to: THREE.Vector3) => ({
  origin: from.clone(),
  direction: to.clone().sub(from).normalize(),
});

/** Le point (lat, lon) vu depuis `camera` : un rayon qui doit y retomber. */
function pickFrom(
  body: SurfaceBody,
  camera: THREE.Vector3,
  lat: number,
  lon: number
) {
  const target = body.surfacePointToWorld(lat, lon);
  const { origin, direction } = rayTo(camera, target);
  return pickGeographic(origin, direction, body);
}

const tiltOf = (axisDeg: number) =>
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    (axisDeg * Math.PI) / 180
  );

const angularDistanceDeg = (
  a: { latitudeDeg: number; longitudeDeg: number },
  b: { latitudeDeg: number; longitudeDeg: number }
) => {
  const va = geographicToLocalDirection(a.latitudeDeg, a.longitudeDeg);
  const vb = geographicToLocalDirection(b.latitudeDeg, b.longitudeDeg);
  return (va.angleTo(vb) * 180) / Math.PI;
};

describe('raySphereHit', () => {
  const center = new THREE.Vector3(0, 0, 0);
  it('touche la face avant, pas la face arrière', () => {
    const hit = raySphereHit(
      new THREE.Vector3(0, 0, 100),
      new THREE.Vector3(0, 0, -1),
      center,
      10
    );
    expect(hit?.z).toBeCloseTo(10, 9);
  });
  it('rate la sphère : null', () => {
    expect(
      raySphereHit(
        new THREE.Vector3(0, 20, 100),
        new THREE.Vector3(0, 0, -1),
        center,
        10
      )
    ).toBeNull();
  });
  it('sphère derrière l’origine : null', () => {
    expect(
      raySphereHit(
        new THREE.Vector3(0, 0, 100),
        new THREE.Vector3(0, 0, 1),
        center,
        10
      )
    ).toBeNull();
  });
});

describe('pickGeographic : coordonnées connues, rotation et inclinaison', () => {
  const positions = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1234, -56, 789),
  ];
  const tilts = [new THREE.Quaternion(), tiltOf(23.44), tiltOf(-80)];
  const phases = [0, 1.234, Math.PI, 5.5];
  // Points de contrôle : Paris, Sydney, Quito (équateur), Honolulu, Tokyo (côté antiméridien),
  // Reykjavik (haute latitude), Nuuk.
  const places: Array<[string, number, number]> = [
    ['Paris', 48.8566, 2.3522],
    ['Sydney', -33.8688, 151.2093],
    ['Quito', -0.18, -78.4678],
    ['Honolulu', 21.3069, -157.8583],
    ['Tokyo', 35.6762, 139.6503],
    ['Reykjavik', 64.1466, -21.9426],
    ['Nuuk', 64.1835, -51.7216],
  ];

  for (const position of positions)
    for (const tilt of tilts)
      for (const phase of phases) {
        const body = makeBody({ position, tilt, phase });
        const center = bodyCenter(body);
        // La caméra regarde chaque point depuis l'extérieur, le long de la normale + un écart.
        for (const [name, lat, lon] of places) {
          it(`${name} retrouvé (phase ${phase.toFixed(2)}, pos ${position.x})`, () => {
            const surface = body.surfacePointToWorld(lat, lon);
            const normal = surface.clone().sub(center).normalize();
            const camera = surface
              .clone()
              .addScaledVector(normal, 90)
              .add(new THREE.Vector3(8, 5, -3));
            const picked = pickFrom(body, camera, lat, lon);
            expect(picked).not.toBeNull();
            expect(
              angularDistanceDeg(picked!, {
                latitudeDeg: lat,
                longitudeDeg: lon,
              })
            ).toBeLessThan(1e-4);
          });
        }
      }

  it('la rotation décale la longitude lue, pas la latitude', () => {
    const camera = new THREE.Vector3(0, 0, 400);
    const a = makeBody({
      position: new THREE.Vector3(),
      tilt: new THREE.Quaternion(),
      phase: 0,
    });
    const b = makeBody({
      position: new THREE.Vector3(),
      tilt: new THREE.Quaternion(),
      phase: Math.PI / 6, // 30°
    });
    const centerRay = rayTo(camera, new THREE.Vector3());
    const pa = pickGeographic(centerRay.origin, centerRay.direction, a)!;
    const pb = pickGeographic(centerRay.origin, centerRay.direction, b)!;
    expect(pb.latitudeDeg).toBeCloseTo(pa.latitudeDeg, 9);
    // Mod 360 : le décalage est de 30°, au signe de la convention Three.js près.
    const delta = ((pb.longitudeDeg - pa.longitudeDeg + 540) % 360) - 180;
    expect(Math.abs(delta)).toBeCloseTo(30, 6);
  });

  it('antiméridien et pôles : longitude dans ]-180, 180], latitude bornée', () => {
    const body = makeBody({
      position: new THREE.Vector3(),
      tilt: new THREE.Quaternion(),
      phase: 0.7,
    });
    for (const [lat, lon] of [
      [10, 179.999],
      [10, -179.999],
      [-10, 180],
      [89.9999, 33],
      [-89.9999, -120],
    ] as const) {
      const picked = pickFrom(
        body,
        new THREE.Vector3(0, 0, 500).add(
          body.surfacePointToWorld(lat, lon).multiplyScalar(3)
        ),
        lat,
        lon
      );
      expect(picked).not.toBeNull();
      expect(picked!.latitudeDeg).toBeGreaterThanOrEqual(-90);
      expect(picked!.latitudeDeg).toBeLessThanOrEqual(90);
      expect(picked!.longitudeDeg).toBeGreaterThanOrEqual(-180);
      expect(picked!.longitudeDeg).toBeLessThanOrEqual(180);
      expect(
        angularDistanceDeg(picked!, { latitudeDeg: lat, longitudeDeg: lon })
      ).toBeLessThan(1e-4);
    }
  });

  it('un rayon qui manque le corps : null', () => {
    const body = makeBody({
      position: new THREE.Vector3(),
      tilt: new THREE.Quaternion(),
      phase: 0,
    });
    const { origin, direction } = rayTo(
      new THREE.Vector3(0, 0, 400),
      new THREE.Vector3(200, 0, 0)
    );
    expect(pickGeographic(origin, direction, body)).toBeNull();
  });

  it('le rayon touche la face VISIBLE : la face cachée ne se choisit pas', () => {
    const body = makeBody({
      position: new THREE.Vector3(),
      tilt: new THREE.Quaternion(),
      phase: 0,
    });
    // Un point de l'hémisphère opposé à la caméra : le rayon dirigé vers lui touche d'abord le
    // point visible, jamais le point visé.
    const camera = new THREE.Vector3(0, 0, 400);
    const far = body.surfacePointToWorld(0, 0);
    const back = far.clone().multiplyScalar(-1); // point antipodal de (0, 0)
    const { origin, direction } = rayTo(camera, back);
    const picked = pickGeographic(origin, direction, body);
    // (le rayon vers le centre côté caméra : il traverse le disque par sa face avant)
    expect(picked).not.toBeNull();
    const front = body.worldPointToGeographic(
      raySphereHit(origin, direction, new THREE.Vector3(), RADIUS)!
    );
    expect(angularDistanceDeg(picked!, front)).toBeLessThan(1e-3);
  });
});

describe('isFacingCamera : occlusion derrière le globe', () => {
  const center = new THREE.Vector3(0, 0, 0);
  const camera = new THREE.Vector3(0, 0, 200);
  it('point face à la caméra : visible', () => {
    expect(isFacingCamera(new THREE.Vector3(0, 0, 35), center, camera)).toBe(
      true
    );
  });
  it('point sur la face cachée : masqué', () => {
    expect(isFacingCamera(new THREE.Vector3(0, 0, -35), center, camera)).toBe(
      false
    );
  });
  it('point juste derrière le limbe : masqué ; juste devant : visible', () => {
    // La caméra voit le limbe sous un angle dont le cosinus vaut R / d.
    const limb = Math.acos(35 / 200);
    const before = new THREE.Vector3(
      35 * Math.sin(limb - 0.01),
      0,
      35 * Math.cos(limb - 0.01)
    );
    const after = new THREE.Vector3(
      35 * Math.sin(limb + 0.01),
      0,
      35 * Math.cos(limb + 0.01)
    );
    expect(isFacingCamera(before, center, camera)).toBe(true);
    expect(isFacingCamera(after, center, camera)).toBe(false);
  });
});

/**
 * AUD-02 : la Terre n'est pas une sphère. Un corps ellipsoïdal (même modèle que
 * `figureRadius` : x = a, z = b, y = pôle c) dont le rayon dépend de la direction, avec la vraie
 * Terre (1/298) ET un aplatissement exagéré (1/10) pour que l'écart se voie à l'échelle du test.
 */
function makeEllipsoidBody(options: {
  position: THREE.Vector3;
  tilt: THREE.Quaternion;
  phase: number;
  a: number;
  b: number;
  c: number;
}): SurfaceBody {
  const group = new THREE.Group();
  group.position.copy(options.position);
  const tilt = new THREE.Group();
  tilt.quaternion.copy(options.tilt);
  const mesh = new THREE.Group();
  mesh.rotation.y = options.phase;
  group.add(tilt);
  tilt.add(mesh);
  group.updateMatrixWorld(true);
  const { a, b, c } = options;
  return {
    surfacePointToWorld(lat, lon, out = new THREE.Vector3()) {
      geographicToLocalDirection(lat, lon, out);
      const r =
        1 / Math.sqrt((out.x / a) ** 2 + (out.z / b) ** 2 + (out.y / c) ** 2);
      return mesh.localToWorld(out.multiplyScalar(r));
    },
    worldPointToGeographic(point) {
      return localDirectionToGeographic(mesh.worldToLocal(point.clone()));
    },
  };
}

describe('pickGeographic : corps ellipsoïdal (AUD-02)', () => {
  const figures = [
    { name: 'Terre 1/298', a: 35, b: 35, c: 35 * (1 - 1 / 298) },
    { name: 'aplatissement 1/10', a: 35, b: 35, c: 31.5 },
    { name: 'triaxial', a: 35, b: 33, c: 30 },
  ];
  const poses = [
    { position: new THREE.Vector3(), tilt: new THREE.Quaternion(), phase: 0 },
    {
      position: new THREE.Vector3(1234, -56, 789),
      tilt: tiltOf(23.44),
      phase: 1.234,
    },
    { position: new THREE.Vector3(-300, 40, 5), tilt: tiltOf(-80), phase: 5.5 },
  ];
  const places: Array<[number, number]> = [
    [48.8566, 2.3522],
    [-33.8688, 151.2093],
    [-0.18, -78.4678],
    [21.3069, -157.8583],
    [64.1466, -21.9426],
    [89.5, 10],
    [-89.5, -170],
    [10, 179.9],
    [10, -179.9],
  ];

  for (const fig of figures)
    describe(fig.name, () => {
      it('impacts valides : le rayon pointé sur (lat, lon) y retombe', () => {
        for (const pose of poses) {
          const body = makeEllipsoidBody({ ...pose, ...fig });
          const center = bodyCenter(body);
          for (const [lat, lon] of places) {
            const target = body.surfacePointToWorld(lat, lon);
            const normal = target.clone().sub(center);
            // Une caméra du côté du point (loin) : le point est face à elle.
            const camera = target
              .clone()
              .add(normal.normalize().multiplyScalar(400));
            const { origin, direction } = rayTo(camera, target);
            const hit = pickGeographic(origin, direction, body);
            expect(hit, `${lat},${lon}`).not.toBeNull();
            expect(
              angularDistanceDeg(hit!, { latitudeDeg: lat, longitudeDeg: lon })
            ).toBeLessThan(1e-3);
          }
        }
      });

      it('un rayon qui touche la sphère équatoriale mais manque l’ellipsoïde ne choisit rien', () => {
        // Hors rotation : rayon horizontal (axe x) à la hauteur h le long de l’axe polaire,
        // entre le demi-axe polaire c et le demi-axe équatorial a.
        const body = makeEllipsoidBody({
          position: new THREE.Vector3(),
          tilt: new THREE.Quaternion(),
          phase: 0,
          ...fig,
        });
        const h = (fig.c + fig.a) / 2;
        if (h > fig.c && h < fig.a) {
          const hit = pickGeographic(
            new THREE.Vector3(-1000, h, 0),
            new THREE.Vector3(1, 0, 0),
            body
          );
          expect(hit).toBeNull();
        }
        // Et un rayon légèrement plus bas touche bien.
        const inside = pickGeographic(
          new THREE.Vector3(-1000, fig.c * 0.9, 0),
          new THREE.Vector3(1, 0, 0),
          body
        );
        expect(inside).not.toBeNull();
      });

      it('près du limbe : le point lu est exactement sur la surface, et vu de face', () => {
        const body = makeEllipsoidBody({ ...poses[1]!, ...fig });
        const center = bodyCenter(body);
        const camera = center.clone().add(new THREE.Vector3(60, 15, 190));
        let checked = 0;
        for (let lat = -80; lat <= 80; lat += 4)
          for (let lon = -180; lon < 180; lon += 6) {
            const target = body.surfacePointToWorld(lat, lon);
            const normal = target.clone().sub(center).normalize();
            const cosine = normal.dot(camera.clone().sub(target).normalize());
            if (cosine <= 0.004 || cosine > 0.08) continue; // la bande du limbe
            const { origin, direction } = rayTo(camera, target);
            const hit = pickGeographic(origin, direction, body);
            // Près du limbe un autre point de la surface peut être touché le premier : alors il est
            // lui aussi vu de face, et le rayon passe par lui.
            if (!hit) continue;
            const back = body.surfacePointToWorld(
              hit.latitudeDeg,
              hit.longitudeDeg
            );
            const toBack = back.clone().sub(origin).normalize();
            expect(toBack.angleTo(direction)).toBeLessThan(1e-5);
            expect(isFacingCamera(back, center, camera)).toBe(true);
            checked++;
          }
        expect(checked).toBeGreaterThan(10);
      });

      it('occultation : viser la face cachée lit le point de la face avant', () => {
        const body = makeEllipsoidBody({ ...poses[1]!, ...fig });
        const center = bodyCenter(body);
        const camera = center.clone().add(new THREE.Vector3(0, 0, 300));
        const far = body.surfacePointToWorld(10, 0);
        const side = far.clone().sub(center);
        // Un point de l'hémisphère opposé à la caméra.
        const hidden = center.clone().sub(side.normalize().multiplyScalar(20));
        const target = body.surfacePointToWorld(
          body.worldPointToGeographic(hidden).latitudeDeg,
          body.worldPointToGeographic(hidden).longitudeDeg
        );
        expect(isFacingCamera(target, center, camera)).toBe(
          target.clone().sub(center).dot(camera.clone().sub(target)) > 0
        );
        const { origin, direction } = rayTo(camera, target);
        const hit = pickGeographic(origin, direction, body)!;
        const point = body.surfacePointToWorld(
          hit.latitudeDeg,
          hit.longitudeDeg
        );
        expect(isFacingCamera(point, center, camera)).toBe(true);
      });
    });

  it('coïncide avec la sphère quand les trois demi-axes sont égaux', () => {
    const sphere = makeBody({
      position: new THREE.Vector3(5, 6, 7),
      tilt: tiltOf(23.44),
      phase: 2,
    });
    const same = makeEllipsoidBody({
      position: new THREE.Vector3(5, 6, 7),
      tilt: tiltOf(23.44),
      phase: 2,
      a: RADIUS,
      b: RADIUS,
      c: RADIUS,
    });
    const origin = new THREE.Vector3(5, 6, 400);
    const direction = new THREE.Vector3(0.03, -0.02, -1).normalize();
    const p1 = pickGeographic(origin, direction, sphere)!;
    const p2 = pickGeographic(origin, direction, same)!;
    expect(angularDistanceDeg(p1, p2)).toBeLessThan(1e-9);
  });
});
