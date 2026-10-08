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
import {
  INTERSTELLAR_ACCURACY,
  relativeError,
} from '@/config/interstellarAccuracy';
import { SHAPE_MODEL_GAPS, shapeGapLine } from '@/config/shapeModelGaps';
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
  'discovery',
  'moons',
  'missions',
  'places',
  'instruments',
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
  const segments = (binary?.segments ?? [])
    .map((segment) => ` + segment ${segment.center} ${segment.stepDays} j`)
    .join('');
  return `${step}${perRev}${segments}, ${km(medianKm)}`;
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

/**
 * Les missions que le registre de contexte du PDS declare sur ce corps. `0` s'ecrit `aucune` et
 * non `-` : rien n'est alle la-bas, et c'est une reponse mesuree, pas une case vide.
 */
function missionsCell(row: InventoryRow): string {
  if (!row.applicable.includes('missions')) return '-';
  if (row.missions === null) return 'HORS INDEX';
  return row.missions === 0 ? 'aucune' : String(row.missions);
}

/**
 * Les affirmations de decouverte que les sources primaires declarent sur ce corps (lot 44).
 * `sans objet` n'est pas un manque : la raison est ecrite dans scripts/discovery-targets.json.
 */
function discoveryCell(row: InventoryRow): string {
  if (!row.applicable.includes('discovery')) return '-';
  if (row.discovery === null) return 'HORS INDEX';
  if (row.discovery === 'sans-objet') return 'sans objet (raison ecrite)';
  return String(row.discovery);
}

/**
 * La liste des satellites d'un corps qui a des lunes, et sa source (ligne 22.10, pas 2). `sans
 * objet` n'est pas un manque : la raison est ecrite dans scripts/discovery-targets.json.
 */
function moonsCell(row: InventoryRow): string {
  if (!row.applicable.includes('moons')) return '-';
  if (row.moons === null) return 'HORS INDEX';
  if (row.moons === 'sans-objet') return 'sans objet (raison ecrite)';
  return `${row.moons.total} (${row.moons.source})`;
}

/**
 * Les instruments que le registre du PDS declare sur cette sonde. `absente` n'est pas un manque :
 * c'est une mesure, dont la raison vit dans scripts/pds-archive-targets.json.
 */
function instrumentsCell(row: InventoryRow): string {
  if (!row.applicable.includes('instruments')) return '-';
  if (row.instruments === null) return 'HORS INDEX';
  if (row.instruments === 'absent-de-l-archive')
    return 'absente (raison ecrite)';
  return String(row.instruments);
}

/**
 * Les formations nommees que l'ODE declare observees. `non couvert` n'est pas un manque : l'ODE ne
 * couvre que quatre corps, et c'est ecrit. `TIRAGE INCOMPLET` en est un.
 */
function placesCell(row: InventoryRow): string {
  if (!row.applicable.includes('places')) return '-';
  if (row.places === null) return 'TIRAGE INCOMPLET';
  if (row.places === 'non-couvert') return 'non couvert';
  return `${row.places.observed}/${row.places.formations}`;
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
  const header = [
    'corps',
    'position',
    'textures',
    'surface',
    'decouverte',
    'lunes',
    'missions',
    'lieux',
    'instruments',
    'faits',
    'page',
  ];
  const cells = rows.map((row) => [
    row.parent ? `${row.id} / ${row.parent}` : row.id,
    positionCell(row),
    textureCell(row),
    surfaceCell(row),
    discoveryCell(row),
    moonsCell(row),
    missionsCell(row),
    placesCell(row),
    instrumentsCell(row),
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
    // Depuis le 2026-10-08 la position vient du fichier Horizons, et la colonne en donne l'ecart.
    // Les elements ne servent plus qu'en REPLI (ligne tracee avant l'arrivee du fichier) : leur
    // ecart mesure au perihelie reste dit, sous ce nom (`config/interstellarAccuracy.ts`).
    if (family === 'interstellar' && INTERSTELLAR_ACCURACY.length > 0) {
      out.push(
        '',
        "  Les elements hyperboliques, qui ne servent plus qu'en repli : leur ecart MESURE au",
        '  perihelie, et le meme rapporte a la distance heliocentrique :'
      );
      for (const record of INTERSTELLAR_ACCURACY) {
        const at = record.points.find((p) => p.daysFromPerihelion === 0);
        if (!at) continue;
        out.push(
          `    ${pad(record.body, 10)} ${km(at.errorKm)} au perihelie ` +
            `(${at.heliocentricAU} UA, soit ${(relativeError(at) * 100).toFixed(4)} %)`
        );
      }
    }
  }

  const illustrative = inventory.rows
    .filter((row) => row.illustrativeSurface)
    .map((row) => {
      const surface = row.textures.find((layer) => layer.layer === 'surface');
      const seen = row.illustrativeVerified ?? 'JAMAIS REVERIFIE';
      return `${pad(row.id, 12)} ${pad(surface?.shipped.join('/') ?? 'aucune', 16)} verifie ${seen}`;
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

  // Un manque ne se lit jamais nu : la RECHERCHE de sources est une donnee gardee
  // (`config/shapeModelGaps.ts`), et l'inventaire la montre a cote du corps qu'elle explique.
  // Sans elle, cette liste ne disait pas si personne n'avait cherche ou si rien n'existe.
  if (SHAPE_MODEL_GAPS.length > 0)
    out.push(
      '',
      '  Pourquoi, apres recherche dans les trois collections de formes du PDS :',
      ...SHAPE_MODEL_GAPS.map(
        (gap) => `    ${pad(gap.body, 12)} ${shapeGapLine(gap)}`
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
