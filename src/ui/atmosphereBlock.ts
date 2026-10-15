/**
 * LE BLOC « PROFIL MESURÉ » DE LA FICHE D'UNE GÉANTE (lot 51, pas 3).
 *
 * La caméra ne descend pas sous 10 533 km au-dessus du niveau de 1 bar de Jupiter (plancher de
 * texture, `core/surfaceApproach.ts`), alors que le profil de la sonde Galileo couvre +1 028 à
 * −132 km : lu « à l'altitude de la caméra », il n'afficherait jamais rien. Il se montre donc
 * dans la fiche, choix de l'utilisateur (2026-10-15), en quelques lignes qui sont chacune un
 * échantillon publié (`core/atmosphereProfile.ts`).
 *
 * Ce qu'il DIT, parce que la source le dit : un seul point du globe (latitude lue dans la table),
 * au bord d'une tache chaude selon le titre même de l'article de l'équipe, et une descente
 * AJUSTÉE à l'adiabatique sèche, pas une liste de points mesurés. Les trois autres géantes
 * gardent leur bloc, avec la mesure de l'absence : un visiteur qui passe de Jupiter à Saturne ne
 * voit pas un bloc disparaître sans raison.
 *
 * RIEN N'EST DEMANDÉ AU DÉMARRAGE : ce module vit dans le morceau des blocs de fiche
 * (`ui/cardBlocks.ts`), et l'index puis le profil ne sont chargés qu'à l'ouverture d'une fiche.
 */
import {
  loadAtmosphereProfile,
  type ProfileAnswer,
} from '@/config/atmosphereProfiles';
import {
  adjustedBelowKm,
  profileRows,
  type AtmosphereProfile,
} from '@/core/atmosphereProfile';
import { convertTemperatureC } from '@/core/units';
import { formatIsoDay } from '@/core/dateText';
import { getLocale, intlLocale, onLocaleChange, t } from '@/i18n';
import type { PublicAPI } from '@/SolarSystemApp';
import type { BodyInfoPanel } from './bodyInfo';

const formatDay = (iso: string): string =>
  formatIsoDay(iso.slice(0, 10), getLocale(), intlLocale());

const num = (value: number, digits = 0): string =>
  new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: digits }).format(
    value
  );

const SUPERSCRIPT: Record<string, string> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};

/** Une pression sur neuf ordres de grandeur : bar, millibar, puis notation scientifique. */
export function formatPressure(bar: number): string {
  if (bar >= 1) return `${num(bar, 1)}\u00a0bar`;
  if (bar >= 1e-3) return `${num(bar * 1000, 1)}\u00a0mbar`;
  const exponent = Math.floor(Math.log10(bar));
  const mantissa = bar / 10 ** exponent;
  const sup = String(exponent)
    .split('')
    .map((c) => SUPERSCRIPT[c] ?? c)
    .join('');
  return `${num(mantissa, 1)}\u00a0×\u00a010${sup}\u00a0bar`;
}

/** Une altitude signée par rapport au niveau de 1 bar (« +1 029 km », « −132 km »). */
function formatAltitude(km: number): string {
  const text = `${num(Math.abs(km))}\u00a0km`;
  return km > 0 ? `+${text}` : km < 0 ? `−${text}` : text;
}

function formatKelvin(kelvin: number): string {
  const temp = convertTemperatureC(kelvin - 273.15);
  return `${num(kelvin)}\u00a0K (${num(temp.value)}\u00a0${temp.unit})`;
}

export function setupAtmosphereBlock(
  api: PublicAPI,
  bodyInfo: BodyInfoPanel
): void {
  const panel = document.getElementById('body-info');
  const block = panel?.querySelector<HTMLDetailsElement>('.bi-atmosphere');
  const label = block?.querySelector<HTMLElement>('.bi-atmosphere-label');
  const body = block?.querySelector<HTMLElement>('.bi-atmosphere-body');
  const note = block?.querySelector<HTMLElement>('.bi-atmosphere-note');
  if (!block || !label || !body || !note) return;

  let rendered: string | null = null;
  let answer: ProfileAnswer | null = null;
  let pending: string | null = null;
  /** Le corps dont on sait qu'il n'a ni profil ni absence mesurée : pas une géante. */
  let nothingToShow: string | null = null;

  const renderProfile = (profile: AtmosphereProfile): void => {
    label.textContent = t('bi.atmosphere.label');
    const table = document.createElement('table');
    table.className = 'bi-atmosphere-table';
    const head = document.createElement('tr');
    for (const key of [
      'bi.atmosphere.altitude',
      'bi.atmosphere.pressure',
      'bi.atmosphere.temperature',
    ] as const) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = t(key);
      head.append(th);
    }
    const thead = document.createElement('thead');
    thead.append(head);
    const tbody = document.createElement('tbody');
    for (const row of profileRows(profile)) {
      const tr = document.createElement('tr');
      tr.classList.toggle('is-adjusted', row.kind === 'descent');
      for (const text of [
        formatAltitude(row.altitudeKm),
        formatPressure(row.pressureBar),
        formatKelvin(row.temperatureK),
      ]) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(thead, tbody);
    const entry = profile.segments.find((s) => s.kind === 'entry');
    const local = document.createElement('p');
    local.textContent = t('bi.atmosphere.local', {
      min: num(profile.latitudeDeg.min, 1),
      max: num(profile.latitudeDeg.max, 1),
      date: entry?.start ? formatDay(entry.start) : '',
    });
    const below = adjustedBelowKm(profile);
    const adjusted = document.createElement('p');
    adjusted.textContent =
      below === null
        ? ''
        : t('bi.atmosphere.adjusted', { altitude: formatAltitude(below) });
    body.replaceChildren(table, local, adjusted);
    // La CITATION que le PDS demande (le paquet et son DOI) et l'article de l'équipe, tels que
    // l'archive les publie, avec la date de lecture.
    note.textContent = t('bi.atmosphere.citation', {
      authors: profile.bundle.authors,
      year: String(profile.bundle.year),
      title: profile.bundle.title,
      doi: profile.bundle.doi,
      reference: profile.reference.text,
      date: formatDay(profile.bundle.retrieved),
    });
  };

  const render = (current: string): void => {
    if (!answer) {
      block.hidden = true;
      return;
    }
    if (answer.kind === 'profile') renderProfile(answer.profile);
    else {
      label.textContent = t('bi.atmosphere.labelNone');
      const p = document.createElement('p');
      p.textContent = t('bi.atmosphere.absent', {
        count: num(answer.collections),
        date: formatDay(answer.retrieved),
      });
      body.replaceChildren(p);
      note.textContent = '';
    }
    block.hidden = false;
    rendered = current;
  };

  const sync = (): void => {
    const current = bodyInfo.currentBody();
    if (!current) {
      block.hidden = true;
      rendered = null;
      answer = null;
      return;
    }
    if (nothingToShow === current) {
      block.hidden = true;
      return;
    }
    if (rendered === current) return;
    block.hidden = true;
    answer = null;
    if (pending === current) return;
    pending = current;
    void loadAtmosphereProfile(current)
      .then((loaded) => {
        if (bodyInfo.currentBody() !== current) return;
        if (!loaded) {
          nothingToShow = current;
          return;
        }
        answer = loaded;
        render(current);
      })
      .finally(() => {
        if (pending === current) pending = null;
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
    if (rendered) render(rendered);
  });
}
