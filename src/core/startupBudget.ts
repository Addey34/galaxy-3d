/**
 * LE BUDGET DU DÉMARRAGE, PAR FAMILLE — ET JAMAIS EN UN SEUL TOTAL (lot 17, phase 17F).
 *
 * Module PUR : aucune E/S, aucun DOM, aucun état. Il porte la RÈGLE et les plafonds ; la mesure
 * qui les fonde vit dans `scripts/measure-startup-bytes.mjs`, la confrontation aux artefacts
 * réellement livrés dans `src/config/startupBudget.test.ts` (éphémérides, textures, modèles) et
 * `scripts/check-startup-budget.mjs` (JavaScript, qui exige un build). Plan et journal :
 * `docs/private/EPHEMERIDES_LOT17.md` § 11.
 *
 * POURQUOI PAR FAMILLE, et c'est la décision centrale de la phase. Un budget GLOBAL (« le
 * démarrage doit tenir sous N octets ») créerait une pression permanente à dégrader les textures
 * pour financer autre chose : elles sont la plus grosse famille du démarrage (59,6 % des octets
 * servis, mesuré en production le 2026-09-26), donc le chemin le moins cher pour faire entrer un
 * bundle qui grossit. Ce serait la contradiction frontale de la règle de parité du lot 16, qui
 * vient justement de POSER que chaque corps livre l'échelle complète de ce que sa source contient.
 * Améliorer une texture ne doit jamais pouvoir échouer à cause d'une régression d'éphéméride, ni
 * l'inverse : les verdicts sont donc rendus famille par famille, sans qu'aucune somme ne circule
 * entre elles (`judgeFamilies`, et la garde qui la falsifie en faisant varier une famille).
 *
 * DEUX ORIGINES DE PLAFOND, et la différence n'est pas cosmétique :
 *
 *   - **dérivé** (textures, modèles) : le plafond ne se choisit pas, il se RECALCULE depuis la
 *     règle du palier plancher. Le démarrage ne demande que le palier le plus grossier livré
 *     (`core/textureLadder.TIERS[0]`, `core/modelLod.MODEL_QUALITY_ORDER[0]`), donc ajouter un
 *     palier 2k, 4k ou 8k ne coûte RIEN au démarrage et ne peut pas faire rougir cette garde ;
 *     et rétrécir une texture ferait baisser le coût ET le plafond du même NOMBRE d'octets, donc
 *     n'achèterait rien — tandis que `src/config/textureLadder.test.ts` le refuse par ailleurs.
 *     Cette famille ne peut donc pas être satisfaite en dégradant la qualité. Ce qui la fait
 *     rougir est précis : le démarrage qui se met à demander PLUS GROS que le plancher ;
 *   - **posé** (éphémérides, JavaScript) : ces deux familles coûtent par une DÉCISION de
 *     chargement (quelle fenêtre on demande) ou par du code (un bundle grossit à chaque lot).
 *     Rien ne les dérive d'une règle existante, donc leur plafond est un nombre, avec sa mesure,
 *     sa marge et la raison de cette marge écrites à côté. Les relever se fait sciemment, dans le
 *     commit qui l'explique.
 *
 * UNITÉ : tous les plafonds sont en octets BRUTS, ceux des fichiers livrés, jamais ceux du fil.
 * C'est la seule grandeur que le dépôt contrôle et qu'une machine sans réseau peut recompter.
 * Le rapport entre les deux est MESURÉ, pas supposé (production, 2026-09-26, en-têtes comprises) :
 * textures **0,984**, maillages glTF **0,77**, JavaScript **0,25**, et les plages d'éphémérides
 * légèrement AU-DESSUS de 1 (leurs en-têtes pèsent plus que ce qu'un 206 économise). Le 0,984 des
 * textures surprend et c'est une mesure : Firebase comprime bel et bien certains JPEG à faible
 * entropie — la surface 1k d'Uranus tombe de 11 230 à 3 658 octets (0,33), le ciel 8k de 979 007 à
 * 855 737 (0,87). Mélanger les deux grandeurs dans une même colonne serait exactement la confusion
 * que ce dépôt refuse.
 */
import { MODEL_QUALITY_ORDER, type ModelQuality } from './modelLod';
import { TIERS } from './textureLadder';
import type { TextureQuality } from '@/types';

/**
 * Familles d'octets du démarrage. Les quatre premières ont un budget ; les autres existent pour
 * que le relevé ne cache rien — une famille « divers » qui grossit sans nom est exactement la
 * façon dont un budget se contourne sans mentir. C'est arrivé : le « autres, 2 228 918 o, 4,9 % »
 * du § 2 du plan n'a jamais été ouvert, et cette phase a mesuré une fois, au même endroit,
 * 2 263 107 octets de trois images WMS de NASA GIBS (1,5 % d'écart, mêmes couches). Ce sont donc
 * très probablement les mêmes octets, mais je ne l'affirme pas : la mesure du plan n'a pas été
 * refaite, et ces trois requêtes ne sont réapparues dans aucune des huit visites suivantes.
 */
export type StartupFamily =
  | 'ephemerides'
  | 'textures'
  | 'models'
  | 'javascript'
  | 'small-bodies'
  | 'external-imagery'
  | 'css'
  | 'html'
  | 'other';

/** Les quatre familles budgétées, dans l'ordre où le relevé les imprime. */
export const BUDGETED_FAMILIES = [
  'ephemerides',
  'textures',
  'models',
  'javascript',
] as const;

export type BudgetedFamily = (typeof BUDGETED_FAMILIES)[number];

/**
 * À quelle famille appartient une URL du démarrage.
 *
 * Écrit ici, une seule fois, parce que trois lecteurs en ont besoin et qu'une copie dériverait :
 * la mesure en vrai navigateur (`scripts/measure-startup-bytes.mjs`), la garde de build
 * (`scripts/check-startup-budget.mjs`) et la garde e2e (`e2e/startupBudget.spec.ts`).
 *
 * Le classement se fait sur le CHEMIN servi, jamais sur l'hôte, à une exception NOMMÉE près :
 * l'imagerie externe, qui ne vit que sur un autre hôte et que son chemin ne suffit pas à
 * reconnaître. Cette exception existe parce que ces octets sont bien à la charge du démarrage,
 * même s'ils ne sortent pas de ce dépôt.
 */
export function classifyStartupUrl(url: string): StartupFamily {
  let path = url;
  let host = '';
  try {
    const parsed = new URL(url, 'https://example.invalid');
    path = parsed.pathname;
    host = parsed.hostname;
  } catch {
    /* Une URL non analysable est classée sur la chaîne brute : mieux que de la perdre. */
  }
  if (path.includes('/assets/ephemerides/')) return 'ephemerides';
  if (path.includes('/assets/textures/')) return 'textures';
  if (path.includes('/assets/models/')) return 'models';
  if (path.includes('/assets/small-bodies/')) return 'small-bodies';
  if (/(^|\.)(gibs|earthdata)\.(earthdata\.)?nasa\.gov$/.test(host))
    return 'external-imagery';
  if (/\.m?[jt]sx?$/.test(path)) return 'javascript';
  if (/\.css$/.test(path)) return 'css';
  if (path === '/' || /\.html?$/.test(path)) return 'html';
  return 'other';
}

/** Ce qu'une famille a coûté, et ce qu'elle avait le droit de coûter. */
export interface FamilyCost {
  readonly family: BudgetedFamily;
  /** Octets BRUTS que le démarrage demande à cette famille. */
  readonly bytes: number;
  /** Plafond de CETTE famille. Aucune autre famille n'entre dans ce nombre. */
  readonly budgetBytes: number;
  /** Comment ce plafond a été obtenu, en une phrase lisible dans le rapport. */
  readonly method: string;
}

export interface FamilyVerdict extends FamilyCost {
  readonly withinBudget: boolean;
  /** Octets restants. Négatif quand le budget est dépassé. */
  readonly headroomBytes: number;
}

/**
 * Le verdict de chaque famille, rendu INDÉPENDAMMENT des autres.
 *
 * C'est la propriété que la phase doit tenir, et elle est falsifiable : une version qui sommerait
 * les familles avant de comparer laisserait une texture allégée financer un bundle qui grossit.
 * `startupBudget.test.ts` le vérifie en faisant varier une famille et en exigeant que le verdict
 * des autres ne bouge pas d'un iota.
 */
export function judgeFamilies(
  costs: readonly FamilyCost[]
): readonly FamilyVerdict[] {
  return costs.map((cost) => ({
    ...cost,
    withinBudget: cost.bytes <= cost.budgetBytes,
    headroomBytes: cost.budgetBytes - cost.bytes,
  }));
}

// ---------------------------------------------------------------------------
// FAMILLES DÉRIVÉES : le plafond se recalcule, il ne se choisit pas.
// ---------------------------------------------------------------------------

/**
 * Le palier PLANCHER de l'échelle : le plus grossier de `core/textureLadder.TIERS`.
 *
 * `resolveLadder` le livre toujours dès qu'une texture existe — « c'est le niveau de démarrage,
 * et le refuser ferait disparaître le corps plutôt que l'alléger ». Le budget des textures du
 * démarrage est donc entièrement dicté par cette règle-là, sans qu'aucun nombre soit posé ici.
 */
export const TEXTURE_FLOOR_TIER: TextureQuality = TIERS[0]!;

/** Le niveau de maillage le plus léger : celui que le LOD charge d'abord. */
export const MODEL_FLOOR_QUALITY: ModelQuality = MODEL_QUALITY_ORDER[0]!;

/**
 * Ce que la PREMIÈRE VUE résout légitimement au-dessus du plancher, nommément.
 *
 * Deux cas, MESURÉS en production le 2026-09-26 et non déduits : ce sont les deux seules
 * textures que le démarrage demande à un palier supérieur à 1k. Chacune est là parce que le LOD
 * fait son travail, pas parce qu'un chargement dérape — mais elles pèsent 1 253 862 octets du
 * fil à elles deux (18,3 % de la famille), donc les laisser dans une somme anonyme aurait rendu
 * le budget illisible.
 *
 * Une troisième entrée qui apparaîtrait fait ROUGIR la garde, et c'est le but : soit la première
 * vue s'est mise à charger un palier fin sans qu'on le veuille, soit c'est légitime et il faut
 * l'écrire ici avec sa raison. Dérivé plutôt que décrété : leurs octets sont LUS sur les fichiers
 * livrés, jamais tapés.
 */
export interface FirstViewRefinement {
  readonly body: string;
  readonly layer: string;
  readonly tier: TextureQuality;
  readonly reason: string;
}

export const FIRST_VIEW_TEXTURE_REFINEMENTS: readonly FirstViewRefinement[] = [
  {
    body: 'stars',
    layer: 'surface',
    tier: '8k',
    reason:
      "le ciel entoure la caméra : sa distance normalisée est nulle, donc le LOD résout le palier `ultra`. C'est la seule texture dont on ne s'éloigne jamais.",
  },
  {
    body: 'sun',
    layer: 'surface',
    tier: '2k',
    reason:
      'la première vue est centrée sur le Soleil, à moins de 40 rayons : le LOD résout `medium`. Son 1k est demandé aussi, par le préchargement, et cela reste le comportement voulu (voir grossier tout de suite, puis net).',
  },
];

/** Un corps que le démarrage précharge, et les paliers de texture réellement livrés. */
export interface TextureFloorInput {
  readonly body: string;
  readonly layer: string;
  /**
   * Paliers livrés pour cette couche, DANS L'ORDRE DÉCLARÉ par le catalogue. L'ordre compte : cf.
   * `bootTierForFarLayer`.
   */
  readonly declared: readonly TextureQuality[];
  /** Octets de chaque palier livré, lus sur les fichiers. */
  readonly bytesByTier: Readonly<Partial<Record<TextureQuality, number>>>;
}

/**
 * Le palier qu'une couche VUE DE LOIN reçoit au démarrage — et pourquoi l'ORDRE DÉCLARÉ décide.
 *
 * `TextureSystem.chooseTextureQuality` n'a aucun palier dont le seuil de distance couvre la
 * distance 100 que `_loadAllTextures` passe (le plus permissif est `low`, à 80). Il tombe donc
 * dans son repli, qui prend le DERNIER palier déclaré (`[...resolutions].reverse().find(...)`).
 * Le démarrage ne demande donc le plancher que parce que le catalogue déclare ses résolutions du
 * plus GRAND au plus PETIT. Cette dépendance est réelle — un corps déclaré à l'envers enverrait son
 * 8k au démarrage — et elle a DÉJÀ un propriétaire : `config/catalogValidation.ts` refuse un ordre
 * croissant (« resolutions must be ordered from highest to lowest »), fail-fast au chargement du
 * catalogue. Le budget des textures ne recopie pas cette règle, il vérifie qu'elle tient toujours
 * (`src/config/startupBudget.test.ts`), parce qu'il en dépend.
 *
 * J'avais d'abord écrit ici que rien ne tenait cet ordre. C'était FAUX, et c'est ma propre
 * falsification qui l'a dit : la mutation « déclarer un corps à l'envers » est bien rouge, mais
 * elle échoue au chargement du catalogue, pas dans la garde de budget. Une garde rouge pour la
 * mauvaise raison ne prouve pas ce qu'on croit.
 */
export function bootTierForFarLayer(
  declared: readonly TextureQuality[]
): TextureQuality | null {
  return declared.length === 0 ? null : declared[declared.length - 1]!;
}

/** Ce qu'une couche préchargée coûte au démarrage, et si c'est bien son plancher qui est servi. */
export interface FloorTierLine {
  readonly body: string;
  readonly layer: string;
  /** Palier que le démarrage demande vraiment. */
  readonly tier: string;
  readonly bytes: number;
  /** Faux quand le démarrage demande autre chose que le plancher de l'échelle. */
  readonly isFloor: boolean;
}

/**
 * Budget des TEXTURES du démarrage : la somme du palier plancher de chaque couche que le
 * démarrage touche, plus les raffinements de première vue NOMMÉS ci-dessus.
 *
 * Trois conséquences, et ce sont elles qui font que cette garde ne peut pas pousser à dégrader :
 *
 *   1. ajouter un palier 2k, 4k ou 8k à un corps ne change PAS ce nombre, le démarrage ne le
 *      demandant pas ;
 *   2. rétrécir une texture ferait baisser le coût ET le plafond ensemble : cette garde
 *      n'achèterait rien, et `textureLadder.test.ts` le refuse de son côté ;
 *   3. un corps de plus fait monter ce nombre, et c'est légitime — la règle de parité veut qu'il
 *      ait ce que les autres ont. La garde s'ajuste d'elle-même au lieu de bloquer l'ajout.
 */
export function textureFloorBudget(inputs: readonly TextureFloorInput[]): {
  readonly bytes: number;
  readonly lines: readonly FloorTierLine[];
} {
  const lines = inputs.map((input) => {
    const tier = bootTierForFarLayer(input.declared);
    return {
      body: input.body,
      layer: input.layer,
      tier: tier ?? '(aucun palier livré)',
      bytes: tier ? (input.bytesByTier[tier] ?? 0) : 0,
      isFloor: tier === TEXTURE_FLOOR_TIER,
    };
  });
  return { bytes: lines.reduce((sum, line) => sum + line.bytes, 0), lines };
}

/** Un corps modélisé, et les niveaux de maillage livrés. */
export interface ModelFloorInput {
  readonly body: string;
  readonly shipped: readonly ModelQuality[];
  readonly bytesByQuality: Readonly<Partial<Record<ModelQuality, number>>>;
}

/**
 * Budget des MODÈLES du démarrage : le niveau le plus léger de chaque corps modélisé.
 *
 * Même dérivation que les textures, sur la règle de `core/modelLod` : « on charge d'abord le plus
 * léger ; le plus fin n'est téléchargé que si la caméra s'approche ASSEZ pour qu'il se voie ». Un
 * 4k ajouté ne coûte donc rien au démarrage. À la différence des textures, le repli de
 * `chooseModelQuality` trie explicitement par niveau : l'ordre de déclaration ne décide de rien.
 */
export function modelFloorBudget(inputs: readonly ModelFloorInput[]): {
  readonly bytes: number;
  readonly lines: readonly FloorTierLine[];
} {
  const lines = inputs.map((input) => {
    const quality =
      MODEL_QUALITY_ORDER.find((candidate) =>
        input.shipped.includes(candidate)
      ) ?? null;
    return {
      body: input.body,
      layer: 'shape',
      tier: quality ?? '(aucun niveau livré)',
      bytes: quality ? (input.bytesByQuality[quality] ?? 0) : 0,
      isFloor: quality === MODEL_FLOOR_QUALITY,
    };
  });
  return { bytes: lines.reduce((sum, line) => sum + line.bytes, 0), lines };
}

// ---------------------------------------------------------------------------
// FAMILLES À PLAFOND POSÉ : un nombre, sa mesure, sa marge et la raison de la marge.
// ---------------------------------------------------------------------------

/**
 * ÉPHÉMÉRIDES : 1 800 000 octets bruts pour la fenêtre de démarrage.
 *
 * MESURE, et elle a corrigé le chiffre que cette série citait depuis 17C. La fenêtre de démarrage
 * a été balayée sur TOUTE la couverture livrée (`src/config/startupBudget.test.ts` fait tourner
 * le VRAI service contre les VRAIS binaires du dépôt, via `core/horizonsTestFixture` : ce n'est
 * pas une re-dérivation du plan, c'est le chemin de production). Elle varie d'un facteur 80 :
 *
 *     1900-06-15      21 216 o   presque tout hors couverture
 *     1969-07-20     984 624 o   onze corps hors couverture, et la ligne d'Uranus dedans
 *     2015-06-15   1 709 040 o   PIRE CAS : la ligne de Neptune y tient, à elle seule 722 544 o
 *     2026-09-23     987 264 o   la date de référence du plan (17C en mesurait 987 168 dans un
 *                                navigateur : un échantillon d'écart, 96 octets)
 *     2099-12-01      57 888 o   bord de couverture : les fenêtres larges se réduisent d'elles-mêmes
 *
 * Les 987 168 octets de 17C sont donc un cas MOYEN, ni le pire ni un majorant : une adresse datée
 * de l'an 2000 (`?date=2000-01-01`) fait payer 1,71 Mo au démarrage, parce que la demi-période de
 * Neptune ne tient dans la couverture qu'entre 1982 et 2018 environ. Le piège 8 du plan — « une
 * date de mesure peut flatter la conception » — est donc confirmé, et dans le sens qui coûte.
 * C'est le PIRE cas qui est budgété : un budget posé sur la date du jour serait dépassé par un
 * simple lien daté, ce qui ferait rougir la garde pour une utilisation parfaitement normale.
 *
 * MARGE : +90 960 octets, soit +5,3 %. Mesurée elle aussi : sur le plateau 1982-2018 le total
 * oscille de 1 707 312 à 1 709 040 octets selon le jour (la grille de chaque fichier ne tombe pas
 * au même endroit), donc une marge de quelques milliers d'octets est déjà nécessaire pour ne pas
 * rougir un jour sur deux. Le reste couvre la croissance ORDINAIRE. Ce qui fait monter cette
 * famille n'est pas le code mais le CATALOGUE : une ligne d'orbite coûte une période entière, donc
 * 722 544 o pour Neptune, 368 496 pour Uranus, 332 832 pour Halley. Un seul corps à longue période
 * ajouté épuiserait la marge, et c'est VOULU : il faut alors regarder, et probablement prendre la
 * piste que 17C a identifiée sans la prendre — ne calculer que les lignes réellement VISIBLES,
 * qui retirerait à elle seule les 332 832 octets de Halley, dont l'orbite est éteinte par défaut.
 */
export const EPHEMERIS_STARTUP_BUDGET_BYTES = 1_800_000;

/**
 * JAVASCRIPT : 1 300 000 octets bruts pour tout ce que le démarrage exécute.
 *
 * MESURE. 1 221 328 octets bruts au 2026-09-26, lus dans `dist/` : la clôture des imports
 * STATIQUES depuis l'entrée (551 458 + 525 159 + 71 200 + 11 808) plus les six morceaux que le
 * démarrage importe dynamiquement (`BOOT_DYNAMIC_CHUNKS`, 61 703 octets). Sur le fil, en brotli,
 * cela fait 310 080 octets mesurés en production — d'où le rapport 0,25 écrit en tête de fichier.
 *
 * MARGE : +78 672 octets, soit +6,4 %. Elle est calibrée sur l'HISTOIRE mesurée de ce bundle,
 * pas au hasard : les trois phases précédentes l'ont fait grossir de 8 201 (17C), 4 087 (17D) et
 * 9 267 octets (17E). La marge couvre donc environ huit lots de cette taille. Au-delà, ce n'est
 * plus de la croissance ordinaire et quelqu'un doit regarder — ce qui est exactement le service
 * qu'un budget rend.
 */
export const JAVASCRIPT_STARTUP_BUDGET_BYTES = 1_300_000;

/**
 * Les morceaux que le démarrage charge par import DYNAMIQUE, nommés avec leur raison.
 *
 * Ils ne sont pas dans la clôture statique de l'entrée, donc rien ne les y trouverait ; et ils
 * sont bel et bien demandés avant que le chargeur se masque (mesuré en production le 2026-09-26).
 * Les compter est la seule façon honnête de budgéter cette famille.
 *
 * Le pendant de cette liste est la garde qui compte : TOUT autre morceau de `dist/assets/*.js`
 * doit rester hors du démarrage. Cinq y sont aujourd'hui, et c'est délibéré (le résumé de
 * validation, le moteur de surfaces, le noyau SPK, les deux façades de fiches de surface) : si
 * l'un d'eux entrait dans la clôture statique, le budget s'en apercevrait au lieu de le subir.
 */
export interface BootDynamicChunk {
  /** Nom du morceau SANS son empreinte : `GLTFLoader`, pas `GLTFLoader-BuLyuW6a.js`. */
  readonly chunk: string;
  readonly reason: string;
}

/**
 * Les morceaux qui restent HORS du démarrage, nommés avec leur raison.
 *
 * Cette liste est le pendant de la précédente, et elle existe pour une raison précise : sans
 * elle, vider `BOOT_DYNAMIC_CHUNKS` ferait baisser le coût mesuré de 61 703 octets sans qu'aucune
 * garde ne rougisse — un budget qui compte moins que la réalité est pire qu'aucun budget. Avec les
 * deux, la partition de `dist/assets/*.js` est EXHAUSTIVE : tout morceau est dans la clôture
 * statique, déclaré dynamique au démarrage, ou déclaré hors démarrage. Un morceau neuf oblige donc
 * à trancher, et un morceau retiré d'une liste tombe dans le vide, où le script le voit.
 */
export const NON_BOOT_CHUNKS: readonly BootDynamicChunk[] = [
  {
    chunk: 'horizons-validation-summary',
    reason:
      "le résumé de validation contre Horizons n'est lu que par le bloc « Position à cette date » de la fiche, chargé à l'ouverture (`ui/positionProvenance`). Un morceau que le démarrage ne paie pas, et dont le poids n'est pas recopié ici : il est mesuré par `pnpm budget:startup`, et le lot 39 l'a fait grossir d'un tiers en pavant la profondeur du temps.",
  },
  {
    chunk: 'PlanetarySurfaceEngine',
    reason:
      "l'imagerie de surface n'est demandée qu'à l'approche d'un corps qui déclare un jeu de tuiles, jamais au démarrage ni au-dessus de 6 rayons apparents (lot 9, phase 9C).",
  },
  {
    chunk: 'surfaceTilesets',
    reason: 'façade des fiches de tuiles, chargée avec le moteur de surfaces.',
  },
  {
    chunk: 'surfaceHeights',
    reason:
      'façade des fiches de hauteurs, chargée avec le moteur de surfaces.',
  },
  {
    chunk: 'SpkKernelWorker',
    reason:
      "le noyau SPK est optionnel et `SPK_SETTINGS.url` vaut `null` sans `VITE_SPK_KERNEL_URL`, qui n'est défini nulle part dans la CI.",
  },
];

/**
 * DES MORCEAUX DONT LE DÉMARRAGE NE CHARGE QU'UN SEUL — et pourquoi il fallait le dire.
 *
 * Depuis le lot 20, les dictionnaires de langue arrivent par import dynamique : un visiteur
 * charge `dict-fr`, OU `dict-es`, OU `dict-pt-BR`, jamais deux. Les compter tous les trois
 * surestimerait le démarrage de deux dictionnaires ; n'en compter aucun le sous-estimerait pour
 * les trois quarts des visiteurs, puisque seul l'anglais est dans la clôture statique. Le budget
 * prend donc le PLUS LOURD du groupe, ce qui est le pire cas réel.
 *
 * Une cinquième langue n'ajoutera donc rien au budget, sauf si son dictionnaire devient le plus
 * lourd — et c'est exactement la propriété qu'on veut : traduire l'application ne coûte pas au
 * démarrage, seule la langue effectivement lue est payée.
 */
export interface BootExclusiveGroup {
  /** Noms de morceaux SANS empreinte, comme `BOOT_DYNAMIC_CHUNKS`. */
  readonly chunks: readonly string[];
  readonly reason: string;
}

export const BOOT_EXCLUSIVE_CHUNK_GROUPS: readonly BootExclusiveGroup[] = [
  {
    chunks: ['dict-fr', 'dict-es', 'dict-pt-BR'],
    reason:
      "un visiteur charge le dictionnaire de SA langue et d'aucune autre (`i18n/locales.loadDictionary`) ; l'anglais, lui, reste dans la clôture statique parce qu'il est le repli de `t()`.",
  },
  {
    chunks: ['catalogue-fr', 'catalogue-es', 'catalogue-pt-BR'],
    reason:
      "le TEXTE du catalogue (descriptions, noms, crédits, raisons) suit la même règle que le dictionnaire depuis le lot 20 : le bundle ne porte que l'anglais des fiches, et la langue active arrive dans sa propre carte (`config/catalogueText`, greffon `deriveRegistryText`). Avant cela, les quatre langues du registre étaient inlinées pour tout le monde, soit 50 263 octets payés par un anglophone qui ne les lit jamais.",
  },
];

/**
 * Ce qu'un groupe exclusif coûte au démarrage : son membre le plus lourd.
 *
 * Pur et testé, parce que c'est la seule règle du budget qui ne soit pas une somme : une version
 * qui additionnerait le groupe rendrait le budget faux dans le sens confortable (trop gros), et
 * une version qui l'ignorerait le rendrait faux dans le sens dangereux.
 */
export function exclusiveGroupCost(
  group: BootExclusiveGroup,
  bytesOf: (chunk: string) => number
): { readonly chunk: string; readonly bytes: number } {
  let worst = { chunk: '', bytes: -1 };
  for (const chunk of group.chunks) {
    const bytes = bytesOf(chunk);
    if (bytes > worst.bytes) worst = { chunk, bytes };
  }
  return worst;
}

export const BOOT_DYNAMIC_CHUNKS: readonly BootDynamicChunk[] = [
  {
    chunk: 'GLTFLoader',
    reason:
      'les quinze corps irréguliers chargent leur maillage le plus léger dès leur création (`CelestialObject`), donc le chargeur glTF arrive au démarrage.',
  },
  {
    chunk: 'EffectComposer',
    reason:
      "la chaîne de post-traitement est montée par `SceneSystem` à l'initialisation.",
  },
  { chunk: 'RenderPass', reason: 'première passe de cette même chaîne.' },
  { chunk: 'OutputPass', reason: 'dernière passe de cette même chaîne.' },
  { chunk: 'Pass', reason: 'classe de base des passes ci-dessus.' },
  {
    chunk: 'GlowPass',
    reason:
      "la couronne solaire est visible dès la première image, donc sa passe l'est aussi.",
  },
];
