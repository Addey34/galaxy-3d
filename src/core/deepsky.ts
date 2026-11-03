/**
 * LE CIEL PROFOND : le fichier livré et sa lecture. Pur, sans DOM ni Three.js.
 *
 * `public/assets/sky/deepsky.json` (`scripts/generate-deepsky.mjs`) est un instantané d'OpenNGC
 * (NGC/IC, CC BY-SA 4.0) : amas, nébuleuses et galaxies brillantes. Le catalogue ne donne aucune
 * distance ni aucun mouvement propre utilisables : un objet n'a qu'une DIRECTION fixe (J2000), et
 * l'application ne lui invente ni distance ni taille de scène.
 */

/** Un objet, dans l'ordre de `fields`. */
export type DeepSkyObject = readonly [
  designation: string,
  messier: number | null,
  commonName: string | null,
  type: string,
  constellation: string | null,
  raDeg: number,
  decDeg: number,
  vmag: number | null,
  majorAxisArcmin: number | null,
];

export interface DeepSkyFile {
  source: {
    id: string;
    name: string;
    url: string;
    commit: string;
    license: string;
    licenseUrl: string;
    retrieved: string;
    csvSha256: string;
    rows: number;
    vLimit: number;
  };
  fields: string[];
  count: number;
  objects: DeepSkyObject[];
}

/** Direction équatoriale J2000 (vecteur unitaire) d'un objet, écrite dans `out`. */
export function deepSkyDirection(
  object: Pick<DeepSkyObject, 5 | 6>,
  out: [number, number, number] | Float64Array
): void {
  const ra = (object[5] * Math.PI) / 180;
  const dec = (object[6] * Math.PI) / 180;
  const c = Math.cos(dec);
  out[0] = c * Math.cos(ra);
  out[1] = c * Math.sin(ra);
  out[2] = Math.sin(dec);
}

/**
 * Le nom écrit sur le ciel : « M 31 · Andromeda Galaxy » pour un objet Messier nommé, « M 13 » sans
 * nom d'usage, le nom d'usage seul pour un objet non Messier qui en a un. Rien pour les autres :
 * 494 désignations écrites à la fois noieraient le ciel. Les noms d'usage sont ceux de la source
 * (anglais), non traduits.
 */
export function deepSkyLabel(object: DeepSkyObject): string | null {
  const [, messier, common] = object;
  if (messier !== null)
    return common ? `M ${messier} · ${common}` : `M ${messier}`;
  return common;
}
