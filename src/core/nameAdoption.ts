/**
 * CE QUE L'UAI AVAIT ADOPTÉ COMME NOMS DE SURFACE À UNE DATE (ligne 22.10, front des noms,
 * 2026-10-02). Module PUR (étapes d'adoption + date → borne), sans DOM ni réseau, comme
 * `core/discovery.ts`.
 *
 * UNE DATE D'ADOPTION N'EST PAS UNE DATE DE CONNAISSANCE. Le gazetteer de l'UAI date l'acte
 * d'adoption, et le dit lui-même : la fiche de Copernicus A (iauId 8421, lue le 2026-10-02)
 * porte « Approval Date : 2006 » et, pour référence, « Named Lunar Formations » de Blagg et
 * Müller, 1935. Et 7 050 des 7 058 noms lunaires de 2006 sont des désignations lettrées, que la
 * page de la Lune dit reprises d'un catalogue de la NASA de 1982. Ce module compte donc des noms
 * OFFICIELS, et la fiche le dit en ces termes.
 *
 * UNE ANNÉE SEULE VAUT L'ANNÉE ENTIÈRE. Le gazetteer publie un jour pour les adoptions récentes
 * (Pluton, le 8 août 2017) et une année pour les anciennes (« 1935 ») : le générateur garde
 * cette précision, mesurée sur 124 fiches de l'UAI. Quand la scène tombe dans une année
 * d'adoption, le compte devient une BORNE, comme celui des lunes de `core/discovery.ts`.
 */

/** Une date d'adoption (« AAAA » ou « AAAA-MM-JJ »), ses noms, et parmi eux les lettrés. */
export type AdoptionStep = readonly [
  on: string,
  names: number,
  lettered: number,
];

/** Ce que l'index déclare pour un corps. */
export interface BodyAdoptions {
  readonly total: number;
  readonly lettered: number;
  readonly steps: readonly AdoptionStep[];
}

const YEAR_ONLY = /^\d{4}$/;

/** Le jour UTC d'un instant, borné comme dans `core/discovery.ts`. */
const utcDay = (date: Date): string => {
  const year = date.getUTCFullYear();
  if (year < 0) return '0000-00-00';
  if (year > 9999) return '9999-99-99';
  return date.toISOString().slice(0, 10);
};

/**
 * Où tombe la scène par rapport à une date d'adoption : avant, pendant (une année seule que la
 * scène traverse, dont la source ne donne pas le jour), ou après.
 */
function relation(on: string, sceneDay: string): 'before' | 'within' | 'after' {
  if (YEAR_ONLY.test(on)) {
    const year = sceneDay.slice(0, 4);
    return year < on ? 'before' : year > on ? 'after' : 'within';
  }
  return sceneDay < on ? 'before' : 'after';
}

/** Une borne : `atLeast` adoptés à coup sûr, `atMost` peut-être. */
export interface AdoptedCount {
  readonly atLeast: number;
  readonly atMost: number;
  readonly total: number;
}

/**
 * Combien de noms étaient adoptés à la date de la scène, séparément pour les noms propres et pour
 * les désignations lettrées : les compter ensemble ferait de la Lune de 2005 un corps à 2 000
 * noms et de celle de 2006 un corps à 9 000, un saut qui n'est qu'un enregistrement.
 */
export function namesAdoptedAt(
  adoptions: BodyAdoptions,
  sceneDate: Date
): { named: AdoptedCount; lettered: AdoptedCount } {
  const day = utcDay(sceneDate);
  const named = { atLeast: 0, atMost: 0 };
  const lettered = { atLeast: 0, atMost: 0 };
  for (const [on, names, letters] of adoptions.steps) {
    const where = relation(on, day);
    if (where === 'before') continue;
    named.atMost += names - letters;
    lettered.atMost += letters;
    if (where === 'after') {
      named.atLeast += names - letters;
      lettered.atLeast += letters;
    }
  }
  return {
    named: { ...named, total: adoptions.total - adoptions.lettered },
    lettered: { ...lettered, total: adoptions.lettered },
  };
}

/**
 * La prochaine adoption APRÈS la date de la scène (une année seule que la scène traverse n'est pas
 * « prochaine » : elle est peut-être déjà passée). `null` quand tout est adopté.
 */
export function nextAdoption(
  adoptions: BodyAdoptions,
  sceneDate: Date
): AdoptionStep | null {
  const day = utcDay(sceneDate);
  return adoptions.steps.find(([on]) => relation(on, day) === 'before') ?? null;
}
