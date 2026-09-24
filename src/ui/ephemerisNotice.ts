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
 * En dessous de cette attente, on se TAIT (phase 17D, décision D4).
 *
 * Mesuré le 2026-09-23 : la fenêtre de démarrage arrive en 0,89 s à 10 Mbit/s et un saut de
 * date coûte 3,2 s. Une attente d'une seconde est donc le prix NORMAL d'un saut, et l'annoncer
 * ferait clignoter un bandeau à chaque clic dans le panneau de dates. Au-delà, l'attente n'est
 * plus un détail de chargement : c'est le lien qui ne suit pas la vitesse demandée, et le
 * lecteur a le droit de savoir pourquoi sa date rampe.
 */
export const WAITING_ANNOUNCE_SECONDS = 1.5;

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

/** Ce que le bandeau montre, ou rien du tout. */
export type NoticeState = 'hidden' | 'recovered' | 'waiting' | 'degraded';

export interface NoticeSituation {
  readonly report: EphemerisLoadReport;
  /** Secondes réelles d'attente de l'horloge (`OrbitalMechanics.waitingForDataSeconds`). */
  readonly waitingSeconds: number;
  /** Une reprise a été DEMANDÉE : sa conclusion mérite une ligne, même bonne. */
  readonly asked: boolean;
  /** Cette reprise a tout ramené. */
  readonly recovered: boolean;
}

/**
 * La décision du bandeau, pure et donc falsifiable sans DOM.
 *
 * L'ordre n'est pas décoratif : une absence de fichier PRIME sur une attente. Les deux ne
 * demandent pas la même chose au lecteur — l'une porte la seule action qui répare, l'autre dit
 * seulement que la date avance au rythme des octets — et « précision réduite » serait FAUX
 * pendant une attente, où aucune position n'est remplacée par une autre.
 */
export function noticeState(situation: NoticeSituation): NoticeState {
  const { report, waitingSeconds, asked, recovered } = situation;
  const waiting = waitingSeconds >= WAITING_ANNOUNCE_SECONDS;
  const complete = isComplete(report);
  if (complete && !asked && !waiting) return 'hidden';
  if (recovered) return 'recovered';
  if (complete && waiting) return 'waiting';
  return 'degraded';
}

/** Poignée : la composition dit, à chaque image, depuis combien de temps la date attend. */
export interface EphemerisNotice {
  /**
   * Secondes réelles d'attente de l'horloge (`OrbitalMechanics.waitingForDataSeconds`). Le
   * bandeau décide seul s'il y a lieu d'en parler.
   */
  setWaiting(seconds: number): void;
}

export function setupEphemerisNotice(api: PublicAPI): EphemerisNotice {
  const service = api.horizonsEphemeris;
  let banner: HTMLElement | null = null;
  let render = (): void => {};
  let place = (): void => {};

  /**
   * Le bandeau n'existe dans le DOM que si un fichier manque VRAIMENT, et depuis le lot 17
   * cela peut arriver en cours de session : le service ne charge plus des fichiers entiers au
   * démarrage mais des FENÊTRES, et une fenêtre demandée à un saut de date peut échouer là où
   * celle du démarrage était arrivée. Le bandeau est donc construit à la demande, au premier
   * rapport dégradé, et pas seulement à l'ouverture.
   */
  const ensureBanner = (): void => {
    if (banner) return;
    banner = build();
  };

  const removeBanner = (): void => {
    if (!banner) return;
    banner.remove();
    banner = null;
    window.removeEventListener('resize', place);
    window.dispatchEvent(new Event(NOTICE_CHANGED));
  };

  /** Une reprise DEMANDÉE laisse sa ligne de confirmation ; une guérison seule, non. */
  let asked = false;
  /**
   * Depuis combien de secondes réelles la date attend ses octets. Un état à part de la
   * dégradation du lot 15 : ici rien n'est remplacé par une source moins précise, la date est
   * simplement plus lente que demandé. Écrire « précision réduite » serait faux.
   */
  let waitingSeconds = 0;
  /** Une reprise DEMANDÉE a tout ramené : sa ligne de confirmation reste jusqu'à fermeture. */
  let recovered = false;

  /** La décision, prise par la fonction pure ci-dessus : ce module n'en tranche aucune. */
  const state = (): NoticeState =>
    noticeState({ report: service.report, waitingSeconds, asked, recovered });

  const refresh = (): void => {
    if (state() === 'hidden') {
      removeBanner();
      return;
    }
    ensureBanner();
    render();
    place();
  };

  service.onReportChange(refresh);

  if (!isComplete(service.report)) {
    ensureBanner();
    render();
    place();
  }

  return {
    setWaiting: (seconds: number): void => {
      const before = state();
      waitingSeconds = seconds;
      // Appelée à chaque image : on ne touche au DOM que si la DÉCISION change.
      if (state() !== before) refresh();
    },
  };

  function build(): HTMLElement {
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

    render = (): void => {
      const report = service.report;
      const showing = state();
      banner.setAttribute('aria-label', t('ephemeris.notice.aria'));
      dismiss.textContent = t('ephemeris.notice.dismiss');
      retry.textContent = busy
        ? t('ephemeris.notice.retrying')
        : t('ephemeris.notice.retry');
      retry.disabled = busy;

      if (showing === 'recovered') {
        title.textContent = t('ephemeris.notice.recovered');
        detail.textContent = '';
        detail.hidden = true;
        retry.hidden = true;
        banner.dataset['state'] = 'recovered';
        return;
      }

      // La précédence (absence de fichier avant attente) est tranchée par `noticeState`.
      if (showing === 'waiting') {
        title.textContent = t('ephemeris.notice.waitingTitle');
        detail.textContent = t('ephemeris.notice.waiting');
        detail.hidden = false;
        retry.hidden = true;
        banner.dataset['state'] = 'waiting';
        delete banner.dataset['missing'];
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
    place = (): void => {
      const dock = document.querySelector('.dock--bottom');
      if (!dock) return;
      const top = dock.getBoundingClientRect().top;
      banner.style.bottom = `${Math.max(0, window.innerHeight - top + 8)}px`;
      // Le bandeau d'imagerie de surface partage cette bande et se pose AU-DESSUS du nôtre.
      // Il lit notre rectangle réel (une seule source, le DOM) ; ce signal lui dit seulement
      // QUAND relire, sans qu'aucun des deux modules n'importe l'autre.
      window.dispatchEvent(new Event(NOTICE_CHANGED));
    };

    dismiss.addEventListener('click', removeBanner);

    retry.addEventListener('click', () => {
      if (busy) return;
      busy = true;
      asked = true;
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

    return banner;
  }
}
