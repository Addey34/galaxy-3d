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
    'error.contextLost': 'Reconnecting the 3D view…',
    'error.contextLostTimeout':
      'The 3D view could not reconnect. Reload the page.',

    // ── Navigation ──
    'nav.overview': 'Overview',
    'nav.bodies': 'Bodies',
    'nav.search': 'Search a body',
    'nav.searchPlaceholder': 'Search a body…',
    'nav.paletteAria': 'Search and select a body',
    'nav.group.star': 'Star',
    'nav.group.planet': 'Planets',
    'nav.group.moon': 'Moons',
    'nav.group.dwarf': 'Dwarf planets',
    'nav.group.other': 'Small bodies',
    'nav.kind.moon': 'moon',
    'nav.kind.dwarf': 'dwarf',
    'surface.close': 'Close',
    'bi.trigger.aria': 'Body information',
    'settings.trigger.aria': 'Display settings',
    'time.expand': 'Time settings',
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
    'events.marchEquinox': 'March equinox',
    'events.juneSolstice': 'June solstice',
    'events.septemberEquinox': 'September equinox',
    'events.decemberSolstice': 'December solstice',
    'events.perihelion': 'Perihelion (Earth closest to Sun)',
    'events.aphelion': 'Aphelion (Earth farthest from Sun)',
    'events.opposition': 'Opposition (closest, visible all night)',
    'events.conjunction': 'Inferior conjunction (passes between Earth and Sun)',
    'events.kind.penumbral': 'penumbral',
    'events.kind.partial': 'partial',
    'events.kind.annular': 'annular',
    'events.kind.total': 'total',
    'events.tip.peak': 'Peak visible near {lat}, {lon}',
    'events.tip.obscuration': '{percent}% obscured at maximum',
    'events.tip.goto': 'Click to travel to this date',

    // ── Bascule de mode ──
    'mode.group': 'View mode',
    'mode.educ': 'Educ.',
    'mode.explo': 'Explo.',
    'mode.educ.title': 'Educational view, circular orbits',
    'mode.explo.title': 'Exploration mode, true scale',
    'zoom.optical': 'Optical zoom (FOV)',

    // ── Qualité graphique (perf adaptative) ──
    'quality.title': 'Graphics quality',
    'quality.heading': 'Graphics quality',
    'quality.auto': 'Auto',
    'quality.auto.hint': 'Match this device',
    'quality.low': 'Low',
    'quality.low.hint': 'Smoothest on weak GPUs',
    'quality.medium': 'Medium',
    'quality.medium.hint': 'Balanced',
    'quality.high': 'High',
    'quality.high.hint': 'Best looking',
    'quality.reloadNote': 'Some options apply on next reload.',

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
    'share.btn.title': 'Share this view',
    'share.btn.aria': 'Share this view',
    'share.copied': 'Link copied',
    'share.failed': 'Copy failed',
    'capture.btn.title': 'Capture this view',
    'capture.btn.aria': 'Capture this view',
    'capture.success': 'Image downloaded',
    'capture.failed': 'Capture failed',
    'webxr.btn.enter.title': 'Enter VR',
    'webxr.btn.enter.aria': 'Enter virtual reality',
    'webxr.btn.exit.title': 'Exit VR',
    'webxr.btn.exit.aria': 'Exit virtual reality',
    'webxr.btn.unavailable.title': 'VR not available',
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
    'credits.fictional': 'Illustrative surfaces',
    'credits.fictional.list':
      'No spacecraft has resolved these surfaces; their textures are illustrative, not scientific maps: Ceres, Eris, Haumea, Makemake, Pallas, Hygiea, Halley.',
    'credits.data': 'Data',
    'credits.donate': '♥ Support on Ko-fi',
    'credits.privacy': 'Privacy',
    'support.title': 'Support the project',
    'support.lead':
      'I build this solar system alone, on my free time, and give it away free to everyone.',
    'support.point.free': 'Free, no ads, no trackers',
    'support.point.data': 'Real NASA/JPL data',
    'support.point.use': 'Your donation keeps it online and independent',
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
      'Educational stays simple while Exploration shows the true scale.',
    'tour.step.time.title': '3. Change time',
    'tour.step.time.text':
      'Use the date and speed controls to move through time.',
    'tour.step.expand.title': '4. Unfold the clock',
    'tour.step.expand.text':
      'Click the clock to unfold the advanced date and speed settings.',
    'tour.step.info.title': '5. Inspect a target',
    'tour.step.info.text':
      'After selecting a body, open its information panel from the target button.',
    'tour.step.settings.title': '6. Adjust display',
    'tour.step.settings.text':
      'Open display settings to show or hide orbits, names and markers.',
    'tour.step.weather.title': '7. Explore weather',
    'tour.step.weather.text':
      'Open weather layers to see clouds, rain, wind and surface data on Earth.',
    'tour.step.events.title': '8. Watch the sky',
    'tour.step.events.text':
      'Check upcoming astronomical events and select an event for details.',
    'tour.step.quality.title': '9. Tune graphics',
    'tour.step.quality.text':
      'Choose a graphics quality level to balance visual detail and smoothness.',
    'tour.step.share.title': '10. Share a view',
    'tour.step.share.text':
      'Set up a view, then share its link. Whoever opens it lands on the exact same scene.',
    'tour.step.help.title': '11. Find help',
    'tour.step.help.text': 'Check the help page for more information.',

    // ── Tours guidés scénarisés ──
    'tours.start': 'Scripted tours',
    'tours.pause': 'Pause',
    'tours.resume': 'Resume',
    'tours.next': 'Next',
    'tours.close': 'Close',
    'tours.progress': 'Step {current} of {total}',
    'tours.status.flyingTo': 'Flying to {body}…',
    'tours.status.jumping': 'Jumping through time…',
    'tours.status.speeding': 'Speeding up time…',

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

    // ── Filtres petits corps (NEO / comètes / TNO) ──
    'smallBodies.trigger.aria': 'Small-body filters',
    'smallBodies.dialog.aria': 'Small-body filters',
    'smallBodies.title': 'Small bodies',
    'smallBodies.mainBelt': 'Main belt',
    'smallBodies.neo': 'Near-Earth objects',
    'smallBodies.comet': 'Comets',
    'smallBodies.tno': 'Trans-Neptunian objects',

    // ── Couches météo ──
    'weather.title': 'Weather layers',
    'weather.trigger.aria': 'Weather layers',
    'weather.dialog.aria': 'Weather layers',
    'weather.clouds': 'Clouds (NASA)',
    'weather.cloudsModel': 'Clouds (Open-Meteo)',
    'weather.precip': 'Rain (NASA IMERG)',
    'weather.precipModel': 'Rain (Open-Meteo)',
    'weather.wind': 'Wind',
    'weather.thermal': 'Air temperature (MERRA-2)',
    'weather.thermalModel': 'Air temperature (Open-Meteo)',
    'weather.clouds.note':
      "Real cloud cover from NASA satellite imagery (day's snapshot).",
    'weather.cloudsModel.note':
      'Modelled cloud cover (Open-Meteo): gap-free worldwide, supports past and forecast — pick this for live/time-travel.',
    'weather.precip.note':
      'Observed NASA IMERG V07 rain: its native alpha mask is preserved; no polar extrapolation is added.',
    'weather.precip.legendLo': 'Light',
    'weather.precip.legendHi': 'Intense',
    'weather.precipModel.note':
      'Modelled rainfall (Open-Meteo): gap-free worldwide, past + forecast. Dry areas stay transparent.',
    'weather.precipModel.lo': '0 mm/h',
    'weather.precipModel.hi': '20+ mm/h',
    'weather.thermalModel.note':
      'Modelled 2 m air temperature (Open-Meteo): gap-free worldwide, past (ERA5) + forecast.',
    'weather.thermalModel.lo': '−40 °C',
    'weather.thermalModel.hi': '+45 °C',
    'weather.pressureModel': 'Sea-level pressure (Open-Meteo)',
    'weather.pressureModel.note':
      'Sea-level pressure shown as smooth isobars in hPa.',
    'weather.pressureModel.lo': '960 hPa',
    'weather.pressureModel.hi': '1060 hPa',
    'weather.humidityModel': 'Relative humidity (Open-Meteo)',
    'weather.humidityModel.note':
      'Relative humidity at 2 m from Open-Meteo, in percent.',
    'weather.humidityModel.lo': '0 %',
    'weather.humidityModel.hi': '100 %',
    'weather.source.prefix': 'Source:',
    'weather.source.approx': 'nearest available',
    'weather.loading': 'Loading…',
    // Statut temporel honnête de la donnée (voir core/dataStatus.ts).
    'weather.status.observed': 'observed',
    'weather.status.analysis': 'analysis',
    'weather.status.forecast': 'forecast',
    'weather.status.forecast_uncertain': 'uncertain forecast',
    'weather.status.climatology': 'climate average',
    'weather.status.unavailable': 'unavailable',
    'weather.wind.note':
      'Wind flow (Open-Meteo): colour and speed follow wind strength.',
    'weather.thermal.note':
      'Air temperature near the surface (MERRA-2 monthly):',

    // ── Barre de navigation planètes ──
    'nav.collapse': 'Hide planet bar',
    'nav.expand': 'Show planet bar',
    'nav.scrollLeft': 'Scroll left',
    'nav.scrollRight': 'Scroll right',
    'nav.bodiesOpen': 'Show all bodies',
    'nav.bodiesClose': 'Show nearby bodies',

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
    'bi.fictional': 'Illustrative surface',
    'bi.fictional.hint':
      'No spacecraft has resolved this surface, so the texture is illustrative, not a scientific map.',
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
    'error.contextLost': 'Reconnexion de la vue 3D…',
    'error.contextLostTimeout':
      'La vue 3D n’a pas pu se reconnecter. Rechargez la page.',

    // ── Navigation ──
    'nav.overview': 'Vue globale',
    'nav.bodies': 'Corps',
    'nav.search': 'Rechercher un corps',
    'nav.searchPlaceholder': 'Rechercher un corps…',
    'nav.paletteAria': 'Rechercher et sélectionner un corps',
    'nav.group.star': 'Étoile',
    'nav.group.planet': 'Planètes',
    'nav.group.moon': 'Lunes',
    'nav.group.dwarf': 'Planètes naines',
    'nav.group.other': 'Petits corps',
    'nav.kind.moon': 'lune',
    'nav.kind.dwarf': 'naine',
    'surface.close': 'Fermer',
    'bi.trigger.aria': 'Informations du corps',
    'settings.trigger.aria': "Réglages d'affichage",
    'time.expand': 'Réglages du temps',
    'events.title': 'Événements à venir',
    'events.open': 'Ouvrir les événements astronomiques',
    'events.close': 'Fermer les événements astronomiques',
    'events.empty': 'Aucun événement à venir',
    'events.newMoon': 'Nouvelle Lune',
    'events.firstQuarter': 'Premier quartier',
    'events.fullMoon': 'Pleine Lune',
    'events.thirdQuarter': 'Dernier quartier',
    'events.solarEclipse': 'Éclipse solaire',
    'events.lunarEclipse': 'Éclipse lunaire',
    'events.marchEquinox': 'Équinoxe de mars',
    'events.juneSolstice': 'Solstice de juin',
    'events.septemberEquinox': 'Équinoxe de septembre',
    'events.decemberSolstice': 'Solstice de décembre',
    'events.perihelion': 'Périhélie (Terre au plus près du Soleil)',
    'events.aphelion': 'Aphélie (Terre au plus loin du Soleil)',
    'events.opposition': 'Opposition (au plus près, visible toute la nuit)',
    'events.conjunction':
      'Conjonction inférieure (passe entre Terre et Soleil)',
    'events.kind.penumbral': 'pénombrale',
    'events.kind.partial': 'partielle',
    'events.kind.annular': 'annulaire',
    'events.kind.total': 'totale',
    'events.tip.peak': 'Pic visible près de {lat}, {lon}',
    'events.tip.obscuration': '{percent} % obscurci au maximum',
    'events.tip.goto': 'Cliquer pour voyager à cette date',

    // ── Bascule de mode ──
    'mode.group': 'Mode d’affichage',
    'mode.educ': 'Éduc.',
    'mode.explo': 'Explo.',
    'mode.educ.title': 'Vue éducative, orbites circulaires',
    'mode.explo.title': 'Mode exploration, vraie échelle',
    'zoom.optical': 'Zoom optique (FOV)',

    // ── Qualité graphique (perf adaptative) ──
    'quality.title': 'Qualité graphique',
    'quality.heading': 'Qualité graphique',
    'quality.auto': 'Auto',
    'quality.auto.hint': 'Adapté à cet appareil',
    'quality.low': 'Basse',
    'quality.low.hint': 'La plus fluide sur GPU faible',
    'quality.medium': 'Moyenne',
    'quality.medium.hint': 'Équilibrée',
    'quality.high': 'Élevée',
    'quality.high.hint': 'Plus beau rendu',
    'quality.reloadNote': 'Certaines options s’appliquent au rechargement.',

    // ── Lecture / temps ──
    'playback.playpause': 'Lecture / Pause',
    'playback.play': 'Reprendre la simulation',
    'playback.pause': 'Mettre la simulation en pause',
    'speed.live': 'Direct',
    'time.group': 'Contrôles temporels',
    'time.inputTime': 'Heure de simulation',
    'time.inputDate': 'Date de simulation',
    'time.today': 'Revenir à maintenant',
    'time.wheelTime': 'Molette : ±1 h  ·  Clic : choisir l’heure',
    'time.wheelDate': 'Molette : ±1 jour  ·  Clic : choisir la date',

    // ── Aide & crédits ──
    'help.btn.title': 'Aide, astuces et crédits',
    'help.btn.aria': 'Aide, astuces et crédits',
    'share.btn.title': 'Partager cette vue',
    'share.btn.aria': 'Partager cette vue',
    'share.copied': 'Lien copié',
    'share.failed': 'Échec de la copie',
    'capture.btn.title': 'Capturer cette vue',
    'capture.btn.aria': 'Capturer cette vue',
    'capture.success': 'Image téléchargée',
    'capture.failed': 'Échec de la capture',
    'webxr.btn.enter.title': 'Entrer en VR',
    'webxr.btn.enter.aria': 'Entrer en réalité virtuelle',
    'webxr.btn.exit.title': 'Quitter la VR',
    'webxr.btn.exit.aria': 'Quitter la réalité virtuelle',
    'webxr.btn.unavailable.title': 'VR non disponible',
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
    'credits.fictional': 'Surfaces fictives',
    'credits.fictional.list':
      'Aucune sonde n’a résolu ces surfaces ; leurs textures sont illustratives, pas des cartes scientifiques : Cérès, Éris, Hauméa, Makémaké, Pallas, Hygie, Halley.',
    'credits.data': 'Données',
    'credits.donate': '♥ Soutenir sur Ko-fi',
    'credits.privacy': 'Confidentialité',
    'support.title': 'Soutenir le projet',
    'support.lead':
      'Je développe seul ce système solaire, sur mon temps libre, et je l’offre gratuitement à tous.',
    'support.point.free': 'Gratuit, sans publicité, sans traceur',
    'support.point.data': 'Vraies données NASA/JPL',
    'support.point.use': 'Votre don le garde en ligne et indépendant',
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
      'Éducatif simplifie les distances quand Exploration montre l’échelle réelle.',
    'tour.step.time.title': '3. Changer le temps',
    'tour.step.time.text':
      'Utilisez la date et la vitesse pour voyager dans le temps.',
    'tour.step.expand.title': '4. Déplier l’horloge',
    'tour.step.expand.text':
      'Cliquez sur l’horloge pour déplier les réglages avancés de date et de vitesse.',
    'tour.step.info.title': '5. Inspecter une cible',
    'tour.step.info.text':
      'Après avoir sélectionné un corps, ouvrez sa fiche avec le bouton d’information de la cible.',
    'tour.step.settings.title': '6. Régler l’affichage',
    'tour.step.settings.text':
      'Ouvrez les réglages d’affichage pour afficher ou masquer les orbites, les noms et les points.',
    'tour.step.weather.title': '7. Explorer la météo',
    'tour.step.weather.text':
      'Ouvrez les couches météo pour voir les nuages, la pluie, le vent et les données de surface sur Terre.',
    'tour.step.events.title': '8. Observer le ciel',
    'tour.step.events.text':
      'Consultez les prochains événements astronomiques et choisissez en un pour plus de détails.',
    'tour.step.quality.title': '9. Ajuster les graphismes',
    'tour.step.quality.text':
      'Choisissez une qualité graphique pour équilibrer le niveau de détail et la fluidité.',
    'tour.step.share.title': '10. Partager une vue',
    'tour.step.share.text':
      'Réglez une vue, puis partagez son lien. Celui qui l’ouvre retrouve exactement la même scène.',
    'tour.step.help.title': '11. Retrouver l’aide',
    'tour.step.help.text': "Consultez la page d'aide pour plus d'informations.",

    // ── Tours guidés scénarisés ──
    'tours.start': 'Tours guidés',
    'tours.pause': 'Pause',
    'tours.resume': 'Reprendre',
    'tours.next': 'Suivant',
    'tours.close': 'Fermer',
    'tours.progress': 'Étape {current} sur {total}',
    'tours.status.flyingTo': 'Vol vers {body}…',
    'tours.status.jumping': 'Saut dans le temps…',
    'tours.status.speeding': 'Accélération du temps…',

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

    // ── Filtres petits corps (NEO / comètes / TNO) ──
    'smallBodies.trigger.aria': 'Filtres petits corps',
    'smallBodies.dialog.aria': 'Filtres petits corps',
    'smallBodies.title': 'Petits corps',
    'smallBodies.mainBelt': 'Ceinture principale',
    'smallBodies.neo': 'Géocroiseurs',
    'smallBodies.comet': 'Comètes',
    'smallBodies.tno': 'Objets transneptuniens',

    // ── Couches météo ──
    'weather.title': 'Couches météo',
    'weather.trigger.aria': 'Couches météo',
    'weather.dialog.aria': 'Couches météo',
    'weather.clouds': 'Nuages (NASA)',
    'weather.cloudsModel': 'Nuages (Open-Meteo)',
    'weather.precip': 'Pluie (NASA IMERG)',
    'weather.precipModel': 'Pluie (Open-Meteo)',
    'weather.wind': 'Vent',
    'weather.thermal': 'Température MERRA-2',
    'weather.thermalModel': 'Température Open-Meteo',
    'weather.clouds.note':
      'Couverture nuageuse réelle, imagerie satellite NASA (image du jour).',
    'weather.cloudsModel.note':
      'Couverture nuageuse modélisée (Open-Meteo) : mondiale sans trou, gère passé et prévision — à choisir pour le direct / voyage dans le temps.',
    'weather.precip.note':
      'Pluie observée NASA IMERG V07 : son masque alpha natif est conservé ; aucune extrapolation polaire.',
    'weather.precip.legendLo': 'Faible',
    'weather.precip.legendHi': 'Intense',
    'weather.precipModel.note':
      'Pluie modélisée (Open-Meteo) : mondiale sans trou, passé + prévision. Les zones sèches restent transparentes.',
    'weather.precipModel.lo': '0 mm/h',
    'weather.precipModel.hi': '20+ mm/h',
    'weather.thermalModel.note':
      "Température de l'air à 2 m modélisée (Open-Meteo) : mondiale sans trou, passé (ERA5) + prévision.",
    'weather.thermalModel.lo': '−40 °C',
    'weather.thermalModel.hi': '+45 °C',
    'weather.pressureModel': 'Pression Open-Meteo',
    'weather.pressureModel.note':
      'Pression au niveau de la mer affichée en isobares (hPa).',
    'weather.pressureModel.lo': '960 hPa',
    'weather.pressureModel.hi': '1060 hPa',
    'weather.humidityModel': 'Humidité Open-Meteo',
    'weather.humidityModel.note':
      'Humidité relative à 2 m, fournie par Open-Meteo, en pourcentage.',
    'weather.humidityModel.lo': '0 %',
    'weather.humidityModel.hi': '100 %',
    'weather.source.prefix': 'Source :',
    'weather.source.approx': 'date la plus proche',
    'weather.loading': 'Chargement…',
    // Statut temporel honnête de la donnée (voir core/dataStatus.ts).
    'weather.status.observed': 'observé',
    'weather.status.analysis': 'analyse',
    'weather.status.forecast': 'prévision',
    'weather.status.forecast_uncertain': 'prévision incertaine',
    'weather.status.climatology': 'moyenne climatique',
    'weather.status.unavailable': 'indisponible',
    'weather.wind.note':
      'Flux du vent (Open-Meteo) : la couleur et la vitesse suivent la force du vent.',
    'weather.thermal.note':
      'Température de l’air près du sol (MERRA-2 mensuel) :',

    // ── Barre de navigation planètes ──
    'nav.collapse': 'Masquer la barre',
    'nav.expand': 'Afficher la barre',
    'nav.scrollLeft': 'Défiler à gauche',
    'nav.scrollRight': 'Défiler à droite',
    'nav.bodiesOpen': 'Afficher tous les corps',
    'nav.bodiesClose': 'Afficher les corps voisins',

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
    'bi.fictional': 'Surface fictive',
    'bi.fictional.hint':
      'Aucune sonde n’a résolu cette surface, la texture est donc illustrative, pas une carte scientifique.',
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
