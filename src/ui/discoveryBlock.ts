/**
 * LE BLOC « DÉCOUVERTE » DE LA FICHE : ce que les sources primaires déclarent de la découverte de
 * ce corps, ce qu'on en savait à la date de la scène et, pour une planète qui en a, combien de ses
 * lunes on avait déjà vues (lot 44, ligne 22.10, premier pas de la timeline du SAVOIR).
 *
 * LA DATE DE LA SCÈNE FAIT PARTIE DE LA RÉPONSE, comme dans le bloc des missions : la question
 * « que savait-on de Jupiter en 1609, en 1610, en 1979 » se pose en déplaçant l'horloge, et
 * l'application y répond par des comptes DÉRIVÉS de la table du JPL, jamais par une phrase
 * écrite de mémoire. Le calcul vit dans `core/discovery.ts`, pur et testé.
 *
 * CHAQUE AFFIRMATION EST MONTRÉE AVEC SA SOURCE ET SA DATE DE LECTURE, y compris quand deux
 * sources divergent (Pluton) : la fiche ne tranche pas à la place du lecteur.
 *
 * RIEN N'EST DEMANDÉ AU DÉMARRAGE : l'index arrive à l'ouverture d'une fiche, la liste des
 * satellites à l'ouverture de celle de leur parent (`config/discovery.ts`).
 */
import {
  loadDiscovery,
  loadSatelliteDiscoveries,
  type SatelliteSystemInfo,
} from '@/config/discovery';
import {
  discoveryStanding,
  nextSatelliteDiscovery,
  satellitesKnownAt,
  type DiscoveryClaim,
  type DiscoveryStanding,
  type SatelliteDiscovery,
} from '@/core/discovery';
import { formatIsoDay } from '@/core/dateText';
import { getLocale, intlLocale, onLocaleChange, t } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import type { PublicAPI } from '@/SolarSystemApp';
import type { BodyInfoPanel } from './bodyInfo';

const formatDay = (iso: string): string =>
  formatIsoDay(iso, getLocale(), intlLocale());

/** Le nom court d'une source, un nom propre qui ne se traduit pas. */
const SOURCE_LABEL: Record<DiscoveryClaim['source'], string> = {
  'jpl-sats': 'JPL',
  sbdb: 'JPL SBDB',
  nssdca: 'NSSDCA',
  'jpl-planets': 'JPL',
  'nasa-science': 'NASA Science',
};

/** Ce que l'affirmation date, dans la langue courante. */
function claimText(claim: DiscoveryClaim): string {
  switch (claim.form) {
    case 'day':
      return claim.role === 'predictedReturn'
        ? t('bi.discovery.predictedReturn', { date: formatDay(claim.day) })
        : formatDay(claim.day);
    case 'years':
      // Les années telles que la source les écrit (« 1966, 1980 ») : les relier par « puis »
      // serait interpréter ce que la table ne dit pas.
      return claim.years.join(', ');
    case 'prehistoric':
      return t('bi.discovery.prehistoric');
    case 'ancient':
      return t('bi.discovery.ancient');
    case 'ancientObservations':
      return t('bi.discovery.ancientObservations');
  }
}

/** Les découvreurs et le lieu, tels que la source les publie. */
function whoText(claim: DiscoveryClaim): string {
  if (claim.form !== 'day' && claim.form !== 'years') return '';
  const who = claim.who ?? '';
  const where = claim.form === 'day' ? (claim.where ?? '') : '';
  return where ? (who ? `${who} (${where})` : where) : who;
}

/**
 * La phrase de l'état. Quand la scène tombe DANS les dates publiées, trois cas ne disent pas la
 * même chose : le jour même d'une découverte datée au jour, l'année d'une découverte que la source
 * ne date qu'à l'année, et l'intervalle entre deux dates qui divergent.
 */
function standingText(
  standing: DiscoveryStanding,
  claims: readonly DiscoveryClaim[]
): string {
  if (standing === 'notYetKnown') return t('bi.discovery.notYetKnown');
  if (standing === 'known') return t('bi.discovery.known');
  if (standing === 'knownSinceAntiquity') return '';
  const dated = claims.flatMap<string | number>((c) =>
    c.form === 'day' ? [c.day] : c.form === 'years' ? [...c.years] : []
  );
  if (dated.length > 1) return t('bi.discovery.withinDates');
  return claims.some((c) => c.form === 'day')
    ? t('bi.discovery.onTheDay')
    : t('bi.discovery.withinYear');
}

/** Le nom d'un satellite : celui du catalogue quand il y est, sinon celui de la table. */
const satelliteName = (s: SatelliteDiscovery): string =>
  s.body ? bodyDisplayName(s.body) : s.name;

/** Jusqu'à cinq noms ; au-delà, trois noms et le compte des autres. */
function namesText(satellites: readonly SatelliteDiscovery[]): string {
  const names = satellites.map(satelliteName);
  if (names.length <= 5) return names.join(', ');
  return t('bi.discovery.moonsMore', {
    names: names.slice(0, 3).join(', '),
    count: names.length - 3,
  });
}

export function setupDiscoveryBlock(
  api: PublicAPI,
  bodyInfo: BodyInfoPanel
): void {
  const panel = document.getElementById('body-info');
  const block = panel?.querySelector<HTMLElement>('.bi-discovery');
  const claimsEl = block?.querySelector<HTMLUListElement>(
    '.bi-discovery-claims'
  );
  const standingEl = block?.querySelector<HTMLElement>(
    '.bi-discovery-standing'
  );
  const moonsEl = block?.querySelector<HTMLElement>('.bi-discovery-moons');
  const nextEl = block?.querySelector<HTMLElement>('.bi-discovery-next');
  const noteEl = block?.querySelector<HTMLElement>('.bi-discovery-note');
  if (!block || !claimsEl || !standingEl || !moonsEl || !nextEl || !noteEl)
    return;

  let rendered: string | null = null;
  let renderedDay = '';
  let claims: readonly DiscoveryClaim[] | null = null;
  let system: {
    satellites: readonly SatelliteDiscovery[];
    system: SatelliteSystemInfo;
  } | null = null;
  /** Comme dans `ui/missionsBlock.ts` : on ne retient que le cas VIDE, pour ne pas boucler. */
  let nothingToShow: string | null = null;

  const setLine = (el: HTMLElement, text: string): void => {
    el.textContent = text;
    el.hidden = text === '';
  };

  const render = (body: string, sceneDate: Date): void => {
    if (!claims) {
      block.hidden = true;
      return;
    }
    claimsEl.replaceChildren();
    for (const claim of claims) {
      const li = document.createElement('li');
      const when = document.createElement('span');
      when.className = 'bi-discovery-when';
      when.textContent = claimText(claim);
      li.append(when);
      const who = whoText(claim);
      if (who) {
        // Un vrai caractère, pas la seule marge CSS : sans lui le texte de la ligne est
        // « 1930Tombaugh », et c'est ce qu'un lecteur d'écran prononce. Trouvé en LISANT le rendu.
        li.append(document.createTextNode(' · '));
        const span = document.createElement('span');
        span.className = 'bi-discovery-who';
        span.textContent = who;
        li.append(span);
      }
      const source = document.createElement('a');
      source.className = 'bi-discovery-source';
      source.href = claim.url;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      source.textContent = t('bi.discovery.according', {
        source: SOURCE_LABEL[claim.source],
        date: formatDay(claim.retrieved),
      });
      li.append(source);
      claimsEl.append(li);
    }

    const standing = discoveryStanding(claims, sceneDate);
    setLine(standingEl, standing ? standingText(standing, claims) : '');

    if (system && standing !== 'notYetKnown') {
      const { atLeast, atMost, total } = satellitesKnownAt(
        system.satellites,
        sceneDate
      );
      // Un seul satellite (six des sept petits corps du pas 2) : « 0 sur les 1 » est faux dans
      // les quatre langues. Trouvé en LISANT le rendu.
      const one = total === 1;
      setLine(
        moonsEl,
        atLeast === atMost
          ? t(one ? 'bi.discovery.moonsKnownOne' : 'bi.discovery.moonsKnown', {
              count: atLeast,
              total,
            })
          : t(
              one
                ? 'bi.discovery.moonsKnownRangeOne'
                : 'bi.discovery.moonsKnownRange',
              { min: atLeast, max: atMost, total }
            )
      );
      const next = nextSatelliteDiscovery(system.satellites, sceneDate);
      setLine(
        nextEl,
        next
          ? t('bi.discovery.moonsNext', {
              year: next.year,
              names: namesText(next.satellites),
            })
          : ''
      );
      // La note dit QUELLE liste a été comptée : la table du JPL, ou SBDB pour un petit corps
      // (ligne 22.10, pas 2), avec ses satellites non confirmés quand elle en déclare.
      const info = system.system;
      const note = t(
        info.source === 'sbdb'
          ? 'bi.discovery.moonsNoteSbdb'
          : 'bi.discovery.moonsNote',
        { date: formatDay(info.retrieved) }
      );
      setLine(
        noteEl,
        info.unconfirmed?.length
          ? `${note} ${t('bi.discovery.moonsUnconfirmed', {
              names: info.unconfirmed.map(satelliteName).join(', '),
            })}`
          : note
      );
    } else {
      setLine(moonsEl, '');
      setLine(nextEl, '');
      setLine(noteEl, '');
    }
    block.hidden = false;
    rendered = body;
    renderedDay = sceneDate.toISOString().slice(0, 10);
  };

  let pending: string | null = null;

  const sync = (): void => {
    const body = bodyInfo.currentBody();
    if (!body) {
      block.hidden = true;
      rendered = null;
      claims = null;
      system = null;
      return;
    }
    if (nothingToShow === body) {
      block.hidden = true;
      return;
    }
    const sceneDate = api.orbitalMechanics.simulationDate;
    const sceneDay = sceneDate.toISOString().slice(0, 10);
    if (rendered === body && renderedDay === sceneDay) return;
    if (rendered !== body) {
      rendered = null;
      claims = null;
      system = null;
      block.hidden = true;
    }
    if (claims) {
      render(body, sceneDate);
      return;
    }
    if (pending === body) return;
    pending = body;
    void Promise.all([loadDiscovery(body), loadSatelliteDiscoveries(body)])
      .then(([found, satellites]) => {
        if (bodyInfo.currentBody() !== body) return;
        if (!found || found === 'notApplicable') {
          // Pas un corps du catalogue, ou la question n'a pas de sens (le Soleil, la Terre) :
          // la réponse est définitive. La raison est écrite dans `scripts/discovery-targets.json`
          // et l'inventaire des manques la lit ; elle n'a rien à faire sur la fiche.
          nothingToShow = body;
          block.hidden = true;
          return;
        }
        claims = found;
        system = satellites;
        render(body, api.orbitalMechanics.simulationDate);
      })
      .finally(() => {
        if (pending === body) pending = null;
      });
  };

  let lastCheck = 0;
  api.animationSystem.onFrame(() => {
    const at = performance.now();
    if (at - lastCheck < 500) return;
    lastCheck = at;
    sync();
  });

  onLocaleChange(() => {
    if (rendered) render(rendered, api.orbitalMechanics.simulationDate);
  });
}
