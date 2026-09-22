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
import { tileBounds } from '@/core/tilePyramid';
import { CELESTIAL_CONFIG } from './bodies';
import { flattenBodies } from './catalog';

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

function loadManifest(path: string): HeightManifest {
  return parseHeightManifest(
    JSON.parse(readFileSync(resolve(ROOT, 'public', path), 'utf-8'))
  );
}

function loadTile(
  manifest: HeightManifest,
  index: { level: number; row: number; column: number }
) {
  const file = resolve(
    ROOT,
    'public',
    heightTilePath(manifest, index).slice(1)
  );
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
    for (const [, set] of SURFACE_HEIGHT_SETS)
      expect(
        existsSync(resolve(ROOT, 'public', set.manifestPath)),
        `${set.manifestPath} absent : le relief serait annoncé et jamais servi`
      ).toBe(true);
  });
});

describe('tuiles de hauteurs de la Lune', () => {
  const set = SURFACE_HEIGHT_SETS.get('moon')!;
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
  const set = SURFACE_HEIGHT_SETS.get('moon')!;
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
  const set = SURFACE_HEIGHT_SETS.get('moon')!;
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
