/**
 * DICTIONNAIRE ESPAGNOL. Chargé à la demande (cf. `./locales`).
 *
 * Le type force la parité avec l'anglais : toute clé de `MessageKey` est obligatoire, et une
 * clé inconnue est refusée. Pour ajouter une entrée, commencer par `./dict-en`.
 *
 * TRADUIT PAR CLAUDE au lot 20 (2026-09-27), depuis l'anglais ET le français, et RELU PAR AUCUN
 * LOCUTEUR NATIF : c'est écrit dans le handoff du lot, parce qu'un manque nommé vaut mieux qu'un
 * manque caché. Ce qu'une machine peut vérifier l'est : nombres, unités, noms propres, gabarits
 * `{…}` et parité des clés (`src/i18n/translationFidelity.test.ts`).
 *
 * Deux choix d'unités, décidés une fois ici plutôt qu'au fil des phrases :
 *
 *   - `es` est SANS RÉGION (cf. `./locales`), donc la virgule décimale du CLDR générique ;
 *   - `unit.million` / `unit.billion` s'écrivent en mots (« millones de », « mil millones de »)
 *     et non en lettres. En espagnol « billón » vaut 10¹², donc traduire le « B » anglais par
 *     « B » aurait affiché mille fois la bonne valeur. Le gabarit `{nombre} {suffixe} {unité}`
 *     rend alors « 1,50 mil millones de km », qui est la forme correcte.
 */
import type { MessageKey } from './dict-en';

export const es: Record<MessageKey, string> = {
  // ── Écran de chargement ──
  'title.body': '{name} en 3D: posición y órbita en directo',
  'title.eclipse.solar.total': 'Eclipse solar total del {date} en 3D',
  'title.eclipse.solar.annular': 'Eclipse solar anular del {date} en 3D',
  'title.eclipse.solar.partial': 'Eclipse solar parcial del {date} en 3D',
  'title.eclipse.lunar.total': 'Eclipse lunar total del {date} en 3D',
  'title.eclipse.lunar.partial': 'Eclipse lunar parcial del {date} en 3D',
  'title.eclipse.lunar.penumbral': 'Eclipse lunar penumbral del {date} en 3D',
  'eclipse.name.solar.total': 'Eclipse solar total',
  'eclipse.name.solar.annular': 'Eclipse solar anular',
  'eclipse.name.solar.partial': 'Eclipse solar parcial',
  'eclipse.name.lunar.total': 'Eclipse lunar total',
  'eclipse.name.lunar.partial': 'Eclipse lunar parcial',
  'eclipse.name.lunar.penumbral': 'Eclipse lunar penumbral',
  'title.overview': 'Galaxy: sistema solar 3D interactivo en tiempo real',
  'loader.init': 'Inicializando…',
  'loader.core': 'Cargando los componentes…',
  'loader.scene': 'Construyendo la escena…',
  'loader.lighting': 'Preparando la iluminación…',
  'loader.bodies': 'Creando los cuerpos celestes…',
  'loader.finalize': 'Finalizando…',
  'loader.starting': 'Arrancando…',
  'loader.loadingBody': 'Cargando {body}…',
  'loader.creatingBody': 'Creando {body}...',
  'loader.ephemerides': 'Datos de efemérides cargados',
  'loader.ready': 'Listo para el lanzamiento',
  'loader.stage.core': 'Motor',
  'loader.stage.data': 'Datos',
  'loader.stage.scene': 'Escena',
  'loader.stage.bodies': 'Cuerpos',
  'loader.stage.orbit': 'Órbitas',
  'loader.stage.ready': 'Listo',
  'loader.texturesDone': 'Texturas cargadas',
  // ── Accessibilité : ce que SEUL un lecteur d'écran entend (lot 19) ──
  // Voir le bloc anglais pour la raison de chaque clé.
  'a11y.pageHeading':
    'Galaxy: sistema solar 3D interactivo en tiempo real. Explora los planetas, las lunas y los planetas enanos',
  'a11y.scene': 'Sistema solar, vista 3D interactiva',
  'a11y.navigation': 'Navegación entre los cuerpos',
  'a11y.loading': 'Cargando el sistema solar, espere un momento.',
  'a11y.loadingProgress': 'Progreso de la carga',
  'a11y.ready': 'Sistema solar cargado y listo.',
  'a11y.loadFailed': 'No se ha podido cargar el sistema solar.',
  'a11y.bodySelected': '{name} seleccionado. Ficha de información abierta.',
  'a11y.dateChanged': 'Fecha ajustada al {date}.',
  'a11y.searchResults': '{count} cuerpos coinciden.',
  'a11y.searchResultsOne': 'Un cuerpo coincide.',
  'a11y.searchResultsNone': 'Ningún cuerpo coincide.',
  'a11y.paletteResults': 'Resultados de la búsqueda',
  'a11y.tourPlayer': 'Visita guiada en curso',
  'error.title': 'Error de la aplicación',
  'error.retry': 'Reintentar',
  'error.contextLost': 'Reconectando la vista 3D…',
  'error.contextLostTimeout':
    'La vista 3D no ha podido reconectarse. Vuelva a cargar la página.',

  // ── Éphémérides manquantes (lot 15) ──
  'ephemeris.notice.title': 'Precisión reducida',
  'ephemeris.notice.partial':
    'Efemérides precisas recibidas: {loaded} de {declared}. Los demás cuerpos se sitúan con una fuente menos precisa, indicada en la ficha de cada cuerpo.',
  'ephemeris.notice.none':
    'No se ha podido cargar ninguna efeméride precisa. Todos los cuerpos se sitúan con una fuente menos precisa, indicada en su ficha.',
  'ephemeris.notice.spacecraft': 'Sondas sin ninguna posición: {count}.',
  'ephemeris.notice.retry': 'Cargar los archivos que faltan',
  'ephemeris.notice.retrying': 'Cargando los archivos que faltan…',
  'ephemeris.notice.recovered': 'Todas las efemérides están cargadas.',
  'ephemeris.notice.dismiss': 'Cerrar este mensaje',
  'ephemeris.notice.aria': 'Carga de las efemérides',

  // ── Navigation ──
  'nav.overview': 'Vista general',
  'nav.bodies': 'Cuerpos',
  'nav.search': 'Buscar un cuerpo',
  'dock.tools.aria': 'Herramientas',
  'speed.aria': 'Velocidad de la simulación',
  'speed.limited': 'limitado por su conexión',
  'ephemeris.notice.waitingTitle': 'La fecha espera sus datos',
  'ephemeris.notice.waiting':
    'Su conexión es más lenta que la velocidad de reproducción solicitada. No se muestra nada falso: la fecha avanza al ritmo de los bytes.',
  'offline.hint':
    'Descargue todos los archivos de efemérides para que la aplicación sitúe los cuerpos en cualquier fecha sin red. No se descarga nada hasta que lo pida.',
  'offline.reading': 'Comprobando lo que ya tiene este dispositivo…',
  'offline.unavailable':
    'Este navegador no guarda almacenamiento para la aplicación, así que el uso sin conexión no puede prepararse aquí.',
  'offline.noManifest':
    'El índice de las efemérides no ha llegado, así que todavía no hay nada que preparar.',
  'offline.partial':
    'Este dispositivo tiene {files} de {total} archivos. Preparar el resto descarga unos {size} MB.',
  'offline.ready':
    'Los {files} archivos están en este dispositivo ({size} MB). Las fechas funcionan sin red.',
  'offline.prepare': 'Preparar el uso sin conexión',
  'offline.cancel': 'Detener la descarga',
  'offline.progress': 'Descargando: {done} de {total} archivos.',
  'offline.started': 'Preparación sin conexión iniciada.',
  'offline.forget': 'Liberar {size} MB',
  'nav.searchPlaceholder': 'Buscar un cuerpo…',
  'nav.paletteAria': 'Buscar y seleccionar un cuerpo',
  'nav.group.star': 'Estrella',
  'nav.group.planet': 'Planetas',
  'nav.group.moon': 'Lunas',
  'nav.group.dwarf': 'Planetas enanos',
  'nav.group.other': 'Cuerpos menores',
  'nav.group.spacecraft': 'Sondas',
  'nav.group.interstellar': 'Objetos interestelares',
  'nav.kind.moon': 'luna',
  'nav.kind.dwarf': 'enano',
  'nav.unavailable': 'Sin posición en esta fecha',
  'nav.kind.spacecraft': 'sonda',
  'nav.kind.interstellar': 'interestelar',
  'surface.close': 'Cerrar',
  'bi.trigger.aria': 'Información del cuerpo',
  'settings.trigger.aria': 'Ajustes de visualización',
  'time.expand': 'Ajustes del tiempo',
  'events.title': 'Eventos astronómicos',
  'events.open': 'Eventos astronómicos',
  'events.close': 'Cerrar los eventos astronómicos',
  'events.empty': 'Ningún evento próximo',
  'events.newMoon': 'Luna nueva',
  'events.firstQuarter': 'Cuarto creciente',
  'events.fullMoon': 'Luna llena',
  'events.thirdQuarter': 'Cuarto menguante',
  'events.solarEclipse': 'Eclipse solar',
  'events.lunarEclipse': 'Eclipse lunar',
  'events.marchEquinox': 'Equinoccio de marzo',
  'events.juneSolstice': 'Solsticio de junio',
  'events.septemberEquinox': 'Equinoccio de septiembre',
  'events.decemberSolstice': 'Solsticio de diciembre',
  'events.perihelion': 'Perihelio (la Tierra más cerca del Sol)',
  'events.aphelion': 'Afelio (la Tierra más lejos del Sol)',
  'events.opposition': 'Oposición (lo más cerca, visible toda la noche)',
  'events.conjunction': 'Conjunción inferior (pasa entre la Tierra y el Sol)',
  'events.kind.penumbral': 'penumbral',
  'events.kind.partial': 'parcial',
  'events.kind.annular': 'anular',
  'events.kind.total': 'total',
  'events.tip.peak': 'Máximo visible cerca de {lat}, {lon}',
  'events.tip.obscuration': '{percent} % oscurecido en el máximo',
  'events.tip.goto': 'Haga clic para viajar a esta fecha',

  // ── Bascule de mode ──
  'mode.group': 'Modo de visualización',
  'mode.educ': 'Educ.',
  'mode.explo': 'Explo.',
  'mode.educ.title': 'Vista educativa, órbitas circulares',
  'mode.explo.title': 'Modo exploración, escala real',
  'zoom.optical': 'Zoom óptico (FOV)',

  // ── Qualité graphique (perf adaptative) ──
  'quality.heading': 'Calidad gráfica',
  'quality.auto': 'Auto',
  'quality.auto.hint': 'Adaptada a este dispositivo',
  'quality.low': 'Baja',
  'quality.low.hint': 'La más fluida en GPU modestas',
  'quality.medium': 'Media',
  'quality.medium.hint': 'Equilibrada',
  'quality.high': 'Alta',
  'quality.high.hint': 'El mejor aspecto',
  'quality.reloadNote': 'Algunas opciones se aplican al recargar.',

  // ── Lecture / temps ──
  'playback.playpause': 'Reproducir / Pausa',
  'playback.play': 'Reanudar la simulación',
  'playback.pause': 'Pausar la simulación',
  'time.today': 'Volver a ahora',
  'time.group': 'Controles de tiempo',
  'time.wheelTime': 'Rueda: ±1 h  ·  Clic: elegir la hora',
  'time.wheelDate': 'Rueda: ±1 día  ·  Clic: elegir la fecha',

  // ── Aide & crédits ──
  'help.btn.title': 'Ayuda, consejos y créditos',
  'help.btn.aria': 'Ayuda, consejos y créditos',
  'feedback.btn.title': 'Sugerencias y avisos de errores',
  'feedback.btn.aria': 'Sugerencias y avisos de errores',
  'kofi.btn.title': 'Invítame a un café',
  'kofi.btn.aria': 'Apoyar este proyecto en Ko-fi',
  'share.btn.title': 'Compartir esta vista',
  'share.btn.aria': 'Compartir esta vista',
  'share.copied': 'Enlace copiado',
  'share.failed': 'No se ha podido copiar',
  'capture.btn.title': 'Capturar esta vista',
  'capture.btn.aria': 'Capturar esta vista',
  'capture.success': 'Imagen descargada',
  'capture.failed': 'No se ha podido capturar',
  'webxr.btn.enter.title': 'Entrar en RV',
  'webxr.btn.enter.aria': 'Entrar en realidad virtual',
  'webxr.btn.exit.title': 'Salir de la RV',
  'webxr.btn.exit.aria': 'Salir de la realidad virtual',
  'help.dialog.aria': 'Ayuda y créditos',
  'help.title': 'Navegación',
  'help.tip.drag.key': 'Arrastrar',
  'help.tip.drag.text': 'girar la vista',
  'help.tip.zoom.key': 'Rueda · pinza',
  'help.tip.zoom.text': 'acercar / alejar',
  'help.tip.click.key': 'Clic en un cuerpo',
  'help.tip.click.text': 'o en su etiqueta para viajar hasta él',
  'help.tip.mode.key': 'Educ · Explo',
  'help.tip.mode.text': 'vista comprimida o viaje a escala real',
  'help.tip.time.key': 'Reloj · fecha',
  'help.tip.time.text': 'rueda para viajar en el tiempo, toque para elegir',
  'credits.textures': 'Texturas',
  'credits.fictional': 'Superficies ilustrativas',
  'credits.fictional.list':
    'Los cuerpos nunca cartografiados por completo llevan una textura ilustrativa, no un mapa científico; la ficha del cuerpo lo indica, y Fuentes los enumera.',
  'weather.attribution.prefix': 'Datos meteorológicos:',
  'weather.attribution.modified': 'remuestreados en texturas de mapa',
  'credits.models': 'Modelos de forma 3D',
  'credits.data': 'Datos',
  'credits.privacy': 'Privacidad',
  'credits.methodology': 'Metodología',
  'credits.methodology.href': '/es/methodology/',
  'credits.sources': 'Fuentes',
  'credits.sources.href': '/es/sources/',
  'lang.label': 'Idioma',
  'lang.changed': 'Idioma de la interfaz: {language}.',
  // ── Visite guidée (première visite) ──
  'tour.start': 'Empezar la visita rápida',
  'tour.previous': 'Anterior',
  'tour.next': 'Siguiente',
  'tour.finish': 'Terminar',
  'tour.close': 'Cerrar la visita',
  'tour.progress': 'Paso {current} de {total}',
  'tour.step.navigation.title': '1. Navegar',
  'tour.step.navigation.text':
    'Elija un planeta en la barra superior o arrastre la escena.',
  'tour.step.mode.title': '2. Elegir una vista',
  'tour.step.mode.text':
    'Educativo simplifica las distancias mientras Exploración muestra la escala real.',
  'tour.step.time.title': '3. Cambiar el tiempo',
  'tour.step.time.text':
    'Use la fecha y la velocidad para viajar en el tiempo.',
  'tour.step.expand.title': '4. Desplegar el reloj',
  'tour.step.expand.text':
    'Haga clic en el reloj para desplegar los ajustes avanzados de fecha y velocidad.',
  'tour.step.info.title': '5. Inspeccionar un objetivo',
  'tour.step.info.text':
    'Tras seleccionar un cuerpo, abra su ficha con el botón de información del objetivo.',
  'tour.step.settings.title': '6. Ajustar la visualización',
  'tour.step.settings.text':
    'Abra los ajustes de visualización para mostrar u ocultar las etiquetas, los objetos y las órbitas, grupo por grupo u objeto por objeto.',
  'tour.step.weather.title': '7. Explorar la meteorología',
  'tour.step.weather.text':
    'Abra las capas meteorológicas para ver las nubes, la lluvia, el viento y los datos de superficie en la Tierra.',
  'tour.step.events.title': '8. Observar el cielo',
  'tour.step.events.text':
    'Consulte los próximos eventos astronómicos y elija uno para ver más detalles.',
  'tour.step.share.title': '9. Compartir una vista',
  'tour.step.share.text':
    'Prepare una vista y comparta su enlace. Quien lo abra llegará a la misma escena exacta.',
  'tour.step.capture.title': '10. Tomar una imagen',
  'tour.step.capture.text':
    'Oculta todos los controles y guarda la vista como imagen, con la fecha y el cuerpo escritos en ella.',
  'tour.step.feedback.title': '11. Dar su opinión',
  'tour.step.feedback.text':
    'Informe de un problema o proponga una idea. Las sugerencias son públicas, y puede votar las de los demás.',
  'tour.step.help.title': '12. Encontrar ayuda',
  'tour.step.help.text': 'Consulte la página de ayuda para saber más.',

  // ── Tours guidés scénarisés ──
  'tours.start': 'Visitas guionizadas',
  'tours.pause': 'Pausa',
  'tours.resume': 'Reanudar',
  'tours.next': 'Siguiente',
  'tours.close': 'Cerrar',
  'tours.progress': 'Paso {current} de {total}',
  'tours.outline': 'Visita «{title}», {count} partes: {beats}',
  'tours.status.flyingTo': 'Vuelo hacia {body}…',
  'tours.status.jumping': 'Salto en el tiempo…',
  'tours.status.speeding': 'Acelerando el tiempo…',

  // ── Nudge visite guidée (premier passage en Explo) ──
  'exploNudge.text':
    'Pruebe una visita guiada para descubrir lo mejor del modo Exploración.',
  'exploNudge.action': 'Muéstrame',
  'exploNudge.dismiss': 'Cerrar',

  // ── Badge d'échelle permanent (vue d'ensemble Explo, aucune cible) ──
  'exploScale.fact.earth':
    'La luz del Sol tarda unos 8 minutos en llegar a la Tierra.',
  'exploScale.fact.jupiter':
    'La luz del Sol tarda unos 43 minutos en llegar a Júpiter.',
  'exploScale.fact.neptune':
    'La luz del Sol tarda unas 4 horas en llegar a Neptuno.',
  'exploScale.fact.voyager':
    'Voyager 1, la sonda más lejana de la humanidad, está ya a más de 24 mil millones de km de la Tierra.',

  // ── Surface « Réglages d'affichage » (cf. le bloc anglais) ──
  'settings.title': 'Ajustes de visualización',
  'settings.section.scene': 'En la escena',
  'settings.section.rendering': 'Representación',
  'settings.section.reading': 'Accesibilidad y unidades',
  'settings.section.view': 'Vista',
  'settings.section.offline': 'Uso sin conexión',
  'settings.labelsToggle': 'Mostrar todas las etiquetas',
  'settings.bodiesToggle': 'Mostrar todos los objetos',
  'settings.orbitsToggle': 'Mostrar todas las órbitas y trayectorias',
  'settings.tableHint':
    'La cabecera ajusta toda la columna, una fila de grupo todo su grupo, una fila un solo objeto. Las sondas y los objetos interestelares empiezan ocultos.',
  'settings.tableCaption': 'Lo que muestra la escena, objeto por objeto',
  'settings.col.bodyName': 'Objeto',
  'settings.col.names': 'Etiqueta',
  'settings.col.bodies': 'Objeto',
  'settings.col.orbits': 'Órbita',
  'settings.row.name.aria': 'Mostrar la etiqueta de {name}',
  'settings.row.body.aria': 'Mostrar {name}',
  'settings.row.orbit.aria': 'Mostrar la órbita de {name}',
  'settings.row.trajectory.aria': 'Mostrar la trayectoria de {name}',
  'settings.group.name.aria': 'Mostrar todas las etiquetas: {group}',
  'settings.group.body.aria': 'Mostrar todos los objetos: {group}',
  'settings.group.orbit.aria': 'Mostrar todas las órbitas: {group}',
  'settings.exposure': 'Brillo (exposición)',
  'settings.colorblind': 'Colores de órbita adaptados al daltonismo',
  'settings.gazetteer': 'Nombres de las formaciones (UAI)',
  'settings.surfaceImagery':
    'Transmitir la imagen de superficie de alta resolución',
  'surface.imagery.headline': '{title} a {resolution}/píxel',
  'surface.imagery.acquired': 'imágenes de {from} a {to}',
  'surface.imagery.oversampled':
    'mostrada {factor} veces más grande que el mosaico publicado ({published} px/grado)',
  'surface.relief.headline': 'Relieve {title} a {resolution}/píxel',
  'surface.relief.area': 'área nombrada {name}',
  'surface.relief.acquired': 'altimetría de {from} a {to}',
  'settings.units': 'Unidades imperiales (mi, °F)',

  // ── Champ d'astéroïdes et de comètes, section des Réglages ──
  'smallBodies.title': 'Campo de asteroides y cometas',
  'smallBodies.exploOnly':
    'Dibujado en modo Exploración, un punto por órbita conocida.',
  'smallBodies.mainBelt': 'Cinturón principal',
  'smallBodies.neo': 'Objetos cercanos a la Tierra',
  'smallBodies.comet': 'Cometas',
  'smallBodies.tno': 'Objetos transneptunianos',
  'smallBodies.source':
    '{count} objetos, JPL Small-Body Database, muestra del {date}.',
  'smallBodies.sourceStale':
    '{count} objetos, JPL Small-Body Database, muestra del {date}. Esta muestra tiene {months} meses: pueden faltar las órbitas refinadas desde entonces y los objetos catalogados desde entonces.',

  // ── Couches météo ──
  'weather.title': 'Capas meteorológicas',
  'weather.trigger.aria': 'Capas meteorológicas',
  'weather.dialog.aria': 'Capas meteorológicas',
  'weather.clouds': 'Nubes (NASA)',
  'weather.cloudsModel': 'Nubes (Open-Meteo)',
  'weather.precip': 'Lluvia (NASA IMERG)',
  'weather.precipModel': 'Lluvia (Open-Meteo)',
  'weather.wind': 'Viento',
  'weather.thermal': 'Temperatura del aire (MERRA-2)',
  'weather.thermalModel': 'Temperatura del aire (Open-Meteo)',
  'weather.clouds.note':
    'Cobertura nubosa real, imagen de satélite de la NASA (imagen del día).',
  'weather.cloudsModel.note':
    'Cobertura nubosa modelizada (Open-Meteo): mundial sin huecos, admite pasado y previsión; elíjala para el directo y el viaje en el tiempo.',
  'weather.precip.note':
    'Lluvia observada NASA IMERG V07: se conserva su máscara alfa nativa; no se añade ninguna extrapolación polar.',
  'weather.precip.legendLo': 'Débil',
  'weather.precip.legendHi': 'Intensa',
  'weather.precipModel.note':
    'Lluvia modelizada (Open-Meteo): mundial sin huecos, pasado + previsión. Las zonas secas quedan transparentes.',
  'weather.precipModel.lo': '0 mm/h',
  'weather.precipModel.hi': '20+ mm/h',
  'weather.thermalModel.note':
    'Temperatura del aire a 2 m modelizada (Open-Meteo): mundial sin huecos, pasado (ERA5) + previsión.',
  'weather.thermalModel.lo': '−40 °C',
  'weather.thermalModel.hi': '+45 °C',
  'weather.pressureModel': 'Presión al nivel del mar (Open-Meteo)',
  'weather.pressureModel.note':
    'Presión al nivel del mar mostrada como isobaras suaves en hPa.',
  'weather.pressureModel.lo': '960 hPa',
  'weather.pressureModel.hi': '1060 hPa',
  'weather.humidityModel': 'Humedad relativa (Open-Meteo)',
  'weather.humidityModel.note':
    'Humedad relativa a 2 m de Open-Meteo, en porcentaje.',
  'weather.humidityModel.lo': '0 %',
  'weather.humidityModel.hi': '100 %',
  'weather.source.prefix': 'Fuente:',
  'weather.source.approx': 'la fecha más cercana',
  'weather.loading': 'Cargando…',
  // Couche des événements terrestres (voir ui/earthEvents.ts).
  'earthEvents.title': 'Eventos terrestres',
  'earthEvents.dialog.aria': 'Eventos terrestres',
  'earthEvents.trigger.aria': 'Eventos terrestres',
  'earthEvents.quakes.label': 'Terremotos (USGS)',
  'earthEvents.quakes.note':
    'Soluciones de origen de magnitud {magnitude} y superior en los {days} días anteriores a la fecha de la escena, medidas por redes de sismómetros. Ningún terremoto existe en el futuro: una escena posterior recibe la última ventana real, y la diferencia se indica debajo.',
  'earthEvents.natural.label': 'Eventos naturales (NASA EONET)',
  'earthEvents.natural.note':
    'Eventos comunicados, como incendios, volcanes, tormentas, inundaciones y hielo, en los {days} días anteriores a la fecha de la escena. EONET declara que sus metadatos están destinados solo a la visualización y a la información general, y que no deben tomarse como oficiales en cuanto a la extensión espacial o temporal: son informes, no medidas.',
  'earthEvents.empty': 'Ningún evento en esta ventana.',
  'earthEvents.ongoing': 'en curso',
  'earthEvents.loading': 'Cargando…',
  'earthEvents.attribution.prefix': 'Datos de eventos:',
  // Catégorie temporelle d'une donnée affichée (voir core/temporal.ts).
  'time.category.live': 'en directo',
  'time.category.observed': 'observado',
  'time.category.reported': 'comunicado',
  'time.category.reconstructed': 'reconstruido (modelo)',
  'time.category.predicted': 'previsto',
  'time.category.extrapolated': 'extrapolado',
  'time.category.unavailable': 'no disponible',
  'time.confidence.reduced': 'confianza reducida',
  'time.offset.scene': 'escena del {date}',
  // Provenance de la position d'un corps (voir core/positionProvenance.ts).
  'bi.position.label': 'Posición en esta fecha',
  'position.source.horizons': 'efeméride JPL Horizons (precalculada)',
  'position.source.spk': 'núcleo SPK del JPL',
  'position.source.astronomy-engine': 'Astronomy Engine',
  'position.source.kepler': 'elementos orbitales keplerianos',
  'position.error':
    'Diferencia media medida con JPL Horizons: {distance} ({from}–{to})',
  'position.error.none': 'Diferencia con JPL Horizons no medida en esta fecha',
  'weather.wind.note':
    'Flujo del viento (Open-Meteo): el color y la velocidad siguen la fuerza del viento.',
  'weather.thermal.note':
    'Temperatura del aire cerca del suelo (MERRA-2 mensual):',

  // ── Divers ──
  'fullscreen.title': 'Pantalla completa',

  // ── Fiche d'info (bodyInfo) ──
  'bi.live.label': 'Distancia desde usted',
  'bi.more': 'Saber más',
  'bi.modelCredit': 'Modelo de forma 3D',
  'bi.colourCredit': 'Color de superficie',
  'bi.creditLine': '{label}: {value}',
  'bi.fictional': 'Superficie ilustrativa',
  'bi.fictional.hint':
    'Ninguna sonda ha resuelto esta superficie, así que la textura es ilustrativa, no un mapa científico.',
  // Misiones declaradas sobre un cuerpo (véase core/missions.ts y config/missions.ts).
  'bi.missions.label': 'Misiones',
  'bi.missions.countAtDate': '{count}, de las cuales {active} en esta fecha',
  'bi.missions.countAllAtDate': '{count}, todas en esta fecha',
  'bi.missions.none':
    'Ninguna misión de este archivo declara este cuerpo entre sus objetivos.',
  'bi.missions.span': 'del {from} al {to}',
  'bi.missions.spanOpen': 'desde el {from}, fin no declarado',
  'bi.missions.atDate': 'había comenzado en la fecha de la escena',
  'bi.missions.note':
    'Lo que el archivo del PDS declara para cada misión: el intervalo de sus datos y los cuerpos que toma como objetivos, leído el {date}. Un objetivo declarado no es un registro de observaciones, y el inicio es el del proyecto, no el lanzamiento.',
  // Cf. dict-en para la razón de la palabra « investigaciones ».
  'bi.instruments.label': 'Instrumentos',
  'bi.instruments.investigations': 'Investigaciones en las que figura',
  'bi.instruments.hostEmpty': '(ningún instrumento declarado)',
  'bi.instruments.absent':
    'El archivo del PDS no declara aquí ninguna investigación, y por tanto ningún instrumento.',
  'bi.instruments.absentNote': 'Leído en el archivo del PDS el {date}.',
  'bi.instruments.note':
    'Lo que el archivo del PDS declara que lleva esta sonda, leído el {date}. Cada nombre es el que publica el archivo, y el identificador debajo es su cita.',
  'bi.places.label': 'Formaciones observadas',
  'bi.places.count': '{observed} de {total} con nombre',
  'bi.places.search': 'Formación con nombre',
  'bi.places.hint':
    'Escriba el nombre de una formación para ver qué orbitadores la observaron.',
  'bi.places.unknown': 'Ninguna formación de este cuerpo lleva ese nombre.',
  'bi.places.none':
    'Ninguna huella publicada por el Orbital Data Explorer toca esta formación.',
  'bi.places.unavailable':
    'No se pudieron cargar las observaciones de esta formación.',
  'bi.places.observations': 'Observaciones: {count}, {span}',
  'bi.places.observationsUndated':
    'Observaciones: {count}, fechas no publicadas',
  'bi.places.firstLabel': 'Primera observación (etiqueta PDS)',
  'bi.places.announce': '{name}, instrumentos: {count}',
  'bi.places.uncovered':
    'Solo se encontraron huellas de observaciones, en el Orbital Data Explorer de la NASA, para estos cuerpos: {bodies}. No se encontró ningún servicio público de huellas para este cuerpo.',
  'bi.places.note':
    'Huellas leídas en el Orbital Data Explorer de la NASA (PDS Geosciences Node), productos creados hasta el {date}. No se cuenta un producto cuya huella cubre también el antípoda de la formación, como un mapa global.',
  'stat.radius': 'Radio',
  'stat.meanDistanceSun': 'Distancia media (Sol)',
  'stat.meanDistanceFrom': 'Distancia media ({parent})',
  'stat.mass': 'Masa',
  'stat.gravity': 'Gravedad',
  'stat.meanTemperature': 'Temperatura media',
  'stat.siderealRotation': 'Rotación sidérea',
  'stat.year': 'Año',
  'stat.orbit': 'Órbita',
  'stat.knownMoons': 'Lunas conocidas',
  'stat.axialTilt': 'Inclinación axial',
  'stat.launchDate': 'Fecha de lanzamiento',
  'stat.launchVehicle': 'Lanzador',
  'stat.launchSite': 'Base de lanzamiento',
  'stat.absoluteMagnitude': 'Magnitud absoluta',
  'stat.eccentricity': 'Excentricidad',
  'stat.perihelion': 'Distancia del perihelio',
  'stat.firstObservation': 'Primera observación',
  'stat.unknown': 'Dato no publicado',
  'stat.unsourced': 'Aún sin fuente',
  'stat.unknown.value': 's. d.',
  'bi.sources': 'Fuentes',
  'bi.source': 'fuente',
  'fact.method.measured': 'valor medido',
  'fact.method.derived': 'valor derivado',
  'fact.method.illustrative': 'valor ilustrativo',
  'fact.asOf': 'en {date}',
  'fact.methods.measured': 'Valores medidos',
  'fact.methods.derived': 'Valores derivados',
  'fact.methods.illustrative': 'Valores ilustrativos',
  'fact.accessed': 'consultada el {date}',
  'fact.kind.preprint': 'prepublicación',
  'subtitle.star': 'Estrella del sistema solar',
  'subtitle.moon': 'Satélite natural',
  'subtitle.dwarf': 'Planeta enano',
  'subtitle.asteroid': 'Asteroide',
  'subtitle.comet': 'Cometa',
  'subtitle.spacecraft': 'Sonda espacial',
  'subtitle.interstellar': 'Objeto interestelar',
  'subtitle.planet': 'Planeta',
  'subtitle.planetOrdinal': '{ordinal} planeta desde el Sol',

  // ── Unités & suffixes (fiche) ──
  'unit.light': 'luz',
  'unit.day.short': 'd',
  'unit.hours': 'horas',
  'unit.days': 'días',
  'unit.year.short': 'años',
  'unit.au': 'UA',
  'unit.million': 'millones de',
  'unit.billion': 'mil millones de',

  // ── Précisions de provenance (lot 35) ──
  // Ce que la source mesure exactement quand le libellé de la fiche est plus large, et la
  // raison d'une valeur non sourcée. Ces textes vivaient inlinés en QUATRE langues dans
  // `config/factSources.ts`, donc dans la clôture statique : 6 676 octets de source, 2 828
  // octets gzippés, payés par un visiteur qui n'en lit qu'un quart. Ici, chaque langue ne
  // voyage qu'avec son propre dictionnaire.
  'detail.equatorialRadius1Bar':
    'radio ecuatorial en el nivel de presión de 1 bar',
  'detail.meanGravity1Bar': 'gravedad media en el nivel de presión de 1 bar',
  'detail.equatorialGravity': 'gravedad en el ecuador',
  'detail.temperature1Bar': 'temperatura media en el nivel de presión de 1 bar',
  'detail.effectiveTemperature':
    'temperatura efectiva, 5772 K, convertida a °C',
  'detail.solarRotationAt16Degrees':
    'periodo adoptado a 16° de latitud: el Sol gira más rápido en el ecuador que en los polos',
  'detail.obliquityToEcliptic': 'oblicuidad respecto a la eclíptica',
  'detail.synchronousRotation': 'rotación sincrónica: igual al periodo orbital',
  'detail.massFromGM': 'masa = GM / G, con G de CODATA 2018',
  'detail.gravityFromGM': 'g = GM / R², para una esfera sin rotación',
  'detail.radiusFromDiameter': 'la mitad del diámetro publicado',
  'detail.equatorialRadiusFromDiameter':
    'la mitad del diámetro ecuatorial publicado',
  'detail.volumetricRadiusFromDiameter':
    'la mitad del diámetro equivalente en volumen publicado',
  'detail.itokawaPublishedMass':
    'masa publicada citada en las notas de la base; el GM de 2,1e-9 km³/s² de la base no le corresponde',
  'detail.gravityFromSystemMass':
    'g = G·M / R² con la masa del sistema, para una esfera sin rotación',
  'detail.massFromDensity':
    'masa = densidad publicada × volumen del radio publicado',
  'detail.gravityFromMass': 'g = G·M / R², para una esfera sin rotación',
  'detail.systemMass': 'masa del sistema entero, satélite incluido',
  'detail.obliquityFromPole':
    'ángulo entre el polo de rotación publicado y la normal a la órbita',
  'detail.osculatingSemiMajorAxis':
    'semieje mayor osculador en la época de los elementos',
  'detail.keplerPeriod':
    'tercera ley de Kepler aplicada al semieje mayor osculador',
  'detail.partialLightcurve':
    'periodo de curva de luz que la fuente señala como basado en una cobertura incompleta',
  'detail.confirmedSatellites':
    'número de satélites confirmados listados por la base',
  'detail.nssdcaFactsInBrief':
    'masa tal como figura en los «Facts in Brief» del catálogo para esta sonda',
  'detail.firstObservationUsed':
    'primera observación utilizada por la solución de órbita publicada',
  'detail.osculatingEccentricity':
    'excentricidad osculadora de la solución de órbita publicada; por encima de 1 la órbita es abierta y el objeto abandona el Sistema Solar',
  'detail.absoluteMagnitudeH':
    'magnitud absoluta H: el brillo que tendría el objeto a 1 UA del Sol y del observador, con un ángulo de fase nulo',
  'detail.perihelionFromElements':
    'q = a (1 − e), según los elementos osculadores publicados',
  'fact.notYetSourced':
    'Galaxy aún no ha vinculado este valor a una fuente primaria (agencia espacial, UAI, artículo publicado): por eso no se muestra.',
};
