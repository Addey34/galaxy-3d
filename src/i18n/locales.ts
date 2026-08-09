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
    'loader.creatingBody': 'Creating {body}...',
    'loader.ephemerides': 'Ephemeris data loaded',
    'loader.ready': 'Ready for launch',
    'loader.verified': 'verified loading',
    'loader.stage.core': 'Core',
    'loader.stage.data': 'Data',
    'loader.stage.scene': 'Scène',
    'loader.stage.bodies': 'Bodies',
    'loader.stage.orbit': 'Orbits',
    'loader.stage.ready': 'Ready',
    'loader.texturesDone': 'Textures loaded',
    'error.title': 'Application Error',
    'error.retry': 'Retry',

    // ── Navigation ──
    'nav.overview': 'Overview',
    'events.title': 'Upcoming events',
    'events.open': 'Open astronomical events',
    'events.close': 'Close astronomical events',
    'events.empty': 'No upcoming event found',
    'events.newMoon': 'New Moon',
    'events.firstQuarter': 'First Quarter',
    'events.fullMoon': 'Full Moon',
    'events.thirdQuarter': 'Third Quarter',
    'events.solarEclipse': 'Solar eclipse',
    'events.lunarEclipse': 'Lunar eclipse',
    'events.kind.penumbral': 'penumbral',
    'events.kind.partial': 'partial',
    'events.kind.annular': 'annular',
    'events.kind.total': 'total',

    // ── Bascule de mode ──
    'mode.group': 'View mode',
    'mode.educ': 'Educ.',
    'mode.explo': 'Explo.',
    'mode.educ.title': 'Educational view — circular orbits',
    'mode.explo.title': 'Exploration mode — true scale, space voyage',
    'zoom.optical': 'Optical zoom (FOV)',

    // ── Lecture / temps ──
    'playback.playpause': 'Play / Pause',
    'playback.play': 'Resume simulation',
    'playback.pause': 'Pause simulation',
    'speed.live': 'Live',
    'time.today': 'Back to now',
    'time.group': 'Time controls',
    'time.inputTime': 'Simulation time',
    'time.inputDate': 'Simulation date',
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
    // ── Guided tour (first visit) ──
    'tour.start': 'Start quick tour',
    'tour.previous': 'Previous',
    'tour.next': 'Next',
    'tour.finish': 'Finish',
    'tour.close': 'Close tour',
    'tour.progress': 'Step {current} of {total}',
    'tour.step.navigation.title': '1. Navigate',
    'tour.step.navigation.text':
      'Choose a planet in the top bar or drag the scene.',
    'tour.step.mode.title': '2. Choose your view',
    'tour.step.mode.text':
      'Educational is simple; Exploration shows the true scale.',
    'tour.step.time.title': '3. Change time',
    'tour.step.time.text':
      'Use the date and speed controls to move through time.',
    'tour.step.help.title': '4. Find help',
    'tour.step.help.text':
      'You can reopen this quick tour from the ? help button.',

    // ── Panneau orbites (mode Éducatif) ──
    'orbitOpts.title': 'Orbits',
    'orbitOpts.all': 'All orbits',
    'orbitOpts.collapse': 'Collapse panel',
    'orbitOpts.expand': 'Orbit options',
    'settings.title': 'Settings',
    'settings.orbits': 'Orbits',
    'settings.orbitsToggle': 'Show orbits',
    'settings.orbitsChoose': 'Choose orbits',
    'settings.labelsTitle': 'Display',
    'settings.labels': 'Names & markers',

    'settings.labelsToggle': 'Show body names and markers',

    // ── Barre de navigation planètes ──
    'nav.collapse': 'Hide planet bar',
    'nav.expand': 'Show planet bar',
    'nav.scrollLeft': 'Scroll left',
    'nav.scrollRight': 'Scroll right',

    // ── Horloge : repli complet/simplifié ──
    'time.simplify': 'Simplified view',
    'time.full': 'Full controls',

    // ── Divers ──
    'fullscreen.title': 'Fullscreen',

    // ── Fiche d'info (bodyInfo) ──
    'bi.collapse.title': 'Collapse / expand',
    'bi.collapse.aria': 'Collapse panel',
    'bi.expand.aria': 'Expand panel',
    'bi.live.label': 'Distance from you',
    'bi.more': 'Learn more',
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
    'loader.creatingBody': 'Création de {body}...',
    'loader.ephemerides': 'Données éphémérides chargées',
    'loader.ready': 'Prêt au lancement',
    'loader.verified': 'chargement vérifié',
    'loader.stage.core': 'Moteur',
    'loader.stage.data': 'Données',
    'loader.stage.scene': 'Scène',
    'loader.stage.bodies': 'Corps',
    'loader.stage.orbit': 'Orbites',
    'loader.stage.ready': 'Prêt',
    'loader.texturesDone': 'Textures chargées',
    'error.title': 'Erreur de l’application',
    'error.retry': 'Réessayer',

    // ── Navigation ──
    'nav.overview': 'Vue globale',
    'events.title': '?v?nements ? venir',
    'events.open': 'Ouvrir les ?v?nements astronomiques',
    'events.close': 'Fermer les ?v?nements astronomiques',
    'events.empty': 'Aucun ?v?nement ? venir',
    'events.newMoon': 'Nouvelle Lune',
    'events.firstQuarter': 'Premier quartier',
    'events.fullMoon': 'Pleine Lune',
    'events.thirdQuarter': 'Dernier quartier',
    'events.solarEclipse': '?clipse solaire',
    'events.lunarEclipse': '?clipse lunaire',
    'events.kind.penumbral': 'p?nombrale',
    'events.kind.partial': 'partielle',
    'events.kind.annular': 'annulaire',
    'events.kind.total': 'totale',

    // ── Bascule de mode ──
    'mode.group': 'Mode d’affichage',
    'mode.educ': 'Éduc.',
    'mode.explo': 'Explo.',
    'mode.educ.title': 'Vue éducative — orbites circulaires',
    'mode.explo.title': 'Mode exploration — vraie échelle, voyage spatial',
    'zoom.optical': 'Zoom optique (FOV)',

    // ── Lecture / temps ──
    'playback.playpause': 'Lecture / Pause',
    'playback.play': 'Reprendre la simulation',
    'playback.pause': 'Mettre la simulation en pause',
    'speed.live': 'Direct',
    'time.group': 'Contr?les temporels',
    'time.inputTime': 'Heure de simulation',
    'time.inputDate': 'Date de simulation',
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
    // ── Visite guidée (première visite) ──
    'tour.start': 'Lancer la visite rapide',
    'tour.previous': 'Précédent',
    'tour.next': 'Suivant',
    'tour.finish': 'Terminer',
    'tour.close': 'Fermer la visite',
    'tour.progress': 'Étape {current} sur {total}',
    'tour.step.navigation.title': '1. Naviguer',
    'tour.step.navigation.text':
      'Choisissez une planète dans la barre du haut ou faites glisser la scène.',
    'tour.step.mode.title': '2. Choisir une vue',
    'tour.step.mode.text':
      'Éducatif simplifie les distances ; Exploration montre l’échelle réelle.',
    'tour.step.time.title': '3. Changer le temps',
    'tour.step.time.text':
      'Utilisez la date et la vitesse pour voyager dans le temps.',
    'tour.step.help.title': '4. Retrouver l’aide',
    'tour.step.help.text':
      'Vous pourrez relancer cette visite avec le bouton ?.',

    // ── Panneau orbites (mode Éducatif) ──
    'orbitOpts.title': 'Orbites',
    'orbitOpts.all': 'Toutes les orbites',
    'orbitOpts.collapse': 'Replier le panneau',
    'orbitOpts.expand': 'Options d’orbites',
    'settings.title': 'Paramètres',
    'settings.orbits': 'Orbites',
    'settings.orbitsToggle': 'Afficher les orbites',
    'settings.orbitsChoose': 'Choisir les orbites',
    'settings.labelsTitle': 'Affichage',
    'settings.labels': 'Noms et points',

    'settings.labelsToggle': 'Afficher les noms et les points',

    // ── Barre de navigation planètes ──
    'nav.collapse': 'Masquer la barre',
    'nav.expand': 'Afficher la barre',
    'nav.scrollLeft': 'Défiler à gauche',
    'nav.scrollRight': 'Défiler à droite',

    // ── Horloge : repli complet/simplifié ──
    'time.simplify': 'Vue simplifiée',
    'time.full': 'Contrôles complets',

    // ── Divers ──
    'fullscreen.title': 'Plein écran',

    // ── Fiche d'info (bodyInfo) ──
    'bi.collapse.title': 'Replier / déplier',
    'bi.collapse.aria': 'Replier le panneau',
    'bi.expand.aria': 'Déplier le panneau',
    'bi.more': 'En savoir plus',
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
