import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { forEachBody } from '@/config/catalog';
import { bodyDynamics } from '@/config/gravity';
import { HorizonsEphemerisService } from './HorizonsEphemerisService';
import { OrbitalElementsService } from './OrbitalElementsService';

/**
 * LE REPLI KÉPLÉRIEN DÉCRIT-IL LA MÊME ORBITE QUE LE FICHIER HORIZONS ?
 *
 * `relativeOrbitalElements` sert quand un binaire est absent, hors couverture ou invalidé —
 * en particulier si les assets ne se chargent pas, auquel cas le repli travaille AUX DATES
 * COURANTES, sous les yeux de l'utilisateur. Rien ne le vérifiait, et ces éléments avaient
 * été saisis à la main depuis des sources hétérogènes.
 *
 * Défaut réellement livré, et plus large que soupçonné : HUIT jeux sur vingt étaient dans un
 * repère qui n'est pas celui du moteur. `kepler.ts` attend des angles ÉCLIPTIQUES ; les
 * valeurs saisies étaient souvent celles publiées par rapport à l'ÉQUATEUR de la planète —
 * les deux conventions coexistent dans la littérature et rien ne les distingue à l'œil dans
 * un fichier de config. Inclinaison catalogue puis vraie valeur écliptique :
 *
 *     Charon      0,0°  ->  112,9°      Titan       0,3°  ->  27,7°
 *     Encelade    0,0°  ->   28,1°      Rhéa        0,3°  ->  28,2°
 *     Phobos      1,1°  ->   27,4°      Japet       7,6°  ->  17,0°
 *     Deimos      1,8°  ->   24,2°      Triton    157,3°  ->  129,1°
 *
 * Un satellite serait donc parti dans un plan orbital visiblement faux dès que le repli
 * aurait pris la main. Les vingt jeux sont maintenant dérivés des ÉTATS EXACTS des binaires
 * (`scripts/derive-relative-elements.mjs`), donc du même repère par construction.
 *
 * Ce que ce test compare est non circulaire : d'un côté une propagation képlérienne pure à
 * partir de six nombres du catalogue, de l'autre l'interpolation d'un fichier de 18 354
 * états Horizons. Les deux chemins ne partagent aucune ligne de code.
 *
 * Ce que le test NE promet PAS : une égalité. Les éléments sont OSCULATEURS — ils décrivent
 * la conique tangente à l'époque, sans les perturbations qui font ensuite précesser le nœud.
 * L'écart croît donc avec le temps, et c'est normal. On borne ici ce à quoi un repli doit
 * servir : rester sur la bonne orbite, dans le bon plan, à la bonne cadence.
 */

const EPHEMERIDES_DIR = 'public/assets/ephemerides/';

interface ManifestEntry {
  file: string;
  center?: string;
  stepDays: number;
}

const manifest = JSON.parse(
  readFileSync(EPHEMERIDES_DIR + 'manifest.json', 'utf-8')
) as { bodies: Record<string, ManifestEntry> };

function horizonsFromDisk(): HorizonsEphemerisService {
  const dynamics = bodyDynamics(CELESTIAL_CONFIG);
  const loaded = new Map<string, unknown>();
  for (const [name, entry] of Object.entries(manifest.bodies)) {
    const file = readFileSync(EPHEMERIDES_DIR + entry.file);
    loaded.set(name, {
      manifest: entry,
      samples: new Float64Array(
        file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
      ),
      ...(dynamics[name] !== undefined ? { dynamics: dynamics[name] } : {}),
    });
  }
  type Ctor = new (bodies: Map<string, unknown>) => HorizonsEphemerisService;
  return new (HorizonsEphemerisService as unknown as Ctor)(loaded);
}

/** Époque des éléments dérivés — le repli est à son meilleur ici. */
const EPOCH = new Date('2025-12-31T00:00:00Z');

const satellites: {
  name: string;
  parent: string;
  elements: NonNullable<
    (typeof CELESTIAL_CONFIG.bodies)[string]['relativeOrbitalElements']
  >;
  period: number;
}[] = [];
forEachBody(CELESTIAL_CONFIG, ({ name, config, parentName }) => {
  const elements = config.relativeOrbitalElements;
  const period = config.realData?.orbitPeriodDays;
  if (!elements || parentName === null || !period) return;
  if (!(name in manifest.bodies)) return;
  satellites.push({ name, parent: parentName, elements, period });
});

const elementsService = new OrbitalElementsService();
const horizons = horizonsFromDisk();

/** Écart angulaire et radial entre les deux sources, sur une fenêtre autour de l'époque. */
function compare(
  name: string,
  parent: string,
  elements: (typeof satellites)[number]['elements'],
  period: number,
  spanDays: number
): { maxAngleDeg: number; maxRadiusRatio: number } {
  let maxAngleDeg = 0;
  let maxRadiusRatio = 1;
  const steps = 60;

  for (let i = 0; i <= steps; i++) {
    const date = new Date(
      EPOCH.getTime() + (i / steps) * spanDays * 86_400_000
    );
    const fromHorizons = horizons.getParentRelativeAU(name, parent, date);
    if (!fromHorizons) continue;
    const fromElements = elementsService.getHeliocentricAU(
      { ...elements, periodDays: period },
      date
    );

    maxAngleDeg = Math.max(
      maxAngleDeg,
      fromHorizons.angleTo(fromElements) * (180 / Math.PI)
    );
    const ratio = fromElements.length() / fromHorizons.length();
    maxRadiusRatio = Math.max(maxRadiusRatio, ratio, 1 / ratio);
  }

  return { maxAngleDeg, maxRadiusRatio };
}

describe('repli képlérien confronté aux binaires Horizons', () => {
  it('couvre bien les satellites du catalogue', () => {
    expect(satellites.length).toBeGreaterThanOrEqual(18);
  });

  for (const { name, parent, elements, period } of satellites) {
    /**
     * Une période autour de l'époque : c'est la fenêtre où le repli doit être bon, puisque
     * c'est celle où il sert (assets absents = date courante).
     */
    it(`${name} suit son fichier Horizons sur une période`, () => {
      const { maxAngleDeg, maxRadiusRatio } = compare(
        name,
        parent,
        elements,
        period,
        period
      );
      // La DISTANCE au parent est la propriété la plus robuste : elle ne dépend ni de la
      // phase ni de l'orientation, seulement de a et e. 5 % de marge absorbe les
      // perturbations à court terme.
      expect(maxRadiusRatio, `${name} : rayon`).toBeLessThan(1.05);
      // La POSITION doit rester du bon côté de la planète. Un mauvais repère donnait des
      // dizaines de degrés en permanence — Charon aurait été à 113° de son plan.
      expect(maxAngleDeg, `${name} : position`).toBeLessThan(20);
    });
  }

  /**
   * Vieillissement : au-delà de l'époque, l'écart croît (précession du nœud, non modélisée
   * par des éléments figés). On ne l'interdit pas — on vérifie qu'il reste borné, pour que
   * le repli reste un repli utilisable et non une trajectoire fantaisiste.
   */
  it('reste sur la bonne orbite un an après l’époque', () => {
    for (const { name, parent, elements, period } of satellites) {
      const { maxRadiusRatio } = compare(name, parent, elements, period, 365);
      expect(maxRadiusRatio, `${name} : rayon à un an`).toBeLessThan(1.15);
    }
  });
});
