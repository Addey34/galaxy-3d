/**
 * LE PROFIL MESURÉ D'UNE ATMOSPHÈRE (lot 51, pas 3) : ce que la fiche en montre. Module PUR.
 *
 * La source est le profil de la sonde Galileo (`scripts/generate-atmosphere-profiles.mjs`) :
 * 686 échantillons, de 1 028 km au-dessus du niveau de 1 bar à −132 km dessous. La fiche n'en
 * montre que quelques LIGNES, et chacune est un échantillon PUBLIÉ, jamais une interpolation :
 * le plus haut, celui dont la pression est la plus proche de chaque décade repère, le plus bas.
 * Un nombre interpolé serait un point que l'équipe n'a pas écrit. Titan (2026-10-28) ajoute le
 * point de SURFACE de HASI, lu dans ses tables de la phase au sol, en dernière ligne.
 */

/**
 * `[altitude (km), pression (bar), température (K)]`. L'altitude se compte depuis le niveau de 1
 * bar pour une géante (Jupiter), depuis le SOL pour un corps à surface (Titan) : voir
 * `AtmosphereProfile.altitudeReference`.
 */
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

/**
 * Le point de surface d'un corps à sol, tel que l'instrument l'a mesuré : la PREMIÈRE ligne à
 * altitude 0 de chaque table, avec la dispersion des lignes de la phase au sol.
 */
export interface SurfacePoint {
  readonly altitudeKm: number;
  readonly pressureBar: number;
  readonly pressureRangeBar: readonly [number, number];
  readonly temperatureK: number;
  readonly temperatureSigmaK: number;
  readonly temperatureRangeK: readonly [number, number];
}

export interface AtmosphereProfile {
  readonly body: string;
  readonly instrument: string;
  /** Défaut `bar1` (Jupiter) : l'altitude zéro est le niveau de 1 bar. `surface` : le sol. */
  readonly altitudeReference?: 'bar1' | 'surface';
  /** Où la latitude a été lue, quand ce n'est pas le paquet du profil (Titan : trajectoire). */
  readonly latitudeSource?: {
    readonly title: string;
    readonly doi: string;
  };
  readonly surface?: SurfacePoint;
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
  readonly kind: ProfileSegment['kind'] | 'surface';
  /** Vrai pour une ligne AJUSTÉE (segment qui porte une phrase de méthode), non mesurée. */
  readonly adjusted: boolean;
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
      adjusted: segment.method !== undefined,
    }))
  );
  if (all.length === 0) return [];
  const byAltitude = [...all].sort((a, b) => b.altitudeKm - a.altitudeKm);
  const picked = new Set<ProfileRow>([byAltitude[0]!]);
  if (!profile.surface) picked.add(byAltitude.at(-1)!);
  for (const target of REFERENCE_PRESSURES_BAR) {
    let best = all[0]!;
    for (const row of all)
      if (
        row.pressureBar > 0 &&
        Math.abs(Math.log10(row.pressureBar / target)) <
          Math.abs(Math.log10(best.pressureBar / target))
      )
        best = row;
    // Un repère que le profil n'atteint pas (10 bar pour un sol à 1,5 bar) n'a pas de ligne : le
    // plus proche échantillon serait le fond, déjà montré. Le seuil, un facteur deux, est large
    // pour Jupiter, dont le profil couvre les quatre décades.
    if (Math.abs(Math.log10(best.pressureBar / target)) <= Math.log10(2))
      picked.add(best);
  }
  const rows = byAltitude.filter((row) => picked.has(row));
  // Le sol vient d'autres tables que les segments (phase « surface ») : sa ligne est la dernière,
  // et le plus bas échantillon de la descente n'est plus gardé que s'il est lui-même un repère.
  if (profile.surface)
    rows.push({
      altitudeKm: profile.surface.altitudeKm,
      pressureBar: profile.surface.pressureBar,
      temperatureK: profile.surface.temperatureK,
      kind: 'surface',
      adjusted: false,
    });
  return rows;
}

/** L'altitude la plus haute du segment AJUSTÉ : au-dessous, les lignes ne sont pas mesurées. */
export function adjustedBelowKm(profile: AtmosphereProfile): number | null {
  const descent = profile.segments.find((s) => s.kind === 'descent');
  // Sans phrase de méthode, la descente est MESURÉE (Titan) : rien n'y est ajusté.
  if (!descent || descent.method === undefined || descent.samples.length === 0)
    return null;
  return Math.max(...descent.samples.map((s) => s[0]));
}
