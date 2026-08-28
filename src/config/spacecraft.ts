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
];
