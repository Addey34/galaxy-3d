# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Les versions
suivent [SemVer](https://semver.org/lang/fr/). L'historique détaillé reste celui de git : ce
fichier résume ce qui change pour une personne qui utilise ou cite Galaxy.

## [0.9.0] - non publiée (« Scientific Preview »)

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

### Modifié

- Nom public unifié : **Galaxy** (le site mélangeait « 3D Solar System » et « Solar System 3D »).
- Types `@types/three` alignés sur la version de `three` réellement utilisée (0.176).

[0.9.0]: https://github.com/Addey34/galaxy-3d/commits/main
