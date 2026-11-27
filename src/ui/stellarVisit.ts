/**
 * LA VISITE GUIDÉE DU VOISINAGE SOLAIRE (GAL-UNIVERSE-005) : une suite d'arrêts dans la vue 3D, du Soleil
 * aux étoiles les plus remarquables du catalogue, chacun avec ce que les données disent de l'étoile et la
 * NATURE de chaque information (mesuré, catalogué, calculé, illustratif, inconnu).
 *
 * Un morceau à part, chargé au premier usage d'une visite (bouton de la vue, bouton des Réglages ou adresse
 * `visit=`) : ni le démarrage ni la vue du voisinage ne portent ces textes avant. La visite ne possède ni la
 * scène, ni le renderer, ni la boucle : elle pilote la vue par `VisitController` (choisir une étoile, déplacer
 * le curseur de temps, cadrer la caméra), et se défait avec elle. Le visiteur peut la quitter à tout moment
 * (la vue reste ouverte, libre) puis la reprendre à l'arrêt où il l'avait laissée.
 *
 * Aucun nombre n'est écrit dans un texte : `core/stellarVisit` les remplit depuis le voisinage rapproché (`neighbours/`) et
 * `exoplanets.json`. Les planètes de l'archive sont des entrées de catalogue : rien n'en est dessiné.
 */
import {
  archiveCount,
  fillPlaceholders,
  pickSystem,
  placeholderValues,
  type Formatter,
  type Visit,
  type VisitLocale,
  type VisitStep,
} from '@/core/stellarVisit';
import type { ExoplanetFile } from '@/core/exoplanets';
import { distanceFacts, systemPrimary } from '@/core/neighbours';
import { STELLAR_VISITS, visitById } from '@/registry/stellar-visits';
import { getLocale, onLocaleChange, t } from '@/i18n';
import { loadDeferredMessages } from '@/i18n/deferredMessages';
import { getAnnouncer } from './announcer';
import type { VisitController } from './stellarView';
import './stellarVisit.css';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  id?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (id) node.id = id;
  return node;
}

const format: Formatter = {
  number: (value, digits) =>
    new Intl.NumberFormat(getLocale(), {
      maximumSignificantDigits: digits,
    }).format(value),
  fixed: (value, digits) =>
    new Intl.NumberFormat(getLocale(), {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value),
};

function row(label: string, value: string): HTMLElement[] {
  const dt = el('dt');
  dt.textContent = label;
  const dd = el('dd');
  dd.textContent = value;
  return [dt, dd];
}

/** La visite en cours : une seule à la fois par vue. */
let active: { dispose(): void; go(step: number): void; id: string } | null =
  null;

/**
 * Commence la visite `id` (la première si `null`) à l'arrêt `step`. Rend `false` quand la visite n'existe pas :
 * l'appelant le dit, rien n'est ouvert à moitié.
 */
export function begin(
  controller: VisitController,
  id: string | null,
  step: number
): boolean {
  const visit = id === null ? STELLAR_VISITS[0] : visitById(id);
  if (!visit) return false;
  if (active && active.id === visit.id) {
    active.go(step);
    return true;
  }
  active?.dispose();
  active = start(controller, visit, step);
  return true;
}

function start(
  controller: VisitController,
  visit: Visit,
  firstStep: number
): NonNullable<typeof active> {
  const { systems } = controller;
  const steps = visit.steps;
  // L'étoile de chaque arrêt, désignée par sa RÈGLE dans les données (-1 : le Soleil).
  const indexes = steps.map((s) => (s.star ? pickSystem(systems, s.star) : -1));
  let archive: ExoplanetFile | null | undefined;
  let current = 0;
  let running = true;
  let disposed = false;

  // ---- le panneau
  const panel = el('section', 'sv-visit', 'stellar-visit');
  panel.setAttribute('role', 'region');
  const progress = el('p', 'sv-visit-progress', 'stellar-visit-progress');
  const title = el('h3', 'sv-heading sv-visit-title', 'stellar-visit-title');
  panel.setAttribute('aria-labelledby', 'stellar-visit-title');
  const body = el('p', 'sv-visit-body', 'stellar-visit-body');
  const data = el('div', 'sv-visit-data');
  const dataTitle = el('h4', 'sv-visit-sub');
  const facts = el('dl', 'exo-facts sv-visit-facts');
  data.append(dataTitle, facts);
  const reading = el('details', 'sv-visit-reading');
  const readingTitle = el('summary');
  const readingList = el('ul', 'sv-visit-reading-list');
  reading.append(readingTitle, readingList);
  const nav = el('div', 'sv-visit-nav');
  const prev = el('button', 'sv-button', 'stellar-visit-prev');
  const next = el(
    'button',
    'sv-button sv-button--primary',
    'stellar-visit-next'
  );
  const leave = el('button', 'sv-button', 'stellar-visit-leave');
  for (const b of [prev, next, leave]) b.type = 'button';
  nav.append(prev, next, leave);
  const running$ = el('div', 'sv-visit-running');
  running$.append(progress, title, body, data, reading, nav);
  // L'état « en pause » : la visite attend, la vue est libre.
  const paused = el('div', 'sv-visit-paused');
  const pausedText = el('p', 'sv-visit-body');
  const resume = el(
    'button',
    'sv-button sv-button--primary',
    'stellar-visit-resume'
  );
  const end = el('button', 'sv-button', 'stellar-visit-end');
  for (const b of [resume, end]) b.type = 'button';
  paused.append(pausedText, resume, end);
  panel.append(running$, paused);
  controller.side.prepend(panel);

  const locale = (): VisitLocale => {
    const l = getLocale() as string;
    return l === 'fr' || l === 'es' || l === 'pt-BR' ? l : 'en';
  };

  /**
   * La phrase de l'archive : un nombre, ou l'aveu qu'il manque. Un nombre ABSENT (archive en chargement ou illisible)
   * n'est jamais dit « zéro » : seul un nombre lu dans l'archive et égal à 0 dit « aucune planète ».
   */
  const archiveSentence = (index: number): string => {
    if (archive === undefined) return t('sv.visit.archive.loading');
    if (archive === null) return t('sv.visit.archive.unavailable');
    const count = archiveCount(systems[index]!, archive) ?? 0;
    return count === 0
      ? t('sv.visit.archive.none')
      : t(count === 1 ? 'sv.visit.archive.one' : 'sv.visit.archive.many', {
          n: format.number(count, 3),
        });
  };

  const valuesFor = (n: number): ReturnType<typeof placeholderValues> => {
    const index = indexes[n]!;
    const years = steps[n]!.years ?? 0;
    return placeholderValues(
      systems,
      index >= 0 ? index : null,
      years,
      format,
      index >= 0 ? archiveSentence(index) : '',
      controller.absoluteYear(),
      {
        approaching: t('sv.visit.approaching'),
        receding: t('sv.visit.receding'),
      }
    );
  };

  const renderStep = (): void => {
    const step: VisitStep = steps[current]!;
    const l = locale();
    const values = valuesFor(current);
    progress.textContent = t('sv.visit.progress', {
      n: String(current + 1),
      total: String(steps.length),
    });
    title.textContent = fillPlaceholders(step.title[l], values);
    body.textContent = fillPlaceholders(step.body[l], values);
    dataTitle.textContent = t('sv.visit.data');
    prev.textContent = t('sv.visit.prev');
    prev.disabled = current === 0;
    const last = current === steps.length - 1;
    next.textContent = last ? t('sv.visit.finish') : t('sv.visit.next');
    leave.textContent = t('sv.visit.leave');
    readingTitle.textContent = t('sv.visit.reading');

    // Ce que les données disent de CETTE étoile (rien pour l'arrêt du Soleil).
    const index = indexes[current]!;
    const rows: HTMLElement[] = [];
    if (index >= 0) {
      const primary = systemPrimary(systems[index]!);
      const facts0 = distanceFacts(primary);
      rows.push(
        ...row(
          t('st.distSun'),
          t('nb.card.distanceValue', { ly: format.fixed(facts0.lightYears, 2) })
        ),
        ...row(t('nb.card.spectral'), primary[2] ?? t('nb.card.unknown')),
        ...row(
          t('sv.visit.fact.pm'),
          t('sv.visit.fact.pmValue', {
            pm: format.number(Math.hypot(primary[8], primary[9]), 4),
          })
        )
      );
      if (primary[10] !== null)
        rows.push(
          ...row(
            t('sv.visit.fact.rv'),
            t('sv.visit.fact.rvValue', {
              rv: format.fixed(primary[10], 1),
            })
          )
        );
      const planets = archive ? archiveCount(systems[index]!, archive) : null;
      if (planets !== null)
        rows.push(
          ...row(
            t('sv.visit.fact.planets'),
            planets > 0 ? String(planets) : t('sv.visit.fact.none')
          )
        );
    }
    facts.replaceChildren(...rows);
    data.hidden = rows.length === 0;

    // La NATURE de chaque information : seules les lignes qui valent pour cet arrêt s'affichent.
    const lines = [t('sv.visit.reading.measured')];
    if (index >= 0 && archive)
      lines.push(
        t('sv.visit.reading.catalogued', { date: archive.source.retrieved })
      );
    if ((step.years ?? 0) !== 0) lines.push(t('sv.visit.reading.calculated'));
    lines.push(
      t('sv.visit.reading.illustrative'),
      t('sv.visit.reading.unknown')
    );
    if (index >= 0 && archive === null) lines.push(t('sv.visit.noArchive'));
    readingList.replaceChildren(
      ...lines.map((line) => {
        const li = el('li');
        li.textContent = line;
        return li;
      })
    );
  };

  const renderPaused = (): void => {
    pausedText.textContent = t('sv.visit.paused');
    resume.textContent = t('sv.visit.resume', {
      n: String(current + 1),
      total: String(steps.length),
    });
    end.textContent = t('sv.visit.end');
  };

  const render = (): void => {
    running$.hidden = !running;
    paused.hidden = running;
    panel.setAttribute('aria-label', t('sv.visit.region'));
    controller.root.classList.toggle('sv-visiting', running);
    if (running) renderStep();
    else renderPaused();
  };

  /** Place l'arrêt `n` : l'étoile, le temps, le cadrage, l'adresse, l'annonce. */
  const go = (n: number, announce = true): void => {
    if (disposed) return;
    current = Math.max(0, Math.min(steps.length - 1, Math.round(n)));
    running = true;
    const step = steps[current]!;
    const index = indexes[current]!;
    // Le temps d'abord (la position de l'étoile en dépend), puis la fiche, puis le cadrage.
    controller.setYears(step.years ?? 0);
    controller.select(index);
    controller.frameOn(index, step.distancePc);
    controller.setAddress({ id: visit.id, step: current });
    render();
    if (announce)
      getAnnouncer().announce(
        t('sv.visit.stop', {
          n: String(current + 1),
          total: String(steps.length),
          title: title.textContent ?? '',
        })
      );
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    stopLocale();
    panel.remove();
    controller.root.classList.remove('sv-visiting');
    if (active?.id === visit.id) active = null;
  };

  const finish = (): void => {
    controller.setAddress(null);
    getAnnouncer().announce(t('sv.visit.finished'));
    dispose();
    // Le bouton qui disparaît ne doit pas emporter le focus : il revient à « Retour ».
    controller.root.querySelector<HTMLElement>('#stellar-back')?.focus();
  };

  prev.addEventListener('click', () => go(current - 1));
  next.addEventListener('click', () =>
    current === steps.length - 1 ? finish() : go(current + 1)
  );
  leave.addEventListener('click', () => {
    running = false;
    controller.setAddress(null);
    render();
    getAnnouncer().announce(t('sv.visit.left'));
    resume.focus();
  });
  resume.addEventListener('click', () => {
    go(current);
    next.focus();
  });
  end.addEventListener('click', finish);

  const stopLocale = onLocaleChange(() => {
    void loadDeferredMessages().then(() => {
      if (!disposed) render();
    });
  });
  controller.onClose(dispose);

  // L'archive se lit en arrière-plan : les arrêts d'abord, le nombre de planètes quand elle arrive.
  void controller.exoplanets().then((file) => {
    archive = file;
    if (!disposed) render();
  });

  go(firstStep, false);
  getAnnouncer().announce(
    t('sv.visit.opened', {
      n: String(current + 1),
      total: String(steps.length),
      title: title.textContent ?? '',
    })
  );
  next.focus();
  return { dispose, go, id: visit.id };
}
