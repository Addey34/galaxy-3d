import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { bodyDynamics } from '@/config/gravity';
import { flattenBodies } from '@/config/catalog';
import { HorizonsEphemerisService } from './HorizonsEphemerisService';
import {
  EPHEMERIDES_DIR,
  horizonsManifest,
  horizonsServiceFromDisk,
  type HorizonsManifestEntry,
} from './horizonsTestFixture';
import {
  BYTES_PER_SAMPLE,
  byteRangeForIndices,
  covers,
  coveringIndex,
  fileByteLength,
  interpretRangeResponse,
  mergeWindows,
  parseContentRange,
  planBodyWindow,
  rangeHeader,
  samplePositionForDate,
  windowContains,
  WINDOW_MARGIN_SAMPLES,
  type SampleGrid,
  type SampleWindow,
} from './ephemerisWindow';

const MS_PER_DAY = 86_400_000;
const SCENE_DATE = new Date('2026-09-23T00:00:00Z');

const gridOf = (name: string): SampleGrid => {
  const entry = horizonsManifest.bodies[name];
  return {
    startJdTdb: entry.startJdTdb,
    stepDays: entry.stepDays,
    sampleCount: entry.sampleCount,
  };
};

const periodOf = (name: string): number | undefined =>
  flattenBodies(CELESTIAL_CONFIG).get(name)?.realData?.orbitPeriodDays;

/** Un corps chargé sur la seule tranche d'octets de sa fenêtre. */
function loadWindow(name: string, window: SampleWindow): unknown {
  const entry = horizonsManifest.bodies[name];
  const file = readFileSync(EPHEMERIDES_DIR + entry.file);
  const slice = file.subarray(window.byteStart, window.byteEnd + 1);
  const samples = new Float64Array(
    slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength)
  );
  const manifest: HorizonsManifestEntry = {
    ...entry,
    startJdTdb: entry.startJdTdb + window.firstIndex * entry.stepDays,
    sampleCount: window.lastIndex - window.firstIndex + 1,
  };
  const dynamics = bodyDynamics(CELESTIAL_CONFIG)[name];
  return { manifest, samples, ...(dynamics ? { dynamics } : {}) };
}

/**
 * Le service, construit sur la seule FENÊTRE d'un corps : c'est ce que fera la phase 17C.
 * La grille est décalée sur le premier échantillon de la fenêtre, exactement comme un fichier
 * qui commencerait là.
 *
 * Le COMPAGNON du ballant est chargé sur le MÊME intervalle d'index, et ce n'est pas un détail
 * d'implémentation du test : `_withoutReflex` retire le ballant état par état et exige une
 * grille identique. Sans le compagnon, Pluton et ses quatre petites lunes gardent leur ballant
 * et se placent ailleurs (piège 7 du plan, trouvé ici par un test rouge).
 */
function windowedService(
  name: string,
  window: SampleWindow
): HorizonsEphemerisService {
  const loaded = new Map<string, unknown>([[name, loadWindow(name, window)]]);
  const companion = bodyDynamics(CELESTIAL_CONFIG)[name]?.reflex?.companion;
  if (companion && horizonsManifest.bodies[companion]) {
    loaded.set(companion, loadWindow(companion, window));
  }
  type Ctor = new (bodies: Map<string, unknown>) => HorizonsEphemerisService;
  return new (HorizonsEphemerisService as unknown as Ctor)(loaded);
}

describe('adressage d’une fenêtre d’éphéméride', () => {
  it('traduit une suite d’index en plage d’octets, bornes incluses comme Range les veut', () => {
    expect(byteRangeForIndices(0, 0)).toEqual({
      byteStart: 0,
      byteEnd: 47,
      byteLength: 48,
    });
    expect(byteRangeForIndices(10, 11)).toEqual({
      byteStart: 480,
      byteEnd: 575,
      byteLength: 96,
    });
    expect(BYTES_PER_SAMPLE).toBe(48);
  });

  it('la plage désigne bien ces octets-là DANS le fichier livré', () => {
    // Confrontation aux octets réels : l'arithmétique d'index ne prouve rien toute seule.
    const entry = horizonsManifest.bodies.mercury;
    const file = readFileSync(EPHEMERIDES_DIR + entry.file);
    const full = new Float64Array(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
    );
    const { byteStart, byteEnd } = byteRangeForIndices(100, 103);
    const slice = file.subarray(byteStart, byteEnd + 1);
    const windowed = new Float64Array(
      slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength)
    );
    expect(windowed.length).toBe(4 * 6);
    expect([...windowed]).toEqual([...full.subarray(100 * 6, 104 * 6)]);
  });

  it('déclare la taille du fichier que le manifeste décrit', () => {
    for (const [name, entry] of Object.entries(horizonsManifest.bodies)) {
      const bytes = fileByteLength(gridOf(name));
      expect(bytes).toBe(entry.sampleCount * 48);
      expect(readFileSync(EPHEMERIDES_DIR + entry.file).byteLength).toBe(bytes);
    }
  });

  it('écrit un en-tête Range à UN seul intervalle', () => {
    const grid = gridOf('mercury');
    const window = planBodyWindow(grid, { date: SCENE_DATE })!;
    expect(rangeHeader(window)).toBe(
      `bytes=${window.byteStart}-${window.byteEnd}`
    );
    expect(rangeHeader(window)).not.toContain(',');
  });
});

describe('quel échantillon encadre la date', () => {
  it('suit la MÊME règle que le lecteur : le dernier échantillon n’encadre rien', () => {
    const grid: SampleGrid = { startJdTdb: 1000, stepDays: 4, sampleCount: 10 };
    const at = (jd: number) => new Date((jd - 2440587.5) * MS_PER_DAY);
    expect(coveringIndex(grid, at(999))).toBeNull();
    expect(coveringIndex(grid, at(1000))).toBe(0);
    expect(coveringIndex(grid, at(1003.9))).toBe(0);
    expect(coveringIndex(grid, at(1004))).toBe(1);
    // Dernier échantillon = index 9 : il n'a pas de suivant, donc il n'encadre rien.
    expect(coveringIndex(grid, at(1000 + 8 * 4))).toBe(8);
    expect(coveringIndex(grid, at(1000 + 9 * 4))).toBeNull();
    expect(samplePositionForDate(grid, at(1002))).toBeCloseTo(0.5, 12);
  });

  it('accorde « le service répond » et « le planificateur demande », corps par corps', () => {
    // Si ces deux règles divergeaient, on demanderait des octets pour rien, ou on n'en
    // demanderait pas alors que le corps est plaçable.
    const service = horizonsServiceFromDisk();
    for (const name of Object.keys(horizonsManifest.bodies)) {
      const answers = service.getHeliocentricAU(name, SCENE_DATE) !== null;
      expect(covers(gridOf(name), SCENE_DATE), name).toBe(answers);
    }
  });
});

describe('le plan d’un corps', () => {
  it('ne demande RIEN quand la couverture ne contient pas la date', () => {
    // Cassini s'arrête en 2017 : au 2026-09-23 elle n'a aucun octet à demander.
    expect(planBodyWindow(gridOf('cassini'), { date: SCENE_DATE })).toBeNull();
    // Et jamais une longueur négative, qui est le défaut commis en écrivant le plan.
    for (const name of Object.keys(horizonsManifest.bodies)) {
      const w = planBodyWindow(gridOf(name), { date: SCENE_DATE });
      if (w) expect(w.byteLength).toBeGreaterThan(0);
    }
  });

  it('inclut TOUJOURS l’échantillon suivant, que le lecteur exige', () => {
    const grid = gridOf('mercury');
    const index = coveringIndex(grid, SCENE_DATE)!;
    // Même sans aucune marge : le « + 1 » n'est pas une marge, il est obligatoire.
    const bare = planBodyWindow(grid, { date: SCENE_DATE }, 0)!;
    expect(bare.firstIndex).toBe(index);
    expect(bare.lastIndex).toBe(index + 1);
    expect(bare.byteLength).toBe(96);
  });

  it('ajoute la marge déclarée de chaque côté', () => {
    const grid = gridOf('mercury');
    const index = coveringIndex(grid, SCENE_DATE)!;
    const w = planBodyWindow(grid, { date: SCENE_DATE })!;
    expect(WINDOW_MARGIN_SAMPLES).toBe(2);
    expect(w.firstIndex).toBe(index - 2);
    expect(w.lastIndex).toBe(index + 3);
  });

  it('borne la fenêtre au fichier, sans jamais sortir', () => {
    const grid: SampleGrid = { startJdTdb: 1000, stepDays: 4, sampleCount: 10 };
    const at = (jd: number) => new Date((jd - 2440587.5) * MS_PER_DAY);
    const first = planBodyWindow(grid, { date: at(1000) })!;
    expect(first.firstIndex).toBe(0);
    const last = planBodyWindow(grid, { date: at(1000 + 8 * 4) })!;
    expect(last.lastIndex).toBe(9);
  });

  it('élargit à la période ENTIÈRE quand la ligne d’orbite est tracée', () => {
    const grid = gridOf('uranus');
    const period = periodOf('uranus')!;
    const position = planBodyWindow(grid, { date: SCENE_DATE })!;
    const line = planBodyWindow(grid, {
      date: SCENE_DATE,
      orbitPeriodDays: period,
    })!;
    expect(line.byteLength).toBeGreaterThan(position.byteLength);
    // La ligne sonde les deux extrémités : la fenêtre doit couvrir les deux, sinon
    // `needsElementsOnly` bascule TOUTE la courbe sur les éléments, sans erreur.
    for (const sign of [-1, 1]) {
      const end = new Date(
        SCENE_DATE.getTime() + (sign * period * MS_PER_DAY) / 2
      );
      const index = coveringIndex(grid, end)!;
      expect(index).toBeGreaterThanOrEqual(line.firstIndex);
      expect(index + 1).toBeLessThanOrEqual(line.lastIndex);
    }
  });

  it('n’élargit PAS quand la période ne tient pas dans la couverture', () => {
    // Neptune : sa demi-période atteint 2108, au-delà du fichier. La ligne repart donc de
    // toute façon de sa conique, et demander ces octets serait les payer pour rien.
    const grid = gridOf('neptune');
    const period = periodOf('neptune')!;
    const position = planBodyWindow(grid, { date: SCENE_DATE })!;
    const line = planBodyWindow(grid, {
      date: SCENE_DATE,
      orbitPeriodDays: period,
    })!;
    expect(line).toEqual(position);
  });

  it('réunit et compare deux fenêtres de la même grille', () => {
    const grid = gridOf('mercury');
    const a = planBodyWindow(grid, { date: SCENE_DATE })!;
    const b = planBodyWindow(grid, {
      date: new Date(SCENE_DATE.getTime() + 40 * MS_PER_DAY),
    })!;
    const merged = mergeWindows(a, b);
    expect(windowContains(merged, a)).toBe(true);
    expect(windowContains(merged, b)).toBe(true);
    expect(windowContains(a, b)).toBe(false);
    expect(merged.byteLength).toBe(
      (merged.lastIndex - merged.firstIndex + 1) * 48
    );
  });
});

describe('une fenêtre place le corps EXACTEMENT comme le fichier entier', () => {
  // C'est la garde centrale de la phase : si elle tombe, le lot déplace des corps.
  const full = horizonsServiceFromDisk();

  it('rend la position au bit près, pour chaque corps couvert', () => {
    let checked = 0;
    for (const name of Object.keys(horizonsManifest.bodies)) {
      const grid = gridOf(name);
      const window = planBodyWindow(grid, { date: SCENE_DATE });
      if (!window) continue;
      const expected = full.getHeliocentricAU(name, SCENE_DATE);
      if (!expected) continue;
      const actual = windowedService(name, window).getHeliocentricAU(
        name,
        SCENE_DATE
      );
      expect(actual, name).not.toBeNull();
      expect(actual!.x, name).toBe(expected.x);
      expect(actual!.y, name).toBe(expected.y);
      expect(actual!.z, name).toBe(expected.z);
      checked++;
    }
    // Le compte protège contre un test qui passerait en ne vérifiant rien.
    expect(checked).toBeGreaterThanOrEqual(50);
  });

  it('rend la même chose sur TOUTE la fenêtre, pas seulement à la date planifiée', () => {
    const name = 'mars';
    const grid = gridOf(name);
    const window = planBodyWindow(grid, { date: SCENE_DATE })!;
    const service = windowedService(name, window);
    // Un pas de Mars vaut 8 jours, la marge en couvre deux de chaque côté.
    for (let offsetDays = -8; offsetDays <= 8; offsetDays += 1) {
      const date = new Date(SCENE_DATE.getTime() + offsetDays * MS_PER_DAY);
      const expected = full.getHeliocentricAU(name, date);
      const actual = service.getHeliocentricAU(name, date);
      expect(actual, String(offsetDays)).not.toBeNull();
      expect(actual!.x, String(offsetDays)).toBe(expected!.x);
    }
  });

  it('rend null hors de la fenêtre, au lieu d’inventer', () => {
    const name = 'mars';
    const grid = gridOf(name);
    const window = planBodyWindow(grid, { date: SCENE_DATE })!;
    const service = windowedService(name, window);
    const farAway = new Date(SCENE_DATE.getTime() + 400 * MS_PER_DAY);
    expect(full.getHeliocentricAU(name, farAway)).not.toBeNull();
    expect(service.getHeliocentricAU(name, farAway)).toBeNull();
  });
});

describe('ce qu’il faut croire d’une réponse', () => {
  const grid = gridOf('mercury');
  const total = fileByteLength(grid);
  const window = planBodyWindow(grid, { date: SCENE_DATE })!;
  const ok = `bytes ${window.byteStart}-${window.byteEnd}/${total}`;

  it('accepte un 206 dont la plage ET le total correspondent', () => {
    expect(
      interpretRangeResponse(206, ok, window.byteLength, window, grid)
    ).toEqual({ kind: 'window', window });
  });

  it('GARDE le fichier entier quand le serveur a ignoré la plage', () => {
    // Mesuré en production : une demande multi-plages rend 200 avec tout le fichier.
    expect(interpretRangeResponse(200, null, total, window, grid)).toEqual({
      kind: 'full',
    });
  });

  it('refuse un 206 dont le total est celui du flux COMPRESSÉ', () => {
    // Mesuré : `Accept-Encoding: br` rend 206 + `Content-Range: …/417899` pour Mercure,
    // avec des octets pris dans le flux brotli. Sans cette garde, ils passeraient.
    const brotli = `bytes ${window.byteStart}-${window.byteEnd}/417899`;
    const outcome = interpretRangeResponse(
      206,
      brotli,
      window.byteLength,
      window,
      grid
    );
    expect(outcome.kind).toBe('invalid');
    expect(outcome.kind === 'invalid' && outcome.reason).toContain('417899');
  });

  it('refuse une réponse qui ne fait pas la taille annoncée', () => {
    expect(
      interpretRangeResponse(206, ok, window.byteLength - 1, window, grid).kind
    ).toBe('invalid');
    expect(
      interpretRangeResponse(200, null, total - 1, window, grid).kind
    ).toBe('invalid');
  });

  it('refuse un 206 qui répond une AUTRE plage que celle demandée', () => {
    const shifted = `bytes ${window.byteStart + 48}-${window.byteEnd + 48}/${total}`;
    expect(
      interpretRangeResponse(206, shifted, window.byteLength, window, grid).kind
    ).toBe('invalid');
  });

  it('refuse un 206 sans Content-Range lisible, et tout autre statut', () => {
    expect(
      interpretRangeResponse(206, null, window.byteLength, window, grid).kind
    ).toBe('invalid');
    expect(interpretRangeResponse(404, null, 0, window, grid).kind).toBe(
      'invalid'
    );
  });

  it('lit un Content-Range, et refuse ce qui n’en est pas un', () => {
    expect(parseContentRange('bytes 1000-1095/440496')).toEqual({
      start: 1000,
      end: 1095,
      total: 440496,
    });
    expect(parseContentRange('items 0-1/2')).toBeNull();
    expect(parseContentRange(null)).toBeNull();
  });
});

describe('ce que la première vue coûte réellement', () => {
  it('tient dans une poignée de kilo-octets, et le chiffre est celui du plan', () => {
    // Règle de `ui/defaultDisplay` : tout corps est dessiné, seules les orbites des PLANÈTES
    // sont tracées. Le nombre qui sort d'ici est celui que le handoff publie.
    const bodies = flattenBodies(CELESTIAL_CONFIG);
    let bytes = 0;
    let requests = 0;
    for (const name of Object.keys(horizonsManifest.bodies)) {
      const cfg = bodies.get(name);
      const window = planBodyWindow(gridOf(name), {
        date: SCENE_DATE,
        ...(cfg?.kind === 'planet'
          ? { orbitPeriodDays: cfg.realData?.orbitPeriodDays }
          : {}),
      });
      if (!window) continue;
      requests++;
      bytes += window.byteLength;
    }
    const shipped = Object.values(horizonsManifest.bodies).reduce(
      (sum, entry) => sum + entry.sampleCount * 48,
      0
    );
    expect(shipped).toBe(38_445_024);
    expect(requests).toBe(62);
    // Moins de 2 % de ce qui est livré aujourd'hui : c'est tout l'objet du lot.
    expect(bytes).toBeLessThan(shipped * 0.02);
    expect(bytes).toBeGreaterThan(500_000);
  });
});
