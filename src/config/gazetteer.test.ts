import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * LES NOMS DE LA SURFACE, LIVRÉS : CE QUI EST SUR LE DISQUE EST CE QUE LE MANIFESTE ANNONCE.
 *
 * Le répertoire est DÉRIVÉ du Gazetteer of Planetary Nomenclature de l'UAI par
 * `pnpm gazetteer:generate`, qui sait aussi dire en `--check` si un fichier livré a dérivé de sa
 * source. Cette garde-ci ne refait pas ce travail — elle demande le réseau — elle vérifie ce
 * qu'aucune régénération ne verrait : que le manifeste et les fichiers racontent la même chose,
 * que chaque corps nommé existe au catalogue, et que la provenance voyage avec la donnée.
 *
 * POURQUOI LA PROVENANCE EST DANS LE MANIFESTE et non dans `src/registry/providers/` : ce
 * registre décrit les sources des FAITS affichés par corps (rayon, masse, période), et il
 * refuse — sa garde me l'a dit pendant ce lot — une fiche que rien ne cite. Le répertoire des
 * noms est un jeu de données livré, comme l'instantané des petits corps ; sa mention de domaine
 * public et sa citation sont celles que l'UAI DEMANDE, lues dans sa FAQ.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = join(ROOT, 'public/assets/gazetteer');
const ENTITIES = join(ROOT, 'src/registry/entities');

interface Feature {
  name: string;
  code: string;
  type: string;
  lat: number;
  lon: number;
  diameterKm: number;
  approved: string;
  origin: string;
  iauId: number;
}

interface Manifest {
  convention: { longitude: string; latitude: string; source: string };
  provider: Record<string, string>;
  bodies: Record<string, { count: number; bytes: number }>;
}

const manifest = JSON.parse(
  readFileSync(join(ROOT, 'src/config/gazetteerIndex.json'), 'utf-8')
) as Manifest;

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -5))
  .sort();

const featuresOf = (body: string): Feature[] =>
  JSON.parse(readFileSync(join(DIR, `${body}.json`), 'utf-8')) as Feature[];

describe('répertoire des noms de surface', () => {
  it('annonce EXACTEMENT les corps présents sur le disque', () => {
    // Un fichier que le manifeste ignore ne serait chargé par personne ; une entrée de
    // manifeste sans fichier ferait échouer une approche, et seulement à l'approche.
    expect(Object.keys(manifest.bodies).sort()).toEqual(files);
    expect(files.length).toBeGreaterThanOrEqual(30);
  });

  it('ne nomme que des corps du catalogue', () => {
    const known = new Set(
      readdirSync(ENTITIES)
        .filter((f) => f.endsWith('.json') && f !== 'order.json')
        .map((f) => f.slice(0, -5))
    );
    for (const body of files)
      expect(known.has(body), `${body} n'est pas au catalogue`).toBe(true);
  });

  it('compte et pèse ce que les fichiers contiennent vraiment', () => {
    for (const body of files) {
      const raw = readFileSync(join(DIR, `${body}.json`), 'utf-8');
      const entry = manifest.bodies[body]!;
      expect(JSON.parse(raw).length, `${body} : nombre annoncé`).toBe(
        entry.count
      );
      expect(Buffer.byteLength(raw), `${body} : octets annoncés`).toBe(
        entry.bytes
      );
    }
  });

  it('porte des coordonnées dans la convention qu’il DÉCLARE', () => {
    // La convention n'est pas devinée : la page de téléchargement de l'UAI dit « east
    // longitude, planetocentric latitude », et le manifeste le répète pour que personne n'ait
    // à le redécouvrir. Une longitude négative ici voudrait dire qu'on a pris le `<Point>` du
    // KML (en -180..180) au lieu du champ `center_lon`.
    expect(manifest.convention.longitude).toMatch(/east/i);
    expect(manifest.convention.latitude).toMatch(/planetocentric/i);
    for (const body of files)
      for (const f of featuresOf(body)) {
        expect(f.lat, `${body}/${f.name} latitude`).toBeGreaterThanOrEqual(-90);
        expect(f.lat, `${body}/${f.name} latitude`).toBeLessThanOrEqual(90);
        expect(f.lon, `${body}/${f.name} longitude`).toBeGreaterThanOrEqual(0);
        expect(f.lon, `${body}/${f.name} longitude`).toBeLessThanOrEqual(360);
      }
  });

  it('donne à chaque formation un nom et son identifiant UAI', () => {
    // L'identifiant est ce qui permet d'aller LIRE la fiche à la source ; sans lui, un nom
    // affiché ici ne serait plus vérifiable par personne.
    for (const body of files)
      for (const f of featuresOf(body)) {
        expect(f.name.length, `${body} : formation sans nom`).toBeGreaterThan(
          0
        );
        expect(
          f.iauId,
          `${body}/${f.name} sans identifiant UAI`
        ).toBeGreaterThan(0);
      }
  });

  it('ne livre JAMAIS deux fois le même identifiant sur un corps', () => {
    // L'UAI publie parfois une formation deux fois sous le même lien de fiche (douze cas mesurés
    // le 2026-09-30, Kunisada à deux centres différents). Le générateur tranche par la fiche ;
    // une copie restante écrirait le nom deux fois, et ferait mentir tout compte par identifiant
    // (c'est la garde des formations observées qui l'a vu).
    for (const body of files) {
      const seen = new Map<number, string>();
      for (const f of featuresOf(body)) {
        expect(
          seen.has(f.iauId),
          `${body} : ${f.name} (${f.iauId}) en double`
        ).toBe(false);
        seen.set(f.iauId, f.name);
      }
    }
  });

  it('fait voyager la provenance AVEC la donnée', () => {
    const p = manifest.provider;
    expect(p.publisher).toContain('International Astronomical Union');
    expect(p.rights).toBe('public-domain');
    // La mention est CITÉE, pas reformulée : c'est la phrase de la FAQ de l'UAI.
    expect(p.rightsQuote).toContain('public domain');
    expect(p.rightsStatedAt).toMatch(
      /^https:\/\/planetarynames\.wr\.usgs\.gov\//
    );
    expect(p.citation).toContain('Gazetteer of Planetary Nomenclature');
    expect(p.accessed).toMatch(/^20\d\d-\d\d-\d\d$/);
  });
});
