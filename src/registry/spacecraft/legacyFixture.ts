/**
 * Sondes spatiales — couche instrument 2D (`src/ui/spacecraftOverlay.ts`).
 *
 * Contenu uniquement, séparé du catalogue principal comme `smallBodies.ts` : une sonde n'a ni
 * rayon, ni texture, ni orbite képlérienne fermée (assistances gravitationnelles, halo L2 pour
 * JWST) — sa position vient exclusivement des vecteurs réels JPL Horizons
 * (`HorizonsEphemerisService`, mêmes binaires que les planètes/lunes/planètes naines).
 * `name` est la clé de jointure exacte avec `manifest.json` / `scripts/generate-horizons-ephemerides.mjs`.
 */
import type { LocalizedText } from '@/types';

export interface SpacecraftMission {
  name: string;
  displayName: LocalizedText;
  description: LocalizedText;
  /** ISO — repli d'affichage ; la vraie borne de couverture vient du manifeste. */
  launchDate: string;
  /** Couleur du marqueur/label, 0xRRGGBB. */
  color: number;
}

export const SPACECRAFT_MISSIONS: SpacecraftMission[] = [
  {
    name: 'voyager1',
    displayName: { en: 'Voyager 1', fr: 'Voyager 1' },
    description: {
      en: 'Launched in 1977, the most distant human-made object, now in interstellar space.',
      fr: 'Lancée en 1977, l’objet humain le plus lointain, aujourd’hui dans l’espace interstellaire.',
    },
    launchDate: '1977-09-05',
    color: 0xffcc66,
  },
  {
    name: 'voyager2',
    displayName: { en: 'Voyager 2', fr: 'Voyager 2' },
    description: {
      en: 'Launched in 1977, the only spacecraft to have visited Uranus and Neptune.',
      fr: 'Lancée en 1977, la seule sonde à avoir visité Uranus et Neptune.',
    },
    launchDate: '1977-08-20',
    color: 0xffaa44,
  },
  {
    name: 'parker-solar-probe',
    displayName: { en: 'Parker Solar Probe', fr: 'Sonde solaire Parker' },
    description: {
      en: 'Launched in 2018, repeatedly diving closer to the Sun than any spacecraft before it.',
      fr: 'Lancée en 2018, elle plonge à répétition plus près du Soleil qu’aucune sonde avant elle.',
    },
    launchDate: '2018-08-12',
    color: 0xff5555,
  },
  {
    name: 'jwst',
    displayName: {
      en: 'James Webb Space Telescope',
      fr: 'Télescope spatial James Webb',
    },
    description: {
      en: 'Launched in 2021, orbiting the Sun-Earth L2 point about 1.5 million km from Earth.',
      fr: 'Lancé en 2021, en orbite autour du point de Lagrange L2, à environ 1,5 million de km de la Terre.',
    },
    launchDate: '2021-12-25',
    color: 0x88ddff,
  },
  {
    name: 'new-horizons',
    displayName: { en: 'New Horizons', fr: 'New Horizons' },
    description: {
      en: 'Launched in 2006, flew past Pluto in 2015 and the Kuiper belt object Arrokoth in 2019.',
      fr: 'Lancée en 2006, elle a survolé Pluton en 2015 puis l’objet de la ceinture de Kuiper Arrokoth en 2019.',
    },
    launchDate: '2006-01-19',
    color: 0xc9a0ff,
  },
  {
    name: 'cassini',
    displayName: { en: 'Cassini', fr: 'Cassini' },
    description: {
      en: 'Launched in 1997, orbited Saturn from 2004 and ended its mission inside the planet in 2017.',
      fr: 'Lancée en 1997, en orbite autour de Saturne à partir de 2004, elle a fini sa mission dans la planète en 2017.',
    },
    launchDate: '1997-10-15',
    color: 0x5fd7c8,
  },
  {
    name: 'juno',
    displayName: { en: 'Juno', fr: 'Juno' },
    description: {
      en: 'Launched in 2011, orbiting Jupiter since 2016 on a long polar orbit.',
      fr: 'Lancée en 2011, en orbite polaire très allongée autour de Jupiter depuis 2016.',
    },
    launchDate: '2011-08-05',
    color: 0xff92c2,
  },
  {
    name: 'rosetta',
    displayName: { en: 'Rosetta', fr: 'Rosetta' },
    description: {
      en: 'Launched in 2004, the first mission to orbit a comet, and to land on one with Philae in 2014.',
      fr: 'Lancée en 2004, première mission à se mettre en orbite autour d’une comète et à s’y poser avec Philae en 2014.',
    },
    launchDate: '2004-03-02',
    color: 0x9ee87a,
  },
  {
    name: 'bepicolombo',
    displayName: { en: 'BepiColombo', fr: 'BepiColombo' },
    description: {
      en: 'Launched in 2018, on its way to Mercury through a long series of planetary flybys.',
      fr: 'Lancée en 2018, en route vers Mercure via une longue série de survols planétaires.',
    },
    launchDate: '2018-10-20',
    color: 0x7aa7ff,
  },
  {
    name: 'osiris-rex',
    displayName: { en: 'OSIRIS-REx', fr: 'OSIRIS-REx' },
    description: {
      en: 'Launched in 2016, collected a sample from asteroid Bennu and returned it to Earth in 2023.',
      fr: 'Lancée en 2016, elle a prélevé un échantillon de l’astéroïde Bennu et l’a rapporté sur Terre en 2023.',
    },
    launchDate: '2016-09-08',
    color: 0xe8d44d,
  },
  {
    name: 'hayabusa2',
    displayName: { en: 'Hayabusa2', fr: 'Hayabusa2' },
    description: {
      en: 'Launched in 2014, sampled asteroid Ryugu and returned the capsule to Earth in 2020.',
      fr: 'Lancée en 2014, elle a prélevé l’astéroïde Ryugu et rapporté sa capsule sur Terre en 2020.',
    },
    launchDate: '2014-12-03',
    color: 0xff8a4d,
  },
];
