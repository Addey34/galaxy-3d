import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  heightTilePath,
  parseHeightManifest,
  SURFACE_HEIGHT_SETS,
  type HeightManifest,
} from './surfaceHeights';
import { decodeHeightTile, heightMetresAt } from '@/core/heightTile';
import {
  heightTileFor,
  heightWindow,
  patchSegments,
} from '@/core/heightPyramid';
import { buildTilePatch } from '@/core/tilePatch';
import { tileBounds, tileMatrix } from '@/core/tilePyramid';
import { CELESTIAL_CONFIG } from './bodies';
import { flattenBodies } from './catalog';
import { bodyFigure, figureRadiiKm } from './bodyFigure';

/**
 * LES TUILES DE HAUTEURS LIVRÉES SONT-ELLES CE QUE LE MANIFESTE ANNONCE ?
 *
 * Ces fichiers sont cuits par `pnpm surface:tiles` depuis un modèle d'élévation publié, puis
 * COMMITÉS : rien ne les revérifie à la construction du site. Un défaut de cuisson (mauvais
 * quantum, longitude décalée d'un demi-pixel, pôle en étoile) se verrait comme un relief
 * plausible mais faux, et personne ne saurait dire que c'est faux sans mesurer.
 *
 * Ce fichier mesure donc trois choses sur les octets RÉELLEMENT livrés : la cohérence interne
 * (en-têtes, continuité des bords, pôle unique), l'accord avec le manifeste que l'application
 * lit, et enfin l'accord avec des altitudes PUBLIÉES — la profondeur de Tycho et la hauteur de
 * son pic central, telles que l'équipe LROC les publie.
 */

const ROOT = resolve(import.meta.dirname, '../..');

/** Tous les jeux déclarés, un par grille d'imagerie (la Terre en a deux, lot 48). */
const ALL_SETS = [...SURFACE_HEIGHT_SETS.values()].flat();
const setById = (id: string) => ALL_SETS.find((set) => set.id === id)!;

function loadManifest(path: string): HeightManifest {
  return parseHeightManifest(
    JSON.parse(readFileSync(resolve(ROOT, 'public', path), 'utf-8'))
  );
}

/**
 * Une tuile LIVRÉE. Servie par le site, elle est dans `public/` ; servie ailleurs (la Terre, sur
 * le service de données), seules ses TÉMOINS sont dans le dépôt, sous le même chemin haché, copiés
 * par le cuiseur : un témoin d'une cuisson périmée ne se trouve plus.
 */
function loadTile(
  manifest: HeightManifest,
  index: { level: number; row: number; column: number }
) {
  const path = heightTilePath(manifest, index).slice(
    manifest.tileOrigin.length + 1
  );
  const file = manifest.tileOrigin
    ? resolve(ROOT, 'src/config/heightWitnesses', path)
    : resolve(ROOT, 'public', path);
  const bytes = readFileSync(file);
  return decodeHeightTile(
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer,
    index
  );
}

describe('jeux de hauteurs déclarés', () => {
  it('ne déclare que des corps du catalogue', () => {
    const bodies = new Set(
      [...flattenBodies(CELESTIAL_CONFIG)].map(([name]) => name)
    );
    for (const [body] of SURFACE_HEIGHT_SETS) expect(bodies).toContain(body);
  });

  it('pointe un manifeste réellement livré', () => {
    for (const set of ALL_SETS)
      expect(
        existsSync(resolve(ROOT, 'public', set.manifestPath)),
        `${set.manifestPath} absent : le relief serait annoncé et jamais servi`
      ).toBe(true);
  });
});

describe('tuiles de hauteurs de la Lune', () => {
  const set = setById('moon-lola-ldem');
  const manifest = loadManifest(set.manifestPath);

  it('décrit un socle global et des aires nommées', () => {
    const global = manifest.coverage.filter((entry) => !entry.bounds);
    expect(global).toHaveLength(1);
    expect(global[0]!.levels).toEqual([manifest.baseLevel]);
    const named = manifest.coverage.filter((entry) => entry.bounds);
    expect(named.length).toBeGreaterThanOrEqual(2);
    for (const entry of named) expect(entry.areaName).toBeTruthy();
  });

  it('porte dans chaque fichier le quantum et l’offset du manifeste', () => {
    // Le décodeur ne lit QUE le fichier : si les deux divergeaient, l'application afficherait
    // un relief à une autre échelle que celle que le manifeste annonce.
    for (const index of [
      { level: 4, row: 0, column: 0 },
      { level: 4, row: 7, column: 21 },
      { level: 8, row: 189, column: 240 },
    ]) {
      const tile = loadTile(manifest, index);
      expect(tile.quantumMetres).toBe(manifest.quantumMetres);
      expect(tile.offsetMetres).toBe(manifest.offsetMetres);
      expect(tile.samples).toBe(manifest.samples);
    }
  });

  it('donne au pôle UNE seule altitude, partagée par toutes ses tuiles', () => {
    // Sans cette règle, chaque tuile polaire donnerait à son sommet dégénéré la moyenne de sa
    // portion de longitude : le pôle deviendrait une étoile à 32 branches.
    const values = new Set<number>();
    for (let column = 0; column < 32; column += 1) {
      const tile = loadTile(manifest, { level: 4, row: 0, column });
      for (let x = 0; x < tile.samples; x += 37)
        values.add(heightMetresAt(tile, x, 0));
    }
    expect(values.size).toBe(1);
  });

  it('partage exactement ses bords avec ses voisines', () => {
    // C'est ce qui garantit qu'aucune fissure n'apparaît entre deux carreaux de même niveau,
    // sans aucune couture à coudre : le registre GRILLE fait que le bord EST commun.
    const centre = loadTile(manifest, { level: 4, row: 7, column: 21 });
    const east = loadTile(manifest, { level: 4, row: 7, column: 22 });
    const south = loadTile(manifest, { level: 4, row: 8, column: 21 });
    const n = centre.samples;
    for (let y = 0; y < n; y += 1)
      expect(heightMetresAt(centre, n - 1, y)).toBe(heightMetresAt(east, 0, y));
    for (let x = 0; x < n; x += 1)
      expect(heightMetresAt(centre, x, n - 1)).toBe(
        heightMetresAt(south, x, 0)
      );
  });

  it('reste dans les altitudes que le manifeste annonce', () => {
    const tile = loadTile(manifest, { level: 8, row: 189, column: 240 });
    for (let i = 0; i < tile.values.length; i += 97) {
      const metres = tile.offsetMetres + tile.values[i]! * tile.quantumMetres;
      expect(metres).toBeGreaterThanOrEqual(manifest.minElevationMetres);
      expect(metres).toBeLessThanOrEqual(manifest.maxElevationMetres);
    }
  });

  it('livre EXACTEMENT les tuiles que le manifeste compte, et pas plus lourd', () => {
    // Le poids est ce qui a décidé de la forme de ce lot : Firebase facture le stockage sur la
    // SOMME des versions retenues, le quota est de 10 Go, et il a déjà sauté une fois
    // (`hostingPayload.test.ts`). Cuire le socle un niveau plus fin multiplierait ce chiffre par
    // quatre sans qu'aucun test ne bronche ; celui-ci bronche.
    const raw = JSON.parse(
      readFileSync(resolve(ROOT, 'public', set.manifestPath), 'utf-8')
    ) as { tiles: number; bytes: number; directory: string };
    const directory = resolve(ROOT, 'public', raw.directory);
    const files: string[] = [];
    const walk = (path: string): void => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const full = resolve(path, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.hgt')) files.push(full);
      }
    };
    walk(directory);
    expect(files.length, 'tuiles livrées ≠ tuiles annoncées').toBe(raw.tiles);
    const bytes = files.reduce((total, file) => total + statSync(file).size, 0);
    expect(bytes, 'poids livré ≠ poids annoncé').toBe(raw.bytes);
    // 150 Mo : le jeu livré en pèse 84,2, et ce plafond laisse de la place pour un second corps
    // sans laisser passer un socle cuit un niveau trop fin (268 Mo).
    expect(bytes / 1e6).toBeLessThan(150);
  });

  it('ne pèse pas plus que ce que le manifeste déclare', () => {
    // Le poids est le vrai sujet de cette phase : 10 Go de quota d'hébergement, et une copie
    // par version retenue.
    const sample = statSync(
      resolve(
        ROOT,
        'public',
        heightTilePath(manifest, { level: 4, row: 7, column: 21 }).slice(1)
      )
    ).size;
    expect(sample).toBe(32 + manifest.samples * manifest.samples * 2);
  });
});

/**
 * DEUX CARREAUX VOISINS SE TOUCHENT-ILS ?
 *
 * Le chemin complet — fiche, manifeste, tuile livrée, fenêtre d'échantillons, maillage — est
 * rejoué ici sur les octets RÉELS, pour deux carreaux d'imagerie côte à côte. Si leurs bords ne
 * coïncidaient pas, une fissure courrait le long de chaque carreau, et rien dans les tests
 * unitaires des modules purs ne l'attraperait : chacun est juste, c'est leur composition qui ne
 * le serait pas.
 */
describe('bords partagés, par le chemin du moteur', () => {
  const set = setById('moon-lola-ldem');
  const manifest = loadManifest(set.manifestPath);
  const RADIUS = 0.27;
  const RADIUS_KM = 1737.4;
  const unitsPerKm = RADIUS / RADIUS_KM;

  /** Ce que le moteur fait d'un carreau d'imagerie : hauteurs, fenêtre, maillage. */
  function patchFor(imagery: { level: number; row: number; column: number }) {
    const source = heightTileFor(imagery, manifest.coverage)!;
    const tile = loadTile(manifest, source.index);
    const window = heightWindow(imagery, source.index, manifest.samples)!;
    const segments = patchSegments(window.span, 32);
    const step = window.span / segments;
    const apron = segments + 3;
    const values = new Float32Array(apron * apron);
    for (let j = -1; j <= segments + 1; j += 1)
      for (let i = -1; i <= segments + 1; i += 1)
        values[(j + 1) * apron + (i + 1)] =
          (heightMetresAt(tile, window.x0 + i * step, window.y0 + j * step) /
            1000) *
          unitsPerKm;
    return {
      geometry: buildTilePatch({
        bounds: tileBounds(imagery),
        radius: RADIUS,
        segments,
        heights: { values, segments },
      }),
      segments,
      level: source.index.level,
    };
  }

  it('fait coïncider le bord est de l’un et le bord ouest de l’autre', () => {
    const left = patchFor({ level: 6, row: 24, column: 110 });
    const right = patchFor({ level: 6, row: 24, column: 111 });
    const side = left.segments + 1;
    let worst = 0;
    for (let j = 0; j < side; j += 1) {
      const a = (j * side + side - 1) * 3;
      const b = j * side * 3;
      worst = Math.max(
        worst,
        Math.hypot(
          left.geometry.positions[a]! - right.geometry.positions[b]!,
          left.geometry.positions[a + 1]! - right.geometry.positions[b + 1]!,
          left.geometry.positions[a + 2]! - right.geometry.positions[b + 2]!
        )
      );
    }
    // Converti en mètres au sol : un écart d'un mètre serait déjà une fissure visible de près.
    expect((worst / unitsPerKm) * 1000).toBeLessThan(1);
  });

  it('fait coïncider le bord sud de l’un et le bord nord de l’autre', () => {
    const north = patchFor({ level: 6, row: 24, column: 110 });
    const south = patchFor({ level: 6, row: 25, column: 110 });
    const side = north.segments + 1;
    let worst = 0;
    for (let i = 0; i < side; i += 1) {
      const a = ((side - 1) * side + i) * 3;
      const b = i * 3;
      worst = Math.max(
        worst,
        Math.hypot(
          north.geometry.positions[a]! - south.geometry.positions[b]!,
          north.geometry.positions[a + 1]! - south.geometry.positions[b + 1]!,
          north.geometry.positions[a + 2]! - south.geometry.positions[b + 2]!
        )
      );
    }
    expect((worst / unitsPerKm) * 1000).toBeLessThan(1);
  });
});

/**
 * CONFRONTATION À DES ALTITUDES PUBLIÉES.
 *
 * Source : « Tycho Central Peak Spectacular! », Mark Robinson, équipe LROC (Arizona State
 * University), 29 juin 2011, qui écrit « The summit of the central peak is 2 km (6562 ft) above
 * the crater floor » et « the crater floor is about 4700 m (15,420 ft) below the rim », pour un
 * cratère « ~82 km (51 miles) in diameter » situé « at 43.37°S, 348.68°E ».
 *
 * On mesure la même chose sur les tuiles livrées, avec des définitions ÉCRITES ici : le rempart
 * est la moyenne, sur l'azimut, du point le plus haut de la couronne 0,85 à 1,15 rayon ; le
 * plancher est la médiane de la couronne 0,30 à 0,65 rayon ; le pic est le point le plus haut du
 * disque central 0,15 rayon. Les fourchettes acceptées tiennent compte de ce que ces définitions
 * ne sont pas celles de l'auteur, qui ne les publie pas.
 */
describe('profondeur de Tycho, contre la mesure publiée par l’équipe LROC', () => {
  const set = setById('moon-lola-ldem');
  const manifest = loadManifest(set.manifestPath);
  const cache = new Map<string, ReturnType<typeof loadTile>>();

  const CENTRE = { latitudeDeg: -43.37, longitudeDeg: 348.68 - 360 };
  const RADIUS_KM = 82 / 2;

  /** Altitude en un point, au niveau le plus fin qui le couvre. */
  function elevationAt(latitudeDeg: number, longitudeDeg: number): number {
    const columns = 2 * 2 ** 8;
    const rows = 2 ** 8;
    const imagery = {
      level: 8,
      row: Math.floor(((90 - latitudeDeg) / 180) * rows),
      column: Math.floor(((longitudeDeg + 180) / 360) * columns),
    };
    const source = heightTileFor(imagery, manifest.coverage)!;
    const key = `${source.index.level}/${source.index.row}/${source.index.column}`;
    let tile = cache.get(key);
    if (!tile) {
      tile = loadTile(manifest, source.index);
      cache.set(key, tile);
    }
    const bounds = tileBounds(source.index);
    const x =
      ((longitudeDeg - bounds.west) / (bounds.east - bounds.west)) *
      (tile.samples - 1);
    const y =
      ((bounds.north - latitudeDeg) / (bounds.north - bounds.south)) *
      (tile.samples - 1);
    return heightMetresAt(tile, Math.round(x), Math.round(y));
  }

  /** Point à `rangeKm` du centre, dans l'azimut donné (navigation sphérique). */
  function offset(rangeKm: number, azimuthDeg: number): [number, number] {
    const angular = rangeKm / manifest.datumRadiusKm;
    const azimuth = (azimuthDeg * Math.PI) / 180;
    const lat = (CENTRE.latitudeDeg * Math.PI) / 180;
    const lon = (CENTRE.longitudeDeg * Math.PI) / 180;
    const lat2 = Math.asin(
      Math.sin(lat) * Math.cos(angular) +
        Math.cos(lat) * Math.sin(angular) * Math.cos(azimuth)
    );
    const lon2 =
      lon +
      Math.atan2(
        Math.sin(azimuth) * Math.sin(angular) * Math.cos(lat),
        Math.cos(angular) - Math.sin(lat) * Math.sin(lat2)
      );
    return [(lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI];
  }

  const rim: number[] = [];
  const floor: number[] = [];
  let peak = Number.NEGATIVE_INFINITY;
  for (let azimuth = 0; azimuth < 360; azimuth += 4) {
    let highest = Number.NEGATIVE_INFINITY;
    for (let r = 0.85 * RADIUS_KM; r <= 1.15 * RADIUS_KM; r += 0.5)
      highest = Math.max(highest, elevationAt(...offset(r, azimuth)));
    rim.push(highest);
    for (let r = 0.3 * RADIUS_KM; r <= 0.65 * RADIUS_KM; r += 0.5)
      floor.push(elevationAt(...offset(r, azimuth)));
  }
  for (let r = 0; r <= 0.15 * RADIUS_KM; r += 0.5)
    for (let azimuth = 0; azimuth < 360; azimuth += 10)
      peak = Math.max(peak, elevationAt(...offset(r, azimuth)));

  const mean = rim.reduce((total, value) => total + value, 0) / rim.length;
  const sorted = [...floor].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;

  it('trouve un plancher à environ 4 700 m sous le rempart', () => {
    expect(mean - median).toBeGreaterThan(4000);
    expect(mean - median).toBeLessThan(5400);
  });

  it('trouve un pic central à environ 2 km au-dessus du plancher', () => {
    expect(peak - median).toBeGreaterThan(1600);
    expect(peak - median).toBeLessThan(2600);
  });

  it('place le cratère au bon endroit : son plancher est SOUS ses alentours', () => {
    // Une longitude décalée de 180° ou une latitude inversée rendrait un relief parfaitement
    // plausible ailleurs : cette comparaison est ce qui l'attrape. On prend une COURONNE
    // complète à 2,2 rayons, parce qu'un seul azimut tombe sur des éjectas dont l'altitude
    // varie de plus d'un kilomètre.
    const around: number[] = [];
    for (let azimuth = 0; azimuth < 360; azimuth += 10)
      around.push(elevationAt(...offset(2.2 * RADIUS_KM, azimuth)));
    const outside =
      around.reduce((total, value) => total + value, 0) / around.length;
    expect(median).toBeLessThan(outside - 1500);
  });
});

describe('le relief et le globe rendu décrivent la MÊME figure (ligne 45.3)', () => {
  const bodies = flattenBodies(CELESTIAL_CONFIG);

  it.each(ALL_SETS.map((set) => [set.id, set] as const))(
    '%s : le cuiseur a supposé le globe que l’application dessine',
    (_id, set) => {
      const body = set.body;
      const manifest = loadManifest(set.manifestPath);
      const radiusKm = bodies.get(body)!.realData!.radiusKm!;
      // Le cuiseur recopie la règle de `bodyFigure` (il ne lit pas de TypeScript) : c'est ici
      // qu'une divergence se verrait, avant qu'une enveloppe ne passe au-dessus du relief.
      expect(manifest.figure.renderRadiusKm).toBeCloseTo(radiusKm, 9);
      const figure = bodyFigure(body, radiusKm);
      if (figure === null) {
        expect(manifest.figure.radiiKm).toBeNull();
      } else {
        expect(manifest.figure.radiiKm).toEqual(figureRadiiKm(body));
      }
      expect(manifest.figureFloorRatio).toBeGreaterThan(0.9);
      expect(manifest.figureFloorRatio).toBeLessThanOrEqual(1);
    }
  );
});

describe('le relief LIVRÉ tombe sur la forme publiée du corps (ligne 45.3)', () => {
  const bodies = flattenBodies(CELESTIAL_CONFIG);
  /**
   * Le rayon mesuré aux deux pôles, comparé au rayon POLAIRE du globe rendu (le demi-axe c de
   * l'ellipsoïde, ou le rayon de la sphère). Le relief de Mars livré jusqu'au 2026-10-09 venait
   * de MEGT, des hauteurs rapportées à l'aréoïde : posé sur la sphère de 3 396 km, son pôle nord
   * tombait à environ 3 394 km, 18 km au-dessus du demi-axe polaire publié (3 376,2 km). Aucun
   * test ne regardait le rayon ; celui-ci l'aurait vu.
   *
   * La tolérance est PHYSIQUE, pas un réglage : 10 km couvre les calottes et les bassins polaires
   * réels (Cérès : +3 km au nord, Mars : quelques km de calotte), pas un aplatissement oublié.
   */
  const POLAR_TOLERANCE_KM = 10;

  it.each(ALL_SETS.map((set) => [set.id, set] as const))(
    '%s : rayon mesuré aux deux pôles près du rayon polaire rendu',
    (_id, set) => {
      const body = set.body;
      const manifest = loadManifest(set.manifestPath);
      const radiusKm = bodies.get(body)!.realData!.radiusKm!;
      const radii = figureRadiiKm(body);
      const polarKm = bodyFigure(body, radiusKm) && radii ? radii[2] : radiusKm;
      const level = manifest.baseLevel;
      const { rows } = tileMatrix(level, manifest.matrix);
      for (const row of [0, rows - 1]) {
        const tile = loadTile(manifest, { level, row, column: 0 });
        const y = row === 0 ? 0 : tile.samples - 1;
        const poleKm =
          manifest.datumRadiusKm + heightMetresAt(tile, 0, y) / 1000;
        expect(
          Math.abs(poleKm - polarKm),
          `${body} pôle ${row === 0 ? 'nord' : 'sud'} : ${poleKm.toFixed(1)} km contre ${polarKm} km`
        ).toBeLessThan(POLAR_TOLERANCE_KM);
      }
    }
  );
});

describe('relief de la Terre : l’eau à son niveau, sur les témoins LIVRÉS (lot 48)', () => {
  const set = setById('earth-etopo-2022');
  const manifest = loadManifest(set.manifestPath);
  const raw = JSON.parse(
    readFileSync(resolve(ROOT, 'public', set.manifestPath), 'utf-8')
  ) as {
    geoid: { minimumMetres: number; maximumMetres: number };
    water: {
      dryLand: { lowestFlatWaterMetres: number };
      bodies: {
        kind: string;
        latitudeDeg: number;
        longitudeDeg: number;
        levelMetres: number;
      }[];
    };
  };
  const [a, b, c] = figureRadiiKm('earth')!;

  /** Hauteur au-dessus de l'ellipsoïde RENDU, en mètres, pour chaque échantillon de la tuile. */
  function ellipsoidHeights(
    index: { level: number; row: number; column: number },
    keep: (latitude: number, longitude: number) => boolean = () => true
  ) {
    const tile = loadTile(manifest, index);
    const bounds = tileBounds(index, manifest.matrix);
    const out: { latitude: number; metres: number }[] = [];
    for (let y = 0; y < tile.samples; y += 1)
      for (let x = 0; x < tile.samples; x += 1) {
        const latitude =
          bounds.north -
          ((bounds.north - bounds.south) * y) / (tile.samples - 1);
        const longitude =
          bounds.west + ((bounds.east - bounds.west) * x) / (tile.samples - 1);
        if (!keep(latitude, longitude)) continue;
        const phi = (latitude * Math.PI) / 180;
        const lambda = (longitude * Math.PI) / 180;
        const ux = Math.cos(phi) * Math.cos(lambda);
        const uy = Math.cos(phi) * Math.sin(lambda);
        const uz = Math.sin(phi);
        const ellipsoidKm =
          1 / Math.sqrt((ux / a) ** 2 + (uy / b) ** 2 + (uz / c) ** 2);
        out.push({
          latitude,
          metres:
            (manifest.datumRadiusKm - ellipsoidKm) * 1000 +
            heightMetresAt(tile, x, y),
        });
      }
    return out;
  }
  const lowest = (index: { level: number; row: number; column: number }) =>
    Math.min(...ellipsoidHeights(index).map((s) => s.metres));
  const level = (kind: string, latitude: number, longitude: number) =>
    raw.water.bodies.find(
      (body) =>
        body.kind === kind &&
        Math.abs(body.latitudeDeg - latitude) < 1 &&
        Math.abs(body.longitudeDeg - longitude) < 1
    )!.levelMetres;

  it('cuit un relief par grille d’imagerie, et le même relief sur chacune', () => {
    // GIBS (10 × 5 au niveau 3) et EOX (Trek, 2 × 1 au niveau 0) : sur la mauvaise grille, le même
    // indice tombe ailleurs. Les deux jeux viennent de la MÊME source et de la MÊME règle de l'eau.
    const trek = loadManifest(setById('earth-etopo-2022-trek').manifestPath);
    expect(trek.matrix).toMatchObject({
      columnsAtLevelZero: 2,
      rowsAtLevelZero: 1,
      referenceLevel: 0,
    });
    expect(trek.tileOrigin).toBe(manifest.tileOrigin);
    expect(trek.datumRadiusKm).toBe(manifest.datumRadiusKm);
    expect(
      SURFACE_HEIGHT_SETS.get('earth')!
        .map((set) => set.id)
        .sort()
    ).toEqual(['earth-etopo-2022', 'earth-etopo-2022-trek']);
  });

  it('suit la grille de son imagerie GIBS, et ses tuiles sont servies par le service de données', () => {
    expect(manifest.matrix).toMatchObject({
      columnsAtLevelZero: 10,
      rowsAtLevelZero: 5,
      referenceLevel: 3,
    });
    expect(manifest.tileOrigin).toBe('https://galaxy-data.adrianguichard.dev');
    expect(manifest.coverage[0]!.levels).toEqual([3, 4, 5, 6]);
  });

  it('borne la terre sèche par la plus basse surface d’eau plate, celle de la mer Morte', () => {
    expect(raw.water.dryLand.lowestFlatWaterMetres).toBeLessThan(-400);
    expect(raw.water.dryLand.lowestFlatWaterMetres).toBeGreaterThan(-450);
  });

  it('ramène la Caspienne à son niveau : son centre n’est plus le fond publié', () => {
    // Sans la règle, ETOPO y donne −448 m (le fond) ; avec elle, le niveau de l'eau à l'écart du
    // géoïde près. Le MINIMUM de la tuile ne dirait rien : la dépression de Karagiye, une vraie
    // terre, y descend plus bas que le lac.
    const at = level('sea-arm', 41.76, 50.79);
    const centre = ellipsoidHeights(
      { level: 6, row: 10, column: 51 },
      (latitude, longitude) =>
        Math.abs(latitude - 42) < 0.1 && Math.abs(longitude - 51) < 0.1
    );
    expect(centre.length).toBeGreaterThan(0);
    for (const sample of centre) {
      expect(sample.metres).toBeGreaterThanOrEqual(
        at + raw.geoid.minimumMetres - 1
      );
      expect(sample.metres).toBeLessThanOrEqual(
        at + raw.geoid.maximumMetres + 1
      );
    }
  });

  it('ne laisse aucune fosse dans la tuile du lac Supérieur, ni au large ni sur la rive', () => {
    // Le fond publié y descend à −198 m ; un anneau de rive que le masque dit « terre » gardait
    // encore 52 m. Rien dans cette tuile n'est plus bas que le plus bas des lacs qu'elle porte
    // (Michigan-Huron), à l'écart du géoïde près.
    const lakes = Math.min(
      level('great-lake', 47.52, -87.75),
      level('great-lake', 44.48, -84.45)
    );
    expect(lowest({ level: 6, row: 9, column: 20 })).toBeGreaterThanOrEqual(
      lakes + raw.geoid.minimumMetres - 1
    );
  });

  it('garde la mer Morte à sa surface publiée, plus basse que toute terre de sa tuile', () => {
    const floor = lowest({ level: 6, row: 13, column: 47 });
    const surface = raw.water.dryLand.lowestFlatWaterMetres;
    expect(floor).toBeGreaterThanOrEqual(surface + raw.geoid.minimumMetres - 1);
    expect(floor).toBeLessThanOrEqual(surface + raw.geoid.maximumMetres + 1);
  });

  it('porte l’Himalaya dans la tuile de l’Everest', () => {
    // À 60″ (1,85 km) le sommet est lissé : on n'attend pas 8 849 m, seulement un massif.
    const highest = Math.max(
      ...ellipsoidHeights({ level: 6, row: 13, column: 59 }).map(
        (s) => s.metres
      )
    );
    expect(highest).toBeGreaterThan(7000);
  });
});

describe('le relief se choisit par la grille de l’imagerie (lot 48)', () => {
  it('rend le jeu de la même grille, et aucun d’une autre', async () => {
    const { heightsForGrid, loadBodyHeights } =
      await import('./surfaceHeights');
    const loaded = await loadBodyHeights(
      'earth',
      (message) => {
        throw new Error(message);
      },
      async (path) =>
        JSON.parse(
          readFileSync(resolve(ROOT, 'public', path.slice(1)), 'utf-8')
        )
    );
    expect(loaded).toHaveLength(2);
    const gibs = {
      columnsAtLevelZero: 10,
      rowsAtLevelZero: 5,
      tileSizePx: 512,
      referenceLevel: 3,
    };
    const trek = { columnsAtLevelZero: 2, rowsAtLevelZero: 1, tileSizePx: 256 };
    expect(heightsForGrid(loaded, gibs)?.set.id).toBe('earth-etopo-2022');
    expect(heightsForGrid(loaded, trek)?.set.id).toBe('earth-etopo-2022-trek');
    expect(
      heightsForGrid(loaded, {
        columnsAtLevelZero: 4,
        rowsAtLevelZero: 2,
        tileSizePx: 256,
      })
    ).toBeNull();
  });
});
