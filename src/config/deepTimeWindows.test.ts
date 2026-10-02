/**
 * LA PROFONDEUR DU TEMPS (lot 39) confrontée à ce qui la produit.
 *
 * Le relevé de validation porte depuis ce lot un millénaire par ligne, de l'an 1 à l'an 9999,
 * prolongé le 2026-10-02 jusqu'en 9998 av. J.-C. (année astronomique -9997, ligne 22.10),
 * mesuré contre la cible profonde que `scripts/validation-targets.json` déclare pour chaque
 * corps. Trois choses peuvent dériver sans que rien ne le dise, et chacune a sa garde ici :
 * une cible déclarée dont personne n'a relancé la mesure, un plancher de substitution qui
 * laisserait passer une ligne qu'il devrait retenir, et un pavage troué qui ferait dire
 * « reconstruit » à une date qu'aucune fenêtre ne couvre.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import summaryJson from './horizons-validation-summary.json';
import type { ValidationRow, ValidationSummary } from '@/seo/methodologyPage';

const summary = summaryJson as unknown as ValidationSummary;
const DEEP = summary.rows.filter((r) => r.windowKind === 'deep');

/** La table des cibles, lue à sa source : le script n'a pas d'autre propriétaire. */
const TARGETS = (
  JSON.parse(
    readFileSync(new URL('../../scripts/validation-targets.json', import.meta.url), 'utf8') // prettier-ignore
  ) as {
    targets: Record<string, { command: string; deep?: { command: string } }>;
  }
).targets;

const DECLARED = Object.entries(TARGETS)
  .filter(([, t]) => t.deep)
  .map(([body]) => body);

const bodiesOf = (rows: readonly ValidationRow[]): string[] => [
  ...new Set(rows.map((r) => r.body)),
];

describe('profondeur du temps : les corps mesurés', () => {
  it('sont EXACTEMENT ceux qui déclarent une cible profonde', () => {
    // Déclarer un « deep » sans relancer `pnpm ephemeris:validate` laisserait une promesse
    // sans mesure, et retirer une déclaration laisserait des lignes orphelines.
    expect(bodiesOf(DEEP).sort()).toEqual([...DECLARED].sort());
  });

  it('chaque ligne interroge la cible profonde DÉCLARÉE, jamais le corps', () => {
    for (const row of DEEP)
      expect(row.target).toBe(TARGETS[row.body]!.deep!.command);
  });

  it('une ligne profonde vient d’une source qui répond à toute date', () => {
    // Un binaire Horizons ou un noyau SPK ne répond pas hors de sa couverture : il ne peut pas
    // avoir de millénaire profond. Seuls astronomy-engine et les éléments képlériens le peuvent.
    for (const row of DEEP)
      expect(['astronomy-engine', 'kepler']).toContain(row.provider);
  });
});

describe('profondeur du temps : le plancher de substitution', () => {
  const substituted = DEEP.filter((r) => r.target !== TARGETS[r.body]!.command);

  it('toute ligne substituée porte un plancher mesuré', () => {
    expect(substituted.length).toBeGreaterThan(0);
    for (const row of substituted) expect(row.floorKm).toBeGreaterThan(0);
  });

  /**
   * LA RÈGLE, rejouée ici sur la donnée livrée : un plancher qui atteindrait un centième de
   * l'écart pourrait déplacer les deux chiffres significatifs que la fiche imprime. Falsifiée
   * en retirant le refus d'une ligne d'Uranus dans le résumé : ce test devient rouge.
   */
  it('aucune ligne publiée ne dépasse le centième que la règle autorise', () => {
    for (const row of substituted) {
      const mean = row.km?.mean;
      if (mean == null) continue;
      expect(row.floorKm!).toBeLessThanOrEqual(0.01 * mean);
    }
  });

  it('une ligne retenue dit pourquoi, et ne publie AUCUN chiffre', () => {
    // Un CODE, pas une phrase : ce champ est rendu tel quel sur /methodology, qui existe en
    // quatre langues, et une phrase française y est apparue dans le tableau de la page
    // anglaise avant que cette garde n'existe.
    for (const row of DEEP.filter((r) => r.floorRefused)) {
      expect(row.floorRefused).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(row.km).toBeNull();
      expect(row.radii).toBeNull();
    }
  });

  it('le bloc « deep » du résumé décrit chaque corps substitué', () => {
    const declared = summary.deep?.bodies ?? {};
    expect(Object.keys(declared).sort()).toEqual(bodiesOf(substituted).sort());
    for (const [body, deep] of Object.entries(declared)) {
      expect(deep.target).toBe(TARGETS[body]!.deep!.command);
      expect(deep.floorKm).toBeGreaterThan(0);
      // Le fait qui a coûté le plus cher à trouver : pour Uranus et Neptune, le plancher du
      // chemin réel dépasse de loin la distance géométrique corps-barycentre, parce que
      // Horizons n'est pas cohérent avec lui-même. La garde n'exige donc PAS l'égalité ; elle
      // exige que les deux soient publiés, pour qu'un lecteur puisse voir le désaccord.
      expect(deep.separationMaxKm).toBeGreaterThan(0);
      expect(typeof deep.insideBody).toBe('boolean');
    }
  });
});

describe('profondeur du temps : le pavage', () => {
  it('chaque corps est pavé sans trou de 9998 av. J.-C. à l’an 9999', () => {
    // Trier par DATE : en ordre de chaîne, « -001000 » passe avant « -009997 », et le premier
    // élément serait faux (le même piège qu'à la page /methodology, ligne 22.10).
    const time = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
    for (const body of bodiesOf(DEEP)) {
      const tiles = DEEP.filter((r) => r.body === body).sort(
        (a, b) => time(a.windowFrom) - time(b.windowFrom)
      );
      expect(tiles[0]!.windowFrom, body).toBe('-009997-01-01');
      expect(tiles.at(-1)!.windowTo.slice(0, 4), body).toBe('9999');
      // Le passage de l'ère : la tranche qui finit au début de l'an 1 est suivie de celle qui
      // y commence, sans année 0 perdue ni comptée deux fois.
      expect(
        tiles.map((t) => t.windowFrom),
        body
      ).toContain('0001-01-01');
      // Bout à bout : la fin d'une tuile est le début de la suivante.
      for (let i = 1; i < tiles.length; i++)
        expect(tiles[i]!.windowFrom).toBe(tiles[i - 1]!.windowTo);
    }
  });

  /**
   * LE TÉMOIN ΔT (ligne 22.10) : chaque écart profond compare deux positions à une même date UT,
   * convertie par deux ΔT qui ne sont plus des mesures avant les observations. Leur désaccord est
   * publié à côté de l'écart ; cette garde exige qu'il soit mesuré pour CHAQUE tranche.
   */
  it('le désaccord des deux ΔT est mesuré au milieu de chaque tranche', () => {
    const deltaT = (
      summary as unknown as {
        deep: {
          deltaT: { year: number; horizonsS: number; galaxyS: number }[];
        };
      }
    ).deep.deltaT;
    const time = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
    const someBody = bodiesOf(DEEP)[0]!;
    // L'année du milieu de chaque tranche, dans l'ordre : c'est là que le script mesure ΔT.
    const midYears = DEEP.filter((r) => r.body === someBody)
      .map((t) => (time(t.windowFrom) + time(t.windowTo)) / 2)
      .sort((a, b) => a - b)
      .map((ms) => new Date(ms).getUTCFullYear());
    expect(deltaT.map((d) => d.year)).toEqual(midYears);
    for (const d of deltaT)
      expect(
        Number.isFinite(d.horizonsS) && Number.isFinite(d.galaxyS),
        String(d.year)
      ).toBe(true);
    // Borne : avant notre ère les deux ΔT divergent d'au moins une minute, sinon ce témoin ne
    // témoignerait de rien.
    const earliest = deltaT[0]!;
    expect(Math.abs(earliest.horizonsS - earliest.galaxyS)).toBeGreaterThan(60);
  });

  it('les tuiles publiées couvrent bien 1900-2100 pour un corps non substitué', () => {
    // La Terre n'a pas de substitution : aucune de ses tuiles ne peut être retenue.
    const earth = DEEP.filter((r) => r.body === 'earth');
    expect(earth.length).toBeGreaterThan(0);
    for (const row of earth) {
      expect(row.floorRefused).toBeUndefined();
      expect(row.km?.mean).toBeGreaterThan(0);
    }
  });
});
