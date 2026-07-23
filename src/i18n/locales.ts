/**
 * Dictionnaires de traduction (français / anglais).
 *
 * Un seul enregistrement plat par langue : `clé → chaîne`. Les clés sont regroupées par
 * zone d'interface (`loader.*`, `nav.*`, `help.*`, `stat.*`…). L'anglais sert de repli
 * quand une clé manque dans une autre langue (cf. `t()` dans `./index`).
 *
 * Les descriptions et noms des corps ne vivent PAS ici : ils restent dans le catalogue
 * (`config/bodies.ts`, champ `LocalizedText`) — le catalogue est la source unique du contenu.
 */

export type Locale = 'en' | 'fr';
export const LOCALES: readonly Locale[] = ['en', 'fr'];

type Dict = Record<string, string>;

export const messages: Record<Locale, Dict> = {
  en: {
    // ── Écran de chargement ──
    'loader.title': 'Loading Solar System...',
    'loader.init': 'Initializing...',
    'loader.core': 'Loading core components…',
    'loader.scene': 'Building scene…',
    'loader.lighting': 'Setting up lighting…',
    'loader.bodies': 'Creating celestial bodies…',
    'loader.finalize': 'Finalizing…',
    'loader.starting': 'Starting…',
    'loader.loadingBody': 'Loading {body}…',
    'loader.texturesDone': 'Textures loaded',
    'error.title': 'Application Error',
    'error.retry': 'Retry',

    // ── Navigation ──
    'nav.overview': 'Overview',

    // ── Bascule de mode ──
    'mode.group': 'View mode',
    'mode.educ': 'Educ.',
    'mode.explo': 'Explo.',
    'mode.educ.title': 'Educational view — circular orbits',
    'mode.explo.title': 'Exploration mode — true scale, space voyage',

    // ── Lecture / temps ──
    'playback.playpause': 'Play / Pause',
    'speed.live': 'Live',
    'time.today': 'Back to now',
    'time.wheelTime': 'Wheel: ±1 h  ·  Click: pick the time',
    'time.wheelDate': 'Wheel: ±1 day  ·  Click: pick the date',

    // ── Aide & crédits ──
    'help.btn.title': 'Help, tips & credits',
    'help.btn.aria': 'Help, tips and credits',
    'help.dialog.aria': 'Help and credits',
    'help.title': 'Navigation',
    'help.tip.drag.key': 'Drag',
    'help.tip.drag.text': 'orbit the view',
    'help.tip.zoom.key': 'Scroll · pinch',
    'help.tip.zoom.text': 'zoom in / out',
    'help.tip.click.key': 'Click a body',
    'help.tip.click.text': 'or its label to travel to it',
    'help.tip.mode.key': 'Educ · Explo',
    'help.tip.mode.text': 'compressed overview vs true-scale voyage',
    'help.tip.time.key': 'Clock · date',
    'help.tip.time.text': 'scroll to time-travel, tap to pick',
    'credits.textures': 'Textures',
    'credits.data': 'Data',
    'credits.donate': '♥ Support the project',
    'lang.label': 'Language',

    // ── Onboarding (première visite) ──
    'onboarding.title': 'First steps',
    'onboarding.aria': 'Getting started tips',
    'onboarding.tip.select': 'Click any planet to fly to it',
    'onboarding.tip.explo': 'Switch to Explo for true solar system scale',
    'onboarding.tip.time': 'Scroll the clock or date to time-travel',
    'onboarding.tip.help': '? button — full navigation tips',
    'onboarding.dismiss': 'Got it',

    // ── Panneau orbites (mode Éducatif) ──
    'orbitOpts.title': 'Orbits',

    // ── Divers ──
    'fullscreen.title': 'Fullscreen',

    // ── Fiche d'info (bodyInfo) ──
    'bi.collapse.title': 'Collapse / expand',
    'bi.collapse.aria': 'Collapse panel',
    'bi.expand.aria': 'Expand panel',
    'bi.live.label': 'Distance from you',
    'stat.radius': 'Radius',
    'stat.distanceSun': 'Distance (Sun)',
    'stat.distanceEarth': 'Distance (Earth)',
    'stat.mass': 'Mass',
    'stat.gravity': 'Gravity',
    'stat.temperature': 'Temperature',
    'stat.day': 'Day',
    'stat.revolution': 'Revolution',
    'stat.year': 'Year',
    'stat.orbit': 'Orbit',
    'stat.moons': 'Moons',
    'stat.axialTilt': 'Axial tilt',
    'subtitle.star': 'Star of the Solar System',
    'subtitle.moon': 'Natural satellite',
    'subtitle.dwarf': 'Dwarf planet',
    'subtitle.asteroid': 'Asteroid',
    'subtitle.comet': 'Comet',
    'subtitle.planet': 'Planet',
    // {ordinal} = « 3rd » (anglais) / « 3ᵉ » (français), calculé par bodyInfo.
    'subtitle.planetOrdinal': '{ordinal} planet from the Sun',

    // ── Unités & suffixes (fiche) ──
    'unit.light': 'light',
    'unit.day.short': 'd',
    'unit.year.short': 'yr',
    'unit.au': 'AU',
    'unit.millionKm': 'M km',
    'unit.billionKm': 'B km',
  },

  fr: {
    // ── Écran de chargement ──
    'loader.title': 'Chargement du système solaire…',
    'loader.init': 'Initialisation…',
    'loader.core': 'Chargement des composants…',
    'loader.scene': 'Construction de la scène…',
    'loader.lighting': 'Mise en place de l’éclairage…',
    'loader.bodies': 'Création des corps célestes…',
    'loader.finalize': 'Finalisation…',
    'loader.starting': 'Démarrage…',
    'loader.loadingBody': 'Chargement de {body}…',
    'loader.texturesDone': 'Textures chargées',
    'error.title': 'Erreur de l’application',
    'error.retry': 'Réessayer',

    // ── Navigation ──
    'nav.overview': 'Vue globale',

    // ── Bascule de mode ──
    'mode.group': 'Mode d’affichage',
    'mode.educ': 'Éduc.',
    'mode.explo': 'Explo.',
    'mode.educ.title': 'Vue éducative — orbites circulaires',
    'mode.explo.title': 'Mode exploration — vraie échelle, voyage spatial',

    // ── Lecture / temps ──
    'playback.playpause': 'Lecture / Pause',
    'speed.live': 'Direct',
    'time.today': 'Revenir à maintenant',
    'time.wheelTime': 'Molette : ±1 h  ·  Clic : choisir l’heure',
    'time.wheelDate': 'Molette : ±1 jour  ·  Clic : choisir la date',

    // ── Aide & crédits ──
    'help.btn.title': 'Aide, astuces et crédits',
    'help.btn.aria': 'Aide, astuces et crédits',
    'help.dialog.aria': 'Aide et crédits',
    'help.title': 'Navigation',
    'help.tip.drag.key': 'Glisser',
    'help.tip.drag.text': 'pivoter la vue',
    'help.tip.zoom.key': 'Molette · pincer',
    'help.tip.zoom.text': 'zoomer / dézoomer',
    'help.tip.click.key': 'Cliquer un corps',
    'help.tip.click.text': 'ou son label pour y voyager',
    'help.tip.mode.key': 'Éduc · Explo',
    'help.tip.mode.text': 'vue compressée ou voyage à vraie échelle',
    'help.tip.time.key': 'Horloge · date',
    'help.tip.time.text':
      'molette pour voyager dans le temps, tap pour choisir',
    'credits.textures': 'Textures',
    'credits.data': 'Données',
    'credits.donate': '♥ Soutenir le projet',
    'lang.label': 'Langue',

    // ── Onboarding (première visite) ──
    'onboarding.title': 'Premiers pas',
    'onboarding.aria': 'Astuces de démarrage',
    'onboarding.tip.select': 'Cliquez une planète pour y voyager',
    'onboarding.tip.explo': 'Passez en Explo pour la vraie échelle du système solaire',
    'onboarding.tip.time': 'Molette sur l’horloge ou la date pour voyager dans le temps',
    'onboarding.tip.help': 'Bouton ? — toutes les commandes',
    'onboarding.dismiss': 'Compris',

    // ── Panneau orbites (mode Éducatif) ──
    'orbitOpts.title': 'Orbites',

    // ── Divers ──
    'fullscreen.title': 'Plein écran',

    // ── Fiche d'info (bodyInfo) ──
    'bi.collapse.title': 'Replier / déplier',
    'bi.collapse.aria': 'Replier le panneau',
    'bi.expand.aria': 'Déplier le panneau',
    'bi.live.label': 'Distance depuis vous',
    'stat.radius': 'Rayon',
    'stat.distanceSun': 'Distance (Soleil)',
    'stat.distanceEarth': 'Distance (Terre)',
    'stat.mass': 'Masse',
    'stat.gravity': 'Gravité',
    'stat.temperature': 'Température',
    'stat.day': 'Jour',
    'stat.revolution': 'Révolution',
    'stat.year': 'Année',
    'stat.orbit': 'Orbite',
    'stat.moons': 'Lunes',
    'stat.axialTilt': 'Inclinaison axiale',
    'subtitle.star': 'Étoile du Système solaire',
    'subtitle.moon': 'Satellite naturel',
    'subtitle.dwarf': 'Planète naine',
    'subtitle.asteroid': 'Astéroïde',
    'subtitle.comet': 'Comète',
    'subtitle.planet': 'Planète',
    'subtitle.planetOrdinal': '{ordinal} planète depuis le Soleil',

    // ── Unités & suffixes (fiche) ──
    'unit.light': 'lumière',
    'unit.day.short': 'j',
    'unit.year.short': 'ans',
    'unit.au': 'UA',
    'unit.millionKm': 'M km',
    'unit.billionKm': 'Md km',
  },
};
