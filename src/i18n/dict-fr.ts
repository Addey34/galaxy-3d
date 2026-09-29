/**
 * DICTIONNAIRE FRANÇAIS. Chargé à la demande (cf. `./locales`).
 *
 * Le type force la parité avec l'anglais : toute clé de `MessageKey` est obligatoire, et une
 * clé inconnue est refusée. Pour ajouter une entrée, commencer par `./dict-en`.
 */
import type { MessageKey } from './dict-en';

export const fr: Record<MessageKey, string> = {
  // ── Écran de chargement ──
  'title.body': '{name} en 3D : position et orbite en direct',
  'title.eclipse.solar.total': 'Éclipse totale de Soleil du {date} en 3D',
  'title.eclipse.solar.annular': 'Éclipse annulaire de Soleil du {date} en 3D',
  'title.eclipse.solar.partial': 'Éclipse partielle de Soleil du {date} en 3D',
  'title.eclipse.lunar.total': 'Éclipse totale de Lune du {date} en 3D',
  'title.eclipse.lunar.partial': 'Éclipse partielle de Lune du {date} en 3D',
  'title.eclipse.lunar.penumbral':
    'Éclipse de Lune par la pénombre du {date} en 3D',
  'eclipse.name.solar.total': 'Éclipse totale de Soleil',
  'eclipse.name.solar.annular': 'Éclipse annulaire de Soleil',
  'eclipse.name.solar.partial': 'Éclipse partielle de Soleil',
  'eclipse.name.lunar.total': 'Éclipse totale de Lune',
  'eclipse.name.lunar.partial': 'Éclipse partielle de Lune',
  'eclipse.name.lunar.penumbral': 'Éclipse de Lune par la pénombre',
  'title.overview': 'Galaxy : système solaire 3D interactif en temps réel',
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
  'loader.stage.core': 'Moteur',
  'loader.stage.data': 'Données',
  'loader.stage.scene': 'Scène',
  'loader.stage.bodies': 'Corps',
  'loader.stage.orbit': 'Orbites',
  'loader.stage.ready': 'Prêt',
  'loader.texturesDone': 'Textures chargées',
  // ── Accessibilité : ce que SEUL un lecteur d'écran entend (lot 19) ──
  // Voir le bloc anglais pour la raison de chaque clé.
  'a11y.pageHeading':
    'Galaxy : système solaire 3D interactif en temps réel. Explorez les planètes, les lunes et les planètes naines',
  'a11y.scene': 'Système solaire, vue 3D interactive',
  'a11y.navigation': 'Navigation entre les corps',
  'a11y.loading': 'Chargement du système solaire, veuillez patienter.',
  'a11y.loadingProgress': 'Progression du chargement',
  'a11y.ready': 'Système solaire chargé et prêt.',
  'a11y.loadFailed': 'Le système solaire n’a pas pu être chargé.',
  'a11y.bodySelected': '{name} sélectionné. Fiche d’information ouverte.',
  'a11y.dateChanged': 'Date réglée sur {date}.',
  'a11y.searchResults': '{count} corps correspondent.',
  'a11y.searchResultsOne': 'Un corps correspond.',
  'a11y.searchResultsNone': 'Aucun corps ne correspond.',
  'a11y.paletteResults': 'Résultats de la recherche',
  'a11y.tourPlayer': 'Visite guidée en cours',
  'error.title': 'Erreur de l’application',
  'error.retry': 'Réessayer',
  'error.contextLost': 'Reconnexion de la vue 3D…',
  'error.contextLostTimeout':
    'La vue 3D n’a pas pu se reconnecter. Rechargez la page.',

  // ── Éphémérides manquantes (lot 15) ──
  'ephemeris.notice.title': 'Précision réduite',
  'ephemeris.notice.partial':
    'Éphémérides précises reçues : {loaded} sur {declared}. Les autres corps sont placés par une source moins précise, nommée dans leur fiche.',
  'ephemeris.notice.none':
    'Aucune éphéméride précise n’a pu être chargée. Tous les corps sont placés par une source moins précise, nommée dans leur fiche.',
  'ephemeris.notice.spacecraft':
    'Sondes laissées sans aucune position : {count}.',
  'ephemeris.notice.retry': 'Charger les fichiers manquants',
  'ephemeris.notice.retrying': 'Chargement des fichiers manquants…',
  'ephemeris.notice.recovered': 'Toutes les éphémérides sont chargées.',
  'ephemeris.notice.dismiss': 'Fermer ce message',
  'ephemeris.notice.aria': 'Chargement des éphémérides',

  // ── Navigation ──
  'nav.overview': 'Vue globale',
  'nav.bodies': 'Corps',
  'nav.search': 'Rechercher un corps',
  'dock.tools.aria': 'Outils',
  'speed.aria': 'Vitesse de simulation',
  'speed.limited': 'limité par votre connexion',
  'ephemeris.notice.waitingTitle': 'La date attend ses données',
  'ephemeris.notice.waiting':
    'Votre connexion est plus lente que la vitesse de lecture demandée. Rien de faux n’est affiché : la date avance au rythme des octets.',
  'offline.hint':
    'Téléchargez tous les fichiers d’éphémérides pour que l’application place les corps à n’importe quelle date sans réseau. Rien n’est téléchargé tant que vous ne le demandez pas.',
  'offline.reading': 'Lecture de ce que cet appareil tient déjà…',
  'offline.unavailable':
    'Ce navigateur ne garde aucun stockage pour l’application : le hors-ligne ne peut pas être préparé ici.',
  'offline.noManifest':
    'L’index des éphémérides n’est pas arrivé : il n’y a encore rien à préparer.',
  'offline.partial':
    'Cet appareil tient {files} des {total} fichiers. Préparer le reste télécharge environ {size} Mo.',
  'offline.ready':
    'Les {files} fichiers sont sur cet appareil ({size} Mo). Les dates fonctionnent sans réseau.',
  'offline.prepare': 'Préparer le hors-ligne',
  'offline.cancel': 'Arrêter le téléchargement',
  'offline.progress': 'Téléchargement : {done} fichiers sur {total}.',
  'offline.started': 'Préparation du hors-ligne lancée.',
  'offline.forget': 'Libérer {size} Mo',
  'nav.searchPlaceholder': 'Rechercher un corps…',
  'nav.paletteAria': 'Rechercher et sélectionner un corps',
  'nav.group.star': 'Étoile',
  'nav.group.planet': 'Planètes',
  'nav.group.moon': 'Lunes',
  'nav.group.dwarf': 'Planètes naines',
  'nav.group.other': 'Petits corps',
  'nav.group.spacecraft': 'Sondes',
  'nav.group.interstellar': 'Objets interstellaires',
  'nav.kind.moon': 'lune',
  'nav.kind.dwarf': 'naine',
  'nav.unavailable': 'Aucune position à cette date',
  'nav.kind.spacecraft': 'sonde',
  'nav.kind.interstellar': 'interstellaire',
  'surface.close': 'Fermer',
  'bi.trigger.aria': 'Informations du corps',
  'settings.trigger.aria': "Réglages d'affichage",
  'time.expand': 'Réglages du temps',
  'events.title': 'Événements astronomiques',
  'events.open': 'Événements astronomiques',
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
  'events.conjunction': 'Conjonction inférieure (passe entre Terre et Soleil)',
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
  'time.group': 'Contrôles temporels',
  'time.today': 'Revenir à maintenant',
  'time.wheelTime': 'Molette : ±1 h  ·  Clic : choisir l’heure',
  'time.wheelDate': 'Molette : ±1 jour  ·  Clic : choisir la date',

  // ── Aide & crédits ──
  'help.btn.title': 'Aide, astuces et crédits',
  'help.btn.aria': 'Aide, astuces et crédits',
  'feedback.btn.title': 'Suggestions et signalements',
  'feedback.btn.aria': 'Suggestions et signalements',
  'kofi.btn.title': "M'offrir un café",
  'kofi.btn.aria': 'Soutenir ce projet sur Ko-fi',
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
  'help.tip.time.text': 'molette pour voyager dans le temps, tap pour choisir',
  'credits.textures': 'Textures',
  'credits.fictional': 'Surfaces fictives',
  'credits.fictional.list':
    'Les corps jamais cartographiés globalement ont une texture illustrative, pas une carte scientifique ; la fiche du corps le signale, et Sources les énumère.',
  'weather.attribution.prefix': 'Données météo :',
  'weather.attribution.modified': 'rééchantillonnées en textures de carte',
  'credits.models': 'Modèles de forme 3D',
  'credits.data': 'Données',
  'credits.privacy': 'Confidentialité',
  'credits.methodology': 'Méthodologie',
  'credits.methodology.href': '/fr/methodology/',
  'credits.sources': 'Sources',
  'credits.sources.href': '/fr/sources/',
  'lang.label': 'Langue',
  'lang.changed': 'Langue de l’interface : {language}.',
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
    'Ouvrez les réglages d’affichage pour montrer ou masquer les étiquettes, les objets et les orbites, groupe par groupe ou objet par objet.',
  'tour.step.weather.title': '7. Explorer la météo',
  'tour.step.weather.text':
    'Ouvrez les couches météo pour voir les nuages, la pluie, le vent et les données de surface sur Terre.',
  'tour.step.events.title': '8. Observer le ciel',
  'tour.step.events.text':
    'Consultez les prochains événements astronomiques et choisissez en un pour plus de détails.',
  'tour.step.share.title': '9. Partager une vue',
  'tour.step.share.text':
    'Réglez une vue, puis partagez son lien. Celui qui l’ouvre retrouve exactement la même scène.',
  'tour.step.capture.title': '10. Prendre une image',
  'tour.step.capture.text':
    'Masque tous les contrôles et enregistre la vue en image, avec la date et le corps inscrits dessus.',
  'tour.step.feedback.title': '11. Donner son avis',
  'tour.step.feedback.text':
    'Signalez un problème ou proposez une idée. Les suggestions sont publiques, et vous pouvez voter pour celles des autres.',
  'tour.step.help.title': '12. Retrouver l’aide',
  'tour.step.help.text': "Consultez la page d'aide pour plus d'informations.",

  // ── Tours guidés scénarisés ──
  'tours.start': 'Tours guidés',
  'tours.pause': 'Pause',
  'tours.resume': 'Reprendre',
  'tours.next': 'Suivant',
  'tours.close': 'Fermer',
  'tours.progress': 'Étape {current} sur {total}',
  'tours.outline': 'Visite « {title} », {count} parties : {beats}',
  'tours.status.flyingTo': 'Vol vers {body}…',
  'tours.status.jumping': 'Saut dans le temps…',
  'tours.status.speeding': 'Accélération du temps…',

  // ── Nudge visite guidée (premier passage en Explo) ──
  'exploNudge.text':
    'Essayez une visite guidée pour découvrir le meilleur du mode Exploration.',
  'exploNudge.action': 'Me montrer',
  'exploNudge.dismiss': 'Fermer',

  // ── Badge d'échelle permanent (vue d'ensemble Explo, aucune cible) ──
  'exploScale.fact.earth':
    'La lumière du Soleil met environ 8 minutes à atteindre la Terre.',
  'exploScale.fact.jupiter':
    'La lumière du Soleil met environ 43 minutes à atteindre Jupiter.',
  'exploScale.fact.neptune':
    'La lumière du Soleil met environ 4 heures à atteindre Neptune.',
  'exploScale.fact.voyager':
    'Voyager 1, la sonde la plus lointaine de l’humanité, est déjà à plus de 24 milliards de km de la Terre.',

  // ── Surface « Réglages d'affichage » (cf. le bloc anglais) ──
  'settings.title': 'Réglages d’affichage',
  'settings.section.scene': 'Dans la scène',
  'settings.section.rendering': 'Rendu',
  'settings.section.reading': 'Accessibilité et unités',
  'settings.section.view': 'Vue',
  'settings.section.offline': 'Utilisation hors ligne',
  'settings.labelsToggle': 'Afficher toutes les étiquettes',
  'settings.bodiesToggle': 'Afficher tous les objets',
  'settings.orbitsToggle': 'Afficher toutes les orbites et trajectoires',
  'settings.tableHint':
    'L’en-tête règle toute la colonne, une ligne de groupe tout son groupe, une ligne un seul objet. Les sondes et les objets interstellaires sont masqués au départ.',
  'settings.tableCaption': 'Ce que montre la scène, objet par objet',
  'settings.col.bodyName': 'Objet',
  'settings.col.names': 'Étiquette',
  'settings.col.bodies': 'Objet',
  'settings.col.orbits': 'Orbite',
  'settings.row.name.aria': 'Afficher l’étiquette de {name}',
  'settings.row.body.aria': 'Afficher {name}',
  'settings.row.orbit.aria': 'Afficher l’orbite de {name}',
  'settings.row.trajectory.aria': 'Afficher la trajectoire de {name}',
  'settings.group.name.aria': 'Afficher toutes les étiquettes : {group}',
  'settings.group.body.aria': 'Afficher tous les objets : {group}',
  'settings.group.orbit.aria': 'Afficher toutes les orbites : {group}',
  'settings.exposure': 'Luminosité (exposition)',
  'settings.colorblind': 'Couleurs d’orbite adaptées au daltonisme',
  'settings.surfaceImagery': 'Streamer l’imagerie de surface haute résolution',
  'surface.imagery.headline': '{title} à {resolution}/pixel',
  'surface.imagery.acquired': 'images de {from} à {to}',
  'surface.imagery.oversampled':
    'affichée {factor} fois plus grande que la mosaïque publiée ({published} px/degré)',
  'surface.relief.headline': 'Relief {title} à {resolution}/pixel',
  'surface.relief.area': 'aire nommée {name}',
  'surface.relief.acquired': 'altimétrie de {from} à {to}',
  'settings.units': 'Unités impériales (mi, °F)',

  // ── Champ d'astéroïdes et de comètes, section des Réglages ──
  'smallBodies.title': 'Champ d’astéroïdes et de comètes',
  'smallBodies.exploOnly':
    'Dessiné en mode Exploration, un point par orbite connue.',
  'smallBodies.mainBelt': 'Ceinture principale',
  'smallBodies.neo': 'Géocroiseurs',
  'smallBodies.comet': 'Comètes',
  'smallBodies.tno': 'Objets transneptuniens',
  'smallBodies.source':
    '{count} objets, JPL Small-Body Database, relevé du {date}.',
  'smallBodies.sourceStale':
    '{count} objets, JPL Small-Body Database, relevé du {date}. Ce relevé date de {months} mois : les orbites affinées depuis, et les objets catalogués depuis, peuvent y manquer.',

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
    'Couverture nuageuse modélisée (Open-Meteo) : mondiale sans trou, gère passé et prévision ; à choisir pour le direct et le voyage dans le temps.',
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
  // Couche des événements terrestres (voir ui/earthEvents.ts).
  'earthEvents.title': 'Événements terrestres',
  'earthEvents.dialog.aria': 'Événements terrestres',
  'earthEvents.trigger.aria': 'Événements terrestres',
  'earthEvents.quakes.label': 'Séismes (USGS)',
  'earthEvents.quakes.note':
    'Solutions d’origine de magnitude {magnitude} et plus sur les {days} jours qui précèdent la date de la scène, mesurées par les réseaux de sismomètres. Aucun séisme n’existe au futur : une scène plus tardive reçoit la dernière fenêtre réelle, et l’écart est écrit ci-dessous.',
  'earthEvents.natural.label': 'Événements naturels (NASA EONET)',
  'earthEvents.natural.note':
    'Événements rapportés (incendies, volcans, tempêtes, inondations, glaces, entre autres) sur les {days} jours qui précèdent la date de la scène. EONET déclare que ses métadonnées sont destinées à la visualisation et à l’information générale seulement, et ne doivent pas être tenues pour officielles quant à l’emprise spatiale ou temporelle : ce sont des rapports, pas des mesures.',
  'earthEvents.empty': 'Aucun événement sur cette fenêtre.',
  'earthEvents.ongoing': 'en cours',
  'earthEvents.loading': 'Chargement…',
  'earthEvents.attribution.prefix': 'Données d’événements :',
  // Catégorie temporelle d'une donnée affichée (voir core/temporal.ts).
  'time.category.live': 'en direct',
  'time.category.observed': 'observé',
  'time.category.reported': 'rapporté',
  'time.category.reconstructed': 'reconstruit (modèle)',
  'time.category.predicted': 'prédit',
  'time.category.extrapolated': 'extrapolé',
  'time.category.unavailable': 'indisponible',
  'time.confidence.reduced': 'confiance réduite',
  'time.offset.scene': 'scène au {date}',
  // Provenance de la position d'un corps (voir core/positionProvenance.ts).
  'bi.position.label': 'Position à cette date',
  'position.source.horizons': 'éphéméride JPL Horizons (précalculée)',
  'position.source.spk': 'noyau SPK du JPL',
  'position.source.astronomy-engine': 'Astronomy Engine',
  'position.source.kepler': 'éléments orbitaux képlériens',
  'position.error':
    'Écart moyen mesuré à JPL Horizons : {distance} ({from}–{to})',
  'position.error.none': 'Écart à JPL Horizons non mesuré à cette date',
  'weather.wind.note':
    'Flux du vent (Open-Meteo) : la couleur et la vitesse suivent la force du vent.',
  'weather.thermal.note':
    'Température de l’air près du sol (MERRA-2 mensuel) :',

  // ── Divers ──
  'fullscreen.title': 'Plein écran',

  // ── Fiche d'info (bodyInfo) ──
  'bi.more': 'En savoir plus',
  'bi.modelCredit': 'Modèle de forme 3D',
  'bi.colourCredit': 'Couleur de surface',
  'bi.creditLine': '{label} : {value}',
  'bi.live.label': 'Distance depuis vous',
  'bi.fictional': 'Surface fictive',
  'bi.fictional.hint':
    'Aucune sonde n’a résolu cette surface, la texture est donc illustrative, pas une carte scientifique.',
  'stat.radius': 'Rayon',
  'stat.meanDistanceSun': 'Distance moyenne (Soleil)',
  'stat.meanDistanceFrom': 'Distance moyenne ({parent})',
  'stat.mass': 'Masse',
  'stat.gravity': 'Gravité',
  'stat.meanTemperature': 'Température moyenne',
  'stat.siderealRotation': 'Rotation sidérale',
  'stat.year': 'Année',
  'stat.orbit': 'Orbite',
  'stat.knownMoons': 'Lunes connues',
  'stat.axialTilt': 'Inclinaison axiale',
  'stat.launchDate': 'Date de lancement',
  'stat.launchVehicle': 'Lanceur',
  'stat.launchSite': 'Site de lancement',
  'stat.absoluteMagnitude': 'Magnitude absolue',
  'stat.eccentricity': 'Excentricité',
  'stat.perihelion': 'Distance de périhélie',
  'stat.firstObservation': 'Première observation',
  'stat.unknown': 'Donnée non publiée',
  'stat.unsourced': 'Pas encore sourcée',
  'stat.unknown.value': 'n.d.',
  'bi.sources': 'Sources',
  'bi.source': 'source',
  'fact.method.measured': 'valeur mesurée',
  'fact.method.derived': 'valeur dérivée',
  'fact.method.illustrative': 'valeur illustrative',
  'fact.asOf': 'en {date}',
  'fact.methods.measured': 'Valeurs mesurées',
  'fact.methods.derived': 'Valeurs dérivées',
  'fact.methods.illustrative': 'Valeurs illustratives',
  'fact.accessed': 'consultée le {date}',
  'fact.kind.preprint': 'prépublication',
  'subtitle.star': 'Étoile du Système solaire',
  'subtitle.moon': 'Satellite naturel',
  'subtitle.dwarf': 'Planète naine',
  'subtitle.asteroid': 'Astéroïde',
  'subtitle.comet': 'Comète',
  'subtitle.spacecraft': 'Sonde spatiale',
  'subtitle.interstellar': 'Objet interstellaire',
  'subtitle.planet': 'Planète',
  'subtitle.planetOrdinal': '{ordinal} planète depuis le Soleil',

  // ── Unités & suffixes (fiche) ──
  'unit.light': 'lumière',
  'unit.day.short': 'j',
  'unit.hours': 'heures',
  'unit.days': 'jours',
  'unit.year.short': 'ans',
  'unit.au': 'UA',
  'unit.million': 'M',
  'unit.billion': 'Md',

  // ── Précisions de provenance (lot 35) ──
  // Ce que la source mesure exactement quand le libellé de la fiche est plus large, et la
  // raison d'une valeur non sourcée. Ces textes vivaient inlinés en QUATRE langues dans
  // `config/factSources.ts`, donc dans la clôture statique : 6 676 octets de source, 2 828
  // octets gzippés, payés par un visiteur qui n'en lit qu'un quart. Ici, chaque langue ne
  // voyage qu'avec son propre dictionnaire.
  'detail.equatorialRadius1Bar':
    'rayon équatorial au niveau de pression de 1 bar',
  'detail.meanGravity1Bar': 'gravité moyenne au niveau de pression de 1 bar',
  'detail.equatorialGravity': 'gravité à l’équateur',
  'detail.temperature1Bar':
    'température moyenne au niveau de pression de 1 bar',
  'detail.effectiveTemperature':
    'température effective, 5772 K, convertie en °C',
  'detail.solarRotationAt16Degrees':
    'période adoptée à 16° de latitude : le Soleil tourne plus vite à l’équateur qu’aux pôles',
  'detail.obliquityToEcliptic': 'obliquité par rapport à l’écliptique',
  'detail.synchronousRotation':
    'rotation synchrone : égale à la période orbitale',
  'detail.massFromGM': 'masse = GM / G, avec G de CODATA 2018',
  'detail.gravityFromGM': 'g = GM / R², pour une sphère sans rotation',
  'detail.radiusFromDiameter': 'moitié du diamètre publié',
  'detail.equatorialRadiusFromDiameter': 'moitié du diamètre équatorial publié',
  'detail.volumetricRadiusFromDiameter':
    'moitié du diamètre équivalent en volume publié',
  'detail.itokawaPublishedMass':
    'masse publiée citée dans les notes de la base ; le GM de 2,1e-9 km³/s² de la base ne lui correspond pas',
  'detail.gravityFromSystemMass':
    'g = G·M / R² avec la masse du système, pour une sphère sans rotation',
  'detail.massFromDensity': 'masse = densité publiée × volume du rayon publié',
  'detail.gravityFromMass': 'g = G·M / R², pour une sphère sans rotation',
  'detail.systemMass': 'masse du système entier, satellite compris',
  'detail.obliquityFromPole':
    'angle entre le pôle de rotation publié et la normale à l’orbite',
  'detail.osculatingSemiMajorAxis':
    'demi-grand axe osculateur à l’époque des éléments',
  'detail.keplerPeriod':
    'troisième loi de Kepler appliquée au demi-grand axe osculateur',
  'detail.partialLightcurve':
    'période de courbe de lumière que la source signale comme fondée sur une couverture incomplète',
  'detail.confirmedSatellites':
    'nombre de satellites confirmés listés par la base',
  'detail.nssdcaFactsInBrief':
    'masse telle que listée dans les « Facts in Brief » du catalogue pour cette sonde',
  'detail.firstObservationUsed':
    'première observation retenue par la solution d’orbite publiée',
  'detail.osculatingEccentricity':
    'excentricité osculatrice de la solution d’orbite publiée ; au-dessus de 1 l’orbite est ouverte et l’objet quitte le Système solaire',
  'detail.absoluteMagnitudeH':
    'magnitude absolue H : l’éclat qu’aurait l’objet à 1 UA du Soleil et de l’observateur, sous un angle de phase nul',
  'detail.perihelionFromElements':
    'q = a (1 − e), d’après les éléments osculateurs publiés',
  'fact.notYetSourced':
    'Galaxy n’a pas encore rattaché cette valeur à une source primaire (agence spatiale, UAI, article publié) : elle n’est donc pas affichée.',
};
