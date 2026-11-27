/** Les phrases des blocs hors démarrage, cf. `./dict-card-en.ts` (lot 52, piste C). */
import type { CardMessageKey } from './dict-card-en';

export const cardEs: Record<CardMessageKey, string> = {
  'search.group.dataset': 'Capas de datos',
  'search.group.place': 'Lugares',
  'search.group.mission': 'Misiones',
  'search.group.instrument': 'Instrumentos',
  'search.group.discovery': 'Descubrimientos',
  'search.group.flyby': 'Sobrevuelos',
  'search.group.orbitInsertion': 'Inserciones en órbita',
  'search.group.perihelion': 'Perihelios',
  'search.group.perijove': 'Perijoves',
  'deep.card.designation': 'Designación',
  'deep.card.messier': 'Messier',
  'deep.card.constellation': 'Constelación',
  'deep.card.ra': 'Ascensión recta (J2000)',
  'deep.card.dec': 'Declinación (J2000)',
  'deep.card.vmag': 'Magnitud visual',
  'deep.card.size': 'Tamaño aparente',
  'deep.card.unknown': 'no publicado',
  'deep.card.source':
    'OpenNGC, leído el {date}, licencia {license}. Solo se sitúa en el cielo la dirección del objeto: el catálogo no da ninguna distancia utilizable, así que no se dibuja ni se muestra ninguna.',
  'deep.card.opened': 'Objeto del cielo profundo {name}',
  'deep.unit.arcmin': '{v} minutos de arco',
  'deep.search.label': 'Buscar un objeto del cielo profundo',
  'deep.search.placeholder': 'M 31, NGC 224, Andrómeda',
  'deep.type.G': 'Galaxia',
  'deep.type.OCl': 'Cúmulo abierto',
  'deep.type.ClN': 'Cúmulo con nebulosidad',
  'deep.type.GCl': 'Cúmulo globular',
  'deep.type.Neb': 'Nebulosa',
  'deep.type.HII': 'Región H II',
  'deep.type.PN': 'Nebulosa planetaria',
  'deep.type.RfN': 'Nebulosa de reflexión',
  'deep.type.SNR': 'Remanente de supernova',
  'nb.card.kind': 'Estrella cercana al Sol',
  'nb.card.members': 'Estrellas de este sistema',
  'nb.card.distance': 'Distancia al Sol',
  'nb.card.distanceValue': '{ly} años luz',
  'nb.card.distanceError': '{ly} ± {err} años luz',
  'nb.card.au': 'En unidades astronómicas',
  'nb.card.auValue': '{au} UA',
  'nb.card.scale': 'Si la Tierra estuviera a 1 cm del Sol',
  'nb.card.scaleValue': 'a {km} km',
  'nb.card.light': 'Su luz tarda',
  'nb.card.lightValue': '{years} años en llegar hasta nosotros',
  'nb.card.motion': 'Movimiento propio',
  'nb.card.motionValue': '{v} segundos de arco por año',
  'nb.card.rv': 'Velocidad radial',
  'nb.card.rvApproaching': '{v} km/s, se acerca',
  'nb.card.rvReceding': '{v} km/s, se aleja',
  'nb.card.spectral': 'Tipo espectral',
  'nb.card.vmag': 'Magnitud visual',
  'nb.card.unknown': 'no publicada',
  'nb.card.origin.gaia': 'Distancia y movimiento: Gaia DR3, fuente {id}.',
  'nb.card.origin.hyg':
    'Distancia y movimiento: HYG v4.4 (Hipparcos y Gliese); no se publica ninguna incertidumbre.',
  'nb.card.hint':
    'El marcador muestra la dirección real de la estrella. La estrella no se dibuja a su distancia: la escena termina en el Sistema Solar.',
  'nb.card.source':
    'Fuentes: Gaia DR3 (ESA, {gaiaLicense}) y HYG v4.4 ({hygLicense}), dos archivos distintos, cada uno con su licencia. Las posiciones son las de J2000,0; el marcador sigue el movimiento propio hasta la fecha de la escena.',
  'nb.card.source.hygOnly':
    'Fuente: HYG v4.4 ({hygLicense}); no se pudo leer el archivo de Gaia DR3. Las posiciones son las de J2000,0; el marcador sigue el movimiento propio hasta la fecha de la escena.',
  'nb.card.opened': 'Estrella cercana {name}',
  'nb.unit.ly': 'al',
  'nb.search.label': 'Buscar una estrella cercana',
  'nb.search.placeholder': 'Próxima, Sirio, Barnard',
  'st.title': 'Vecindad solar en 3D',
  'st.back': 'Volver al Sistema Solar',
  'st.reset': 'Recentrar la vista',
  'st.open': 'Ver en la vecindad solar',
  'st.scale':
    '1 unidad = 1 pársec = 3,26 años luz. Un círculo por pársec alrededor del Sol, en el plano galáctico.',
  'st.ring': '{pc} pc · {ly} al',
  'st.sun': 'Sol',
  'st.centre': 'Centro galáctico (dirección)',
  'st.symbolic':
    'Los puntos son símbolos de tamaño constante: no se dibuja el tamaño real de una estrella. El color sigue el tipo espectral.',
  'st.frame':
    'Sistema galáctico: x hacia el centro galáctico, z hacia el polo norte galáctico. Las posiciones son las de la fecha de la escena, desplazadas en línea recta desde los valores del catálogo en J2000.',
  'st.help':
    'Arrastra para girar, rueda o pellizco para acercar, clic derecho o dos dedos para mover. Teclado: las flechas giran, más y menos acercan, Inicio recentra, Escape vuelve.',
  'st.list': 'Estrellas de la vecindad',
  'st.listItem': '{name}, {ly} años luz',
  'st.selected': 'Estrella elegida',
  'st.noSelection': 'Elige una estrella para ver su distancia y su posición.',
  'st.distSun': 'Distancia al Sol (publicada)',
  'st.distAtDate': 'Distancia al Sol en esta fecha',
  'st.position': 'Posición (x, y, z)',
  'st.positionValue': '{x} ; {y} ; {z} pc',
  'st.timeLabel': 'Años desde la fecha de la escena',
  'st.timeNow': 'La fecha de la escena',
  'st.timeValue': '{years} años, año {year}',
  'st.timeLimit':
    'Movimiento rectilíneo, limitado a 10 000 años a cada lado de J2000: más allá la aproximación no es defendible.',
  'st.noRadial':
    'No se publica velocidad radial para esta estrella: no se incluye su acercamiento o alejamiento del Sol.',
  'st.opened':
    'Vecindad solar en 3D. {n} sistemas de estrellas alrededor del Sol.',
  'st.closed': 'De vuelta al Sistema Solar.',
  'st.selectedAnnounce': '{name}, a {ly} años luz del Sol.',
  'st.unavailable':
    'La vista 3D no está disponible: el contexto gráfico no responde.',
  'st.unknownStar':
    'El enlace indica una estrella que no está entre las estrellas cercanas. La vista se abre sin estrella seleccionada.',
  'st.dataUnavailable':
    'La vista 3D no está disponible: no se pudo leer el archivo de estrellas cercanas.',
  'st.fieldAu': 'Ancho del campo a la altura del Sol: {au} UA',
  'st.fieldLy': 'Ancho del campo a la altura del Sol: {ly} al ({pc} pc)',
  'st.ringAu': '{au} UA',
  'st.stageAu':
    'En el Sistema Solar: la unidad es la unidad astronómica (UA), la distancia media Tierra-Sol, {km} millones de km. Círculos naranjas: 1, 10, 100… UA, en el plano de los planetas.',
  'st.stageLy':
    'Entre las estrellas: la unidad es el año luz (1 parsec = {ly} años luz = {au} UA). Círculos azules: uno por parsec, en el plano galáctico.',
  'st.stageNote':
    'Un cambio de escala, no un viaje: el Sol permanece en el centro y solo se ensancha el campo, en un único sistema galáctico. No se supone ninguna velocidad.',
  'st.skip': 'Omitir la transición',
  'sv.visit.start': 'Visita guiada',
  'sv.visit.region': 'Visita guiada de las vecinas del Sol',
  'sv.visit.progress': 'Parada {n} de {total}',
  'sv.visit.prev': 'Parada anterior',
  'sv.visit.next': 'Parada siguiente',
  'sv.visit.finish': 'Terminar la visita',
  'sv.visit.leave': 'Salir de la visita y explorar libremente',
  'sv.visit.resume': 'Reanudar la visita (parada {n} de {total})',
  'sv.visit.end': 'Terminar la visita',
  'sv.visit.paused':
    'La visita está en pausa. Las estrellas, el control de tiempo y la cámara son suyos.',
  'sv.visit.data': 'Esta estrella en los datos',
  'sv.visit.fact.pm': 'Movimiento propio',
  'sv.visit.fact.pmValue': '{pm} mas/año',
  'sv.visit.fact.rv': 'Velocidad radial',
  'sv.visit.fact.rvValue': '{rv} km/s',
  'sv.visit.fact.planets': 'Planetas listados por el archivo',
  'sv.visit.fact.none': 'ninguno',
  'sv.visit.reading': 'Cómo leer esta parada',
  'sv.visit.reading.measured':
    'Medido: la posición, el movimiento propio, la velocidad radial y el tipo espectral (Gaia DR3, o HYG donde Gaia no es seguro).',
  'sv.visit.reading.catalogued':
    'Catalogado: los planetas del NASA Exoplanet Archive (instantánea del {date}), con el estado que el archivo les da.',
  'sv.visit.reading.calculated':
    'Calculado: la posición en otro año, a partir de un movimiento rectilíneo. No es una medición.',
  'sv.visit.reading.illustrative':
    'Ilustrativo: los puntos son símbolos. No se dibuja ningún planeta, textura ni superficie.',
  'sv.visit.reading.unknown':
    'Desconocido aquí: el radio, la masa y la edad de estas estrellas no están en los datos de esta vista.',
  'sv.visit.approaching': 'se acerca al Sol',
  'sv.visit.receding': 'se aleja del Sol',
  'sv.visit.unknown': 'Esa visita guiada no existe: la vista se abre sin ella.',
  'sv.visit.opened': 'Visita guiada iniciada. Parada {n} de {total}: {title}.',
  'sv.visit.stop': 'Parada {n} de {total}: {title}.',
  'sv.visit.left': 'Visita en pausa. Puede explorar libremente.',
  'sv.visit.finished': 'Visita terminada. Puede seguir explorando.',
  'sv.visit.noArchive':
    'No se pudo leer el archivo de exoplanetas: no se muestra el número de planetas.',
  'sv.visit.archive.none':
    'El NASA Exoplanet Archive no lista ningún planeta para esta estrella.',
  'sv.visit.archive.one':
    'El NASA Exoplanet Archive lista {n} planeta para esta estrella, con el estado que el archivo le da.',
  'sv.visit.archive.many':
    'El NASA Exoplanet Archive lista {n} planetas para esta estrella, con el estado que el archivo les da.',
  'sv.visit.archive.loading':
    'El número de planetas del NASA Exoplanet Archive aún se está cargando.',
  'sv.visit.archive.unavailable':
    'No se pudo leer el NASA Exoplanet Archive: aquí no se da ningún número de planetas, y un número ausente no significa cero planetas.',
  'st.transitionStart':
    'Cambio de escala: del Sistema Solar, en unidades astronómicas, al vecindario, en años luz.',
  'exo.card.unknown': 'no publicado',
  'exo.card.period': 'Período orbital',
  'exo.card.radius': 'Radio',
  'exo.card.axis': 'Semieje mayor',
  'exo.card.year': 'Descubrimiento',
  'exo.card.method': 'Método',
  'exo.card.planets.one': '{count} planeta conocido',
  'exo.card.planets.other': '{count} planetas conocidos',
  'exo.card.distance': 'a {ly} años luz',
  'exo.card.distanceUnknown': 'Distancia no publicada',
  'exo.card.source':
    'NASA Exoplanet Archive, leído el {date}. Los planetas no se dibujan: solo se sitúa su estrella anfitriona en el cielo. Para un planeta hallado por velocidad radial, el radio suele calcularlo el archivo a partir de la masa, no medirse.',
  'exo.card.opened': 'Sistema {name}, {count} planetas conocidos',
  'exo.unit.days': '{v} días',
  'exo.unit.earthRadii': '{v} radios terrestres',
  'exo.unit.au': '{v} UA',
  'exo.search.label': 'Buscar un sistema planetario',
  'exo.search.placeholder': 'Nombre de la estrella anfitriona',
  'exo.method.transit': 'Tránsito',
  'exo.method.radialVelocity': 'Velocidad radial',
  'exo.method.imaging': 'Imagen directa',
  'exo.method.microlensing': 'Microlente',
  'exo.method.transitTiming': 'Variaciones de los tiempos de tránsito',
  'exo.method.eclipseTiming': 'Variaciones de los tiempos de eclipse',
  'exo.method.orbitalBrightness': 'Modulación orbital del brillo',
  'exo.method.pulsarTiming': 'Cronometraje de púlsar',
  'exo.method.pulsationTiming': 'Variaciones de los tiempos de pulsación',
  'exo.method.astrometry': 'Astrometría',
  'exo.method.diskKinematics': 'Cinemática del disco',
  'search.group.contact': 'Contactos',
  'search.missionPage': 'página de la misión',
  'surface.compare.slider': 'Cortina antes y después',
  'surface.compare.valuetext':
    '{before} a la izquierda de la línea, {after} a la derecha, línea al {percent} % del ancho',
  'bi.discovery.according': '{source}, leído el {date}',
  'bi.discovery.prehistoric': 'Desde la prehistoria',
  'bi.discovery.ancient': 'Desde la Antigüedad',
  'bi.discovery.ancientObservations':
    'Observaciones antiguas de hace más de dos mil años',
  'bi.discovery.predictedReturn': 'Retorno predicho, observado el {date}',
  'bi.discovery.notYetKnown':
    'En la fecha de la escena, este cuerpo aún no se conocía.',
  'bi.discovery.known': 'En la fecha de la escena, este cuerpo ya se conocía.',
  'bi.discovery.onTheDay':
    'La fecha de la escena es el día de su descubrimiento.',
  'bi.discovery.withinYear':
    'La fecha de la escena cae en el año de su descubrimiento, y la fuente no indica el día.',
  'bi.discovery.withinDates':
    'La fecha de la escena cae entre las fechas publicadas: la respuesta depende de la fuente.',
  'bi.discovery.moonsKnown':
    'Lunas ya vistas en esta fecha: {count} de las {total} que el JPL registra hoy',
  'bi.discovery.moonsKnownRange':
    'Lunas ya vistas en esta fecha: entre {min} y {max} de las {total} que el JPL registra hoy',
  'bi.discovery.moonsKnownOne':
    'Lunas ya vistas en esta fecha: {count} de la única que el JPL registra hoy',
  'bi.discovery.moonsKnownRangeOne':
    'Lunas ya vistas en esta fecha: entre {min} y {max} de la única que el JPL registra hoy',
  'bi.discovery.moonsNext': 'Siguiente descubrimiento: {year} ({names})',
  'bi.discovery.moonsMore': '{names} y {count} más',
  'bi.discovery.moonsNote':
    'Este recuento solo incluye las lunas que la tabla del JPL registra hoy, leída el {date}: una luna anunciada y luego refutada no figura en ella, así que no es lo que se creía en su momento.',
  'bi.discovery.moonsNoteSbdb':
    'Este recuento solo incluye los satélites que la JPL Small-Body Database confirma hoy, leída el {date}: un satélite anunciado y luego refutado no figura en ella, así que no es lo que se creía en su momento.',
  'bi.discovery.moonsUnconfirmed':
    'No contados, porque la base de datos los da como no confirmados: {names}.',
  'bi.discovery.names':
    'Nombres de superficie que la UAI había hecho oficiales en esta fecha: {count} de {total}',
  'bi.discovery.namesRange':
    'Nombres de superficie que la UAI había hecho oficiales en esta fecha: entre {min} y {max} de {total}',
  'bi.discovery.lettered':
    'Designaciones con letra como «Copernicus A» hechas oficiales en esta fecha: {count} de {total}',
  'bi.discovery.letteredRange':
    'Designaciones con letra como «Copernicus A» hechas oficiales en esta fecha: entre {min} y {max} de {total}',
  'bi.discovery.namesNext': 'Siguiente adopción: {date}, {count} más',
  'bi.discovery.namesNote':
    'Fechas de adopción del Gazetteer of Planetary Nomenclature de la UAI, leído el {date}: la fecha en que un nombre se hizo oficial, no la fecha en que la formación se vio o se nombró por primera vez.',
  'bi.discovery.refutedThatYear':
    'En {year}, el año de la escena, {who} señala un posible satélite de este cuerpo; la fuente no da el día.',
  'bi.discovery.refutedReported':
    'En esta fecha ya se había señalado un posible satélite de este cuerpo: desde {year} por {who}, y después varias veces por otros observadores, entre ellos {others}.',
  'bi.discovery.refutedSearched':
    'Una búsqueda depositada el {date} no encontró ninguno, hasta unos {radius} de radio.',
  'bi.atmosphere.label': 'Perfil medido (sonda Galileo)',
  'bi.atmosphere.labelNone': 'Perfil medido de la atmósfera',
  'bi.atmosphere.labelTitan': 'Perfil medido (sonda Huygens)',
  'bi.atmosphere.altitudeSurface': 'Sobre el suelo',
  'bi.atmosphere.ground': 'Suelo',
  'bi.atmosphere.localTitan':
    'Un solo lugar de Titán, latitud {min}° a {max}°, atravesado el {date} en el descenso. La última fila es la primera lectura a nivel del suelo; las lecturas siguientes van de {low} a {high} K.',
  'bi.atmosphere.site': 'Latitud leída en: {title}, DOI {doi}.',
  'bi.atmosphere.altitude': 'Sobre 1 bar',
  'bi.atmosphere.pressure': 'Presión',
  'bi.atmosphere.temperature': 'Temperatura',
  'bi.atmosphere.local':
    'Un solo punto del globo, latitud {min}° a {max}°, atravesado el {date}. El artículo del equipo lo sitúa en el borde de una mancha caliente a 5 µm del cinturón ecuatorial norte.',
  'bi.atmosphere.adjusted':
    'A partir de {altitude}, el equipo ajustó la adiabática seca a los datos: esas filas no son puntos medidos.',
  'bi.atmosphere.citation':
    '{authors} ({year}), {title}, NASA Planetary Data System, DOI {doi}. {reference} Leído el {date}.',
  'bi.atmosphere.absent':
    'Ningún perfil de temperatura y presión de la baja atmósfera se publica como datos en el Planetary Data System de la NASA para este planeta: {count} colecciones leídas el {date}, ninguna lo es.',
  'bi.missions.countAtDate': '{count}, de las cuales {active} en esta fecha',
  'bi.missions.countAllAtDate': '{count}, todas en esta fecha',
  'bi.missions.none':
    'Ninguna misión de este archivo declara este cuerpo entre sus objetivos.',
  'bi.missions.span': 'del {from} al {to}',
  'bi.missions.spanUndeclared': 'fechas no declaradas',
  'bi.missions.spanEndOnly': 'hasta el {to}, inicio no declarado',
  'bi.missions.spanOpen': 'desde el {from}, fin no declarado',
  'bi.missions.atDate': 'había comenzado en la fecha de la escena',
  'bi.missions.note':
    'Lo que el archivo del PDS declara para cada misión: el intervalo de sus datos y los cuerpos que toma como objetivos, leído el {date}. Un objetivo declarado no es un registro de observaciones, y el inicio es el del proyecto, no el lanzamiento.',
  'bi.instruments.investigations': 'Investigaciones en las que figura',
  'bi.instruments.hostEmpty': '(ningún instrumento declarado)',
  'bi.instruments.absent':
    'El archivo del PDS no declara aquí ninguna investigación, y por tanto ningún instrumento.',
  'bi.instruments.absentNote': 'Leído en el archivo del PDS el {date}.',
  'bi.instruments.note':
    'Lo que el archivo del PDS declara que lleva esta sonda, leído el {date}. Cada nombre es el que publica el archivo, y el identificador debajo es su cita.',
  'place.marker.hint':
    'Vista orientada hacia este lugar. Acércate para ver los nombres de la superficie.',
  'place.marker.announce':
    '{place}, {body}: la vista está orientada hacia este lugar. Acércate para ver los nombres de la superficie.',
  'bi.places.count':
    '{observed} observadas de {evaluated} evaluadas en el conjunto ODE publicado.',
  'bi.places.countNamed': '{named} con nombre en el catálogo de la UAI.',
  'bi.places.search': 'Formación con nombre',
  'bi.places.hint':
    'Escriba el nombre de una formación para ver qué orbitadores la observaron.',
  'bi.places.unknown': 'Ninguna formación de este cuerpo lleva ese nombre.',
  'bi.places.none':
    'Ninguna huella publicada por el Orbital Data Explorer toca esta formación.',
  'bi.places.notEvaluated':
    'Esta formación no se evaluó en el conjunto de datos ODE publicado actualmente.',
  'bi.places.unavailable':
    'No se pudieron cargar las observaciones de esta formación.',
  'bi.places.observations': 'Observaciones: {count}, {span}',
  'bi.places.observationsUndated':
    'Observaciones: {count}, fechas no publicadas',
  'bi.places.firstLabel': 'Primera observación (etiqueta PDS)',
  'bi.places.announce': '{name}, instrumentos: {count}',
  'bi.places.uncovered':
    'Solo se encontraron huellas de observaciones, en el Orbital Data Explorer de la NASA, para estos cuerpos: {bodies}. No se encontró ningún servicio público de huellas para este cuerpo.',
  'bi.cities.label': 'Ciudades en 3D',
  'bi.cities.hint':
    'Ciudades cuyos edificios se dibujan en 3D al acercarse. Elija una para sumergirse en ella.',
  'bi.cities.go': 'Sumergirse en {city}',
  'bi.cities.diving': 'Descendiendo a {city}',
  'bi.cities.name.lyon-bdtopo': 'Lyon',
  'bi.cities.name.marseille-bdtopo': 'Marsella',
  'bi.cities.name.toulouse-bdtopo': 'Toulouse',
  'bi.cities.name.nice-bdtopo': 'Niza',
  'bi.cities.name.bordeaux-bdtopo': 'Burdeos',
  'bi.cities.name.lille-bdtopo': 'Lila',
  'bi.cities.name.nantes-bdtopo': 'Nantes',
  'bi.cities.name.strasbourg-bdtopo': 'Estrasburgo',
  'bi.cities.name.montpellier-bdtopo': 'Montpellier',
  'bi.cities.name.rennes-bdtopo': 'Rennes',
  'bi.cities.name.grenoble-bdtopo': 'Grenoble',
  'bi.cities.name.toulon-bdtopo': 'Tolón',
  'bi.cities.name.dijon-bdtopo': 'Dijon',
  'bi.cities.name.angers-bdtopo': 'Angers',
  'bi.cities.name.reims-bdtopo': 'Reims',
  'bi.cities.name.nimes-bdtopo': 'Nimes',
  'bi.cities.name.saintetienne-bdtopo': 'Saint-Étienne',
  'bi.cities.name.newyork-opendata': 'Nueva York',
  'bi.cities.name.london-overture': 'Londres',
  'bi.cities.name.amsterdam-3dbag': 'Ámsterdam',
  'bi.cities.name.rotterdam-3dbag': 'Róterdam',
  'bi.cities.name.denhaag-3dbag': 'La Haya',
  'bi.cities.name.utrecht-3dbag': 'Utrecht',
  'bi.cities.name.eindhoven-3dbag': 'Eindhoven',
  'bi.cities.name.chicago-overture': 'Chicago',
  'bi.cities.name.singapore-overture': 'Singapur',
  'bi.cities.name.sydney-overture': 'Sídney',
  'bi.cities.name.paris-bdtopo': 'París',
  'bi.cities.name.berlin-lod2': 'Berlín',
  'bi.cities.name.nairobi-overture': 'Nairobi',
  'bi.places.note':
    'Huellas leídas en el Orbital Data Explorer de la NASA (PDS Geosciences Node), productos creados hasta el {date}. No se cuenta un producto cuya huella cubre también el antípoda de la formación, como un mapa global.',
  'inspect.title': 'El tiempo en un punto',
  'inspect.hint.pick':
    'Haz clic o toca el globo, o introduce coordenadas, para leer las capas activas.',
  'inspect.hint.noLayers':
    'No hay ninguna capa inspeccionable activa. Activa una capa de modelo (temperatura, presión, humedad, lluvia, nubes o viento) en el panel meteorológico. El inspector nunca activa una por ti.',
  'inspect.hint.images':
    'Las capas de satélite y de NASA GIBS son imágenes: aquí no se leen.',
  'inspect.lat': 'Latitud',
  'inspect.lon': 'Longitud',
  'inspect.go': 'Leer este punto',
  'inspect.center': 'Usar el centro de la vista',
  'inspect.offGlobe': 'El centro de la vista no está sobre el globo.',
  'inspect.badCoords':
    'Introduce una latitud de −90 a 90 y una longitud de −180 a 180.',
  'inspect.details': 'Fuente y fecha',
  'inspect.expand': 'Mostrar la ficha completa',
  'inspect.collapse': 'Mostrar menos',
  'inspect.about': 'Sobre estos valores',
  'inspect.summary': 'Lecturas en este punto',
  'inspect.caveat':
    'Los valores se interpolan a partir de una malla de modelo. No son una medición en este punto exacto.',
  'inspect.selected': 'Punto elegido: {lat}, {lon}.',
  'inspect.var.temperature': 'Temperatura (2 m)',
  'inspect.var.pressure': 'Presión a nivel del mar',
  'inspect.var.humidity': 'Humedad relativa',
  'inspect.var.precipitation': 'Precipitación',
  'inspect.var.cloudCover': 'Nubosidad (modelo)',
  'inspect.var.wind': 'Viento (10 m)',
  'inspect.msg.missing': 'El modelo no da ningún valor en este punto.',
  'inspect.msg.outOfCoverage': 'Fuera de la cobertura de la malla.',
  'inspect.msg.stale':
    'Desactualizado: la malla cargada es de otra hora, así que no se muestra ningún valor.',
  'inspect.msg.staleError':
    'La actualización falló. La malla cargada es de otra hora, así que no se muestra ningún valor.',
  'inspect.msg.updating': 'Actualizando para la nueva fecha…',
  'inspect.msg.outOfRange': 'Esta fecha está fuera del rango del modelo.',
  'inspect.msg.error': 'No se pudieron cargar los datos.',
  'inspect.msg.loading': 'Cargando…',
  'inspect.wind.calm': 'Calma: sin dirección significativa',
  'inspect.wind.from': 'Procedencia: {dir} · {deg}°',
  'inspect.dir.N': 'N',
  'inspect.dir.NE': 'NE',
  'inspect.dir.E': 'E',
  'inspect.dir.SE': 'SE',
  'inspect.dir.S': 'S',
  'inspect.dir.SW': 'SO',
  'inspect.dir.W': 'O',
  'inspect.dir.NW': 'NO',
  'inspect.precip.rate': 'Tasa instantánea (GFS)',
  'inspect.precip.accumulation': 'Acumulada en la hora anterior',
  'inspect.precip.none': 'Sin precipitación',
  'inspect.meta.source': 'Fuente',
  'inspect.meta.nature': 'Naturaleza',
  'inspect.meta.effective': 'Válido para',
  'inspect.meta.requested': 'Hora pedida',
  'inspect.meta.offset': '{h} h respecto a la hora pedida',
  'inspect.meta.grid': 'Malla',
  'inspect.meta.gridValue': 'malla de {step}°, interpolada',
  'craft.button': 'Inspeccionar en 3D',
  'craft.issButton': 'Inspeccionar la ISS en 3D',
  'craft.noModel':
    'No hay aquí un modelo 3D fiable de esta sonda: no se dibuja nada en lugar de una forma inventada.',
  'craft.title': '{name}: inspección en 3D',
  'craft.close': 'Cerrar la inspección',
  'craft.reset': 'Restablecer la vista',
  'craft.loading': 'Cargando el modelo 3D…',
  'craft.failed': 'No se pudo cargar el modelo 3D. La escena no ha cambiado.',
  'craft.unavailable':
    'La inspección en 3D no está disponible: el contexto gráfico no responde.',
  'craft.help':
    'Arrastre o use las flechas para girar el modelo. Rueda, pellizco o teclas + y - para hacer zoom. Inicio restablece la vista, Escape la cierra.',
  'craft.scale':
    'Escala de presentación: aquí la nave se muestra ampliada para poder inspeccionarla. En la escena astronómica nunca se amplía.',
  'craft.fidelity':
    'Modelo representativo de la colección 3D Resources de la NASA. Sus proporciones y detalles son los del archivo: este proyecto no los ha comprobado con planos de ingeniería.',
  'craft.rights':
    'La NASA indica que el contenido usado para representar modelos 3D en general no está sujeto a derechos de autor en Estados Unidos (NASA Images and Media Usage Guidelines, leído el 2026-11-23). No se sugiere ningún respaldo de la NASA.',
  'craft.parts': 'Piezas con nombre en el archivo',
  'craft.partsNone':
    'Este modelo es un solo bloque: su archivo no nombra piezas separadas.',
  'craft.instruments': 'Instrumentos declarados en el archivo del PDS',
  'craft.instrumentsNote':
    'La lista procede del registro de contexto del PDS, no del modelo 3D: el modelo no indica dónde está cada instrumento.',
  'craft.provenance': 'Procedencia',
  'craft.source': 'Archivo de origen',
  'craft.credit': 'Crédito: {credit}',
  'craft.file': '{kb} KB, {tris} triángulos, SHA-256 {hash}…',
  'craft.opened': 'Inspeccionando {name} en 3D.',
  'craft.closed': 'De vuelta a la vista anterior.',
  'craft.partOn': '{part} resaltada.',
  'craft.partOff': 'Resaltado retirado.',
  'sat.kind': 'Objeto en órbita',
  'sat.group.stations': 'Grupo: estaciones espaciales',
  'sat.group.visual': 'Grupo: objetos más brillantes',
  'sat.unknown': 'no publicado',
  'sat.norad': 'Número de catálogo NORAD',
  'sat.designator': 'Designación internacional (COSPAR)',
  'sat.period': 'Período orbital',
  'sat.minutes': '{n} min',
  'sat.altitudes': 'Altitud, del perigeo al apogeo',
  'sat.altitudesValue': '{perigee} a {apogee} km',
  'sat.inclination': 'Inclinación',
  'sat.eccentricity': 'Excentricidad',
  'sat.epoch': 'Época de los elementos',
  'sat.validity': 'Elementos válidos',
  'sat.validityValue': 'del {from} al {to}',
  'sat.altitude': 'Altitud ahora (SGP4)',
  'sat.km': '{n} km',
  'sat.speed': 'Velocidad ahora (SGP4)',
  'sat.kmPerS': '{n} km/s',
  'sat.over': 'Sobre (SGP4)',
  'sat.outside':
    'En la fecha de la escena estos elementos están fuera de su validez: el objeto no se dibuja en lugar de dibujarse en el lugar equivocado.',
  'sat.model.iss':
    'La ISS tiene un modelo 3D (NASA 3D Resources). Solo se amplía en la inspección; en el espacio sigue siendo un punto.',
  'sat.model.none':
    'No hay modelo 3D de este objeto: sigue siendo un punto en lugar de una forma inventada.',
  'sat.source':
    'Elementos de CelesTrak (18th Space Defense Squadron), leídos el {date} UTC por el servicio de datos de Galaxy y propagados con SGP4. El error crece unos kilómetros por día en torno a la época. Altitud, velocidad y posición se calculan, no se miden.',
  'sat.opened': '{name}: ficha del satélite abierta.',
  'sat.search.label': 'Buscar un satélite',
  'sat.search.placeholder': 'Escriba un nombre, por ejemplo ISS',
  'sat.follow': 'Seguir este objeto',
  'sat.unfollow': 'Dejar de seguir',
  'sat.following':
    '{name}: la cámara sigue el objeto. Gire, acerque o deje de seguir en cualquier momento.',
  'sat.followChip': 'Siguiendo {name}',
  'sat.followEnded': '{name}: seguimiento detenido.',
  'sat.followEndedOutside':
    '{name}: seguimiento detenido, los elementos no son válidos en esta fecha.',
  'sat.followEndedNoSolution':
    '{name}: seguimiento detenido, SGP4 no tiene posición para esta fecha.',
  'sat.path':
    'Trazado de la órbita: un periodo por delante de la fecha de la escena, calculado por SGP4 a partir de los elementos. No es una medición, y no se dibuja ningún trazado del pasado. Las flechas indican el sentido del movimiento.',
  'sat.pathTruncated':
    'El trazado se detiene donde los elementos dejan de ser válidos.',
  'sx.open': 'Explorar este sistema',
  'sx.unavailable': 'No se pudo cargar la exploración del sistema.',
  'sx.title': 'El sistema {name}',
  'sx.back': 'Volver a la vecindad',
  'sx.reset': 'Todo el sistema',
  'sx.compare': 'Comparar con el Sistema Solar',
  'sx.scale':
    'Una unidad es una unidad astronómica (la distancia Tierra-Sol). Las órbitas se dibujan de frente.',
  'sx.field': 'Campo de visión: {au} UA de ancho',
  'sx.help':
    'Arrastrar para girar, rueda o pellizco para acercar, tocar una estrella o una órbita. Teclado: flechas para girar, + y - para acercar, Inicio para todo el sistema, Escape para volver a la vecindad. La lista da el mismo acceso.',
  'sx.list': 'En este sistema',
  'sx.listStar': '{name} (estrella)',
  'sx.listPlanet': '{name} (planeta)',
  'sx.listPlanetNoOrbit': '{name} (planeta, órbita no dibujada)',
  'sx.opened':
    'Sistema {name} abierto: {stars} estrellas en el catálogo, {planets} planetas catalogados.',
  'sx.selected': '{name} seleccionado',
  'sx.closed': 'De vuelta a la vecindad solar.',
  'sx.archiveUnavailable':
    'No se pudo leer el archivo de planetas: solo se muestran las estrellas.',
  'sx.doc.noPlanets':
    'Ninguna órbita que dibujar: el archivo no lista ningún planeta para este sistema (instantánea del {date}). Eso no significa que no tenga.',
  'sx.doc.noAxis':
    'Ninguna órbita que dibujar: sus planetas no tienen semieje mayor ni masa estelar para derivarlo. Sus datos están en la lista.',
  'sx.missingHosts':
    'Reconocidos en la capa del cielo pero ausentes de la instantánea detallada: {hosts}.',
  'sx.star.separation': 'Separación proyectada con {name}',
  'sx.star.separationValue':
    '{au} UA (derivada de las posiciones del catálogo: un mínimo, la distancia a lo largo de la línea de visión es desconocida)',
  'sx.star.teff': 'Temperatura efectiva',
  'sx.star.radius': 'Radio',
  'sx.star.mass': 'Masa',
  'sx.star.noHost': 'Ningún planeta del archivo se atribuye a esta estrella.',
  'sx.star.hostOf':
    'NASA Exoplanet Archive: anfitriona «{host}», {count} planetas catalogados dibujados o listados aquí.',
  'sx.star.trueSize':
    'La estrella se dibuja con su radio publicado; su punto mantiene un tamaño constante en pantalla para encontrarla de lejos.',
  'sx.star.archiveStars':
    'El archivo cuenta {n} estrellas en este sistema; el catálogo de la vecindad agrupa {m} aquí (una compañera a más de un minuto de arco tiene su propio marcador).',
  'sx.planet.star': 'Estrella anfitriona',
  'sx.planet.eccentricity': 'Excentricidad',
  'sx.planet.eccZero': '0 (publicada; a menudo fijada en cero por el ajuste)',
  'sx.planet.eccUnknown':
    'no publicada: la órbita es un círculo discontinuo en su semieje mayor',
  'sx.planet.range': 'Distancia a la estrella',
  'sx.planet.rangeValue': 'de {q} a {Q} UA',
  'sx.planet.inclination': 'Inclinación',
  'sx.planet.mass': 'Masa',
  'sx.planet.noOrbit':
    'Ni semieje mayor ni masa estelar para derivarlo: la órbita no se dibuja.',
  'sx.planet.position':
    'No se sabe dónde está el planeta en su órbita: su nombre marca la órbita, no el planeta.',
  'sx.planet.radiusCalculated':
    'Su radio no se midió: el archivo lo calcula a partir de la masa.',
  'sx.planet.controversial':
    'El archivo señala este planeta como controvertido.',
  'sx.planet.circumbinary':
    'El archivo lo clasifica como circumbinario (en órbita alrededor de dos estrellas).',
  'sx.tag.calculated': 'valor calculado por el archivo',
  'sx.tag.derived': 'valor derivado aquí, tercera ley de Kepler',
  'sx.tag.minimum': 'masa mínima, m sin i',
  'sx.tag.trueMass': 'masa',
  'sx.unit.kelvin': '{v} K',
  'sx.unit.solarRadii': '{v} radios solares',
  'sx.unit.solarMasses': '{v} masas solares',
  'sx.unit.earthMasses': '{v} masas terrestres',
  'sx.unit.degrees': '{v}°',
  'sx.table.title': 'Comparar los planetas',
  'sx.table.planet': 'Planeta',
  'sx.table.caption':
    'Periodo en días, semieje mayor en UA, masa en masas terrestres, radio en radios terrestres. † calculado por el archivo; ‡ derivado aquí (tercera ley de Kepler); ≥ masa mínima (m sin i); un guion: no publicado.',
  'sx.compare.note':
    'Círculos grises discontinuos: las órbitas de los planetas del Sistema Solar a la misma escala (semiejes mayores, NSSDCA), centradas en {name}.',
  'sx.compare.ring': '{name} (Sistema Solar)',
  'sx.read.title': 'Cómo leer esta vista',
  'sx.read.measured':
    'Medido: la posición, la distancia y el movimiento de las estrellas (Gaia DR3 o HYG), y la separación proyectada entre dos estrellas del sistema.',
  'sx.read.catalogued':
    'Catalogado: los planetas y sus órbitas, del NASA Exoplanet Archive (instantánea del {date}). Cada valor indica cuándo el archivo lo calculó en lugar de tomarlo de una publicación.',
  'sx.read.derived':
    'Derivado aquí: un semieje mayor calculado a partir del periodo y de la masa estelar (tercera ley de Kepler), señalado como tal.',
  'sx.read.illustrative':
    'Ilustrativo: las órbitas se dibujan de frente porque su orientación en el cielo no se publica (el nodo nunca, la inclinación rara vez); una banda va de la menor a la mayor distancia a la estrella; un círculo discontinuo indica una excentricidad no publicada; los colores solo distinguen las órbitas.',
  'sx.read.unknown':
    'Desconocido: dónde está cada planeta en su órbita, la inclinación de las órbitas, la distancia entre las estrellas a lo largo de la línea de visión. No se dibuja nada para ello.',
  'sx.sources':
    'Estrellas: catálogo de la vecindad (Gaia DR3 o HYG). Planetas y estrella anfitriona: NASA Exoplanet Archive, tabla pscomppars, instantánea del {date}.',
  'sx.sourcesStars': 'Estrellas: catálogo de la vecindad (Gaia DR3 o HYG).',
  'sx.star.spectral': 'Tipo espectral (catálogo de la vecindad)',
  'sx.star.spectralArchive': 'Tipo espectral (archivo)',
  'sx.backSky': 'Volver al cielo',
  'sx.closedSky': 'De vuelta al cielo.',
  'sx.unknownHost':
    'Este sistema planetario no está en el catálogo del cielo: la exploración no se abre.',
  'sx.star.distanceArchive': 'Distancia al Sol (archivo)',
  'sx.star.originArchive':
    'Estrella conocida solo por el NASA Exoplanet Archive (no está en el catálogo de la vecindad): sus otras estrellas, si las hay, no se sitúan, porque el archivo da su número, no sus posiciones.',
  'sx.star.circumbinary':
    'Al menos un planeta gira aquí alrededor de una PAREJA de estrellas (circumbinario en el archivo): su órbita se dibuja alrededor del centro del sistema, y no se dibuja ninguna estrella sola, porque las posiciones de las dos estrellas no están en los datos.',
  'sx.star.archiveStarsSky': 'El archivo cuenta {n} estrellas en este sistema.',
  'sx.helpSky':
    'Arrastrar para girar, rueda o pellizco para acercar, tocar una estrella o una órbita. Teclado: flechas para girar, + y - para acercar, Inicio para todo el sistema, Escape para volver al cielo. La lista da el mismo acceso.',
  'sx.read.measuredSky':
    'Publicado: la distancia del sistema y los parámetros de su estrella anfitriona, tal como los da el archivo.',
  'sx.sourcesSky':
    'Estrella y planetas: NASA Exoplanet Archive, tabla pscomppars, instantánea del {date}.',
  'obs.label': 'Seguir observando',
  'obs.tour': 'Visita guiada: {title}',
  'obs.tourPlace': 'Visita guiada: {title} ({place})',
  'obs.orbit': '{probe}, en órbita desde el {date}',
  'obs.contact': '{probe}, en contacto con el cuerpo el {date}',
  'obs.flyby': '{probe}, sobrevuelo el {date}',
  'obs.mission': '{probe}, misión declarada para este cuerpo',
  'obs.missionFrom': '{probe}, junto a este cuerpo desde el {date}',
  'obs.bodyOrbit': '{body}: inserción orbital el {date}',
  'obs.bodyContact': '{body}: contacto el {date}',
  'obs.bodyFlyby': '{body}: máximo acercamiento el {date}',
  'obs.bodyMission': '{body}: objetivo de la misión',
  'obs.bodyMissionFrom': '{body}: junto a este cuerpo desde el {date}',
  'obs.inspect': 'Inspeccionar {probe} en 3D',
  'obs.event': 'Próximo evento: {event}, el {date}',
  'obs.satellites': 'Mostrar los satélites en órbita',
  'obs.neighbourhood': 'Ir al vecindario solar',
  'obs.back': 'Volver a {body}, {date}',
  'obs.note':
    'Cada enlace procede de una medición o de un registro incluidos en Galaxy.',
  'ed.title': 'Observaciones de la atmósfera',
  'ed.info':
    'Hubble (OPAL), observada el {date}, a partir de un mapa fuente de {px} px de ancho; el {share} de la superficie se completa con colores medios medidos, sin detalle inventado.',
  'ed.scene':
    'Fecha de la escena: {date}. No se interpola nada entre dos observaciones, y la fase de rotación del planeta no está fechada: las longitudes de sus formaciones no son las de la escena.',
  'ed.limits':
    'Al comparar observaciones: el productor estira los colores de cada una por separado, y la cobertura y la resolución difieren; parte de lo que cambia viene del procesamiento, no del planeta.',
  'ed.compare': 'Comparar con el {date}',
  'ed.loading': 'Cargando la observación del {date}…',
  'ed.unavailable':
    'No se pudo cargar la observación del {date}: la del {shown} sigue en pantalla.',
  'vol.heading': 'Explorar más lejos',
  'vol.scaleButton': '{pc} pc',
  'vol.scaleLabel':
    '{pc} pc: mostrar las estrellas hasta {pc} pársecs ({ly} años luz)',
  'vol.neighbourhoodOnly':
    'Las 61 estrellas a menos de 5 pc. Elija una escala mayor para cargar el catálogo Gaia de estrellas cercanas.',
  'vol.loading': 'Cargando las estrellas hasta {pc} pc…',
  'vol.loaded':
    '{count} estrellas mostradas hasta {pc} pc, más allá de la vecindad de 5 pc.',
  'vol.failed':
    'No se pudieron cargar todas las estrellas más allá de 5 pc: la vista se queda en {pc} pc.',
  'vol.coverage':
    'Gaia Catalogue of Nearby Stars (Gaia EDR3, 2021): los objetos cuya distancia mediana es de 100 pc o menos. No son todas las estrellas: faltan los objetos más débiles, y las más brillantes, demasiado luminosas para Gaia, vienen de Hipparcos.',
  'vol.filter': 'Mostrar',
  'vol.filter.all': 'Todas las estrellas',
  'vol.filter.whiteDwarfs': 'Enanas blancas probables',
  'vol.filter.exoplanetHosts': 'Anfitrionas de exoplanetas',
  'vol.filter.radialVelocity': 'Con una velocidad radial publicada',
  'vol.search': 'Buscar una estrella con nombre',
  'vol.searchPlaceholder': 'Vega, 51 Peg, HD 10700…',
  'vol.searchNone': 'Ninguna estrella con nombre coincide.',
  'vol.gaiaName': 'Gaia DR3 {id}',
  'vol.unnamed': 'Estrella n.º {n} del volumen',
  'vol.distanceGcns':
    '{pc} pc ({ly} al): mediana de la distribución de distancia del GCNS, 68 % entre {lo} y {hi} pc',
  'vol.distanceRel': '{pc} pc ({ly} al), ±{pct} % (GCNS)',
  'vol.distancePlain': '{pc} pc ({ly} al)',
  'vol.distanceHyg': '{pc} pc ({ly} al), según la paralaje de Hipparcos',
  'vol.distanceSimbad': '{pc} pc ({ly} al), según la paralaje que da SIMBAD',
  'vol.magnitude': 'Magnitud aparente',
  'vol.magG': 'G = {m} (Gaia)',
  'vol.magV': 'V = {m} (Hipparcos)',
  'vol.absMagnitude': 'Magnitud absoluta',
  'vol.absMagValue': '{m}, calculada a partir de la distancia, sin extinción',
  'vol.colour': 'Índice de color',
  'vol.colourBpRp': 'BP−RP = {c} (Gaia)',
  'vol.colourBV': 'B−V = {c} (Hipparcos)',
  'vol.notPublished': 'no publicado por la fuente',
  'vol.parallax': 'Paralaje',
  'vol.parallaxValue': '{p} ± {e} mas',
  'vol.parallaxPlain': '{p} mas',
  'vol.tangential': 'Velocidad perpendicular a la visual',
  'vol.tangentialValue':
    '{v} km/s, calculada a partir del movimiento propio y la distancia',
  'vol.radial': 'Velocidad radial',
  'vol.radialValue': '{v} ± {e} km/s (publicada)',
  'vol.radialPlain': '{v} km/s (publicada)',
  'vol.quality': 'Astrometría',
  'vol.qualityValue':
    'RUWE {ruwe}; fiable con una probabilidad del {p} % (GCNS)',
  'vol.whiteDwarf': 'Enana blanca',
  'vol.whiteDwarfValue': 'probabilidad {p} % (GCNS)',
  'vol.exoplanets': 'Exoplanetas',
  'vol.exoplanetsValue':
    '{count} conocido(s) alrededor de {host} (NASA Exoplanet Archive, cruzado por el número Gaia DR3)',
  'vol.origin.gcns':
    'Gaia DR3 {id}, en el Gaia Catalogue of Nearby Stars (GCNS, CC BY-NC 4.0, construido con datos de Gaia de la ESA, CC BY-NC 3.0 IGO).',
  'vol.origin.hyg':
    'Demasiado brillante para Gaia, listada por el GCNS como ausente de EDR3: valores de Hipparcos (HYG v4.4, CC BY-SA 4.0).',
  'vol.origin.simbad':
    'Ausente de Gaia EDR3 (lista del GCNS, CC BY-NC 4.0) y no encontrada en Hipparcos: solo posición y paralaje de SIMBAD (CDS/SIMBAD); magnitud, color y movimiento no están disponibles aquí.',
  'vol.nameHyg':
    'Nombre: HYG v4.4 (CC BY-SA 4.0), asociado por Galaxy por posición y distancia.',
  'vol.noRadial':
    'No se publica velocidad radial: al mover el tiempo, el movimiento mostrado es solo perpendicular a la visual.',
  'vol.noMotion':
    'Esta estrella no se mueve con el tiempo aquí: su movimiento no está en la fuente.',
  'vol.symbolic':
    'Más allá de 5 pc, cada estrella es un pequeño punto: su brillo sigue su magnitud absoluta y su color es indicativo (según el índice de color), nunca un tipo espectral.',
  'vol.dataUnavailable':
    'No se pudo cargar parte de los datos (red): elija de nuevo para reintentar.',
  'vol.unknownStar':
    'La estrella de este enlace no está en el volumen estelar.',
  'ed.announce': 'Observación del {date} mostrada',
};
