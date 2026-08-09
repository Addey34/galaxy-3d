/** Etat partageable de l'application, encode dans la query string. */
export type PermalinkMode = 'educ' | 'explo';

export interface PermalinkState {
  mode?: PermalinkMode;
  body?: string;
  date?: Date;
}

const PERMALINK_KEYS = ['mode', 'body', 'date'] as const;

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp);
}

export function parsePermalink(
  search: string,
  validBodies: ReadonlySet<string>
): PermalinkState {
  const params = new URLSearchParams(search);
  const modeValue = params.get('mode');
  const bodyValue = params.get('body')?.trim().toLowerCase();

  return {
    mode: modeValue === 'educ' || modeValue === 'explo' ? modeValue : undefined,
    body:
      bodyValue === 'overview' ||
      (bodyValue !== undefined && validBodies.has(bodyValue))
        ? bodyValue
        : undefined,
    date: parseDate(params.get('date')),
  };
}

export function formatPermalinkDate(date: Date): string {
  return new Date(Math.floor(date.getTime() / 1000) * 1000)
    .toISOString()
    .replace('.000Z', 'Z');
}

export function serializePermalink(
  state: PermalinkState,
  currentSearch = ''
): string {
  const params = new URLSearchParams(currentSearch);
  for (const key of PERMALINK_KEYS) params.delete(key);

  if (state.mode) params.set('mode', state.mode);
  if (state.body) params.set('body', state.body);
  if (state.date) params.set('date', formatPermalinkDate(state.date));

  const query = params.toString();
  return query ? `?${query}` : '';
}
