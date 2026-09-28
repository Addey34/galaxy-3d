/**
 * LE PAS D'UN SATELLITE : ce qu'il coûterait de le raffiner, et pourquoi on ne le fait pas.
 *
 * Module PUR (aucune E/S) : il porte la RÈGLE, l'arithmétique du coût, et la liste des refus
 * DÉCLARÉS. La mesure qui les fonde vit dans `scripts/measure-propagation-error.mjs`
 * (`pnpm ephemeris:propagation`) ; la confrontation au relevé livré vit dans
 * `src/config/ephemerisStepBudget.test.ts`.
 *
 * POURQUOI CE FICHIER EXISTE. La règle de parité de l'utilisateur est sans ambiguïté : chaque
 * corps a ce qu'ont les autres, et « un manque est soit comblé, soit écrit avec sa raison ;
 * jamais laissé de côté sans le dire ». Six satellites dépassent un rayon d'écart médian. Le
 * manque est ici ÉCRIT, avec le pas qui le comblerait et les octets que ce pas coûterait, pour
 * que la décision se relise et se conteste au lieu de se deviner.
 *
 * CE QUE LA MESURE A ÉTABLI, et qui n'était pas ce qu'on croyait :
 *
 *   - le DÉMARRAGE n'est pas la contrainte. Depuis le lot 17C les fichiers se lisent par
 *     fenêtres HTTP `Range` : chacune de ces lunes coûte 336 octets au démarrage, et au pas
 *     d'une heure 816. Le pire cas budgété (1 709 040 o) est fait aux quatre cinquièmes par
 *     Neptune, Uranus et Halley, dont la LIGNE D'ORBITE coûte une période entière ;
 *   - la contrainte est le FICHIER LIVRÉ, et elle est économique : Firebase Hosting facture la
 *     somme des versions RETENUES, donc un octet livré se paie autant de fois qu'il y a de
 *     versions gardées (cf. `scripts/check-deploy-size.mjs`, et le jour où le noyau SPK de
 *     638 Mo a fait sauter le quota de 10 Go). La charge utile est déjà à 366,1 Mo ;
 *   - le repli képlérien est BIEN PIRE que le binaire grossier (Mimas : 504 rayons contre 4,3),
 *     donc rétrécir la couverture pour financer un pas fin dégraderait tout le reste du temps.
 *     C'est mesuré, et c'est ce qui a écarté cette piste ;
 *   - aucun réglage à zéro octet ne reste : le facteur `meanMotionScale` a été BALAYÉ sur
 *     Amalthée (1,0060 rend 1 181 km, 1,0069219 — la valeur publiée — 1 100, 1,0081 1 225), il
 *     est donc déjà à son optimum.
 *
 * CE QUI FERAIT CHANGER D'AVIS, et c'est écrit pour que ce ne soit pas une position de principe :
 * un coût qui tombe (un format d'échantillon plus compact — les fichiers relatifs à leur parent
 * ont une amplitude minuscule, piste NON mesurée), une source exacte servie autrement (le noyau
 * SPK place Mimas, Encelade et Téthys à 0,00 km, mais il pèse 638 Mo et `firebase.json`
 * l'exclut délibérément du déploiement), ou une décision assumée de payer les octets.
 */
import { BYTES_PER_SAMPLE } from '@/core/ephemerisWindow';

/**
 * Jours de la couverture DÉCLARÉE au manifeste (`coverage`), 1900-01-01 → 2101-01-01.
 *
 * C'est la couverture DEMANDÉE, pas la portée obtenue : celle-ci dépend du pas, puisque la
 * grille ne retombe pas sur la fin (73 412 jours au pas de 4, 73 408 au pas de 8). Avec la
 * troncature ci-dessous, ce nombre reproduit EXACTEMENT le compte d'échantillons de tous les
 * fichiers de pleine couverture livrés, à chacun de leurs quatre pas.
 */
export const FULL_COVERAGE_DAYS = 73_414;

/** Écart médian visé, en rayons du corps. C'est la mesure de fin de la ligne 22.2. */
export const TARGET_MEDIAN_RADII = 1;

/** Octets d'un binaire de pleine couverture au pas donné, en jours. */
export function shippedBytesForStep(stepDays: number): number {
  if (!(stepDays > 0)) throw new Error(`pas invalide : ${stepDays}`);
  return (Math.floor(FULL_COVERAGE_DAYS / stepDays) + 1) * BYTES_PER_SAMPLE;
}

/** Pourquoi un pas n'est pas raffiné. Une raison par CAUSE, jamais une phrase libre. */
export type StepRefusalReason =
  /** Le pas qui tiendrait la cible coûte trop d'octets livrés, et le coût est chiffré ici. */
  | 'cost-in-shipped-bytes'
  /**
   * Le modèle linéaire ne sait pas chiffrer ce corps : le pas visé sortirait de son domaine
   * (au-delà d'un dixième de révolution). Ce n'est pas un refus de payer, c'est un aveu de
   * ne pas savoir, et il vaut mieux que le nombre inventé qui le remplacerait.
   */
  | 'beyond-the-model';

export interface DeclaredStepRefusal {
  /** Nom du corps au catalogue. */
  readonly body: string;
  /**
   * Écart médian SERVI, en rayons, lu au relevé de validation committé : précisément son
   * `radii.median`, la MÉDIANE DES RAPPORTS date par date.
   *
   * Ce n'est pas tout à fait ce qu'imprime `pnpm inventory:gaps`, qui divise l'écart médian en
   * km par le rayon, donc un RAPPORT DE MÉDIANES : les deux diffèrent au dernier chiffre
   * (Mimas, 4,29 ici contre 4,30 là). Les deux sont justes, ce sont deux statistiques ; c'est
   * écrit pour que la question ne se repose pas.
   */
  readonly medianRadii: number;
  /** Pas qui tiendrait la cible, en minutes, ou `null` si le modèle ne sait pas le dire. */
  readonly neededStepMinutes: number | null;
  readonly reason: StepRefusalReason;
}

/**
 * LES REFUS, corps par corps. Chiffres LUS de `pnpm ephemeris:propagation` et du relevé de
 * validation committé ; le test les recalcule et rougit si l'un a dérivé — notamment si un
 * corps s'améliore et n'a plus rien à faire ici.
 *
 * Le coût n'est PAS écrit ici : il se dérive du pas par `shippedBytesForStep`, pour qu'aucun
 * nombre ne puisse mentir en silence.
 */
export const REFUSED_STEP_REFINEMENTS: readonly DeclaredStepRefusal[] = [
  {
    body: 'amalthea',
    medianRadii: 15.04,
    neededStepMinutes: 15,
    reason: 'cost-in-shipped-bytes',
  },
  {
    body: 'mimas',
    medianRadii: 4.29,
    neededStepMinutes: 91,
    reason: 'cost-in-shipped-bytes',
  },
  {
    body: 'enceladus',
    medianRadii: 2.98,
    neededStepMinutes: 216,
    reason: 'cost-in-shipped-bytes',
  },
  {
    body: 'deimos',
    medianRadii: 1.3,
    neededStepMinutes: null,
    reason: 'beyond-the-model',
  },
  {
    body: 'phobos',
    medianRadii: 1.19,
    neededStepMinutes: null,
    reason: 'beyond-the-model',
  },
  {
    body: 'tethys',
    medianRadii: 1.15,
    neededStepMinutes: null,
    reason: 'beyond-the-model',
  },
];

/** Octets que coûteraient TOUS les raffinements refusés qui savent se chiffrer. */
export function refusedRefinementBytes(
  refusals: readonly DeclaredStepRefusal[] = REFUSED_STEP_REFINEMENTS
): number {
  let total = 0;
  for (const refusal of refusals) {
    if (refusal.neededStepMinutes === null) continue;
    total += shippedBytesForStep(refusal.neededStepMinutes / 1440);
  }
  return total;
}
