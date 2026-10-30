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
import {
  convertDistanceKm,
  convertHeightKm,
  convertPressureBar,
  getUnitSystem,
  onUnitSystemChange,
} from '@/core/units';
import { surfacePressureDisplay } from '@/core/bodyFacts';
import { formatIsoDay } from '@/core/dateText';
import { kelvinWithConversion, superscript } from '@/core/numberText';
import { getLocale, intlLocale, onLocaleChange, t } from '@/i18n';
import type { PublicAPI } from '@/SolarSystemApp';
import type { BodyInfoPanel } from './bodyInfo';
import { setCitationText } from './citationLinks';

const formatDay = (iso: string): string =>
  formatIsoDay(iso.slice(0, 10), getLocale(), intlLocale());

const num = (value: number, digits = 0): string =>
  new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: digits }).format(
    value
  );

/** Une valeur positive en notation scientifique : « 1,2 × 10⁻³ unité ». */
function formatScientific(value: number, unit: string): string {
  let exponent = Math.floor(Math.log10(value));
  let mantissa = value / 10 ** exponent;
  // Une mantisse qui s'arrondit à 10 (9,97 × 10⁻⁴) passe à l'exposant suivant : « 1 × 10⁻³ ».
  if (Number(mantissa.toFixed(1)) >= 10) {
    exponent += 1;
    mantissa /= 10;
  }
  const sup = superscript(exponent);
  return `${num(mantissa, 1)}\u00a0×\u00a010${sup}\u00a0${unit}`;
}

/**
 * Une pression sur neuf ordres de grandeur. Métrique : bar, millibar, puis notation scientifique.
 * Impérial : psi, puis trois chiffres significatifs, puis notation scientifique (le millibar n'a
 * pas d'équivalent usuel).
 */
export function formatPressure(bar: number): string {
  if (getUnitSystem() === 'imperial') {
    const psi = convertPressureBar(bar);
    if (psi.value >= 1)
      return `${num(psi.value, psi.value < 10 ? 2 : 1)}\u00a0${psi.unit}`;
    if (psi.value >= 1e-3) {
      const decimals = Math.min(
        8,
        Math.max(0, 2 - Math.floor(Math.log10(psi.value)))
      );
      return `${num(psi.value, decimals)}\u00a0${psi.unit}`;
    }
    return formatScientific(psi.value, psi.unit);
  }
  if (bar >= 1e-3) {
    const shown = surfacePressureDisplay(bar);
    const decimals = bar >= 1 && bar < 10 ? 2 : 1;
    return `${num(shown.value, decimals)}\u00a0${shown.unit}`;
  }
  return formatScientific(bar, convertPressureBar(bar).unit);
}

/** Une altitude signée par rapport au niveau de 1 bar (« +1 029 km », « −132 km »). */
function formatAltitude(km: number): string {
  const distance = convertDistanceKm(Math.abs(km));
  const text = `${num(distance.value)}\u00a0${distance.unit}`;
  return km > 0 ? `+${text}` : km < 0 ? `−${text}` : text;
}

/** Une altitude au-dessus du sol : en km, et en mètres sous le kilomètre. */
function formatHeight(km: number): string {
  const height = convertHeightKm(km);
  return `${num(height.value)}\u00a0${height.unit}`;
}

const formatKelvin = (kelvin: number): string =>
  kelvinWithConversion(kelvin, num);

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
    const ground = profile.altitudeReference === 'surface';
    label.textContent = t(
      ground ? 'bi.atmosphere.labelTitan' : 'bi.atmosphere.label'
    );
    const table = document.createElement('table');
    table.className = 'bi-atmosphere-table';
    const head = document.createElement('tr');
    for (const key of [
      ground ? 'bi.atmosphere.altitudeSurface' : 'bi.atmosphere.altitude',
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
      tr.classList.toggle('is-adjusted', row.adjusted);
      for (const text of [
        row.kind === 'surface'
          ? t('bi.atmosphere.ground')
          : ground
            ? formatHeight(row.altitudeKm)
            : formatAltitude(row.altitudeKm),
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
    const place = {
      min: num(profile.latitudeDeg.min, 1),
      max: num(profile.latitudeDeg.max, 1),
      date: entry?.start ? formatDay(entry.start) : '',
    };
    local.textContent = profile.surface
      ? t('bi.atmosphere.localTitan', {
          ...place,
          low: num(profile.surface.temperatureRangeK[0], 1),
          high: num(profile.surface.temperatureRangeK[1], 1),
        })
      : t('bi.atmosphere.local', place);
    const below = adjustedBelowKm(profile);
    const adjusted = document.createElement('p');
    adjusted.textContent =
      below === null
        ? ''
        : t('bi.atmosphere.adjusted', { altitude: formatAltitude(below) });
    body.replaceChildren(table, local, adjusted);
    // La CITATION que le PDS demande (le paquet et son DOI) et l'article de l'équipe, tels que
    // l'archive les publie, avec la date de lecture.
    const citation = t('bi.atmosphere.citation', {
      authors: profile.bundle.authors,
      year: String(profile.bundle.year),
      title: profile.bundle.title,
      doi: profile.bundle.doi,
      reference: profile.reference.text,
      date: formatDay(profile.bundle.retrieved),
    });
    const site = profile.latitudeSource
      ? ` ${t('bi.atmosphere.site', {
          title: profile.latitudeSource.title,
          doi: profile.latitudeSource.doi,
        })}`
      : '';
    // Les DOI sont des liens `doi.org` : un identifiant stable qu'on peut suivre.
    setCitationText(note, citation + site, [
      profile.bundle.doi,
      ...(profile.latitudeSource ? [profile.latitudeSource.doi] : []),
    ]);
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

  const redraw = (): void => {
    if (rendered) render(rendered);
  };
  onLocaleChange(redraw);
  onUnitSystemChange(redraw);
}
