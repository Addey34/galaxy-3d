/**
 * L'inventaire, rendu lisible. Module PUR : il transforme l'inventaire en texte, sans E/S.
 *
 * Il n'ajoute AUCUN jugement à ce que `collect.ts` a lu : les colonnes sont des faits, les
 * blocs qui suivent des regroupements de ces mêmes faits. La file de travail qui décide quoi
 * combler, et dans quel ordre, vit dans `docs/private/VISION.md` § « La file de travail », son
 * seul propriétaire.
 */
import {
  REFUSED_STEP_REFINEMENTS,
  shippedBytesForStep,
} from '@/config/ephemerisStepBudget';
import type { Capability, Inventory, InventoryRow } from './collect';

/**
 * Le refus DÉCLARÉ de raffiner le pas d'un corps, en une ligne. Ce n'est pas un jugement
 * ajouté ici : la déclaration est une donnée (`config/ephemerisStepBudget.ts`), confrontée au
 * relevé livré par sa propre garde. L'inventaire ne fait que la montrer à côté du manque
 * qu'elle explique, pour qu'un manque ne s'y lise jamais sans sa raison.
 */
function declaredRefusal(id: string): string {
  const refusal = REFUSED_STEP_REFINEMENTS.find((r) => r.body === id);
  if (!refusal) return '';
  if (refusal.neededStepMinutes === null) return '  refus : hors modele';
  const mo = shippedBytesForStep(refusal.neededStepMinutes / 1440) / 1e6;
  return `  refus : pas de ${refusal.neededStepMinutes} min, ${mo.toFixed(0)} Mo livres`;
}

const CAPABILITY_ORDER: readonly Capability[] = [
  'position',
  'texture',
  'shape',
  'tileset',
  'heightfield',
  'facts',
  'page',
  'card',
];

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function km(value: number | null): string {
  if (value === null) return 'non mesure';
  if (value < 10) return `${value.toFixed(1)} km`;
  return `${Math.round(value)} km`;
}

function positionCell(row: InventoryRow): string {
  if (!row.applicable.includes('position')) return '-';
  const { binary, medianKm } = row.position;
  const step = binary ? `bin ${binary.stepDays} j` : 'sans binaire';
  const perRev =
    binary?.samplesPerRevolution != null
      ? ` ${binary.samplesPerRevolution.toFixed(2)} ech/rev`
      : '';
  return `${step}${perRev}, ${km(medianKm)}`;
}

function textureCell(row: InventoryRow): string {
  if (row.textures.length === 0) return '-';
  const shipped = row.textures.filter((layer) => layer.shipped.length > 0);
  if (shipped.length === 0) return 'aucune';
  const top = shipped
    .map((layer) => layer.shipped[layer.shipped.length - 1]!)
    .sort()
    .reverse()[0]!;
  const provenance = row.illustrativeSurface ? 'illustratif' : 'mesure';
  return `${shipped.length} couche${shipped.length > 1 ? 's' : ''}, max ${top}, ${provenance}`;
}

function surfaceCell(row: InventoryRow): string {
  const parts = [
    row.shape
      ? `forme ${row.shape.resolutions[0]}${
          row.shape.missingFiles.length
            ? ` (${row.shape.missingFiles.length} fichier absent)`
            : ''
        }`
      : '',
    row.tileset ? `tuiles n${row.tileset.maxLevel}` : '',
    row.heightfield ? 'hauteurs' : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' + ') : '-';
}

function factsCell(row: InventoryRow): string {
  if (!row.applicable.includes('facts')) return '-';
  const { applicable, sourced, reasoned, unsourced, missing } = row.facts;
  const holes = unsourced.length + missing.length;
  return `${sourced}+${reasoned}/${applicable}${holes ? ` (-${holes})` : ''}`;
}

function pageCell(row: InventoryRow): string {
  if (!row.applicable.includes('page')) return '-';
  return `${row.page.locales.length}/4${row.card ? ' +vignette' : ' SANS vignette'}`;
}

function table(rows: readonly InventoryRow[]): string[] {
  const header = ['corps', 'position', 'textures', 'surface', 'faits', 'page'];
  const cells = rows.map((row) => [
    row.parent ? `${row.id} / ${row.parent}` : row.id,
    positionCell(row),
    textureCell(row),
    surfaceCell(row),
    factsCell(row),
    pageCell(row),
  ]);
  const widths = header.map((label, column) =>
    Math.max(label.length, ...cells.map((line) => line[column]!.length))
  );
  return [
    header
      .map((label, i) => pad(label, widths[i]!))
      .join('  ')
      .trimEnd(),
    ...cells.map((line) =>
      line
        .map((cell, i) => pad(cell, widths[i]!))
        .join('  ')
        .trimEnd()
    ),
  ];
}

/** Combien de lignes déclarent chaque capacité, et combien n'en ont aucun artefact. */
export function capabilityTally(inventory: Inventory): {
  capability: Capability;
  applicable: number;
  absent: number;
}[] {
  return CAPABILITY_ORDER.map((capability) => ({
    capability,
    applicable: inventory.rows.filter((row) =>
      row.applicable.includes(capability)
    ).length,
    absent: inventory.rows.filter((row) => row.absent.includes(capability))
      .length,
  }));
}

export function renderInventory(inventory: Inventory): string {
  const out: string[] = [];
  const { sources } = inventory;
  out.push('INVENTAIRE DERIVE DU DEPOT  (pnpm inventory:gaps)');
  out.push(
    `manifeste ephemerides ${sources.ephemerisManifest.slice(0, 10)} · paliers mesures ${sources.textureLadderMeasuredAt} · validation ${sources.validationGeneratedAt.slice(0, 10)} · ${sources.fingerprintDocuments} documents generes`
  );
  out.push(
    "position = pas du binaire livre + ecart median a Horizons de ce que l'application sert ; faits = sources + raisons redigees / applicables"
  );

  const families: [InventoryRow['family'], string][] = [
    ['body', 'CORPS DU CATALOGUE'],
    ['spacecraft', 'SONDES'],
    ['interstellar', 'OBJETS INTERSTELLAIRES'],
  ];
  for (const [family, title] of families) {
    const rows = inventory.rows.filter((row) => row.family === family);
    out.push('', `${title} (${rows.length})`, ...table(rows));
  }

  const illustrative = inventory.rows
    .filter((row) => row.illustrativeSurface)
    .map((row) => {
      const surface = row.textures.find((layer) => layer.layer === 'surface');
      return `${pad(row.id, 12)} ${surface?.shipped.join('/') ?? 'aucune'}`;
    });
  out.push(
    '',
    `SURFACES ILLUSTRATIVES, aucune mosaique resolue publiee (${illustrative.length})`,
    ...illustrative.map((line) => `  ${line}`)
  );

  const capped = inventory.rows.flatMap((row) =>
    row.textures
      .filter((layer) => layer.refusedAbove?.kind === 'above-source')
      .map(
        (layer) =>
          `${row.id} ${layer.layer} s'arrete a ${layer.shipped[layer.shipped.length - 1]} : source ${
            layer.refusedAbove!.kind === 'above-source'
              ? layer.refusedAbove!.sourcePixelWidth
              : 0
          } px`
      )
  );
  out.push(
    '',
    `PALIERS PLAFONNES PAR LEUR SOURCE PUBLIEE (${capped.length})`,
    ...capped.map((line) => `  ${line}`)
  );

  // Comparaison DÉRIVÉE, sans seuil inventé : le plus grand corps qui porte déjà un modèle de
  // forme fixe la taille au-delà de laquelle une sphère a été jugée suffisante. En dessous, un
  // corps sans modèle est un écart de parité — à la file de dire s'il vaut d'être comblé.
  const withModel = inventory.rows.filter(
    (row) => row.shape !== null && row.radiusKm !== null
  );
  const largestModelled = withModel.length
    ? Math.max(...withModel.map((row) => row.radiusKm!))
    : 0;
  const smallerWithout = inventory.rows
    .filter(
      (row) =>
        row.family === 'body' &&
        row.shape === null &&
        row.radiusKm !== null &&
        row.radiusKm < largestModelled
    )
    .sort((a, b) => b.radiusKm! - a.radiusKm!);
  out.push(
    '',
    `SANS MODELE DE FORME ET PLUS PETITS QUE LE PLUS GRAND CORPS QUI EN A UN (${smallerWithout.length}, repere ${Math.round(largestModelled)} km)`,
    ...smallerWithout.map(
      (row) => `  ${pad(row.id, 12)} ${Math.round(row.radiusKm!)} km`
    )
  );

  const under = inventory.rows
    .filter(
      (row) =>
        row.position.binary?.samplesPerRevolution != null &&
        row.position.binary.samplesPerRevolution < 2
    )
    .map((row) => ({
      id: row.id,
      perRev: row.position.binary!.samplesPerRevolution!,
      km: row.position.medianKm,
      radii:
        row.position.medianKm !== null && row.radiusKm
          ? row.position.medianKm / row.radiusKm
          : null,
    }))
    .sort((a, b) => (b.radii ?? -1) - (a.radii ?? -1));
  const withBinaryAndPeriod = inventory.rows.filter(
    (row) => row.position.binary?.samplesPerRevolution != null
  ).length;
  out.push(
    '',
    `BINAIRES SOUS-ECHANTILLONNES, moins de 2 echantillons par revolution (${under.length} sur ${withBinaryAndPeriod}). La propagation a deux corps prend la main ; l'ecart restant est mesure ci-dessous, en rayons du corps`,
    ...under.map(
      (row) =>
        `  ${pad(row.id, 12)} ${row.perRev.toFixed(2)} ech/rev  ${km(row.km)}  ${
          row.radii === null ? '-' : `${row.radii.toFixed(2)} rayons`
        }${declaredRefusal(row.id)}`
    )
  );

  const unsourced = inventory.rows.filter(
    (row) =>
      row.applicable.includes('facts') &&
      (row.facts.unsourced.length > 0 || row.facts.missing.length > 0)
  );
  const holes = unsourced.reduce(
    (total, row) =>
      total + row.facts.unsourced.length + row.facts.missing.length,
    0
  );
  out.push(
    '',
    `FAITS SANS SOURCE PRIMAIRE (${holes} sur ${unsourced.length} corps)`,
    ...unsourced.map(
      (row) =>
        `  ${pad(row.id, 12)} ${[...row.facts.unsourced, ...row.facts.missing].join(', ')}`
    )
  );

  out.push('', 'PAR CAPACITE');
  for (const tally of capabilityTally(inventory))
    out.push(
      `  ${pad(tally.capability, 12)} ${pad(String(tally.applicable), 3)} applicable, ${tally.absent} sans artefact`
    );

  const withGaps = inventory.rows.filter((row) => row.absent.length > 0);
  out.push('', `LIGNES AVEC AU MOINS UNE ABSENCE (${withGaps.length})`);
  for (const row of withGaps)
    out.push(`  ${pad(row.id, 20)} ${row.absent.join(', ')}`);

  return out.join('\n');
}
