/**
 * Panneau des événements astronomiques : LANCEUR seulement (GAL-PERF-001B-01). `ui/astronomicalEvents.ts`
 * (construction du panneau, calcul des huit prochains événements, feuille de style) n'est plus dans le
 * démarrage : le déclencheur `#events-trigger` est statique dans le HTML, et le clic qui l'ouvre lance
 * le chargement, SANS second clic. Les calculs scientifiques (`core/astronomicalEvents`) restent
 * dans le démarrage : les visites (`jumpToEvent`) et les pages d'éclipse les utilisent.
 *
 * Le contrat, un point par risque :
 *   - une seule charge en vol : un clic pendant le chargement ne fait rien (pas de file, pas
 *     d'ouverture-fermeture) ; une seule instance du panneau, créée à la fin du premier chargement ;
 *   - l'ouverture est une INTENTION, qui expire si le visiteur fait autre chose avant l'arrivée du
 *     module : une autre surface s'ouvre ou tout se ferme (le coordinateur le dit : autre
 *     surface, visite qui démarre), Échap est pressé, ou le focus est parti ailleurs (jamais de
 *     focus volé). Le module se charge quand même, et le clic suivant ouvre normalement ;
 *   - la date des événements est lue à l'OUVERTURE (`setOpen` du panneau), pas au chargement ;
 *   - un échec est DIT (`announceLoadFailure`, texte distinct au second échec : WebKit garde l'échec
 *     en mémoire) et le clic suivant réessaie ; une fois chargé, l'écouteur est retiré.
 *
 * `aria-controls="astronomical-events"` du déclencheur désigne un élément absent tant que le panneau
 * n'est pas monté : tolérable, `aria-expanded` vaut `false` (axe ne signale la référence qu'ouverte).
 * `aria-busy` marque le déclencheur pendant le chargement.
 */
import type { OrbitalMechanics } from '@/core/OrbitalMechanics';
import type { AstronomicalEventsDeps } from './astronomicalEvents';
import { announceLoadFailure } from './loadFailure';

export function setupAstronomicalEventsOnDemand(
  om: OrbitalMechanics,
  deps: AstronomicalEventsDeps = {}
): void {
  const trigger = document.getElementById('events-trigger');
  if (!trigger) return;

  let loading = false;
  /**
   * L'import, mémorisé : le survol ou le focus du déclencheur le PRÉCHARGENT (le clic qui suit, sur
   * un poste à souris ou au clavier, trouve le module prêt), et le clic le réutilise : jamais deux
   * imports, et jamais d'initialisation avant le clic (seul `onClick` appelle `setup…`). Un échec
   * est oublié pour que le clic réessaie ; il n'est annoncé qu'au clic.
   */
  let imported: Promise<typeof import('./astronomicalEvents')> | null = null;
  const fetchModule = (): Promise<typeof import('./astronomicalEvents')> =>
    (imported ??= import('./astronomicalEvents').catch((error: unknown) => {
      imported = null;
      throw error;
    }));
  const warm = (): void => {
    fetchModule().catch(() => undefined);
  };
  /** Vrai tant que le visiteur veut toujours ce panneau (l'intention du clic en cours). */
  let wanted = false;
  let releaseGuards: (() => void) | null = null;

  const abandon = (): void => {
    wanted = false;
  };

  /** Surveille ce qui rend l'ouverture indésirable pendant le chargement ; rend sa fonction d'arrêt. */
  const watchIntent = (): (() => void) => {
    const unsubscribe = deps.coordinator?.onOpen((id) => {
      if (id !== 'events') abandon();
    });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') abandon();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      unsubscribe?.();
      document.removeEventListener('keydown', onKey, true);
    };
  };

  /** Le focus est-il resté sur le déclencheur (ou nulle part, comme sous Safari après un clic) ? */
  const focusStayed = (): boolean => {
    const active = document.activeElement;
    return active === null || active === document.body || active === trigger;
  };

  const onClick = (): void => {
    if (loading) return;
    loading = true;
    wanted = true;
    trigger.setAttribute('aria-busy', 'true');
    releaseGuards = watchIntent();
    void fetchModule()
      .then((module) => {
        trigger.removeEventListener('click', onClick);
        trigger.removeEventListener('pointerenter', warm);
        trigger.removeEventListener('focus', warm);
        const open = wanted && focusStayed();
        releaseGuards?.();
        releaseGuards = null;
        const panel = module.setupAstronomicalEvents(om, deps);
        if (open) panel.open();
      })
      .catch(() => {
        releaseGuards?.();
        releaseGuards = null;
        if (wanted) announceLoadFailure('astronomicalEvents');
      })
      .finally(() => {
        loading = false;
        wanted = false;
        trigger.removeAttribute('aria-busy');
      });
  };
  trigger.addEventListener('click', onClick);
  trigger.addEventListener('pointerenter', warm, { once: true });
  trigger.addEventListener('focus', warm, { once: true });
}
