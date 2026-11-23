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
    'Fuentes: Gaia DR3 (ESA) y HYG v4.4 ({license}). Las posiciones son las de J2000,0; el marcador sigue el movimiento propio hasta la fecha de la escena.',
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
    'NASA Exoplanet Archive, leído el {date}. Los planetas no se dibujan: solo se sitúa su estrella anfitriona en el cielo.',
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
};
