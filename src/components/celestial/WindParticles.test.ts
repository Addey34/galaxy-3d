import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { WindParticles } from './WindParticles';
import { samplePalette, WIND_DOMAIN, WIND_PALETTE } from '@/core/meteoPalette';
import { geographicToLocalDirection } from '@/core/frames';
import { srgbByteToLinear } from '@/core/srgb';
import { sampleWind, type WindGrid } from '@/core/windField';

/** Champ uniforme (u vers l'est, v vers le nord, en km/h) sur une grille de 10 degrés. */
function uniformGrid(u: number, v: number): WindGrid {
  const nLat = 19;
  const nLon = 36;
  return {
    step: 10,
    latMin: -90,
    lonMin: -180,
    nLat,
    nLon,
    u: new Float32Array(nLat * nLon).fill(u),
    v: new Float32Array(nLat * nLon).fill(v),
  };
}

const OPTIONS = {
  radius: 1.012,
  count: 400,
  speedScale: 0.02,
  lifeSeconds: 4,
  opacity: 0.35,
  size: 0.01,
  maxLat: 80,
  calmKmh: 6,
  trailSeconds: 2,
};

const array = (g: THREE.BufferGeometry, name: string): Float32Array =>
  g.getAttribute(name).array as Float32Array;

/** Tête et queue de la traînée `i`, en repère local. */
function ends(p: WindParticles, i: number): [THREE.Vector3, THREE.Vector3] {
  const t = array(p.trails.geometry, 'position');
  return [
    new THREE.Vector3(t[i * 6], t[i * 6 + 1], t[i * 6 + 2]),
    new THREE.Vector3(t[i * 6 + 3], t[i * 6 + 4], t[i * 6 + 5]),
  ];
}

/** Vecteurs unitaires est et nord au point `head` (repère de `geographicToLocalDirection`). */
function eastNorth(head: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const phi = Math.atan2(head.z, -head.x);
  const lat = Math.asin(head.y / head.length());
  // Dérivées de `geographicToLocalDirection` par rapport à la longitude puis à la latitude.
  const east = new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi));
  const north = new THREE.Vector3(
    Math.cos(phi) * Math.sin(lat),
    Math.cos(lat),
    -Math.sin(phi) * Math.sin(lat)
  );
  return [east, north];
}

/** Quelques pas : les particules ont un âge, donc une opacité (le fondu d'entrée dure 25 % de la vie). */
function warm(p: WindParticles, grid: WindGrid): void {
  for (let i = 0; i < 4; i++) p.update(0.5, grid);
}

const alphaOfHead = (p: WindParticles, i: number): number =>
  array(p.trails.geometry, 'color')[i * 8 + 3]!;

describe('traînées du vent', () => {
  it('suivent le vecteur : la queue est derrière la tête, dans le sens opposé au vent', () => {
    const p = new WindParticles(OPTIONS);
    // Vent vers l'est : la queue est à l'OUEST de la tête, au même niveau de latitude.
    warm(p, uniformGrid(40, 0));
    let checked = 0;
    for (let i = 0; i < OPTIONS.count; i++) {
      if (alphaOfHead(p, i) < 0.3) continue;
      const [head, tail] = ends(p, i);
      const [east, north] = eastNorth(head);
      const d = tail.clone().sub(head);
      expect(d.dot(east)).toBeLessThan(0);
      expect(Math.abs(d.dot(north))).toBeLessThan(0.1 * d.length());
      checked++;
    }
    expect(checked).toBeGreaterThan(20);

    // Vent vers le nord : la queue est au SUD de la tête.
    const q = new WindParticles(OPTIONS);
    warm(q, uniformGrid(0, 40));
    for (let i = 0; i < OPTIONS.count; i++) {
      if (alphaOfHead(q, i) < 0.3) continue;
      const [head, tail] = ends(q, i);
      const [, north] = eastNorth(head);
      expect(tail.clone().sub(head).dot(north)).toBeLessThan(0);
    }
  });

  it("suivent la MÊME convention que l'advection, y compris où cos(lat) est borné", () => {
    // Particules placées de 0° aux limites de la bande (80°) : le plancher cos >= 0,2 joue
    // au-delà de 78,5° et la traînée doit le suivre, pas l'éviter.
    const lats = [0, 30, 60, 75, 78, 79, 79.5, -79.5, -78.5];
    const p = new WindParticles({ ...OPTIONS, count: lats.length });
    const internals = p as unknown as {
      lat: Float32Array;
      lon: Float32Array;
      age: Float32Array;
      life: Float32Array;
    };
    lats.forEach((lat, i) => {
      internals.lat[i] = lat;
      internals.lon[i] = 10;
      internals.age[i] = 2;
      internals.life[i] = 100;
    });
    const u = 30;
    const v = 0;
    const dt = 0.1;
    // Latitude avant le pas : la convention de l'advection lit cos(lat) AVANT de déplacer.
    const before = Array.from(internals.lat);
    p.update(dt, uniformGrid(u, v));
    const kTrail = OPTIONS.speedScale * OPTIONS.trailSeconds;
    lats.forEach((_, i) => {
      const cosLat = Math.max(0.2, Math.cos((before[i]! * Math.PI) / 180));
      const dLon = (kTrail * u) / cosLat;
      const tail = geographicToLocalDirection(
        internals.lat[i]! - kTrail * v,
        internals.lon[i]! - dLon
      ).multiplyScalar(OPTIONS.radius);
      const [, got] = ends(p, i);
      expect(got.distanceTo(tail)).toBeLessThan(1e-5);
    });
  });

  it("n'en garde aucune ancienne direction quand le champ change", () => {
    const p = new WindParticles(OPTIONS);
    warm(p, uniformGrid(50, 0)); // vent d'est : queues à l'ouest
    // Nouveau champ : vent du sud (vers le nord). Un seul pas suffit, sans mémoire.
    p.update(0.05, uniformGrid(0, 50));
    let checked = 0;
    for (let i = 0; i < OPTIONS.count; i++) {
      if (alphaOfHead(p, i) < 0.05) continue;
      const [head, tail] = ends(p, i);
      const [east, north] = eastNorth(head);
      const d = tail.clone().sub(head);
      expect(d.dot(north)).toBeLessThan(0);
      // Plus aucune composante est-ouest : la direction d'avant n'a pas survécu.
      expect(Math.abs(d.dot(east))).toBeLessThan(0.05 * d.length());
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
    // Et un champ calme efface toute traînée, du même pas.
    p.update(0.05, uniformGrid(0, 0));
    for (let i = 0; i < OPTIONS.count; i++) {
      const [head, tail] = ends(p, i);
      expect(head.distanceTo(tail)).toBe(0);
    }
  });

  it('proportionnelles à la vitesse : deux fois plus vite, deux fois plus longues', () => {
    const lengthAt = (speed: number): number => {
      const p = new WindParticles(OPTIONS);
      warm(p, uniformGrid(speed, 0));
      let sum = 0;
      let n = 0;
      for (let i = 0; i < OPTIONS.count; i++) {
        if (alphaOfHead(p, i) < 0.3) continue;
        const [head, tail] = ends(p, i);
        sum += head.angleTo(tail);
        n++;
      }
      return sum / n;
    };
    expect(lengthAt(60) / lengthAt(30)).toBeCloseTo(2, 1);
  });

  it('nulles au calme : rien de dessiné, aucun mouvement inventé', () => {
    const p = new WindParticles(OPTIONS);
    p.update(0.5, uniformGrid(0, 0));
    for (let i = 0; i < OPTIONS.count; i++) {
      const [head, tail] = ends(p, i);
      expect(head.distanceTo(tail)).toBe(0);
      expect(alphaOfHead(p, i)).toBe(0);
    }
  });

  it('ne laissent aucun segment après un ré-ensemencement', () => {
    const p = new WindParticles(OPTIONS);
    p.update(0.5, uniformGrid(60, 20));
    // Un pas plus long que toute durée de vie : chaque particule est ré-ensemencée.
    p.update(1000, uniformGrid(60, 20));
    for (let i = 0; i < OPTIONS.count; i++) {
      const [head, tail] = ends(p, i);
      expect(head.distanceTo(tail)).toBe(0);
      expect(alphaOfHead(p, i)).toBe(0);
    }
  });

  it("ne traversent pas le globe à l'antiméridien", () => {
    const p = new WindParticles({ ...OPTIONS, count: 4 });
    const internals = p as unknown as {
      lat: Float32Array;
      lon: Float32Array;
      age: Float32Array;
      life: Float32Array;
    };
    for (let i = 0; i < 4; i++) {
      internals.lat[i] = i % 2 === 0 ? 0 : 60;
      internals.lon[i] = i < 2 ? 179.99 : -179.99;
      internals.age[i] = 1;
      internals.life[i] = 100;
    }
    // Vent d'est fort : la tête passe de 179,95 à -180,x, la queue reste de l'autre côté.
    p.update(0.5, uniformGrid(80, 0));
    for (let i = 0; i < 4; i++) {
      const [head, tail] = ends(p, i);
      // Une corde entre deux longitudes enroulées ferait ~2 rayons ; une traînée fait ~3°.
      expect(head.angleTo(tail) * (180 / Math.PI)).toBeLessThan(3.5);
      expect(head.length()).toBeCloseTo(OPTIONS.radius, 5);
      expect(tail.length()).toBeCloseTo(OPTIONS.radius, 5);
    }
  });

  it("reste sur la sphère aux latitudes extrêmes de l'advection", () => {
    const p = new WindParticles({ ...OPTIONS, count: 2 });
    const internals = p as unknown as { lat: Float32Array; life: Float32Array };
    internals.lat[0] = 79.9;
    internals.lat[1] = -79.9;
    internals.life[0] = internals.life[1] = 100;
    p.update(0.016, uniformGrid(100, 100));
    for (let i = 0; i < 2; i++) {
      const [head, tail] = ends(p, i);
      expect(Number.isFinite(tail.x + tail.y + tail.z)).toBe(true);
      expect(tail.length()).toBeCloseTo(head.length(), 5);
    }
  });

  it('sans traînée (trailSeconds = 0), les points seuls', () => {
    const p = new WindParticles({ ...OPTIONS, trailSeconds: 0 });
    expect(p.trails.visible).toBe(false);
  });
});

describe('couleur du vent', () => {
  it('écrit les sommets en LINÉAIRE, depuis la palette de la légende', () => {
    const speed = 85;
    const p = new WindParticles(OPTIONS);
    warm(p, uniformGrid(speed, 0));
    const t = (speed - WIND_DOMAIN.min) / (WIND_DOMAIN.max - WIND_DOMAIN.min);
    const rgb = samplePalette(WIND_PALETTE, t);
    const expected = rgb.map((c) => srgbByteToLinear(c));
    const colors = array(p.trails.geometry, 'color');
    const heads = array(p.points.geometry, 'color');
    let checked = 0;
    for (let i = 0; i < OPTIONS.count; i++) {
      if (alphaOfHead(p, i) === 0) continue;
      for (let c = 0; c < 3; c++) {
        expect(colors[i * 8 + c]).toBeCloseTo(expected[c]!, 5);
        expect(colors[i * 8 + 4 + c]).toBeCloseTo(expected[c]!, 5);
        expect(heads[i * 3 + c]).toBeCloseTo(expected[c]!, 5);
      }
      // La queue s'éteint toujours.
      expect(colors[i * 8 + 7]).toBe(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
    // 85 km/h reste JAUNE : bleu nettement sous le rouge (octets /255 encodés deux fois : gris).
    expect(expected[2]! / expected[0]!).toBeLessThan(0.2);
  });
});

describe('ressources', () => {
  it('libère les deux géométries et les deux matériaux', () => {
    const p = new WindParticles(OPTIONS);
    const spies = [
      vi.spyOn(p.points.geometry, 'dispose'),
      vi.spyOn(p.trails.geometry, 'dispose'),
      vi.spyOn(p.points.material as THREE.Material, 'dispose'),
      vi.spyOn(p.trails.material as THREE.Material, 'dispose'),
    ];
    p.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it('attache les traînées aux têtes : une seule visibilité pour les deux', () => {
    const p = new WindParticles(OPTIONS);
    expect(p.trails.parent).toBe(p.points);
  });
});

describe('variantes avec objet de sortie', () => {
  it('sampleWind(out) rend EXACTEMENT les mêmes valeurs, sur tout un balayage', () => {
    const nLat = 7;
    const nLon = 12;
    const grid: WindGrid = {
      step: 30,
      latMin: -90,
      lonMin: -180,
      nLat,
      nLon,
      u: Float32Array.from({ length: nLat * nLon }, (_, i) => Math.sin(i) * 40),
      v: Float32Array.from(
        { length: nLat * nLon },
        (_, i) => Math.cos(i * 3) * 25
      ),
    };
    const out = { u: 0, v: 0 };
    let n = 0;
    for (let lat = -95; lat <= 95; lat += 7.3) {
      for (let lon = -200; lon <= 200; lon += 9.1) {
        const a = sampleWind(grid, lat, lon);
        const b = sampleWind(grid, lat, lon, out);
        expect(b).toBe(out);
        expect(b.u).toBe(a.u);
        expect(b.v).toBe(a.v);
        n++;
      }
    }
    expect(n).toBeGreaterThan(1000);
  });

  it('samplePalette(out) rend exactement le même résultat et ne touche jamais un arrêt', () => {
    const snapshot = JSON.stringify(WIND_PALETTE.stops);
    const out: [number, number, number] = [0, 0, 0];
    for (let i = 0; i <= 400; i++) {
      const t = -0.1 + (i / 400) * 1.2; // déborde des deux côtés (clampé)
      const plain = [...samplePalette(WIND_PALETTE, t)];
      const withOut = samplePalette(WIND_PALETTE, t, out);
      expect(withOut).toBe(out);
      expect([...withOut]).toEqual(plain);
      for (const stop of WIND_PALETTE.stops) expect(withOut).not.toBe(stop.rgb);
      // L'appelant écrase `out` : la palette partagée ne doit pas bouger.
      out[0] = out[1] = out[2] = -1;
    }
    expect(JSON.stringify(WIND_PALETTE.stops)).toBe(snapshot);
  });
});
