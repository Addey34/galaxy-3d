import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  equatorialToScene,
  localDirectionToGeographic,
  OBLIQUITY_RAD,
  surfaceRotationForSubsolarLongitude,
} from './frames';

const SIN_OBL = Math.sin(OBLIQUITY_RAD);
const COS_OBL = Math.cos(OBLIQUITY_RAD);

describe('equatorialToScene', () => {
  it('maps equatorial +X to scene +X', () => {
    const v = equatorialToScene(1, 0, 0);
    expect(v.x).toBeCloseTo(1, 12);
    expect(v.y).toBeCloseTo(0, 12);
    expect(v.z).toBeCloseTo(0, 12);
  });

  it('maps the ecliptic north pole to scene +Y', () => {
    // Le pôle nord écliptique s'exprime (0, -sinε, cosε) en équatorial J2000.
    const v = equatorialToScene(0, -SIN_OBL, COS_OBL);
    expect(v.x).toBeCloseTo(0, 12);
    expect(v.y).toBeCloseTo(1, 12);
    expect(v.z).toBeCloseTo(0, 12);
  });

  it('preserves vector length (pure rotation)', () => {
    const v = equatorialToScene(0.3, -1.7, 2.4);
    expect(v.length()).toBeCloseTo(Math.hypot(0.3, -1.7, 2.4), 12);
  });

  it('is a proper rotation — preserves cross products (determinant +1, not a reflection)', () => {
    const a = new THREE.Vector3(1, 2, -0.5);
    const b = new THREE.Vector3(-0.4, 0.9, 1.3);
    const crossThenMap = equatorialToScene(
      ...(new THREE.Vector3().crossVectors(a, b).toArray() as [
        number,
        number,
        number,
      ])
    );
    const mapThenCross = new THREE.Vector3().crossVectors(
      equatorialToScene(a.x, a.y, a.z),
      equatorialToScene(b.x, b.y, b.z)
    );
    expect(mapThenCross.x).toBeCloseTo(crossThenMap.x, 12);
    expect(mapThenCross.y).toBeCloseTo(crossThenMap.y, 12);
    expect(mapThenCross.z).toBeCloseTo(crossThenMap.z, 12);
  });
});

describe('localDirectionToGeographic', () => {
  it('matches the UVs THREE.SphereGeometry actually generates', () => {
    // Verification INDEPENDANTE de mon raisonnement : c'est three.js qui definit la verite.
    // On lit les positions ET les UV que la geometrie produit vraiment, et on verifie que
    // la conversion retrouve exactement la meme longitude/latitude. Si three.js changeait
    // sa parametrisation de sphere, ce test tomberait — c'est le seul endroit ou cette
    // hypothese est verifiable hors WebGL.
    const geometry = new THREE.SphereGeometry(1, 32, 16);
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    let checked = 0;
    for (let i = 0; i < position.count; i++) {
      const direction = new THREE.Vector3(
        position.getX(i),
        position.getY(i),
        position.getZ(i)
      );
      // Les poles sont des points singuliers (longitude indefinie) : on les saute.
      if (Math.abs(direction.y) > 0.999) continue;
      const { latitudeDeg, longitudeDeg } =
        localDirectionToGeographic(direction);
      // uv.x = 0 -> 180 W, uv.x = 1 -> 180 E ; la couture (u = 0 et u = 1 au meme point)
      // rend les deux bords equivalents, d'ou la comparaison modulo un tour complet.
      const expectedU = longitudeDeg / 360 + 0.5;
      const deltaU = Math.abs(((uv.getX(i) - expectedU + 1.5) % 1) - 0.5);
      expect(deltaU).toBeLessThan(1e-6);
      // uv.y = 1 au pole Nord.
      expect(uv.getY(i)).toBeCloseTo(latitudeDeg / 180 + 0.5, 6);
      checked++;
    }
    expect(checked).toBeGreaterThan(300);
    geometry.dispose();
  });

  it('places the cardinal directions where an equirectangular map expects them', () => {
    // Consequence directe de la parametrisation verifiee ci-dessus, ecrite en clair pour
    // que le contrat se lise sans derouler la trigonometrie : +X porte le meridien de
    // Greenwich, -X la ligne de changement de date, et la longitude croit vers -Z.
    expect(
      localDirectionToGeographic(new THREE.Vector3(1, 0, 0)).longitudeDeg
    ).toBeCloseTo(0, 9);
    expect(
      Math.abs(
        localDirectionToGeographic(new THREE.Vector3(-1, 0, 0)).longitudeDeg
      )
    ).toBeCloseTo(180, 9);
    expect(
      localDirectionToGeographic(new THREE.Vector3(0, 0, -1)).longitudeDeg
    ).toBeCloseTo(90, 9);
    expect(
      localDirectionToGeographic(new THREE.Vector3(0, 0, 1)).longitudeDeg
    ).toBeCloseTo(-90, 9);
    expect(
      localDirectionToGeographic(new THREE.Vector3(0, 1, 0)).latitudeDeg
    ).toBeCloseTo(90, 9);
  });
});

describe('surfaceRotationForSubsolarLongitude', () => {
  const spinFrameDirection = (
    latitudeDeg: number,
    longitudeDeg: number
  ): THREE.Vector3 => {
    const lat = (latitudeDeg * Math.PI) / 180;
    const phi = ((longitudeDeg / 360 + 0.5) % 1) * 2 * Math.PI;
    return new THREE.Vector3(
      -Math.cos(phi) * Math.cos(lat),
      Math.sin(lat),
      Math.sin(phi) * Math.cos(lat)
    );
  };

  it('lands the subsolar point on the requested longitude', () => {
    // Aller-retour complet : on resout l'angle, on fait tourner le mesh de cet angle, on
    // reexprime la direction du Soleil en coordonnees locales, et on doit retrouver la
    // longitude visee. C'est la propriete dont depend l'alignement des lumieres de ville
    // sur l'ombre.
    for (const sunLatitude of [-23.44, -7, 0, 12.5, 23.44]) {
      for (const sunLongitude of [-179, -90, -1.5, 0, 45.4, 91.8, 178]) {
        for (const targetLongitude of [-175, -60, 0, 33.3, 120]) {
          const sun = spinFrameDirection(sunLatitude, sunLongitude);
          const rotationY = surfaceRotationForSubsolarLongitude(
            sun,
            (targetLongitude * Math.PI) / 180
          );
          // Direction fixe vue depuis un mesh tourne de rotationY autour de +Y.
          const local = sun
            .clone()
            .applyAxisAngle(new THREE.Vector3(0, 1, 0), -rotationY);
          const { latitudeDeg, longitudeDeg } =
            localDirectionToGeographic(local);
          const delta = Math.abs(
            ((longitudeDeg - targetLongitude + 540) % 360) - 180
          );
          expect(delta).toBeLessThan(1e-9);
          // La rotation propre ne peut pas changer la latitude du point subsolaire :
          // elle est fixee par la declinaison, pas par l'heure.
          expect(latitudeDeg).toBeCloseTo(sunLatitude, 9);
        }
      }
    }
  });

  it('differs from an ecliptic-plane composition by the obliquity term', () => {
    // La regression corrigee. L'ancien calcul mesurait l'azimut du Soleil dans le plan XZ
    // de la SCENE (ecliptique) puis le composait avec une longitude EQUATORIALE (RA - GAST).
    // L'ecart resultant est RA - lambda : nul quand le Soleil est a un equinoxe ou a un
    // solstice, extreme entre les deux, et il faisait pivoter continents et lumieres de
    // ville par rapport au terminateur.
    const obliquity = OBLIQUITY_RAD;
    const eclipticToEquatorialRA = (lambdaDeg: number): number => {
      const lambda = (lambdaDeg * Math.PI) / 180;
      return (
        (Math.atan2(Math.cos(obliquity) * Math.sin(lambda), Math.cos(lambda)) *
          180) /
        Math.PI
      );
    };
    // Aux equinoxes et aux solstices, RA et longitude ecliptique coincident : pas d'ecart.
    for (const lambda of [0, 90, 180, 270])
      expect(
        Math.abs(((eclipticToEquatorialRA(lambda) - lambda + 540) % 360) - 180)
      ).toBeLessThan(1e-9);
    // Entre les deux, l'ecart culmine autour de 2.47 degres — l'amplitude exacte du
    // decalage qui etait mesure a l'ecran (+-2.4 degres).
    let worst = 0;
    for (let lambda = 0; lambda < 360; lambda += 0.25)
      worst = Math.max(
        worst,
        Math.abs(((eclipticToEquatorialRA(lambda) - lambda + 540) % 360) - 180)
      );
    expect(worst).toBeGreaterThan(2.4);
    expect(worst).toBeLessThan(2.6);
  });
});
