# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Les versions
suivent [SemVer](https://semver.org/lang/fr/). L'historique détaillé reste celui de git : ce
fichier résume ce qui change pour une personne qui utilise ou cite Galaxy.

## [Non publié]

### Ajouté

- **Galaxy parle espagnol et portugais du Brésil**, en plus de l'anglais et du français. Tout ce
  qu'un visiteur lit suit sa langue : l'interface, le nom et la description de chaque corps, les
  crédits de licence, la raison écrite quand une valeur n'est pas publiée, les visites guidées, et
  les pages `/methodology` et `/sources`. Le sélecteur est dans le popover d'aide, et chaque
  segment porte le nom de sa langue dans sa langue.
- **Une adresse indexable par corps et par langue** : `/es/jupiter/`, `/pt-br/eclipse/2026-08-12/`,
  `/fr/titan/`. L'anglais reste à la racine, où il est indexé depuis septembre. Le français n'avait
  jusqu'ici aucune page de corps. Le site publie 450 adresses au lieu de 120, reliées entre elles
  par `hreflang` réciproque.

### Modifié

- **Le démarrage est plus léger qu'avec deux langues.** Un visiteur ne télécharge que la langue
  qu'il lit : 1 193 725 octets de JavaScript pour un anglophone, contre 1 225 609 auparavant, alors
  que deux langues se sont ajoutées. Le texte du catalogue, jusqu'ici embarqué dans toutes ses
  langues pour tout le monde, est désormais dérivé par langue au moment de la construction.
- **Les nombres s'écrivent comme la langue les écrit.** L'espagnol et le portugais du Brésil
  emploient la virgule décimale : un point leur faisait lire mille fois la valeur.

### Corrigé

- **La mention d'une valeur dérivée se lisait « (derived value value) »** sur les pages de corps,
  dans les quatre langues. Trouvé en relisant la page comme un lecteur la lit.
- **L'ordinal d'une planète, les libellés du curseur de vitesse et la ponctuation d'une ligne de
  crédit** ne connaissaient que l'anglais et le français : ils auraient servi de l'anglais, ou une
  typographie française, aux deux langues neuves.
- **La langue active du sélecteur n'était marquée que par une couleur**, donc invisible pour une
  personne qui utilise un lecteur d'écran. Elle est maintenant annoncée, et le changement de langue
  aussi, dans la langue d'arrivée.

### Ce qui n'est pas traduit, et qui est dit

- La page de confidentialité reste en français et en anglais : c'est un texte de nature juridique,
  dont la traduction demande une relecture que ce lot n'a pas eue.
- Les traductions espagnole et portugaise n'ont pas été relues par un locuteur natif. Ce qu'une
  machine peut vérifier l'est : les nombres, les unités, les noms propres, l'existence de chaque
  lien, et le fait qu'aucune chaîne ne reste en anglais sans raison écrite.

### Corrigé

- **La recherche de corps n'écartait aucun résultat.** Taper « mars » laissait les 71 corps
  affichés : le code posait bien l'attribut `hidden` sur les entrées sans rapport, mais une règle
  de style le neutralisait. Ce défaut gênait tout le monde, pas seulement les personnes qui
  utilisent un lecteur d'écran, et c'est en écoutant qu'on l'a trouvé : le lecteur annonçait
  « Mars, 5 sur 71 » là où il fallait entendre « 1 sur 1 ».
- **En français, l'onglet et le titre principal de la page restaient en anglais.** La traduction
  existait, elle n'était jamais appliquée tant qu'aucun corps n'était choisi. C'était la première
  phrase qu'un lecteur d'écran prononçait en arrivant.
- **L'application ne disait rien quand son état changeait.** Elle est désormais capable de
  parler, et le fait à trois moments : quand le chargement se termine, après une dizaine de
  secondes d'attente jusque-là silencieuse ; quand un corps est choisi ; et quand l'activation
  d'un événement déplace la date de plusieurs semaines. La fin d'une préparation hors ligne est
  annoncée même si le panneau des réglages a été refermé entre-temps, ce qui n'était pas le cas.
- **Choisir un corps laissait le clavier sans point d'ancrage.** La fiche s'ouvrait, l'adresse
  changeait, et le focus disparaissait : il fallait repartir du début de la page. Il entre
  maintenant dans la fiche qui vient de s'ouvrir.
- **Ouvrir les réglages d'affichage, les couches météo, les événements terrestres ou l'aide
  laissait le focus sur le bouton**, à quinze tabulations du panneau qu'on venait d'ouvrir, et
  la touche Échap n'y pouvait plus rien puisqu'elle n'est écoutée que depuis le panneau.
- **Les deux cartes de visite guidée se déclaraient modales sans l'être.** Elles annonçaient au
  lecteur d'écran que le reste de la page était hors d'atteinte, alors que la tabulation en
  sortait dès le troisième bouton, et elles s'annonçaient « dialogue » sans dire lequel.
- **La page n'exposait qu'un seul repère de navigation.** La scène en est désormais un, nommé, et
  les deux barres d'outils aussi : leur nom existait déjà mais n'était exposé nulle part.
- **La barre de progression du chargement n'avait pas de valeur**, et une seconde barre décrivait
  la même progression en double.

### Ajouté

- **Une méthode reproductible pour écouter l'application.** Un banc de capture pilote un lecteur
  d'écran réel (NVDA), muet, et relève chaque énoncé dans l'ordre en le rapprochant de l'élément
  qui a réellement le focus. Les treize défauts ci-dessus étaient tous sous des tests
  automatiques verts : les vérificateurs de règles ne disent rien de l'ordre d'annonce ni du
  parcours du focus. Quatorze gardes tiennent désormais chacune de ces corrections.

## [0.10.0] - 2026-09-27 (« Surfaces mesurées et démarrage allégé »)

### Ajouté

- **Le démarrage ne télécharge plus deux siècles de trajectoires.** L'application lisait les
  64 fichiers d'éphémérides entiers avant d'afficher quoi que ce soit, soit 38 040 720 octets ;
  elle ne lit maintenant que la tranche dont la scène a besoin, 987 168 octets pour la première
  vue. La première visite complète passe de 45,8 à 11,5 mégaoctets, mesurée en production.
  Sur un lien à 2 mégabits par seconde, le démarrage tombe de 186 à 32 secondes. Rien n'est
  approximé en échange : la date n'avance que sur des données réellement arrivées, et aucune
  position de repli n'est affichée en attendant.
- **Le curseur de vitesse dit ce que la connexion tient.** À un an de simulation par seconde
  réelle, suivre l'horloge demande 2,3 mégabits par seconde. Quand le lien mesuré ne suit pas, le
  curseur se plafonne de lui-même et l'écrit (« limité par votre connexion ») au lieu de promettre
  une vitesse qu'il ne tiendra pas. Le plafond se calcule sur le débit observé, jamais sur une
  valeur supposée, et au-dessus de 2,4 mégabits par seconde il n'y a aucun plafond.
- **Une visite de retour ne redemande plus rien.** Ce que l'appareil tient déjà est relu chez lui :
  la deuxième visite demandait 987 168 octets d'éphémérides, elle en demande désormais zéro.
- **Un bouton « préparer le hors-ligne »**, dans les réglages : il télécharge à la demande les
  38 445 024 octets des 64 fichiers, et l'application place ensuite les corps à n'importe quelle
  date sans réseau. Rien n'est téléchargé sans le demander, et l'état affiché est toujours LU dans
  ce que l'appareil tient, jamais un « c'est prêt » mémorisé qui survivrait à une purge.
- **Le poids du démarrage est désormais borné, famille par famille** (éphémérides, textures,
  modèles de forme, JavaScript), et jamais par un total unique, afin qu'alléger une famille ne
  puisse jamais se payer en dégradant la qualité d'une autre. Les budgets des textures et des
  modèles ne sont pas choisis : ils se déduisent de la règle des paliers, si bien qu'ajouter une
  résolution plus fine ne coûte rien au démarrage.
- **Chaque texture livre les résolutions que sa source contient vraiment**, selon une règle
  mesurée et non un choix au cas par cas : jamais plus large que la source lue à son étiquette, et
  un palier ne se livre que s'il montre réellement quelque chose de plus que le palier du dessous
  agrandi. Encelade, Rhéa, Dioné et Téthys passent d'un aperçu de 1 024 pixels à 8 192, Cérès
  reçoit la vraie mosaïque de la sonde Dawn, Bennu la mosaïque d'OSIRIS-REx drapée sur sa forme
  réelle, et vingt-deux couches récupèrent le palier le plus léger qui leur manquait, si bien
  qu'un corps lointain ne télécharge plus un fichier inutilement gros. À l'inverse, sept fichiers
  ont été retirés là où leurs pixels supplémentaires ne montraient rien (Triton, Saturne, son
  anneau, Uranus, Neptune).
- **Dix corps de plus portent leur vraie forme** au lieu d'une sphère, soit quinze en tout, à
  partir des modèles publiés par les missions et les relevés d'occultation. La texture du corps
  est drapée sur cette forme avec le même matériau que les autres corps, au lieu d'être posée
  sommet par sommet.
- **La position de chaque corps vient désormais de la source la plus précise, mesurée corps par
  corps** contre JPL Horizons et non supposée. Les écarts moyens tombent de 262 600 à 23 kilomètres
  pour Neptune, de 112 200 à 5 pour Uranus, de 80 730 à 4 pour Saturne, de 22 820 à 55 pour
  Jupiter, de 2 891 à 5 pour Mars, de 2 637 à 7 pour Mercure et de 1 428 à 5 pour Vénus. La Lune,
  Io et Europe gardent leur source analytique, parce que la mesure la donne plus précise (10,8
  kilomètres contre 12,6 pour la Lune). Les chiffres complets sont publiés sur la page
  « Méthodologie ».
- **Relief lunaire mesuré** : en s'approchant, le sol de la Lune n'est plus une sphère lisse mais
  la forme que l'altimètre laser du Lunar Reconnaissance Orbiter a relevée. Un socle couvre le
  corps entier à 1,3 kilomètre par point, et trois lieux sont cuits seize fois plus finement, à
  83 mètres : le cratère Tycho, Rima Hadley (site d'Apollo 15) et Statio Tranquillitatis (site
  d'Apollo 11). Le bandeau dit d'où viennent ces altitudes et sur quelle période elles ont été
  relevées. Aucun détail n'est inventé entre deux mesures.
- **Imagerie de surface haute résolution sur la Lune**, chargée seulement quand on s'en
  approche : la mosaïque du Lunar Reconnaissance Orbiter publiée par NASA Trek, à 83 mètres par
  pixel au sol, contre 1,3 kilomètre pour l'image livrée avec l'application. Un bandeau dit
  toujours quelle mosaïque est affichée, à quelle finesse, et sur quelle période ses images ont
  été prises (novembre 2009 à février 2011). Le réglage peut être désactivé, et rien n'est alors
  demandé au réseau. La descente s'arrête désormais à 8 kilomètres du sol lunaire au lieu de 128.
- Événements terrestres, en option et éteints par défaut : séismes du catalogue USGS et
  événements naturels rapportés par NASA EONET, posés à leurs vraies coordonnées sur la Terre
  à la date de la scène. Chaque événement porte sa nature, une mesure sismologique et un
  événement rapporté n'étant pas la même chose, et un événement sans fin déclarée est affiché
  « en cours » plutôt que doté d'une date de fin inventée.
- Les onze sondes et les trois objets interstellaires affichent enfin des chiffres : date de
  lancement et masse pour les sondes (catalogue NASA NSSDCA), excentricité, distance de
  périhélie et première observation pour les interstellaires (base des petits corps du JPL).
  Chaque valeur cite sa source ; quand la source publiée ne décrit pas l'objet, la fiche le
  dit au lieu d'afficher un chiffre trompeur.

### Modifié

- **Ce que montre la première vue suit désormais une seule règle**, au lieu de s'être accumulé au
  fil des ajouts : les grands corps sont nommés, tous les corps du catalogue sont dessinés, seules
  les orbites des planètes sont tracées, et les quatorze objets d'instrument (les onze sondes et
  les trois objets interstellaires) ne sont ni dessinés ni nommés tant qu'on ne les demande pas.
  Auparavant le télescope spatial James Webb et d'autres sondes apparaissaient d'office. Le corps
  sélectionné, lui, est toujours dessiné et nommé.
- **Une sonde en orbite autour d'une planète est posée dans le système de cette planète**, par la
  même règle que ses lunes. En échelle compressée, certaines sondes semblaient jusque-là placées
  DANS leur planète.
- **Les réglages sont regroupés dans une seule surface** « Réglages d'affichage », en sections
  titrées et avec un vocabulaire unique (Étiquette, Objet, Orbite). Deux boutons devenus
  redondants ont disparu au profit d'une section et d'une colonne : celui du champ d'astéroïdes et
  celui des trajectoires interstellaires.

### Corrigé

- **Le chargement des éphémérides échouait en silence sur un lien lent**, et les corps concernés
  repassaient sans le dire sur une source moins précise. Ce qui arrive est désormais gardé, ce qui
  manque est nommé à l'écran et repris, et les requêtes sont limitées à six simultanées, cause
  mesurée de l'échec.
- En s'approchant très près d'un corps, celui-ci **disparaissait entièrement** : le plan de coupe
  de la caméra passait devant sa surface, sans erreur ni message. Le seuil dépendait du corps
  (17 km d'altitude sur la Lune, 64 sur la Terre, 34 sur Mars).
- La distance d'approche minimale était la même pour tous les corps, quelle que soit la finesse
  de leur image : on s'arrêtait deux fois trop haut au-dessus des corps les mieux cartographiés
  et quatre fois trop bas au-dessus des autres. Elle se déduit maintenant de l'image réellement
  affichée.
- La couche des petits corps était **vide en ligne**, en silence : le service de la NASA/JPL
  qu'elle interrogeait répond à un navigateur sans l'en-tête d'origine croisée qu'il lui faut
  pour accepter la réponse. Ses milliers d'astéroïdes et de comètes sont désormais livrés avec
  l'application, sous forme d'instantané daté que le panneau affiche, et la couche fonctionne
  hors ligne.
- La légende de la couche de température satellite n'apparaissait jamais : l'image venait d'un
  autre domaine, que la politique de sécurité du site interdit. Elle est maintenant dessinée
  par l'application, avec le barème de couleurs que la NASA publie pour cette couche.
- L'adresse d'une sonde ou d'un objet interstellaire (`?body=voyager1`) ne rouvrait pas sa
  fiche : l'application écrivait un lien qu'elle refusait ensuite de relire.
- La masse d'une sonde s'affichait en puissance de dix (« 7,22 × 10² kg » pour 721,9 kg).

## [0.9.0] - 2026-09-18 (« Scientific Preview »)

Première version numérotée. Elle regroupe tout ce qui a été livré avant la numérotation.

### Ajouté

- Deux échelles : Éducatif (distances compressées en √) et Exploration (rayons, distances et
  tailles angulaires réels), avec transition animée entre les deux.
- Positions réelles : astronomy-engine, vecteurs NASA/JPL Horizons embarqués (planètes naines,
  satellites), propagation képlérienne des petits corps, noyau SPK optionnel.
- Voyage dans le temps, vitesses de simulation (y compris en arrière), permaliens et partage de
  l'angle de caméra exact.
- Trois objets interstellaires (1I/ʻOumuamua, 2I/Borisov, 3I/ATLAS) sur leur trajectoire
  hyperbolique, vérifiée contre Horizons sur ±20 ans autour du périhélie.
- Onze missions spatiales positionnées par Horizons, dans leur fenêtre de couverture réelle.
- Modèles de forme scientifiques de Bennu, Éros, Itokawa, Ryugu et Ida, en niveaux de détail et
  à leur couleur de surface mesurée.
- Événements astronomiques (phases lunaires, éclipses) et une page par éclipse de 2024 à 2035 ;
  Lune éclipsée cuivrée, teinte mesurée sur photographies NASA.
- Couches météo terrestres réelles (nuages, précipitations, température, pression, humidité,
  vent) avec badge de source, date réelle et statut temporel honnête.
- Une page indexable et une vignette de partage par corps ; interface FR/EN ; tours guidés ;
  mode capture ; WebXR expérimental ; PWA hors ligne.
- Faits sourcés : chaque valeur de la fiche d'un corps et de sa page publique cite sa source
  primaire (NASA, JPL, article), sa méthode (mesurée ou dérivée), sa date quand elle évolue et son
  incertitude quand elle est grande. Les valeurs sans source primaire ne sont plus affichées. Liste
  des sources et décompte sur la page `/sources`.

### Corrigé (16 septembre 2026)

- Fiche d'un satellite : la distance est mesurée depuis sa planète (« Distance moyenne
  (Saturne) » pour Titan), au lieu de « Distance (Terre) » ; même défaut corrigé sur les pages
  publiques, qui annonçaient « Distance from the Sun » pour une lune.
- « Jour » renommé « Rotation sidérale » (ce n'est pas le jour solaire) ; la rotation
  rétrograde de Triton ne s'affiche plus en heures négatives.
- « Température moyenne », « Distance moyenne », « Lunes connues » ; le Soleil n'affiche plus
  « 8 lunes ».

### Ajouté (17 septembre 2026)

- Pages `/methodology` et `/sources`, en anglais et en français, générées au build : méthode de
  calcul des positions, précision mesurée contre NASA/JPL Horizons pour chaque corps et chaque
  source, limites connues, et provenance de chaque texture, modèle, éphéméride, élément orbital,
  service de données et bibliothèque. Liées depuis l'aide.

### Corrigé (17 septembre 2026)

- Attribution des données météo : Open-Meteo (CC BY 4.0), ERA5 (Copernicus) et NASA GIBS sont
  désormais cités, avec lien et licence, dans le panneau météo et dans les crédits.
- Repère écliptique : les positions d'astronomy-engine tournent de l'obliquité J2000 d'Horizons
  (84 381,448″) au lieu d'une valeur arrondie ; toutes les sources partagent un même repère.
- Crédits des modèles de forme affichés dans la langue de l'interface.
- Provenance des textures de la Terre : relief (normal map et carte de hauteur) crédité à NOAA
  ETOPO 2022, et non à NASA Visible Earth.
- Aide : la liste des surfaces illustratives était incomplète et affirmait à tort qu'aucune sonde
  n'avait photographié ces corps.
- Valeurs physiques confrontées à leurs sources : gravité des géantes (moyenne à 1 bar publiée
  par la NASA, et non un calcul au rayon équatorial), masse d'Itokawa (3,51e10 kg publiés),
  rayons de Cérès, Hygie, Titania, Makémaké, Quaoar et Sedna, obliquité de Vesta, rotations du
  Soleil, de Jupiter, d'Éris (synchrone avec Dysnomia) et d'Orcus, températures moyennes des
  planètes (table NASA), comptes de lunes datés. Les températures des satellites, les masses de
  Styx, Kerberos, Néréide, Sedna, Orcus et Makémaké, et les obliquités non mesurées ne sont plus
  affichées : aucune source primaire ne les portait.

### Ajouté (18 septembre 2026)

- Modèle temporel : chaque donnée datée déclare ce qu'elle est (mesure, réanalyse, prévision,
  calcul de position) et l'instant ou l'intervalle qu'elle décrit. L'interface en affiche la
  catégorie là où la donnée s'affiche : en direct, observé, reconstruit, prédit, extrapolé ou
  indisponible. Aucun réglage global ne prétend que toute la scène a la même précision.
- Fiche d'un corps : bloc « Position à cette date » (source qui le place, catégorie, et écart
  moyen mesuré contre NASA/JPL Horizons sur la fenêtre qui contient la date). Une même sélection
  change de source selon la date, et le dit.
- Page `/methodology` : section « Ce que dit une date », en anglais et en français.

### Corrigé (18 septembre 2026)

- Les réanalyses (ERA5, MERRA-2) ne sont plus présentées comme des observations : ce sont des
  modèles, désormais étiquetés « reconstruit ».
- Une scène placée dans le futur reçoit la dernière image satellite réelle, comme avant, mais
  l'écart entre cette image et la date de la scène est maintenant écrit à côté de la source.
- Au-delà de l'horizon des modèles météo, l'étiquette « moyenne climatique » décrivait une donnée
  qui n'était jamais récupérée, pendant que la grille précédente restait affichée. La couche
  masque désormais son rendu, et le vent ses particules, plutôt que de montrer une autre date.

### Modifié

- Nom public unifié : **Galaxy** (le site mélangeait « 3D Solar System » et « Solar System 3D »).
- Types `@types/three` alignés sur la version de `three` réellement utilisée (0.176).

[0.9.0]: https://github.com/Addey34/galaxy-3d/releases/tag/v0.9.0
