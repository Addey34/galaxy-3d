/**
 * LA RÉSOLUTION D'UNE ÉTAPE `jumpToEvent` (lot 21), séparée de `config/tourScripts.ts` pour que le
 * lecteur de visites (`ui/tourPlayer.ts`) ne tire aucune fiche : `tourScripts` matérialise toutes
 * les visites et est réservé au build et aux tests (GAL-TOUR-SCALE-001).
 */
import type { AstronomicalEventKind } from '@/core/astronomicalEvents';
import { findUpcomingAstronomicalEvents } from '@/core/astronomicalEvents';

/**
 * Fenêtres de recherche successives, en jours. Élargir plutôt que partir large : une éclipse
 * solaire ou un équinoxe tombe toujours dans les 400 premiers jours, alors qu'une opposition de
 * Mars (780 jours de période synodique) peut en sortir — la première version, calquée sur
 * l'éclipse, aurait donc échoué en silence sur la moitié des formes que le schéma autorise.
 */
const SEARCH_HORIZONS_DAYS = [400, 4000] as const;

/**
 * La prochaine occurrence RÉELLE d'un événement après `referenceDate`, ou `null` si aucune n'est
 * trouvée dans la plus large des fenêtres.
 *
 * C'est ce qui rend une étape `jumpToEvent` possible, et c'est pour cela qu'une fiche n'écrit
 * jamais une date d'éclipse : une date en dur deviendrait fausse avec le temps, une date dérivée
 * ne le devient pas. `src/config/tourScripts.test.ts` résout chaque forme citée par une fiche
 * depuis plusieurs dates de référence, pour que « aucune trouvée » reste un cas théorique.
 *
 * `null` plutôt qu'un repli sur `referenceDate` : l'hôte ne saute alors pas du tout, ce qui est la
 * même chose à l'écran mais se lit dans le code pour ce que c'est.
 */
export function resolveEventDate(
  kind: AstronomicalEventKind,
  referenceDate: Date,
  body?: string
): Date | null {
  for (const horizonDays of SEARCH_HORIZONS_DAYS) {
    // `count` borne la liste APRÈS le tri chronologique : la prendre égale à la fenêtre en jours
    // garantit qu'aucun événement de la fenêtre n'est coupé (leur densité est très inférieure à
    // un par jour), ce qu'un `count` fixe ne garantissait pas.
    const events = findUpcomingAstronomicalEvents(referenceDate, {
      count: horizonDays,
      horizonDays,
    });
    const found = events.find(
      (event) =>
        event.kind === kind && (body === undefined || event.body === body)
    );
    if (found) return found.date;
  }
  return null;
}
