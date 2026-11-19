/**
 * Une LECTURE de l'inspecteur (`FieldReading`) → des LIGNES prêtes à afficher (GAL-METEO-INSPECT-003).
 *
 * Module pur : lecture, préférence d'unités, langue et traducteur entrent, du texte sort. Aucun DOM,
 * aucun réseau. Tout ce que l'interface a le droit de DIRE est décidé ici, donc testé ici :
 *
 *  - une valeur n'est écrite que pour `available` ; `stale`, `missing`, `outOfCoverage`, `noData`
 *    disent leur raison, jamais un chiffre ;
 *  - un vrai zéro s'écrit « 0 » et dit « aucune précipitation » ; une donnée manquante ne s'écrit
 *    jamais 0 ;
 *  - un taux GFS (mm/h) et un cumul de l'heure précédente (mm) portent deux unités et deux phrases ;
 *  - un vent calme n'a pas de direction ; une direction dit D'OÙ VIENT l'air ;
 *  - l'écart entre l'heure demandée et la date effective est écrit quand il existe, jamais déduit ;
 *  - les unités suivent la préférence métrique / impérial déjà en vigueur (`core/units`).
 */
import {
  convertPressureHpa,
  convertRainRateMmH,
  convertSpeedKmh,
  convertTemperatureC,
  type Quantity,
} from './units';
import { temporalCategoryLabelKey } from './temporal';
import type {
  FieldProvenance,
  FieldReading,
  InspectVariable,
  ScalarReading,
  WindReading,
} from './meteoInspect';

export type Translate = (
  key: string,
  vars?: Record<string, string | number>
) => string;

/** Ce que la ligne montre : une valeur, ou la raison de son absence. */
export type RowStatus = 'value' | 'pending' | 'unavailable' | 'error';

export interface InspectRow {
  /** Identifiant de la couche qui répond (`thermal-model`, `wind`…). */
  layerId: string;
  variable: InspectVariable;
  /** Libellé de la variable, déjà traduit. */
  label: string;
  status: RowStatus;
  /** La valeur et son unité (`12,3 °C`), seulement pour `status === 'value'`. */
  value: string | null;
  /** Précision de la valeur (direction du vent, nature de la précipitation, vrai zéro). */
  detail: string | null;
  /** La raison, quand il n'y a pas de valeur. */
  message: string | null;
  /** Couples (libellé, valeur) de la provenance, repliés par défaut. */
  meta: Array<{ label: string; value: string }>;
}

const NBSP = ' ';

function format(
  locale: string,
  value: number,
  digits: number,
  minDigits = digits
): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: minDigits,
    maximumFractionDigits: digits,
  }).format(value);
}

const quantity = (locale: string, q: Quantity, digits: number): string =>
  `${format(locale, q.value, digits)}${NBSP}${q.unit}`;

/** Les huit rumbs : N, NE, E, SE, S, SW, W, NW. */
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

export function compassPoint(degrees: number): (typeof COMPASS)[number] {
  const normalized = ((degrees % 360) + 360) % 360;
  return COMPASS[Math.round(normalized / 45) % 8]!;
}

/** L'ordre d'affichage des lignes : le même quel que soit l'ordre des couches du panneau. */
export const VARIABLE_ORDER: readonly InspectVariable[] = [
  'temperature',
  'pressure',
  'humidity',
  'precipitation',
  'cloudCover',
  'wind',
];

const VARIABLE_LABEL: Record<InspectVariable, string> = {
  temperature: 'inspect.var.temperature',
  pressure: 'inspect.var.pressure',
  humidity: 'inspect.var.humidity',
  precipitation: 'inspect.var.precipitation',
  cloudCover: 'inspect.var.cloudCover',
  wind: 'inspect.var.wind',
};

/** « 2026-11-10 15:00 UTC » : le fuseau n'est jamais implicite. */
function utcStamp(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function offsetText(ms: number, t: Translate, locale: string): string {
  const hours = ms / 3_600_000;
  return t('inspect.meta.offset', {
    h: `${hours > 0 ? '+' : '−'}${format(locale, Math.abs(hours), Number.isInteger(hours) ? 0 : 1)}`,
  });
}

function metaOf(
  provenance: FieldProvenance,
  t: Translate,
  locale: string
): InspectRow['meta'] {
  const meta: InspectRow['meta'] = [
    { label: t('inspect.meta.source'), value: provenance.provider },
  ];
  if (provenance.temporalCategory) {
    const reduced =
      provenance.confidence === 'reduced'
        ? ` · ${t('time.confidence.reduced')}`
        : '';
    meta.push({
      label: t('inspect.meta.nature'),
      value: `${t(temporalCategoryLabelKey(provenance.temporalCategory))}${reduced}`,
    });
  }
  meta.push({
    label: t('inspect.meta.effective'),
    value: utcStamp(provenance.effectiveDate),
  });
  if (provenance.effectiveOffsetMs !== 0) {
    meta.push({
      label: t('inspect.meta.requested'),
      value: `${utcStamp(provenance.requestedHour)} (${offsetText(provenance.effectiveOffsetMs, t, locale)})`,
    });
  }
  meta.push({
    label: t('inspect.meta.grid'),
    value: t('inspect.meta.gridValue', {
      step: format(
        locale,
        provenance.stepDegrees,
        provenance.stepDegrees % 1 ? 1 : 0
      ),
    }),
  });
  return meta;
}

/** Pourquoi une couche active ne donne pas de valeur : la phrase ET le statut de la ligne. */
function absence(
  reading: FieldReading,
  t: Translate
): { status: RowStatus; message: string } {
  const error = reading.phase === 'error';
  const loading = reading.phase === 'loading';
  switch (reading.availability) {
    case 'missing':
      return { status: 'unavailable', message: t('inspect.msg.missing') };
    case 'outOfCoverage':
      return { status: 'unavailable', message: t('inspect.msg.outOfCoverage') };
    case 'stale':
      if (error)
        return { status: 'error', message: t('inspect.msg.staleError') };
      return {
        status: loading ? 'pending' : 'unavailable',
        message: t(loading ? 'inspect.msg.updating' : 'inspect.msg.stale'),
      };
    case 'noData':
      if (reading.emptyReason === 'outOfRange')
        return { status: 'unavailable', message: t('inspect.msg.outOfRange') };
      if (error) return { status: 'error', message: t('inspect.msg.error') };
      return { status: 'pending', message: t('inspect.msg.loading') };
    default:
      return { status: 'unavailable', message: t('inspect.msg.missing') };
  }
}

function scalarValue(
  reading: ScalarReading,
  locale: string
): { value: string; detail: string | null; zero: boolean } {
  const v = reading.value as number;
  switch (reading.variable) {
    case 'temperature':
      return {
        value: quantity(locale, convertTemperatureC(v), 1),
        detail: null,
        zero: false,
      };
    case 'pressure': {
      const q = convertPressureHpa(v);
      return {
        value: quantity(locale, q, q.unit === 'hPa' ? 0 : 2),
        detail: null,
        zero: false,
      };
    }
    case 'humidity':
    case 'cloudCover':
      return {
        value: `${format(locale, v, 0)}${NBSP}%`,
        detail: null,
        zero: false,
      };
    case 'precipitation': {
      // L'unité de la lecture dit la nature : `mm/h` = taux instantané (GFS), `mm` = cumul de
      // l'heure précédente. La conversion impériale garde la même nature (in/h ou in).
      const rate = convertRainRateMmH(v);
      const unit =
        reading.unit === 'mm' ? rate.unit.replace('/h', '') : rate.unit;
      // Jusqu'à deux décimales (trois en pouces), sans zéros de fin : « 0 » pour un vrai zéro.
      const digits = rate.unit === 'mm/h' ? 2 : 3;
      return {
        value: `${format(locale, rate.value, digits, 0)}${NBSP}${unit}`,
        detail: null,
        zero: v === 0,
      };
    }
    default:
      return { value: format(locale, v, 1), detail: null, zero: false };
  }
}

function windValue(
  reading: WindReading,
  t: Translate,
  locale: string
): { value: string; detail: string } {
  const speed = reading.speedKmh as number;
  const converted = convertSpeedKmh(speed);
  const digits = converted.value < 10 ? 1 : 0;
  const value = quantity(locale, converted, digits);
  if (reading.calm || reading.directionDeg === null)
    return { value, detail: t('inspect.wind.calm') };
  return {
    value,
    detail: t('inspect.wind.from', {
      dir: t(`inspect.dir.${compassPoint(reading.directionDeg)}`),
      deg: format(locale, reading.directionDeg, 0),
    }),
  };
}

/** Une lecture → une ligne. Les couches `inactive` n'ont pas de ligne : l'appelant les écarte. */
export function describeReading(
  layerId: string,
  reading: FieldReading,
  t: Translate,
  locale: string
): InspectRow {
  const base = {
    layerId,
    variable: reading.variable,
    label: t(VARIABLE_LABEL[reading.variable]),
    meta: reading.provenance ? metaOf(reading.provenance, t, locale) : [],
  };
  if (reading.availability !== 'available') {
    const { status, message } = absence(reading, t);
    return { ...base, status, value: null, detail: null, message };
  }
  if (reading.kind === 'wind') {
    const { value, detail } = windValue(reading, t, locale);
    return { ...base, status: 'value', value, detail, message: null };
  }
  const { value, detail, zero } = scalarValue(reading, locale);
  let note = detail;
  if (reading.variable === 'precipitation') {
    note =
      reading.nature === 'instantRate'
        ? t('inspect.precip.rate')
        : t('inspect.precip.accumulation');
    if (zero) note = `${t('inspect.precip.none')} · ${note}`;
  }
  return { ...base, status: 'value', value, detail: note, message: null };
}
