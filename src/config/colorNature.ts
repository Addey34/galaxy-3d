/**
 * NATURE DE LA COULEUR affichée par la surface de chaque corps : ce que les pixels représentent
 * (gris, radar, proche infrarouge, fausses couleurs…), dite sur la fiche du corps.
 *
 * Côté app, comme `ILLUSTRATIVE_SURFACES` : le client n'importe pas le registre (zod), cette table
 * en est la copie lue à l'exécution. Elle doit rester alignée avec le champ `colorNature` des
 * fiches `src/registry/products/textures/*-surface.json`, que `colorNature.test.ts` confronte.
 */
import type { ColorNature } from '@/registry/schema/product';

export const COLOR_NATURE_BY_BODY: ReadonlyMap<string, ColorNature> = new Map<
  string,
  ColorNature
>([
  ['amalthea', 'generated'],
  ['ariel', 'monochrome'],
  ['bennu', 'monochrome'],
  ['callisto', 'monochrome'],
  ['ceres', 'monochrome'],
  ['charon', 'monochrome'],
  ['churyumov-gerasimenko', 'monochrome'],
  ['deimos', 'monochrome'],
  ['dione', 'monochrome'],
  ['earth', 'natural'],
  ['enceladus', 'monochrome'],
  ['eris', 'illustrative'],
  ['eros', 'false-color'],
  ['europa', 'monochrome'],
  ['ganymede', 'monochrome'],
  ['gaspra', 'colorized'],
  ['gonggong', 'generated'],
  ['halley', 'illustrative'],
  ['haumea', 'illustrative'],
  ['hydra', 'generated'],
  ['hygiea', 'generated'],
  ['hyperion', 'generated'],
  ['iapetus', 'monochrome'],
  ['ida', 'monochrome'],
  ['io', 'colorized'],
  ['itokawa', 'monochrome'],
  ['jupiter', 'enhanced'],
  ['kerberos', 'generated'],
  ['lutetia', 'monochrome'],
  ['makemake', 'illustrative'],
  ['mars', 'colorized'],
  ['mercury', 'monochrome'],
  ['mimas', 'monochrome'],
  ['miranda', 'monochrome'],
  ['moon', 'monochrome'],
  ['neptune', 'enhanced'],
  ['nereid', 'generated'],
  ['nix', 'generated'],
  ['oberon', 'generated'],
  ['orcus', 'generated'],
  ['pallas', 'generated'],
  ['phobos', 'monochrome'],
  ['pluto', 'monochrome'],
  ['proteus', 'generated'],
  ['quaoar', 'generated'],
  ['rhea', 'monochrome'],
  ['ryugu', 'colorized'],
  ['saturn', 'enhanced'],
  ['sedna', 'generated'],
  ['stars', 'illustrative'],
  ['styx', 'generated'],
  ['sun', 'illustrative'],
  ['tethys', 'monochrome'],
  ['titan', 'infrared'],
  ['titania', 'monochrome'],
  ['triton', 'false-color'],
  ['umbriel', 'generated'],
  ['uranus', 'enhanced'],
  ['venus', 'radar'],
  ['vesta', 'monochrome'],
]);

/**
 * Le JOUR (UTC) où une surface qui est un INSTANTANÉ a été observée : une atmosphère change, la carte vaut à
 * cette date et la fiche le dit (GAL-CATALOG-EXCELLENCE-001), ainsi que les latitudes complétées (`filled`).
 * Copie des champs `observed.from` et `filled` des fiches
 * `src/registry/products/textures/*-surface.json`, confrontée par `colorNature.test.ts`.
 */
export const SURFACE_OBSERVED_BY_BODY: ReadonlyMap<
  string,
  { readonly day: string; readonly filled: boolean }
> = new Map([
  ['jupiter', { day: '2025-12-11', filled: true }],
  ['saturn', { day: '2025-08-29', filled: true }],
  ['uranus', { day: '2026-10-19', filled: true }],
  ['neptune', { day: '2026-08-31', filled: true }],
]);

/** Nature de la couleur d'une surface, ou `undefined` pour un corps sans surface livrée. */
export function colorNatureOf(bodyName: string): ColorNature | undefined {
  return COLOR_NATURE_BY_BODY.get(bodyName);
}
