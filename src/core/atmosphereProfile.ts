/**
 * LE PROFIL MESURÉ D'UNE ATMOSPHÈRE (lot 51, pas 3) : ce que la fiche en montre. Module PUR.
 *
 * La source est le profil de la sonde Galileo (`scripts/generate-atmosphere-profiles.mjs`) :
 * 686 échantillons, de 1 028 km au-dessus du niveau de 1 bar à −132 km dessous. La fiche n'en
 * montre que quelques LIGNES, et chacune est un échantillon PUBLIÉ, jamais une interpolation :
 * le plus haut, celui dont la pression est la plus proche de chaque décade repère, le plus bas.
 * Un nombre interpolé serait un point que l'équipe n'a pas écrit.
 */

/** `[altitude au-dessus du niveau de 1 bar (km), pression (bar), température (K)]`. */
type ProfileSample = readonly [number, number, number];

interface ProfileSegment {
  /** `entry` : réduit des mesures de l'entrée ; `descent` : AJUSTÉ à l'adiabatique sèche. */
  readonly kind: 'entry' | 'descent';
  readonly product: string;
  readonly url: string;
  readonly retrieved: string;
  readonly start: string | null;
  readonly stop: string | null;
  /** La phrase de méthode de la source, quand elle en publie une (la descente). */
  readonly method?: string;
  readonly samples: readonly ProfileSample[];
}

export interface AtmosphereProfile {
  readonly body: string;
  readonly instrument: string;
  readonly bundle: {
    readonly lid: string;
    readonly title: string;
    readonly authors: string;
    readonly year: number;
    readonly doi: string;
    readonly retrieved: string;
  };
  readonly reference: { readonly text: string; readonly retrieved: string };
  readonly latitudeDeg: { readonly min: number; readonly max: number };
  readonly segments: readonly ProfileSegment[];
}

export interface ProfileRow {
  readonly altitudeKm: number;
  readonly pressureBar: number;
  readonly temperatureK: number;
  readonly kind: ProfileSegment['kind'];
}

/** Les pressions repères, en bar : une ligne par décade utile, de la stratosphère au fond. */
const REFERENCE_PRESSURES_BAR: readonly number[] = [1e-3, 0.1, 1, 10];

/**
 * Les lignes affichées : le plus haut échantillon, celui dont la pression est la plus proche
 * (en logarithme) de chaque pression repère, et le plus bas. Sans doublon, de haut en bas.
 */
export function profileRows(profile: AtmosphereProfile): ProfileRow[] {
  const all: ProfileRow[] = profile.segments.flatMap((segment) =>
    segment.samples.map(([altitudeKm, pressureBar, temperatureK]) => ({
      altitudeKm,
      pressureBar,
      temperatureK,
      kind: segment.kind,
    }))
  );
  if (all.length === 0) return [];
  const byAltitude = [...all].sort((a, b) => b.altitudeKm - a.altitudeKm);
  const picked = new Set<ProfileRow>([byAltitude[0]!, byAltitude.at(-1)!]);
  for (const target of REFERENCE_PRESSURES_BAR) {
    let best = all[0]!;
    for (const row of all)
      if (
        row.pressureBar > 0 &&
        Math.abs(Math.log10(row.pressureBar / target)) <
          Math.abs(Math.log10(best.pressureBar / target))
      )
        best = row;
    picked.add(best);
  }
  return byAltitude.filter((row) => picked.has(row));
}

/** L'altitude la plus haute du segment AJUSTÉ : au-dessous, les lignes ne sont pas mesurées. */
export function adjustedBelowKm(profile: AtmosphereProfile): number | null {
  const descent = profile.segments.find((s) => s.kind === 'descent');
  if (!descent || descent.samples.length === 0) return null;
  return Math.max(...descent.samples.map((s) => s[0]));
}
