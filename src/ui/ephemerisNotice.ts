/**
 * CE QUE L'APPLICATION DIT QUAND SES ÉPHÉMÉRIDES N'ARRIVENT PAS TOUTES.
 *
 * Le défaut corrigé au lot 15, mesuré en production le 2026-09-22 sur un lien à 24 ko/s : 25
 * des 64 binaires arrivaient, 39 mouraient en « TypeError: Failed to fetch » après 706 s, et
 * comme le chargement était tout-ou-rien, le service repartait VIDE. Mercure passait de 7,3 km
 * à 2 600 km, les 11 sondes perdaient toute position (les 3 objets interstellaires, eux, se
 * propagent depuis leurs éléments hyperboliques et n'ont jamais de fichier), et rien ne le
 * disait : `Logger.warn` est muet hors debug.
 *
 * Ce module est la réponse à la question « et qu'est-ce qu'on DIT ? ». Il n'apparaît que
 * lorsqu'un fichier manque vraiment : rien à l'écran veut dire que tout est arrivé. Il nomme
 * un FAIT compté (reçues sur déclarées), renvoie à la fiche de chaque corps, qui nomme déjà la
 * source qui le place (`ui/positionProvenance`), et propose la seule action qui répare, la
 * reprise des fichiers manquants.
 *
 * Deux refus délibérés, cohérents avec les lots 6 et 8 : ne rien dire (le projet a déjà écarté
 * deux fois la dégradation silencieuse), et bloquer l'application (une scène à 2 600 km près
 * reste une scène juste, et l'utilisateur décide s'il attend).
 *
 * Une reprise RÉUSSIE laisse une ligne de confirmation, que l'utilisateur ferme, au lieu de
 * faire disparaître le bandeau. Ce n'est pas une entorse au « silence = tout va bien » : le
 * silence vaut pour ce que l'application constate toute seule au démarrage, pas pour le
 * résultat d'une action demandée, qu'une disparition soudaine laisserait deviner et
 * qu'`aria-live` n'annoncerait pas.
 *
 * Placement MESURÉ, pas supposé, au-dessus du dock du bas comme le bandeau d'imagerie de
 * surface (leçon du lot 9C : une garde de mise en page mobile démarre à la taille mobile).
 */
import { SPACECRAFT_MISSIONS } from '@/config/spacecraft';
import type { EphemerisLoadReport } from '@/core/HorizonsEphemerisService';
import { onLocaleChange, t } from '@/i18n';
import type { PublicAPI } from '@/SolarSystemApp';

const SPACECRAFT_NAMES = new Set(SPACECRAFT_MISSIONS.map((m) => m.name));

/**
 * Le bandeau a paru, changé de taille ou disparu. Écouté par `ui/surfacePanel`, dont le
 * bandeau de provenance occupe la même bande au-dessus du dock du bas.
 */
export const NOTICE_CHANGED = 'galaxy:ephemeris-notice';

/** Combien de SONDES ce rapport laisse sans aucune position (elles n'ont pas de repli). */
export function spacecraftWithoutPosition(report: EphemerisLoadReport): number {
  if (report.manifestFailed) return SPACECRAFT_NAMES.size;
  return report.missing.filter((failure) => SPACECRAFT_NAMES.has(failure.body))
    .length;
}

/** Ce que le bandeau doit afficher pour un rapport donné. Pur : testable sans DOM. */
export function noticeText(report: EphemerisLoadReport): string[] {
  const lines = [
    report.manifestFailed
      ? t('ephemeris.notice.none')
      : t('ephemeris.notice.partial', {
          loaded: report.loaded.length,
          declared: report.declared,
        }),
  ];
  const stranded = spacecraftWithoutPosition(report);
  if (stranded > 0)
    lines.push(t('ephemeris.notice.spacecraft', { count: stranded }));
  return lines;
}

/** Un rapport qui n'a rien à dire : tout est arrivé. */
export function isComplete(report: EphemerisLoadReport): boolean {
  return !report.manifestFailed && report.missing.length === 0;
}

export function setupEphemerisNotice(api: PublicAPI): void {
  const service = api.horizonsEphemeris;
  if (isComplete(service.report)) {
    // Cas nominal : aucun élément n'est créé, donc rien à masquer, rien à traduire, rien à
    // placer. Une reprise ne peut pas se produire puisqu'il n'y a rien à reprendre.
    return;
  }

  const banner = document.createElement('aside');
  banner.id = 'ephemeris-notice';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');

  const title = document.createElement('p');
  title.className = 'en-title';

  const detail = document.createElement('p');
  detail.className = 'en-detail';

  const actions = document.createElement('div');
  actions.className = 'en-actions';

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'en-retry';

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'en-dismiss';

  actions.append(retry, dismiss);
  banner.append(title, detail, actions);
  document.body.append(banner);

  let busy = false;
  let recovered = false;

  const render = (): void => {
    const report = service.report;
    banner.setAttribute('aria-label', t('ephemeris.notice.aria'));
    dismiss.textContent = t('ephemeris.notice.dismiss');
    retry.textContent = busy
      ? t('ephemeris.notice.retrying')
      : t('ephemeris.notice.retry');
    retry.disabled = busy;

    if (recovered) {
      title.textContent = t('ephemeris.notice.recovered');
      detail.textContent = '';
      detail.hidden = true;
      retry.hidden = true;
      banner.dataset['state'] = 'recovered';
      return;
    }

    title.textContent = t('ephemeris.notice.title');
    detail.textContent = noticeText(report).join(' ');
    detail.hidden = false;
    // Une reprise n'a de sens que si au moins un échec est de transport : un 404 ou des
    // octets faux ne changeront pas au prochain essai (cf. `EphemerisLoadFailure.retryable`).
    retry.hidden = !report.retryable;
    banner.dataset['state'] = 'degraded';
    // Sans le manifeste on ne sait même pas COMBIEN de fichiers existent : publier un nombre
    // serait inventer. L'attribut disparaît, et le texte dit « aucune éphéméride précise ».
    if (report.manifestFailed) delete banner.dataset['missing'];
    else banner.dataset['missing'] = String(report.missing.length);
  };

  /** Le bandeau se pose au-dessus du dock du bas, mesuré, jamais supposé. */
  const place = (): void => {
    const dock = document.querySelector('.dock--bottom');
    if (!dock) return;
    const top = dock.getBoundingClientRect().top;
    banner.style.bottom = `${Math.max(0, window.innerHeight - top + 8)}px`;
    // Le bandeau d'imagerie de surface partage cette bande et se pose AU-DESSUS du nôtre.
    // Il lit notre rectangle réel (une seule source, le DOM) ; ce signal lui dit seulement
    // QUAND relire, sans qu'aucun des deux modules n'importe l'autre.
    window.dispatchEvent(new Event(NOTICE_CHANGED));
  };

  const close = (): void => {
    banner.remove();
    window.removeEventListener('resize', place);
    window.dispatchEvent(new Event(NOTICE_CHANGED));
  };

  dismiss.addEventListener('click', close);

  retry.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    render();
    void service.retryMissing().then(() => {
      busy = false;
      // Les positions se recalculent à chaque image, mais les lignes d'orbite sont
      // mémorisées : un corps repris doit retrouver SA ligne, pas celle de son ancienne
      // source (cf. `OrbitalMechanics.refreshPositionSources`).
      api.orbitalMechanics.refreshPositionSources();
      recovered = isComplete(service.report);
      render();
      place();
    });
  });

  onLocaleChange(() => {
    render();
    place();
  });
  window.addEventListener('resize', place);

  render();
  place();
}
