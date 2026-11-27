import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DETAIL_FLOOR,
  ILLUSTRATIVE_CEILING,
  TIERS,
  TIER_WIDTH,
  resolveLadder,
  tierForSourceWidth,
} from '@/core/textureLadder';
import { textureReviews } from '@/registry/products';
import surfaceEditions from 'virtual:surface-edition-catalogue';
import { allBodies } from './catalog';
import { CELESTIAL_CONFIG } from './bodies';
import { SMALL_BODIES } from './smallBodies';
import type { TextureQuality, TextureResolutions } from '@/types';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEXTURE_ROOT = join(PROJECT_ROOT, 'public/assets/textures');
const LADDER_PATH = join(PROJECT_ROOT, 'src/config/textureLadder.json');

interface LadderRow {
  body: string;
  layer: string;
  /** Édition de la couche (`textureEditions`), quand le nom du fichier en porte une. */
  edition?: string;
  shipped: TextureQuality[];
  detail: Partial<Record<TextureQuality, number>>;
  bytes: number;
}

const ladder = JSON.parse(readFileSync(LADDER_PATH, 'utf8')) as {
  measuredAt: string;
  rows: LadderRow[];
};

/** `normal_map` cote fichier devient `normalMap` cote catalogue. */
function camel(layer: string): string {
  return layer.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Largeur de source d'une couche, ou null si le registre n'en donne pas. Une ÉDITION (GAL-ATMOSPHERES-001)
 * a la sienne, lue dans les `editions` de la fiche.
 */
function sourceWidth(
  body: string,
  layer: string,
  edition?: string
): number | null {
  const cat = surfaceEditions[body];
  if (edition && cat?.layer === layer) {
    const e = cat.editions.find((x) => x.edition === edition);
    if (e) return e.sourcePixelWidth;
  }
  const review = textureReviews().find(
    (r) => r.body === body && r.layer === layer
  );
  return review?.sourcePixelWidth ?? null;
}

/**
 * Largeur et hauteur d'un JPEG, lues dans son en-tete SOF.
 *
 * Volontairement ecrit a la main plutot que delegue a sharp : ce test tourne dans
 * `pnpm verify`, et decoder les 172 JPEG livres y couterait des minutes. Lire
 * l'en-tete ne coute que quelques kilo-octets par fichier.
 */
function jpegSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  let i = 2; // saute SOI
  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    // SOF0 a SOF15, hors marqueurs qui partagent la plage sans etre des SOF.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return {
        height: buf.readUInt16BE(i + 5),
        width: buf.readUInt16BE(i + 7),
      };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error(`pas de marqueur SOF dans ${path}`);
}

/** Toutes les couches declarees par le catalogue, anneaux compris. */
function declaredLayers(): {
  body: string;
  layer: string;
  tiers: TextureQuality[];
  edition?: string;
}[] {
  const out: {
    body: string;
    layer: string;
    tiers: TextureQuality[];
    edition?: string;
  }[] = [];
  for (const { name, config } of [
    ...allBodies(CELESTIAL_CONFIG),
    ...allBodies({ bodies: SMALL_BODIES }),
  ]) {
    for (const [layer, tiers] of Object.entries(
      (config.textureResolutions ?? {}) as TextureResolutions
    )) {
      if (tiers?.length)
        out.push({
          body: name,
          layer,
          tiers: [...tiers],
          edition: config.textureEditions?.[layer as keyof TextureResolutions],
        });
    }
    if (config.ring?.textureResolutions?.length)
      out.push({
        body: name,
        layer: 'ring',
        tiers: [...config.ring.textureResolutions],
      });
  }
  // Les éditions SECONDAIRES d'une couche (GAL-ATMOSPHERES-001) : déclarées par la fiche du registre, pas
  // par le catalogue (qui ne porte que l'édition par défaut), et livrées elles aussi.
  for (const [body, cat] of Object.entries(surfaceEditions))
    for (const e of cat.editions)
      if (e.edition !== cat.defaultEdition)
        out.push({
          body,
          layer: cat.layer,
          tiers: [...e.tiers] as TextureQuality[],
          edition: e.edition,
        });
  // Pluton et ses lunes sont atteignables par les DEUX catalogues : on dedoublonne, en
  // exigeant que les deux vues declarent la meme echelle.
  const byKey = new Map<
    string,
    { body: string; layer: string; tiers: TextureQuality[]; edition?: string }
  >();
  for (const entry of out) {
    const key = `${entry.body}/${entry.layer}${entry.edition ? `@${entry.edition}` : ''}`;
    const seen = byKey.get(key);
    if (seen)
      expect(entry.tiers, `${key} declare deux echelles`).toEqual(seen.tiers);
    else byKey.set(key, entry);
  }
  return [...byKey.values()];
}

/** Le fichier d'un palier, avec l'édition éventuelle (`catalog.texturePath`). */
function tierFile(row: LadderRow, tier: TextureQuality): string {
  const edition = row.edition ? `__${row.edition}` : '';
  return join(
    TEXTURE_ROOT,
    row.body,
    `${row.body}_${row.layer}${edition}_${tier}.jpg`
  );
}

const rowCases = ladder.rows.map((r) => [`${r.body}/${r.layer}`, r] as const);

describe('echelle de resolutions d une texture (lot 16)', () => {
  it('le releve mesure couvre exactement les textures livrees', () => {
    const declared = declaredLayers()
      .map((d) => `${d.body}/${d.layer}${d.edition ? `@${d.edition}` : ''}`)
      .sort();
    const measured = ladder.rows
      .map(
        (r) => `${r.body}/${camel(r.layer)}${r.edition ? `@${r.edition}` : ''}`
      )
      .sort();
    expect(measured).toEqual(declared);
  });

  it.each(rowCases)(
    '%s : les fichiers presents sont exactement ceux que le catalogue declare',
    (_label, row) => {
      const layer = camel(row.layer);
      const declared = declaredLayers().find(
        (d) =>
          d.body === row.body && d.layer === layer && d.edition === row.edition
      );
      expect(
        declared,
        `${row.body}/${layer} absent du catalogue`
      ).toBeDefined();
      // Le catalogue declare du plus fin au plus grossier, le releve l'inverse.
      expect([...declared!.tiers].sort()).toEqual([...row.shipped].sort());
      // L'édition des fichiers mesurés est celle que le catalogue demande (GAL-CATALOG-EXCELLENCE-001) :
      // sinon le client chargerait un autre fichier que celui qui a été mesuré.
      expect(row.edition, `${row.body}/${layer} édition`).toBe(
        declared!.edition
      );
    }
  );

  it.each(rowCases)(
    '%s : chaque palier livre porte du detail que le palier du dessous ne porte pas',
    (_label, row) => {
      // LA regle : un palier au-dessus de 1k ne se livre que s'il montre quelque chose.
      // Le releve est ecrit par `pnpm textures:ladder`, jamais a la main.
      for (const tier of row.shipped) {
        if (tier === '1k') continue;
        const detail = row.detail[tier];
        expect(
          detail,
          `${row.body}/${row.layer} ${tier} non mesure`
        ).toBeDefined();
        expect(
          detail,
          `${row.body}/${row.layer} ${tier} : ${((detail ?? 0) * 100).toFixed(2)} % de variance en plus du demi-palier, sous le plancher de ${DETAIL_FLOOR * 100} %`
        ).toBeGreaterThanOrEqual(DETAIL_FLOOR);
      }
    }
  );

  it.each(rowCases)(
    '%s : l echelle livree est celle que la regle rend',
    (_label, row) => {
      const verdict = resolveLadder({
        // La provenance ne borne que la ou une largeur de source a ete LUE a son etiquette ;
        // ailleurs le plancher de detail arbitre seul, et un agrandissement, qui ne porte par
        // construction aucun detail neuf, y tombe de lui-meme.
        sourcePixelWidth:
          sourceWidth(row.body, camel(row.layer), row.edition) ??
          Number.MAX_SAFE_INTEGER,
        detailByTier: row.detail,
      });
      expect(verdict.shipped).toEqual(row.shipped);
    }
  );

  it.each(rowCases)(
    '%s : aucun palier ne depasse la largeur de sa source',
    (_label, row) => {
      const width = sourceWidth(row.body, camel(row.layer), row.edition);
      if (width === null) return;
      for (const tier of row.shipped) {
        // Le FICHIER ne dépasse jamais sa source : le palier de base peut être plus étroit que 1024 px
        // quand la source l'est (GAL-ATMOSPHERES-001, Uranus et Neptune à 720 px), jamais agrandi.
        expect(
          jpegSize(tierFile(row, tier)).width,
          `${row.body}/${row.layer} ${tier} depasse sa source de ${width} px`
        ).toBeLessThanOrEqual(width);
        // Au-dessus du palier de base, la largeur nominale du palier tient elle aussi dans la source.
        if (tier !== '1k') expect(TIER_WIDTH[tier]).toBeLessThanOrEqual(width);
      }
    }
  );

  it('chaque fichier livre a la taille de son palier', () => {
    for (const row of ladder.rows) {
      for (const tier of row.shipped) {
        const path = tierFile(row, tier);
        const { width } = jpegSize(path);
        // Un anneau et un noyau cometaire gardent le ratio de leur source : seule la largeur
        // est un palier, et elle ne peut jamais DEPASSER la largeur nominale.
        expect(
          width,
          `${row.body}/${row.layer} ${tier} fait ${width} px`
        ).toBeLessThanOrEqual(TIER_WIDTH[tier]);
        expect(statSync(path).size).toBeGreaterThan(0);
      }
    }
  });

  it('le poids releve est celui des fichiers sur disque', () => {
    for (const row of ladder.rows) {
      const bytes = row.shipped.reduce(
        (sum, tier) => sum + statSync(tierFile(row, tier)).size,
        0
      );
      expect(bytes, `${row.body}/${row.layer}`).toBe(row.bytes);
    }
  });

  it('une largeur de source declaree vient bien du registre', () => {
    // Elle est LUE a l'etiquette du produit, jamais deduite d'un « m/pixel ».
    const withWidth = textureReviews().filter(
      (r) => r.sourcePixelWidth !== undefined
    );
    expect(withWidth.length).toBeGreaterThanOrEqual(10);
    for (const review of withWidth) {
      expect(
        review.sourcePixelWidth,
        `${review.body}/${review.layer}`
      ).toBeGreaterThan(0);
      expect(
        review.sourcePage ?? review.downloadUrl,
        `${review.body}/${review.layer} : une largeur sans page source`
      ).toBeDefined();
    }
  });

  it('la regle elle-meme : plafonds, contiguite, plancher', () => {
    expect(tierForSourceWidth(8191)).toBe('4k');
    expect(tierForSourceWidth(8192)).toBe('8k');
    expect(tierForSourceWidth(1023)).toBeNull();

    // Sans source : plafond illustratif declare, quel que soit le detail mesure. Un bruit
    // procedural est haute frequence par construction, il passerait tous les planchers.
    const proc = resolveLadder({
      sourcePixelWidth: null,
      detailByTier: { '2k': 0.6, '4k': 0.5, '8k': 0.4 },
    });
    expect(proc.shipped).toEqual(['1k', ILLUSTRATIVE_CEILING]);
    expect(proc.refused['4k']).toEqual({ kind: 'no-source' });

    // L'echelle reste CONTIGUE : un trou au milieu ferait demander au LOD un fichier absent.
    const hole = resolveLadder({
      sourcePixelWidth: 8192,
      detailByTier: { '2k': 0.0001, '4k': 0.5, '8k': 0.5 },
    });
    expect(hole.shipped).toEqual(['1k']);

    const capped = resolveLadder({
      sourcePixelWidth: 5000,
      detailByTier: { '2k': 0.5, '4k': 0.5, '8k': 0.5 },
    });
    expect(capped.shipped).toEqual(['1k', '2k', '4k']);
    expect(capped.refused['8k']).toEqual({
      kind: 'above-source',
      sourcePixelWidth: 5000,
    });

    expect(TIERS[0]).toBe('1k');
  });
});
