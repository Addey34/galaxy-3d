/**
 * CE QUE LA LECTURE ACCÉLÉRÉE COÛTE, ET LA VITESSE QUE LE LIEN SOUTIENT.
 *
 * Décision du § 9b du plan du lot 17, prise par l'utilisateur le 2026-09-24, option (c) : la
 * date reste EXACTE (D3 entière, aucune position de repli affichée en silence), et c'est le
 * curseur de vitesse qui se plafonne à ce que la connexion soutient, en le disant. Un curseur
 * qui promet un an par seconde sur un lien à 2 Mbit/s ne mesure rien : il fait attendre.
 *
 * Le plafond n'est PAS un nombre écrit à la main. Il se dérive de deux grandeurs :
 *
 * - la DEMANDE, calculée depuis ce que la scène demande vraiment. Quand la date avance d'un pas
 *   de grille, un corps a besoin d'un échantillon de plus, soit `BYTES_PER_SAMPLE` octets tous
 *   les `stepDays` jours simulés. La somme sur les corps couverts à cette date donne des octets
 *   par jour simulé, et la vitesse convertit en octets par seconde réelle ;
 * - le DÉBIT observé (`core/transferRate.ts`), mesuré sur le temps occupé.
 *
 * **La formule est confrontée à la seule mesure publiée du plan, et elle la reproduit** : les
 * 64 corps du manifeste servi en production (5 fichiers au pas de 1 jour, 1 à 2, 39 à 4, 9 à 8,
 * 3 à 16, 7 à 64) donnent **800,2 octets par jour simulé**, donc à la vitesse maximale
 * (`31 557 600`, soit 365,25 jours simulés par seconde) **292 291 octets par seconde, soit
 * 2,34 Mbit/s** : exactement le chiffre mesuré le 2026-09-23 et écrit au § 6 du plan. Ce n'est
 * donc pas un modèle plausible, c'en est un vérifié.
 *
 * Conséquence à écrire, parce qu'elle borne l'utilité de toute la phase : au-dessus de
 * 2,34 Mbit/s il n'y a AUCUN plafond à afficher, la vitesse maximale étant déjà soutenable.
 * Le plafond ne mord qu'en dessous, et c'est là que vit le public du lot 17.
 */
import {
  BYTES_PER_SAMPLE,
  READ_AHEAD_SECONDS,
  WINDOW_MARGIN_SAMPLES,
} from './ephemerisWindow';

const SECONDS_PER_DAY = 86_400;

/** Grille d'un corps, réduite à ce dont le budget a besoin. */
export interface BudgetGrid {
  readonly stepDays: number;
}

/**
 * Octets qu'un jour simulé coûte, tous corps confondus.
 *
 * On ne compte QUE les corps passés en argument : un corps hors couverture ne demande rien
 * (11 sur 64 au 1969-07-20, mesuré), et le compter gonflerait la demande d'un tiers.
 */
export function bytesPerSimulatedDay(grids: Iterable<BudgetGrid>): number {
  let total = 0;
  for (const grid of grids) {
    const step = grid.stepDays;
    if (!Number.isFinite(step) || step <= 0) continue;
    total += BYTES_PER_SAMPLE / step;
  }
  return total;
}

/**
 * Le coût FIXE de la lecture, indépendant de la vitesse : à chaque fois que la fenêtre glisse,
 * ses marges sont redemandées avec elle (`WINDOW_MARGIN_SAMPLES` de chaque côté), et cela se
 * produit environ une fois par période d'avance de lecture.
 *
 * Petit mais réel : 3 072 octets par seconde pour 64 corps, soit 24,6 kbit/s. L'omettre
 * surestimerait la vitesse soutenable là où justement le lien est pauvre.
 */
export function overheadBytesPerSecond(bodyCount: number): number {
  if (!Number.isFinite(bodyCount) || bodyCount <= 0) return 0;
  return (
    (bodyCount * 2 * WINDOW_MARGIN_SAMPLES * BYTES_PER_SAMPLE) /
    READ_AHEAD_SECONDS
  );
}

/** Octets par seconde réelle que la lecture réclame à une vitesse donnée. */
export function demandBytesPerSecond(
  timeScale: number,
  perSimulatedDay: number,
  bodyCount: number
): number {
  if (!Number.isFinite(timeScale) || !Number.isFinite(perSimulatedDay))
    return 0;
  const sliding =
    (Math.abs(timeScale) / SECONDS_PER_DAY) * Math.max(0, perSimulatedDay);
  return sliding + overheadBytesPerSecond(bodyCount);
}

export interface CeilingInput {
  /** Débit observé, en octets par seconde, ou `null` si rien n'a encore été mesuré. */
  readonly bytesPerSecond: number | null;
  /** Octets par jour simulé, cf. `bytesPerSimulatedDay`. */
  readonly perSimulatedDay: number;
  /** Nombre de corps qui demandent des octets à cette date. */
  readonly bodyCount: number;
  /** Vitesse maximale du curseur (`MAX_SIMULATION_SCALE`). */
  readonly maxTimeScale: number;
}

/**
 * La vitesse maximale que le lien soutient, en secondes simulées par seconde réelle.
 *
 * Rend `null` quand il n'y a RIEN à plafonner, et c'est le cas le plus fréquent : aucun débit
 * mesuré, aucun corps à servir, ou un lien qui absorbe déjà la vitesse maximale. `null` veut
 * dire « le curseur garde toute sa course », jamais « on ne sait pas, donc on limite ».
 *
 * Le plancher est le temps réel 1:1. En dessous, le curseur refuserait de montrer le système
 * solaire d'aujourd'hui, alors que la demande y est négligeable (48 octets par corps et par pas
 * de grille) : un lien qui ne soutient pas cela ne chargerait de toute façon pas la page.
 */
export function sustainableTimeScale(input: CeilingInput): number | null {
  const { bytesPerSecond, perSimulatedDay, bodyCount, maxTimeScale } = input;
  if (bytesPerSecond === null || !Number.isFinite(bytesPerSecond)) return null;
  if (!Number.isFinite(perSimulatedDay) || perSimulatedDay <= 0) return null;
  if (!Number.isFinite(maxTimeScale) || maxTimeScale <= 1) return null;
  const budget = bytesPerSecond - overheadBytesPerSecond(bodyCount);
  const raw = (budget * SECONDS_PER_DAY) / perSimulatedDay;
  if (!Number.isFinite(raw)) return null;
  if (raw >= maxTimeScale) return null;
  return Math.max(1, Math.floor(raw));
}
