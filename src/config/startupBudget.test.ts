import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { allBodies, texturePath, ringTexturePath } from '@/config/catalog';
import { assertValidCelestialCatalog } from '@/config/catalogValidation';
import { APP_SETTINGS } from '@/config/engine';
import { bodyDynamics } from '@/config/gravity';
import { flattenBodies } from '@/config/catalog';
import { HorizonsEphemerisService } from '@/core/HorizonsEphemerisService';
import {
  serveRealEphemerides,
  stubBrowser,
  type Served,
} from '@/core/horizonsTestFixture';
import {
  chooseTextureQuality,
  type TextureQualityThreshold,
} from '@/components/systems/TextureSystem';
import { MODEL_QUALITY_ORDER, type ModelQuality } from '@/core/modelLod';
import { DERIVED_TEXT_LOCALES } from '@/core/registryText';
import {
  BOOT_EXCLUSIVE_CHUNK_GROUPS,
  EPHEMERIS_STARTUP_BUDGET_BYTES,
  FIRST_VIEW_TEXTURE_REFINEMENTS,
  exclusiveGroupCost,
  TEXTURE_FLOOR_TIER,
  bootTierForFarLayer,
  modelFloorBudget,
  textureFloorBudget,
  type TextureFloorInput,
} from '@/core/startupBudget';
import { orbitLineShownByDefault } from '@/core/orbitLineDefaults';
import type { TextureQuality } from '@/types';

/**
 * LE BUDGET DU DÉMARRAGE, CONFRONTÉ AUX ARTEFACTS RÉELLEMENT LIVRÉS (lot 17, phase 17F).
 *
 * Trois des quatre familles se comptent sans build, depuis ce que le dépôt COMMITTE : la fenêtre
 * d'éphémérides (le vrai service sur les vrais binaires), les textures et les maillages (les
 * fichiers de `public/assets/`). La quatrième, le JavaScript, exige `dist/` et vit donc dans
 * `scripts/check-startup-budget.mjs`, étape bloquante de la CI après `pnpm build` — comme
 * l'empreinte des documents générés, pour la même raison.
 *
 * La MÉTHODE de mesure de bout en bout, en vrai navigateur et dans les conditions du plan
 * (production, service worker bloqué, `#loader` visible puis masqué), est
 * `scripts/measure-startup-bytes.mjs`. Ce fichier-ci ne la remplace pas : il tient les nombres
 * entre deux mesures.
 *
 * Aucune somme ne circule entre les familles, et c'est la propriété centrale — cf. le commentaire
 * de tête de `src/core/startupBudget.ts`.
 */

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEXTURE_ROOT = join(PROJECT_ROOT, 'public/assets/textures');
const MODEL_ROOT = join(PROJECT_ROOT, 'public/assets/models');
const MANIFEST_URL = 'https://example.test/assets/ephemerides/manifest.json';

/** Octets d'un fichier livré, ou `null` s'il n'existe pas — ce qui est une information. */
function shippedBytes(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ÉPHÉMÉRIDES
// ---------------------------------------------------------------------------

/**
 * Ce que `SolarSystemApp._loadResources` demande : la date, et les périodes des lignes TRACÉES
 * au démarrage, c'est-à-dire celles de la règle par défaut (`core/orbitLineDefaults.ts`). Jusqu'au
 * 2026-10-04 c'étaient les périodes de TOUS les corps, ligne affichée ou non.
 */
const ORBIT_PERIODS: Record<string, number> = {};
for (const [name, cfg] of flattenBodies(CELESTIAL_CONFIG)) {
  const period = cfg.realData?.orbitPeriodDays;
  if (period !== undefined && period > 0 && orbitLineShownByDefault(cfg.kind))
    ORBIT_PERIODS[name] = period;
}

/**
 * Quatre dates FIXES, et pas celle du jour.
 *
 * Le piège 8 du plan — « une date de mesure peut flatter la conception » — vaut dans les deux
 * sens : au 2099-12-01 les fenêtres larges sortent de la couverture d'elles-mêmes et le total
 * s'effondre, ce qui donnerait un budget faussement confortable. On mesure donc là où les lignes
 * sont les plus larges ET là où elles ne le sont pas, et c'est le PIRE cas qui est budgété.
 *
 * Fixes, parce qu'une garde qui dépend du jour où elle tourne devient rouge un matin sans qu'une
 * ligne ait changé ; la date vivante est mesurée par `scripts/measure-startup-bytes.mjs`.
 */
const STARTUP_DATES = [
  '1969-07-20', // onze corps hors couverture (mesuré au § 3 du plan)
  '2015-06-15', // PIRE CAS de toute la couverture : la ligne de Neptune y tient (722 544 o)
  '2026-09-23', // la date de référence du plan, dont 17C a mesuré 987 168 octets
  '2099-12-01', // bord de couverture : les fenêtres larges se réduisent d'elles-mêmes
] as const;

async function bootEphemerisBytes(isoDate: string): Promise<number> {
  const log: Served[] = [];
  stubBrowser(serveRealEphemerides(log));
  await HorizonsEphemerisService.load(
    MANIFEST_URL,
    bodyDynamics(CELESTIAL_CONFIG),
    {
      // EXACTEMENT la demande du démarrage : aucune avance de lecture, toutes les périodes.
      scene: {
        date: new Date(`${isoDate}T00:00:00Z`),
        orbitPeriodDays: ORBIT_PERIODS,
      },
      retryDelaysMs: [],
    }
  );
  return log.reduce((sum, call) => sum + call.bytes, 0);
}

describe('budget du démarrage : famille « éphémérides »', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(STARTUP_DATES)(
    'la fenêtre de démarrage au %s tient dans son budget',
    async (isoDate) => {
      const bytes = await bootEphemerisBytes(isoDate);
      expect(bytes).toBeGreaterThan(0);
      expect(
        bytes,
        `au ${isoDate}, la fenêtre de démarrage demande ${bytes} octets pour un budget de ` +
          `${EPHEMERIS_STARTUP_BUDGET_BYTES}. Ce qui fait monter cette famille est le CATALOGUE : ` +
          `une ligne d'orbite coûte une période entière (333 Ko pour Halley, 368 Ko pour Uranus). ` +
          `Avant de relever le plafond, regarder la piste que 17C a identifiée sans la prendre : ` +
          `ne calculer que les lignes réellement visibles.`
      ).toBeLessThanOrEqual(EPHEMERIS_STARTUP_BUDGET_BYTES);
    },
    60_000
  );

  it('ne demande qu’une part minuscule des octets livrés', async () => {
    // L'autre face du même fait, et celle qui dit que le lot 17 sert encore à quelque chose :
    // le gain n'est pas un souvenir du plan, il se remesure ici à chaque passage.
    const manifest = JSON.parse(
      readFileSync(
        join(PROJECT_ROOT, 'public/assets/ephemerides/manifest.json'),
        'utf-8'
      )
    ) as { bodies: Record<string, { sampleCount: number }> };
    const shipped = Object.values(manifest.bodies).reduce(
      (sum, entry) => sum + entry.sampleCount * 48,
      0
    );
    const bytes = await bootEphemerisBytes('2026-09-23');
    expect(bytes / shipped).toBeLessThan(0.03);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// TEXTURES
// ---------------------------------------------------------------------------

/**
 * Les couches de texture que le démarrage touche, DÉRIVÉES des deux chemins qui les demandent.
 *
 * Ce n'est pas une liste : c'est la reproduction des deux règles du code.
 *
 *   - `TextureSystem.preloadCriticalTextures` prend la couche `surface` de chaque corps qui
 *     déclare un `loadPriority`, au palier `low` s'il est livré ;
 *   - `CelestialObject` appelle `_loadAllTextures` pour CHAQUE corps (immédiatement s'il a un
 *     `loadPriority`, sinon en veille), et y demande chaque couche déclarée à la distance
 *     normalisée 100 ; puis `_loadRingTexture` demande l'anneau à la distance 250.
 *
 * Vérifié contre un vrai navigateur le 2026-09-26 : cette dérivation rend EXACTEMENT les 60
 * fichiers de palier plancher que la production demande, plus rien, plus les deux raffinements
 * de première vue déclarés séparément. C'est la doctrine du lot 17D : un modèle vérifié, pas un
 * modèle plausible.
 */
interface BootTextureDerivation {
  readonly layers: TextureFloorInput[];
  /**
   * Ce que la dérivation a trouvé d'anormal, COLLECTÉ au lieu d'être asserté ici : une assertion
   * dans une fonction appelée à la collecte échoue sans nom de test, et un rapport sans nom est un
   * rapport qu'on relit mal.
   */
  readonly problems: string[];
}

function bootTextureLayers(): BootTextureDerivation {
  const levels = Object.values(
    APP_SETTINGS.performance.textureQuality
  ) as TextureQualityThreshold[];
  const sorted = [...levels].sort((a, b) => a.distance - b.distance);
  const low = APP_SETTINGS.performance.textureQuality.low.quality;

  const seen = new Map<string, TextureFloorInput>();
  const problems: string[] = [];
  const record = (
    body: string,
    layer: string,
    basePath: string,
    declared: readonly TextureQuality[]
  ): void => {
    const key = `${body}/${layer}`;
    if (seen.has(key)) return;
    const bytesByTier: Partial<Record<TextureQuality, number>> = {};
    for (const tier of declared) {
      const bytes = shippedBytes(join(TEXTURE_ROOT, `${basePath}_${tier}.jpg`));
      if (bytes !== null) bytesByTier[tier] = bytes;
    }
    seen.set(key, { body, layer, declared, bytesByTier });
  };

  for (const { name, config } of allBodies({
    bodies: CELESTIAL_CONFIG.bodies,
  })) {
    const surface = config.textureResolutions.surface;
    if (surface?.length && config.loadPriority !== undefined) {
      // Le préchargement ne passe PAS par le LOD : il choisit `low` s'il est livré.
      if (!surface.includes(low as TextureQuality))
        problems.push(
          `${name} : le préchargement du démarrage ne trouve pas le palier « ${low} » et prendrait ` +
            `donc le dernier palier déclaré. Tout corps texturé doit livrer son plancher.`
        );
      record(
        name,
        'surface',
        config.textures?.surface ?? texturePath(name, 'surface'),
        surface
      );
    }
    for (const layer of Object.keys(config.textures ?? {})) {
      const declared =
        config.textureResolutions[
          layer as keyof typeof config.textureResolutions
        ];
      if (!declared?.length) continue;
      const basePath =
        config.textures?.[layer as keyof typeof config.textures] ??
        texturePath(name, layer);
      // La distance 100 que passe `_loadAllTextures` : aucun seuil ne la couvre, donc le repli
      // de `chooseTextureQuality` décide — et il prend le DERNIER palier déclaré.
      const chosen = chooseTextureQuality(sorted, declared, 100);
      if (chosen !== bootTierForFarLayer(declared))
        problems.push(
          `${name}/${layer} : le LOD résout « ${chosen} » là où la règle de cette garde attend ` +
            `« ${bootTierForFarLayer(declared)} ». Le modèle a cessé de décrire le code.`
        );
      record(name, layer, basePath, declared);
    }
    if (config.ring?.textureResolutions?.length) {
      record(
        name,
        'ring',
        config.ring.textures ?? ringTexturePath(name),
        config.ring.textureResolutions
      );
    }
  }
  return { layers: [...seen.values()], problems };
}

describe('budget du démarrage : famille « textures »', () => {
  const { layers, problems } = bootTextureLayers();
  const budget = textureFloorBudget(layers);

  it('décrit encore ce que fait le code, et livre son plancher partout', () => {
    // Collecté par la dérivation plutôt qu'asserté dans son corps : une assertion jouée à la
    // COLLECTE échoue sans nom de test, et un rapport sans nom se relit mal.
    expect(problems).toEqual([]);
  });

  it('touche bien toutes les couches du démarrage', () => {
    // Sans cette borne, une dérivation cassée rendrait une liste vide, donc verte.
    expect(layers.length).toBeGreaterThan(55);
  });

  it('ne demande JAMAIS mieux que le palier plancher de l’échelle', () => {
    const above = budget.lines.filter((line) => !line.isFloor);
    expect(
      above,
      `ces couches partent au démarrage au-dessus du plancher « ${TEXTURE_FLOOR_TIER} » : ` +
        `${above.map((l) => `${l.body}/${l.layer} en ${l.tier}`).join(', ')}. ` +
        `Le démarrage doit servir le palier le plus grossier livré ; le LOD monte ensuite.`
    ).toEqual([]);
  });

  it('dépend d’une règle du catalogue, et vérifie donc que cette règle existe encore', () => {
    // POURQUOI cette garde n'est pas un doublon. Le démarrage ne demande le plancher que parce
    // que le catalogue déclare ses résolutions du plus GRAND au plus PETIT : les deux chemins du
    // démarrage prennent le DERNIER palier déclaré (cf. `bootTierForFarLayer`). Cette règle a
    // déjà un propriétaire — `config/catalogValidation.ts`, « resolutions must be ordered from
    // highest to lowest », fail-fast au chargement du catalogue — et la recopier ici serait la
    // dérive que ce dépôt a déjà payée. On vérifie donc qu'elle TIENT TOUJOURS, parce que le
    // budget des textures en dépend : sans elle, un corps déclaré à l'envers enverrait son 8k au
    // démarrage. Défaut de ma première version, trouvé en la falsifiant : j'avais écrit que rien
    // ne tenait cet ordre, et c'était faux.
    const witness = [...allBodies({ bodies: CELESTIAL_CONFIG.bodies })].find(
      ({ config }) => (config.textureResolutions.surface?.length ?? 0) > 1
    );
    expect(
      witness,
      'aucun corps à plusieurs paliers dans le catalogue'
    ).toBeDefined();
    const reversed = [...witness!.config.textureResolutions.surface!].reverse();
    expect(() =>
      assertValidCelestialCatalog({
        bodies: {
          [witness!.name]: {
            ...witness!.config,
            textureResolutions: {
              ...witness!.config.textureResolutions,
              surface: reversed,
            },
          },
        },
      })
    ).toThrow(/highest to lowest/);
  });

  it('livre sur le disque chaque fichier de palier plancher qu’il demande', () => {
    const missing = budget.lines.filter((line) => line.bytes === 0);
    expect(
      missing.map((line) => `${line.body}/${line.layer}`),
      'un fichier de plancher absent ne coûte rien au budget et fait disparaître le corps'
    ).toEqual([]);
  });

  it('nomme chaque raffinement de première vue, et le lit sur un fichier livré', () => {
    // Ces deux-là sont les SEULS paliers fins que la production demande au démarrage (mesuré).
    // Une troisième entrée est soit une régression, soit une décision à écrire ici.
    expect(FIRST_VIEW_TEXTURE_REFINEMENTS.length).toBe(2);
    for (const refinement of FIRST_VIEW_TEXTURE_REFINEMENTS) {
      const basePath = texturePath(refinement.body, refinement.layer);
      const bytes = shippedBytes(
        join(TEXTURE_ROOT, `${basePath}_${refinement.tier}.jpg`)
      );
      expect(
        bytes,
        `${refinement.body}/${refinement.layer} en ${refinement.tier} n'est pas livré`
      ).not.toBeNull();
      expect(bytes!).toBeGreaterThan(0);
      expect(refinement.reason.length).toBeGreaterThan(40);
    }
  });
});

// ---------------------------------------------------------------------------
// MODÈLES DE FORME
// ---------------------------------------------------------------------------

describe('budget du démarrage : famille « modèles »', () => {
  const inputs = [...allBodies({ bodies: CELESTIAL_CONFIG.bodies })]
    .filter(({ config }) => config.model)
    .map(({ name, config }) => {
      const shipped = config.model!.resolutions;
      const bytesByQuality: Partial<Record<ModelQuality, number>> = {};
      for (const quality of shipped) {
        const bytes = shippedBytes(
          join(MODEL_ROOT, name, `${name}_shape_${quality}.glb`)
        );
        if (bytes !== null) bytesByQuality[quality] = bytes;
      }
      return { body: name, shipped, bytesByQuality };
    });
  const budget = modelFloorBudget(inputs);

  it('trouve les corps modélisés du catalogue', () => {
    expect(inputs.length).toBeGreaterThan(10);
  });

  it('ne charge que le niveau le plus léger de chaque corps', () => {
    const above = budget.lines.filter((line) => !line.isFloor);
    expect(
      above.map((line) => `${line.body} en ${line.tier}`),
      `le démarrage doit charger « ${MODEL_QUALITY_ORDER[0]} » ; le LOD monte à l'approche`
    ).toEqual([]);
  });

  it('livre chaque maillage de plancher qu’il demande', () => {
    expect(budget.lines.filter((line) => line.bytes === 0)).toEqual([]);
  });
});

/**
 * LES GROUPES EXCLUSIFS DU DÉMARRAGE (lot 20) — un visiteur ne charge qu'un dictionnaire.
 *
 * La famille JavaScript se compte après un build, donc dans `scripts/check-startup-budget.mjs` ;
 * mais la RÈGLE, elle, est pure, et c'est celle-ci qu'il faut falsifier : un groupe qu'on
 * additionnerait surestimerait le démarrage de deux dictionnaires, un groupe qu'on ignorerait le
 * sous-estimerait pour les trois quarts des visiteurs.
 */
describe('budget du démarrage : groupes exclusifs', () => {
  it('ne compte que le membre le plus lourd', () => {
    const bytes: Record<string, number> = {
      'dict-fr': 20_000,
      'dict-es': 24_000,
      'dict-pt-BR': 22_000,
    };
    const worst = exclusiveGroupCost(
      { chunks: ['dict-fr', 'dict-es', 'dict-pt-BR'], reason: 'test' },
      (chunk) => bytes[chunk] ?? 0
    );
    expect(worst.chunk).toBe('dict-es');
    expect(worst.bytes).toBe(24_000);
    // Et ce n'est PAS la somme : la falsification de la règle.
    const sum = Object.values(bytes).reduce((a, b) => a + b, 0);
    expect(worst.bytes).toBeLessThan(sum);
  });

  it('suit le plus lourd quand il change, sans ordre privilégié', () => {
    const worst = exclusiveGroupCost(
      { chunks: ['a', 'b'], reason: 'test' },
      (chunk) => (chunk === 'a' ? 1 : 9)
    );
    expect(worst.chunk).toBe('b');
    const other = exclusiveGroupCost(
      { chunks: ['a', 'b'], reason: 'test' },
      (chunk) => (chunk === 'a' ? 9 : 1)
    );
    expect(other.chunk).toBe('a');
  });

  it('déclare les deux groupes de langue, et jamais l’anglais', () => {
    // L'anglais est dans la clôture STATIQUE — repli de `t()` pour le dictionnaire, seule langue
    // que les fiches gardent pour le catalogue. L'y déclarer le compterait DEUX fois.
    const declared = BOOT_EXCLUSIVE_CHUNK_GROUPS.map((group) => group.chunks);
    expect(declared).toEqual([
      ['dict-fr', 'dict-es', 'dict-pt-BR'],
      ['catalogue-fr', 'catalogue-es', 'catalogue-pt-BR'],
    ]);
    expect(declared.flat().join(' ')).not.toContain('-en');
    for (const group of BOOT_EXCLUSIVE_CHUNK_GROUPS)
      expect(group.reason.length).toBeGreaterThan(40);
    // Une langue livrée sans son groupe serait payée par tout le monde, en silence : chaque
    // langue dérivée doit apparaître dans les DEUX groupes.
    for (const locale of DERIVED_TEXT_LOCALES) {
      expect(declared[0]).toContain(`dict-${locale}`);
      expect(declared[1]).toContain(`catalogue-${locale}`);
    }
  });
});
