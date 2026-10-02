/**
 * LE CALENDRIER AFFICHÉ (ligne 22.10, années avant J.-C., pas 2, 2026-10-02). Module PUR.
 *
 * L'horloge de l'application compte en millisecondes depuis 1970, dans le calendrier GRÉGORIEN
 * prolongé dans le passé, celui de JavaScript. C'est aussi le format du permalien, qui ne change
 * pas. Mais les historiens datent tout ce qui précède la réforme grégorienne dans le calendrier
 * JULIEN, et Horizons imprime lui-même ses dates ainsi : une éclipse antique ne se retrouverait
 * pas à sa date historique dans un affichage grégorien. Avant le 15 octobre 1582, la barre de
 * temps affiche donc le julien, et ce module fait la conversion.
 *
 * Les années sont ASTRONOMIQUES : l'année 0 est 1 av. J.-C., l'année -584 est 585 av. J.-C. En
 * julien, une année est bissextile quand elle est divisible par 4, y compris l'année 0.
 *
 * Témoins : les dates qu'Horizons imprime pour des jours juliens donnés, lues le 2026-10-02
 * (`calendar.test.ts`), dont le 4 et le 15 octobre 1582 et le 29 février 1500, qu'un champ de date
 * de navigateur, grégorien, refuserait.
 */

const MS_PER_DAY = 86_400_000;
/** Jour julien à 0 h UT le 1er janvier 1970. */
const UNIX_EPOCH_JD = 2_440_587.5;

/** Premier jour du calendrier grégorien : le 15 octobre 1582 suit le 4 octobre julien. */
export const GREGORIAN_REFORM_MS = Date.UTC(1582, 9, 15);

/**
 * Décalage de cycles de quatre ans (1 461 jours) qui ramène toute année dans le domaine où les
 * formules entières sont prouvées (années positives), puis qu'on retire : les formules de
 * Richards supposent des quantités positives, et l'horloge va jusqu'en -9997.
 */
const CYCLES = 4_000;
const CYCLE_DAYS = 1_461;

export interface CalendarDate {
  /** Année astronomique (0 = 1 av. J.-C.). */
  readonly year: number;
  /** 1 à 12. */
  readonly month: number;
  readonly day: number;
}

/** Numéro de jour julien (le jour civil qui commence à minuit) d'un instant. */
function dayNumberOf(ms: number): number {
  return Math.floor(ms / MS_PER_DAY + UNIX_EPOCH_JD + 0.5);
}

/** Date du calendrier JULIEN d'un numéro de jour julien. */
function julianFromDayNumber(jdn: number): CalendarDate {
  const c = jdn + CYCLES * CYCLE_DAYS + 32_082;
  const d = Math.floor((4 * c + 3) / CYCLE_DAYS);
  const e = c - Math.floor((CYCLE_DAYS * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: d - 4_800 + Math.floor(m / 10) - 4 * CYCLES,
  };
}

/** Numéro de jour julien d'une date du calendrier JULIEN. */
function dayNumberOfJulian({ year, month, day }: CalendarDate): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4 * CYCLES + 4_800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    32_083 -
    CYCLES * CYCLE_DAYS
  );
}

/** Nombre de jours d'un mois du calendrier julien. */
export function julianMonthLength(year: number, month: number): number {
  if (month === 2) return ((year % 4) + 4) % 4 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * La date que la barre de temps affiche : julienne avant la réforme, grégorienne ensuite, avec
 * le nom du calendrier, pour que l'étiquette dise toujours lequel est lu.
 */
export function displayedDate(
  ms: number
): CalendarDate & { calendar: 'julian' | 'gregorian' } {
  if (ms < GREGORIAN_REFORM_MS)
    return { ...julianFromDayNumber(dayNumberOf(ms)), calendar: 'julian' };
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    calendar: 'gregorian',
  };
}

/**
 * L'instant d'une date JULIENNE à l'heure du jour de `current` (même règle que le champ de date :
 * changer le jour ne change pas l'heure). `null` si la date n'existe pas dans ce calendrier
 * (un 30 février, un mois 13) : la barre garde alors la sienne plutôt que de sauter n'importe où.
 */
export function fromJulianDate(
  date: CalendarDate,
  current: number
): number | null {
  const { year, month, day } = date;
  if (![year, month, day].every(Number.isInteger)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > julianMonthLength(year, month)) return null;
  const timeOfDay = ((current % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
  return (
    (dayNumberOfJulian(date) - UNIX_EPOCH_JD - 0.5) * MS_PER_DAY + timeOfDay
  );
}
