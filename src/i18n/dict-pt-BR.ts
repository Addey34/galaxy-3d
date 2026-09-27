/**
 * DICTIONNAIRE PORTUGAIS DU BRÉSIL. Chargé à la demande (cf. `./locales`).
 *
 * Le type force la parité avec l'anglais : toute clé de `MessageKey` est obligatoire, et une
 * clé inconnue est refusée. Pour ajouter une entrée, commencer par `./dict-en`.
 *
 * TRADUIT PAR CLAUDE au lot 20 (2026-09-27), depuis l'anglais ET le français, et RELU PAR AUCUN
 * LOCUTEUR NATIF : c'est écrit dans le handoff du lot. Ce qu'une machine peut vérifier l'est :
 * nombres, unités, noms propres, gabarits `{…}` et parité des clés
 * (`src/i18n/translationFidelity.test.ts`).
 *
 * C'est du portugais du BRÉSIL, pas du portugais européen, et cela se voit ici : « bilhões »
 * pour 10⁹ (le Portugal écrit « mil milhões »), la deuxième personne rendue par « você » et donc
 * l'impératif à la troisième personne (« Clique », « Abra »). Ce choix est déclaré dans
 * `LOCALES` : annoncer `pt` promettrait plus que ce qui est livré.
 */
import type { MessageKey } from './dict-en';

export const ptBR: Record<MessageKey, string> = {
  // ── Écran de chargement ──
  'title.body': '{name} em 3D: posição e órbita ao vivo',
  'title.eclipse.solar.total': 'Eclipse solar total de {date} em 3D',
  'title.eclipse.solar.annular': 'Eclipse solar anular de {date} em 3D',
  'title.eclipse.solar.partial': 'Eclipse solar parcial de {date} em 3D',
  'title.eclipse.lunar.total': 'Eclipse lunar total de {date} em 3D',
  'title.eclipse.lunar.partial': 'Eclipse lunar parcial de {date} em 3D',
  'title.eclipse.lunar.penumbral': 'Eclipse lunar penumbral de {date} em 3D',
  'eclipse.name.solar.total': 'Eclipse solar total',
  'eclipse.name.solar.annular': 'Eclipse solar anular',
  'eclipse.name.solar.partial': 'Eclipse solar parcial',
  'eclipse.name.lunar.total': 'Eclipse lunar total',
  'eclipse.name.lunar.partial': 'Eclipse lunar parcial',
  'eclipse.name.lunar.penumbral': 'Eclipse lunar penumbral',
  'title.overview': 'Galaxy: Sistema Solar 3D interativo em tempo real',
  'loader.init': 'Inicializando…',
  'loader.core': 'Carregando os componentes…',
  'loader.scene': 'Construindo a cena…',
  'loader.lighting': 'Preparando a iluminação…',
  'loader.bodies': 'Criando os corpos celestes…',
  'loader.finalize': 'Finalizando…',
  'loader.starting': 'Iniciando…',
  'loader.loadingBody': 'Carregando {body}…',
  'loader.creatingBody': 'Criando {body}...',
  'loader.ephemerides': 'Dados de efemérides carregados',
  'loader.ready': 'Pronto para o lançamento',
  'loader.stage.core': 'Motor',
  'loader.stage.data': 'Dados',
  'loader.stage.scene': 'Cena',
  'loader.stage.bodies': 'Corpos',
  'loader.stage.orbit': 'Órbitas',
  'loader.stage.ready': 'Pronto',
  'loader.texturesDone': 'Texturas carregadas',
  // ── Accessibilité : ce que SEUL un lecteur d'écran entend (lot 19) ──
  // Voir le bloc anglais pour la raison de chaque clé.
  'a11y.pageHeading':
    'Galaxy: Sistema Solar 3D interativo em tempo real. Explore os planetas, as luas e os planetas anões',
  'a11y.scene': 'Sistema Solar, vista 3D interativa',
  'a11y.navigation': 'Navegação entre os corpos',
  'a11y.loading': 'Carregando o Sistema Solar, aguarde um momento.',
  'a11y.loadingProgress': 'Progresso do carregamento',
  'a11y.ready': 'Sistema Solar carregado e pronto.',
  'a11y.loadFailed': 'Não foi possível carregar o Sistema Solar.',
  'a11y.bodySelected': '{name} selecionado. Ficha de informações aberta.',
  'a11y.dateChanged': 'Data ajustada para {date}.',
  'a11y.searchResults': '{count} corpos correspondem.',
  'a11y.searchResultsOne': 'Um corpo corresponde.',
  'a11y.searchResultsNone': 'Nenhum corpo corresponde.',
  'a11y.paletteResults': 'Resultados da busca',
  'a11y.tourPlayer': 'Visita guiada em andamento',
  'error.title': 'Erro do aplicativo',
  'error.retry': 'Tentar de novo',
  'error.contextLost': 'Reconectando a vista 3D…',
  'error.contextLostTimeout':
    'A vista 3D não conseguiu se reconectar. Recarregue a página.',

  // ── Éphémérides manquantes (lot 15) ──
  'ephemeris.notice.title': 'Precisão reduzida',
  'ephemeris.notice.partial':
    'Efemérides precisas recebidas: {loaded} de {declared}. Os outros corpos são posicionados por uma fonte menos precisa, indicada na ficha de cada corpo.',
  'ephemeris.notice.none':
    'Nenhuma efeméride precisa pôde ser carregada. Todos os corpos são posicionados por uma fonte menos precisa, indicada na sua ficha.',
  'ephemeris.notice.spacecraft': 'Sondas sem nenhuma posição: {count}.',
  'ephemeris.notice.retry': 'Carregar os arquivos que faltam',
  'ephemeris.notice.retrying': 'Carregando os arquivos que faltam…',
  'ephemeris.notice.recovered': 'Todas as efemérides estão carregadas.',
  'ephemeris.notice.dismiss': 'Fechar esta mensagem',
  'ephemeris.notice.aria': 'Carregamento das efemérides',

  // ── Navigation ──
  'nav.overview': 'Visão geral',
  'nav.bodies': 'Corpos',
  'nav.search': 'Buscar um corpo',
  'dock.tools.aria': 'Ferramentas',
  'speed.aria': 'Velocidade da simulação',
  'speed.limited': 'limitado pela sua conexão',
  'ephemeris.notice.waitingTitle': 'A data espera pelos seus dados',
  'ephemeris.notice.waiting':
    'Sua conexão é mais lenta do que a velocidade de reprodução solicitada. Nada de falso é mostrado: a data avança conforme os bytes chegam.',
  'offline.hint':
    'Baixe todos os arquivos de efemérides para que o aplicativo posicione os corpos em qualquer data sem rede. Nada é baixado até você pedir.',
  'offline.reading': 'Verificando o que este dispositivo já tem…',
  'offline.unavailable':
    'Este navegador não guarda armazenamento para o aplicativo, então o uso offline não pode ser preparado aqui.',
  'offline.noManifest':
    'O índice das efemérides não chegou, então ainda não há nada a preparar.',
  'offline.partial':
    'Este dispositivo tem {files} de {total} arquivos. Preparar o restante baixa cerca de {size} MB.',
  'offline.ready':
    'Os {files} arquivos estão neste dispositivo ({size} MB). As datas funcionam sem rede.',
  'offline.prepare': 'Preparar o uso offline',
  'offline.cancel': 'Parar o download',
  'offline.progress': 'Baixando: {done} de {total} arquivos.',
  'offline.started': 'Preparação offline iniciada.',
  'offline.forget': 'Liberar {size} MB',
  'nav.searchPlaceholder': 'Buscar um corpo…',
  'nav.paletteAria': 'Buscar e selecionar um corpo',
  'nav.group.star': 'Estrela',
  'nav.group.planet': 'Planetas',
  'nav.group.moon': 'Luas',
  'nav.group.dwarf': 'Planetas anões',
  'nav.group.other': 'Corpos menores',
  'nav.group.spacecraft': 'Sondas',
  'nav.group.interstellar': 'Objetos interestelares',
  'nav.kind.moon': 'lua',
  'nav.kind.dwarf': 'anão',
  'nav.unavailable': 'Sem posição nesta data',
  'nav.kind.spacecraft': 'sonda',
  'nav.kind.interstellar': 'interestelar',
  'surface.close': 'Fechar',
  'bi.trigger.aria': 'Informações do corpo',
  'settings.trigger.aria': 'Ajustes de exibição',
  'time.expand': 'Ajustes de tempo',
  'events.title': 'Eventos astronômicos',
  'events.open': 'Eventos astronômicos',
  'events.close': 'Fechar os eventos astronômicos',
  'events.empty': 'Nenhum evento próximo',
  'events.newMoon': 'Lua nova',
  'events.firstQuarter': 'Quarto crescente',
  'events.fullMoon': 'Lua cheia',
  'events.thirdQuarter': 'Quarto minguante',
  'events.solarEclipse': 'Eclipse solar',
  'events.lunarEclipse': 'Eclipse lunar',
  'events.marchEquinox': 'Equinócio de março',
  'events.juneSolstice': 'Solstício de junho',
  'events.septemberEquinox': 'Equinócio de setembro',
  'events.decemberSolstice': 'Solstício de dezembro',
  'events.perihelion': 'Periélio (Terra mais perto do Sol)',
  'events.aphelion': 'Afélio (Terra mais longe do Sol)',
  'events.opposition': 'Oposição (mais perto, visível toda a noite)',
  'events.conjunction': 'Conjunção inferior (passa entre a Terra e o Sol)',
  'events.kind.penumbral': 'penumbral',
  'events.kind.partial': 'parcial',
  'events.kind.annular': 'anular',
  'events.kind.total': 'total',
  'events.tip.peak': 'Máximo visível perto de {lat}, {lon}',
  'events.tip.obscuration': '{percent} % obscurecido no máximo',
  'events.tip.goto': 'Clique para viajar até esta data',

  // ── Bascule de mode ──
  'mode.group': 'Modo de exibição',
  'mode.educ': 'Educ.',
  'mode.explo': 'Explo.',
  'mode.educ.title': 'Vista educativa, órbitas circulares',
  'mode.explo.title': 'Modo exploração, escala real',
  'zoom.optical': 'Zoom óptico (FOV)',

  // ── Qualité graphique (perf adaptative) ──
  'quality.heading': 'Qualidade gráfica',
  'quality.auto': 'Auto',
  'quality.auto.hint': 'Adaptada a este dispositivo',
  'quality.low': 'Baixa',
  'quality.low.hint': 'A mais fluida em GPUs modestas',
  'quality.medium': 'Média',
  'quality.medium.hint': 'Equilibrada',
  'quality.high': 'Alta',
  'quality.high.hint': 'Melhor aparência',
  'quality.reloadNote': 'Algumas opções se aplicam ao recarregar.',

  // ── Lecture / temps ──
  'playback.playpause': 'Reproduzir / Pausar',
  'playback.play': 'Retomar a simulação',
  'playback.pause': 'Pausar a simulação',
  'time.today': 'Voltar para agora',
  'time.group': 'Controles de tempo',
  'time.wheelTime': 'Roda: ±1 h  ·  Clique: escolher a hora',
  'time.wheelDate': 'Roda: ±1 dia  ·  Clique: escolher a data',

  // ── Aide & crédits ──
  'help.btn.title': 'Ajuda, dicas e créditos',
  'help.btn.aria': 'Ajuda, dicas e créditos',
  'feedback.btn.title': 'Sugestões e relatos de problemas',
  'feedback.btn.aria': 'Sugestões e relatos de problemas',
  'kofi.btn.title': 'Me pague um café',
  'kofi.btn.aria': 'Apoiar este projeto no Ko-fi',
  'share.btn.title': 'Compartilhar esta vista',
  'share.btn.aria': 'Compartilhar esta vista',
  'share.copied': 'Link copiado',
  'share.failed': 'Não foi possível copiar',
  'capture.btn.title': 'Capturar esta vista',
  'capture.btn.aria': 'Capturar esta vista',
  'capture.success': 'Imagem baixada',
  'capture.failed': 'Não foi possível capturar',
  'webxr.btn.enter.title': 'Entrar em RV',
  'webxr.btn.enter.aria': 'Entrar em realidade virtual',
  'webxr.btn.exit.title': 'Sair da RV',
  'webxr.btn.exit.aria': 'Sair da realidade virtual',
  'help.dialog.aria': 'Ajuda e créditos',
  'help.title': 'Navegação',
  'help.tip.drag.key': 'Arrastar',
  'help.tip.drag.text': 'girar a vista',
  'help.tip.zoom.key': 'Roda · pinça',
  'help.tip.zoom.text': 'aproximar / afastar',
  'help.tip.click.key': 'Clique em um corpo',
  'help.tip.click.text': 'ou no seu rótulo para viajar até ele',
  'help.tip.mode.key': 'Educ · Explo',
  'help.tip.mode.text': 'vista comprimida ou viagem em escala real',
  'help.tip.time.key': 'Relógio · data',
  'help.tip.time.text': 'roda para viajar no tempo, toque para escolher',
  'credits.textures': 'Texturas',
  'credits.fictional': 'Superfícies ilustrativas',
  'credits.fictional.list':
    'Os corpos nunca mapeados por completo têm uma textura ilustrativa, não um mapa científico; a ficha do corpo informa isso, e Fontes os lista.',
  'weather.attribution.prefix': 'Dados meteorológicos:',
  'weather.attribution.modified': 'reamostrados em texturas de mapa',
  'credits.models': 'Modelos de forma 3D',
  'credits.data': 'Dados',
  'credits.privacy': 'Privacidade',
  'credits.methodology': 'Metodologia',
  'credits.methodology.href': '/pt-br/methodology/',
  'credits.sources': 'Fontes',
  'credits.sources.href': '/pt-br/sources/',
  'lang.label': 'Idioma',
  'lang.changed': 'Idioma da interface: {language}.',
  // ── Visite guidée (première visite) ──
  'tour.start': 'Começar a visita rápida',
  'tour.previous': 'Anterior',
  'tour.next': 'Próximo',
  'tour.finish': 'Concluir',
  'tour.close': 'Fechar a visita',
  'tour.progress': 'Etapa {current} de {total}',
  'tour.step.navigation.title': '1. Navegar',
  'tour.step.navigation.text':
    'Escolha um planeta na barra superior ou arraste a cena.',
  'tour.step.mode.title': '2. Escolher uma vista',
  'tour.step.mode.text':
    'Educativo simplifica as distâncias enquanto Exploração mostra a escala real.',
  'tour.step.time.title': '3. Mudar o tempo',
  'tour.step.time.text': 'Use a data e a velocidade para viajar no tempo.',
  'tour.step.expand.title': '4. Abrir o relógio',
  'tour.step.expand.text':
    'Clique no relógio para abrir os ajustes avançados de data e velocidade.',
  'tour.step.info.title': '5. Inspecionar um alvo',
  'tour.step.info.text':
    'Depois de selecionar um corpo, abra a ficha dele pelo botão de informações do alvo.',
  'tour.step.settings.title': '6. Ajustar a exibição',
  'tour.step.settings.text':
    'Abra os ajustes de exibição para mostrar ou ocultar os rótulos, os objetos e as órbitas, grupo por grupo ou objeto por objeto.',
  'tour.step.weather.title': '7. Explorar a meteorologia',
  'tour.step.weather.text':
    'Abra as camadas meteorológicas para ver as nuvens, a chuva, o vento e os dados de superfície na Terra.',
  'tour.step.events.title': '8. Observar o céu',
  'tour.step.events.text':
    'Confira os próximos eventos astronômicos e escolha um para ver mais detalhes.',
  'tour.step.share.title': '9. Compartilhar uma vista',
  'tour.step.share.text':
    'Prepare uma vista e compartilhe o link dela. Quem abrir chega exatamente na mesma cena.',
  'tour.step.capture.title': '10. Tirar uma imagem',
  'tour.step.capture.text':
    'Oculta todos os controles e salva a vista como imagem, com a data e o corpo escritos nela.',
  'tour.step.feedback.title': '11. Dar sua opinião',
  'tour.step.feedback.text':
    'Relate um problema ou proponha uma ideia. As sugestões são públicas, e você pode votar nas dos outros.',
  'tour.step.help.title': '12. Encontrar ajuda',
  'tour.step.help.text': 'Consulte a página de ajuda para saber mais.',

  // ── Tours guidés scénarisés ──
  'tours.start': 'Visitas roteirizadas',
  'tours.pause': 'Pausar',
  'tours.resume': 'Retomar',
  'tours.next': 'Próximo',
  'tours.close': 'Fechar',
  'tours.progress': 'Etapa {current} de {total}',
  'tours.status.flyingTo': 'Voando até {body}…',
  'tours.status.jumping': 'Salto no tempo…',
  'tours.status.speeding': 'Acelerando o tempo…',

  // ── Nudge visite guidée (premier passage en Explo) ──
  'exploNudge.text':
    'Experimente uma visita guiada para descobrir o melhor do modo Exploração.',
  'exploNudge.action': 'Me mostre',
  'exploNudge.dismiss': 'Fechar',

  // ── Badge d'échelle permanent (vue d'ensemble Explo, aucune cible) ──
  'exploScale.fact.earth':
    'A luz do Sol leva cerca de 8 minutos para chegar à Terra.',
  'exploScale.fact.jupiter':
    'A luz do Sol leva cerca de 43 minutos para chegar a Júpiter.',
  'exploScale.fact.neptune':
    'A luz do Sol leva cerca de 4 horas para chegar a Netuno.',
  'exploScale.fact.voyager':
    'A Voyager 1, a sonda mais distante da humanidade, já está a mais de 24 bilhões de km da Terra.',

  // ── Surface « Réglages d'affichage » (cf. le bloc anglais) ──
  'settings.title': 'Ajustes de exibição',
  'settings.section.scene': 'Na cena',
  'settings.section.rendering': 'Renderização',
  'settings.section.reading': 'Acessibilidade e unidades',
  'settings.section.view': 'Vista',
  'settings.section.offline': 'Uso offline',
  'settings.labelsToggle': 'Mostrar todos os rótulos',
  'settings.bodiesToggle': 'Mostrar todos os objetos',
  'settings.orbitsToggle': 'Mostrar todas as órbitas e trajetórias',
  'settings.tableHint':
    'O cabeçalho ajusta a coluna inteira, uma linha de grupo todo o seu grupo, uma linha um único objeto. As sondas e os objetos interestelares começam ocultos.',
  'settings.tableCaption': 'O que a cena mostra, objeto por objeto',
  'settings.col.bodyName': 'Objeto',
  'settings.col.names': 'Rótulo',
  'settings.col.bodies': 'Objeto',
  'settings.col.orbits': 'Órbita',
  'settings.row.name.aria': 'Mostrar o rótulo de {name}',
  'settings.row.body.aria': 'Mostrar {name}',
  'settings.row.orbit.aria': 'Mostrar a órbita de {name}',
  'settings.row.trajectory.aria': 'Mostrar a trajetória de {name}',
  'settings.group.name.aria': 'Mostrar todos os rótulos: {group}',
  'settings.group.body.aria': 'Mostrar todos os objetos: {group}',
  'settings.group.orbit.aria': 'Mostrar todas as órbitas: {group}',
  'settings.exposure': 'Brilho (exposição)',
  'settings.colorblind': 'Cores de órbita adaptadas ao daltonismo',
  'settings.surfaceImagery':
    'Transmitir a imagem de superfície em alta resolução',
  'surface.imagery.headline': '{title} a {resolution}/pixel',
  'surface.imagery.acquired': 'imagens de {from} a {to}',
  'surface.imagery.oversampled':
    'exibida {factor} vezes maior que o mosaico publicado ({published} px/grau)',
  'surface.relief.headline': 'Relevo {title} a {resolution}/pixel',
  'surface.relief.area': 'área nomeada {name}',
  'surface.relief.acquired': 'altimetria de {from} a {to}',
  'settings.units': 'Unidades imperiais (mi, °F)',

  // ── Champ d'astéroïdes et de comètes, section des Réglages ──
  'smallBodies.title': 'Campo de asteroides e cometas',
  'smallBodies.exploOnly':
    'Desenhado no modo Exploração, um ponto por órbita conhecida.',
  'smallBodies.mainBelt': 'Cinturão principal',
  'smallBodies.neo': 'Objetos próximos da Terra',
  'smallBodies.comet': 'Cometas',
  'smallBodies.tno': 'Objetos transneptunianos',
  'smallBodies.source':
    '{count} objetos, JPL Small-Body Database, amostra de {date}.',
  'smallBodies.sourceStale':
    '{count} objetos, JPL Small-Body Database, amostra de {date}. Esta amostra tem {months} meses: podem faltar as órbitas refinadas desde então e os objetos catalogados desde então.',

  // ── Couches météo ──
  'weather.title': 'Camadas meteorológicas',
  'weather.trigger.aria': 'Camadas meteorológicas',
  'weather.dialog.aria': 'Camadas meteorológicas',
  'weather.clouds': 'Nuvens (NASA)',
  'weather.cloudsModel': 'Nuvens (Open-Meteo)',
  'weather.precip': 'Chuva (NASA IMERG)',
  'weather.precipModel': 'Chuva (Open-Meteo)',
  'weather.wind': 'Vento',
  'weather.thermal': 'Temperatura do ar (MERRA-2)',
  'weather.thermalModel': 'Temperatura do ar (Open-Meteo)',
  'weather.clouds.note':
    'Cobertura de nuvens real, imagem de satélite da NASA (imagem do dia).',
  'weather.cloudsModel.note':
    'Cobertura de nuvens modelada (Open-Meteo): mundial sem falhas, cobre passado e previsão; escolha esta para o ao vivo e a viagem no tempo.',
  'weather.precip.note':
    'Chuva observada NASA IMERG V07: sua máscara alfa nativa é preservada; nenhuma extrapolação polar é adicionada.',
  'weather.precip.legendLo': 'Fraca',
  'weather.precip.legendHi': 'Intensa',
  'weather.precipModel.note':
    'Chuva modelada (Open-Meteo): mundial sem falhas, passado + previsão. As áreas secas ficam transparentes.',
  'weather.precipModel.lo': '0 mm/h',
  'weather.precipModel.hi': '20+ mm/h',
  'weather.thermalModel.note':
    'Temperatura do ar a 2 m modelada (Open-Meteo): mundial sem falhas, passado (ERA5) + previsão.',
  'weather.thermalModel.lo': '−40 °C',
  'weather.thermalModel.hi': '+45 °C',
  'weather.pressureModel': 'Pressão ao nível do mar (Open-Meteo)',
  'weather.pressureModel.note':
    'Pressão ao nível do mar mostrada como isóbaras suaves em hPa.',
  'weather.pressureModel.lo': '960 hPa',
  'weather.pressureModel.hi': '1060 hPa',
  'weather.humidityModel': 'Umidade relativa (Open-Meteo)',
  'weather.humidityModel.note':
    'Umidade relativa a 2 m da Open-Meteo, em porcentagem.',
  'weather.humidityModel.lo': '0 %',
  'weather.humidityModel.hi': '100 %',
  'weather.source.prefix': 'Fonte:',
  'weather.source.approx': 'a data mais próxima',
  'weather.loading': 'Carregando…',
  // Couche des événements terrestres (voir ui/earthEvents.ts).
  'earthEvents.title': 'Eventos terrestres',
  'earthEvents.dialog.aria': 'Eventos terrestres',
  'earthEvents.trigger.aria': 'Eventos terrestres',
  'earthEvents.quakes.label': 'Terremotos (USGS)',
  'earthEvents.quakes.note':
    'Soluções de origem de magnitude {magnitude} e acima nos {days} dias anteriores à data da cena, medidas por redes de sismômetros. Nenhum terremoto existe no futuro: uma cena posterior recebe a última janela real, e a diferença está escrita abaixo.',
  'earthEvents.natural.label': 'Eventos naturais (NASA EONET)',
  'earthEvents.natural.note':
    'Eventos relatados, como incêndios, vulcões, tempestades, inundações e gelo, nos {days} dias anteriores à data da cena. A EONET declara que seus metadados são destinados apenas à visualização e à informação geral, e não devem ser tomados como oficiais quanto à extensão espacial ou temporal: são relatos, não medidas.',
  'earthEvents.empty': 'Nenhum evento nesta janela.',
  'earthEvents.ongoing': 'em andamento',
  'earthEvents.loading': 'Carregando…',
  'earthEvents.attribution.prefix': 'Dados de eventos:',
  // Catégorie temporelle d'une donnée affichée (voir core/temporal.ts).
  'time.category.live': 'ao vivo',
  'time.category.observed': 'observado',
  'time.category.reported': 'relatado',
  'time.category.reconstructed': 'reconstruído (modelo)',
  'time.category.predicted': 'previsto',
  'time.category.extrapolated': 'extrapolado',
  'time.category.unavailable': 'indisponível',
  'time.confidence.reduced': 'confiança reduzida',
  'time.offset.scene': 'cena em {date}',
  // Provenance de la position d'un corps (voir core/positionProvenance.ts).
  'bi.position.label': 'Posição nesta data',
  'position.source.horizons': 'efeméride JPL Horizons (pré-calculada)',
  'position.source.spk': 'núcleo SPK do JPL',
  'position.source.astronomy-engine': 'Astronomy Engine',
  'position.source.kepler': 'elementos orbitais keplerianos',
  'position.error':
    'Diferença média medida em relação ao JPL Horizons: {distance} ({from}–{to})',
  'position.error.none':
    'Diferença em relação ao JPL Horizons não medida nesta data',
  'weather.wind.note':
    'Fluxo do vento (Open-Meteo): a cor e a velocidade seguem a força do vento.',
  'weather.thermal.note': 'Temperatura do ar perto do solo (MERRA-2 mensal):',

  // ── Divers ──
  'fullscreen.title': 'Tela cheia',

  // ── Fiche d'info (bodyInfo) ──
  'bi.live.label': 'Distância de você',
  'bi.more': 'Saber mais',
  'bi.modelCredit': 'Modelo de forma 3D',
  'bi.colourCredit': 'Cor da superfície',
  'bi.creditLine': '{label}: {value}',
  'bi.fictional': 'Superfície ilustrativa',
  'bi.fictional.hint':
    'Nenhuma sonda resolveu esta superfície, então a textura é ilustrativa, não um mapa científico.',
  'stat.radius': 'Raio',
  'stat.meanDistanceSun': 'Distância média (Sol)',
  'stat.meanDistanceFrom': 'Distância média ({parent})',
  'stat.mass': 'Massa',
  'stat.gravity': 'Gravidade',
  'stat.meanTemperature': 'Temperatura média',
  'stat.siderealRotation': 'Rotação sideral',
  'stat.year': 'Ano',
  'stat.orbit': 'Órbita',
  'stat.knownMoons': 'Luas conhecidas',
  'stat.axialTilt': 'Inclinação axial',
  'stat.launchDate': 'Data de lançamento',
  'stat.launchVehicle': 'Veículo lançador',
  'stat.launchSite': 'Base de lançamento',
  'stat.absoluteMagnitude': 'Magnitude absoluta',
  'stat.eccentricity': 'Excentricidade',
  'stat.perihelion': 'Distância do periélio',
  'stat.firstObservation': 'Primeira observação',
  'stat.unknown': 'Dado não publicado',
  'stat.unsourced': 'Ainda sem fonte',
  'stat.unknown.value': 'n/d',
  'bi.sources': 'Fontes',
  'bi.source': 'fonte',
  'fact.method.measured': 'valor medido',
  'fact.method.derived': 'valor derivado',
  'fact.method.illustrative': 'valor ilustrativo',
  'fact.asOf': 'em {date}',
  'fact.methods.measured': 'Valores medidos',
  'fact.methods.derived': 'Valores derivados',
  'fact.methods.illustrative': 'Valores ilustrativos',
  'fact.accessed': 'consultada em {date}',
  'fact.kind.preprint': 'pré-publicação',
  'subtitle.star': 'Estrela do Sistema Solar',
  'subtitle.moon': 'Satélite natural',
  'subtitle.dwarf': 'Planeta anão',
  'subtitle.asteroid': 'Asteroide',
  'subtitle.comet': 'Cometa',
  'subtitle.spacecraft': 'Sonda espacial',
  'subtitle.interstellar': 'Objeto interestelar',
  'subtitle.planet': 'Planeta',
  'subtitle.planetOrdinal': '{ordinal} planeta a partir do Sol',

  // ── Unités & suffixes (fiche) ──
  'unit.light': 'luz',
  'unit.day.short': 'd',
  'unit.hours': 'horas',
  'unit.days': 'dias',
  'unit.year.short': 'anos',
  'unit.au': 'UA',
  'unit.million': 'milhões de',
  'unit.billion': 'bilhões de',
};
