# Catalogue de l'univers representable

Ce document definit ce que Galaxy peut deja representer, ce qui peut etre ajoute sans changer de frontiere, et ce qui necessite une extension du moteur. Il sert de contrat de contenu : un nouvel objet doit avoir une source de donnees, un referentiel, une representation visuelle et une strategie de performance avant d'entrer dans le catalogue.

## 1. Etat actuel

| Famille                    | Catalogue actuel                                               | Donnees de position                                  | Representation actuelle                 |
| -------------------------- | -------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------- |
| Etoiles et fond            | Soleil, fond etoile                                            | astronomy-engine pour le Soleil, skybox pour le fond | Sphere emettrice, starfield             |
| Planetes                   | Mercure, Venus, Terre, Mars, Jupiter, Saturne, Uranus, Neptune | astronomy-engine                                     | Spheres texturees, couches optionnelles |
| Satellites                 | Lune, Io, Europe, Ganymede, Callisto                           | Terre-Lune et JupiterMoons                           | Spheres texturees, bump pour la Lune    |
| Planetes naines            | Ceres, Pluton, Eris, Haumea, Makemake                          | Horizons local puis Kepler                           | Spheres texturees                       |
| Petits corps               | Vesta, Pallas, Hygiea, Halley                                  | Elements orbitaux Kepler                             | Spheres texturees et orbites            |
| Collections instrumentales | Champ SBDB des petits corps                                    | Donnees chargees en couche UI                        | Marqueurs 2D, pas de meshes physiques   |

Les textures actuelles sont dans public/assets/textures/. Le chargeur supporte actuellement des fichiers JPEG nommes par corps, couche et resolution. Les fichiers ephemerides Horizons sont locaux dans public/assets/ephemerides/ : le rendu deploye ne depend pas d'un appel reseau au demarrage.

## 2. Regles de representation

### Corps spheriques

Une planete, lune, naine ou petite sphere n'a pas besoin d'un modele 3D externe : le moteur construit une sphere Three.js et applique les couches configurees.

    public/assets/textures/{body}/{body}{layer}_{quality}.jpg

Un corps sans texture peut declarer fallbackColor pour obtenir une sphere de secours explicitement
identifiee. Ce fallback ne remplace pas une texture scientifique et doit rester documente.

Couches actuellement reconnues :

- surface : albedo ou couleur visible ;
- normalMap / bump : relief ;
- spec / specularMap : ocean ou surface brillante ;
- clouds : couche transparente en rotation independante ;
- atmosphere : couche atmospherique ;
- lights : lueurs nocturnes ;
- anneaux : texture radiale dediee configuree par RingConfig.

Ne pas ajouter WebP, AVIF, PNG HDR ou KTX2 dans le catalogue avant d'avoir etendu TextureSystem, les tests de chargement et la politique de compatibilite navigateur. Aujourd'hui, le contrat de production est JPEG + LOD 1k, 2k, 4k, 8k.

### Corps irreguliers

Les asteroides et noyaux cometaires peuvent commencer par une sphere visuelle si aucune forme fiable n'est disponible. Une representation fidele devra fournir :

- un maillage glTF/GLB derive d'un modele radar, photometrique ou de mission ;
- une texture albedo et, si disponible, une normal map ;
- les metres, l'orientation et le centre de masse documentes ;
- un fallback sphere explicite pour les appareils faibles.

Le contrat de modele n'existe pas encore dans CelestialBodyConfig. Un fichier .glb ne doit donc pas etre depose seul dans le depot : il faudra d'abord ajouter ModelConfig, un proprietaire de ressources et un chemin dispose().

### Anneaux, atmospheres et champs

- Anneaux : couche locale autour d'un corps, texture radiale, ombres et transparence.
- Atmospheres : shader ou couche sphere, avec epaisseur et diffusion documentees.
- Nuages et aurores : couches animees, jamais confondues avec la surface.
- Ceintures et nuages de poussiere : instancing ou particules, jamais des milliers de meshes individuels.
- Champ d'etoiles : skybox ou catalogue de points, avec magnitude et couleur comme donnees.

### Engins spatiaux et objets artificiels

Les sondes et satellites artificiels doivent vivre dans une couche mission distincte des corps naturels :

    public/assets/models/{mission}/{mission}.glb
    public/assets/textures/{mission}/{mission}Albedo_2k.jpg

Ils necessitent une trajectoire temporelle, un referentiel, une echelle physique, une licence d'asset et une strategie de visibilite. En Exploration, un modele ne peut pas etre agrandi pour le rendre visible ; son label ou une aide d'interface doit rester separe du rendu physique.

## 3. Feuille de route du catalogue

### Etat d'avancement

- [x] Lune terrestre et quatre lunes galileennes avec positions astronomy-engine.
- [x] Textures dediees 2k pour Io, Europe, Ganymede et Callisto.
- [ ] Lunes saturniennes prioritaires : Titan, Encelade, Rhea, Japet.
- [ ] Triton, Charon, Phobos et Deimos.

### Vague A - completude du Systeme solaire

Priorite haute, compatible avec les frontieres actuelles :

- lunes galileennes : Io, Europe, Ganymede, Callisto (positions et textures 1k/2k integrees) ;
- Titan, Encelade, Rhea, Japet ;
- Triton et Charon ;
- Phobos et Deimos ;
- asteroides remarquables : Eros, Itokawa, Bennu, Ryugu, Apophis, Ida ;
- cometes de missions : 67P/Churyumov-Gerasimenko, Tempel 1, Wild 2, Borrelly ;
- objets transneptuniens : Orcus, Quaoar, Gonggong, Salacia, Varuna, Sedna.

Les lunes regulieres peuvent reutiliser frame parentRelative et OrbitalElementsService. Les corps de mission irreguliers attendront le contrat de modele 3D.

### Vague B - structures du Systeme solaire

- ceinture principale d'asteroides, avec densite pedagogique configurable ;
- ceinture de Kuiper ;
- nuage de Oort comme enveloppe statistique, pas comme liste de meshes ;
- poussiere zodiacale ;
- vent solaire et heliosphere comme couches instrumentales ;
- points de Lagrange et orbites de transfert comme objets calcules, sans texture.

Ces ensembles sont des representations de population. Ils ne doivent pas etre confondus avec des objets physiques individuels ni faire croire qu'une position exacte est connue pour chaque point.

### Vague C - missions spatiales

Premiers candidats : Voyager 1/2, New Horizons, Cassini, Juno, Parker Solar Probe, Rosetta/Philae, James Webb, Hubble, BepiColombo, OSIRIS-REx et Hayabusa2.

Chaque mission devra avoir une fiche, une trajectoire locale versionnee et une date de validite. Les donnees de trajectoire ne doivent pas etre recuperees a chaque frame depuis une API distante.

### Vague D - etoiles proches et exoplanetes

Candidats pedagogiques : Proxima Centauri, Alpha Centauri, Sirius, Betelgeuse, Vega, Polaris, TRAPPIST-1, Kepler-186, Kepler-452, 51 Pegasi et les systemes avec planetes confirmees.

Cette vague necessite un nouveau referentiel stellarSystem ou interstellar, une distance en annees-lumiere, des incertitudes de catalogue et une vue distincte du Systeme solaire. Elle ne doit pas etre branchee comme une simple orbite heliocentrique.

### Vague E - ciel profond et cosmologie

- nebuleuses : Orion, Carina, Helix ;
- amas : Pleiades, Omega Centauri, amas globulaire et amas ouverts ;
- galaxies : Voie lactee, Andromede, Triangulum, galaxies proches ;
- trous noirs et disques d'accretion comme shaders ou volumes ;
- filaments, amas de galaxies et fond diffus cosmologique comme vues de contexte.

Ces objets seront principalement des billboards, volumes, skyboxes ou cartes de densite. Ils ne peuvent pas respecter simultanement une echelle metrique unique avec les planetes : le produit devra introduire des niveaux de reference et l'indiquer clairement dans l'interface.

## 4. Contrat d'ajout d'un objet

Avant tout ajout :

1. choisir une cle unique minuscule et un nom localise ;
2. choisir kind, frame et la source de position ;
3. renseigner rayon, periode, orientation, couleur et donnees documentaires ;
4. choisir la representation : sphere, anneau, couche, particules ou futur modele ;
5. fournir les textures et resolutions effectivement presentes ;
6. documenter la source, l'epoque, la licence et la couverture temporelle ;
7. ajouter un test catalogue et un test de position ou de transformation ;
8. ajouter un scenario Playwright si l'objet modifie le boot, la navigation ou le WebGL ;
9. lancer pnpm textures:resize, pnpm verify, pnpm build et les E2E concernes.
   Pour une source validee, utiliser pnpm textures:fetch --body=io,europa.

Un objet incomplet reste dans une roadmap ou une couche de marqueurs. Il n'entre pas dans le rendu physique avec des donnees inventees.

## 5. Definition de fini

Un contenu est considere pret quand :

- le catalogue et les assets ont exactement le meme nom ;
- le fallback est explicite si une texture, une ephemeride ou un modele manque ;
- aucun systeme generique ne contient un branchement par nom ;
- le mode Educatif reste lisible et le mode Exploration conserve distances, rayons et tailles angulaires physiques ;
- la qualite basse ne bloque pas le premier rendu ;
- les assets sont compatibles avec la licence du depot et ne contiennent aucune donnee privee ;
- les ressources Three.js ont un proprietaire et sont liberees par dispose().

Voir aussi ARCHITECTURE.md, TESTING.md et CODE_MAP.md.

## 6. Audit et provenance des textures

La commande `pnpm textures:audit` est le controle obligatoire avant d'ajouter ou de remplacer un objet. Elle combine le test du catalogue avec un controle Sharp de chaque JPEG present : fichier lisible, dimensions valides, projection equirectangulaire pour les surfaces et respect du plafond 8k.

La qualite est classee ainsi :

- native : resolution issue de la source mission/cartographique, sans agrandissement artificiel ;
- derivee : LOD reduit depuis une source native ;
- approximative : largeur historique proche d'un palier (par exemple 3674 px ou 4000 px), conservee sans upscale ;
- a verifier : provenance ou projection non documentee.

Une texture ne doit pas etre remplacee par la premiere image trouvee sur le Web. Le manifeste `scripts/texture-sources.json` doit contenir la page officielle, le telechargement, la projection, la resolution native, la licence et le credit. Les mosaïques USGS/NASA sont privilegiees ; les sources trop volumineuses ou non equirectangulaires doivent etre reprojetees et traitees hors du pipeline avant import.


## 7. Pipeline des sources volumineuses

Une source scientifique brute n'est pas un asset de livraison. Pour une mosaïque comme Vénus
Magellan (environ 109 Go), le flux validé est :

1. conserver l'original hors Git, avec URL officielle, taille, SHA-256, projection et couverture ;
2. traiter par fenêtres/tiles avec GDAL ou un worker équivalent, sans charger toute la mosaïque en mémoire ;
3. reprojeter vers l'équirectangulaire consommée par le viewer, sans inventer les zones NoData ;
4. générer seulement les LOD 1k/2k/4k/8k utiles, en distinguant albedo, relief et masques de données ;
5. auditer dimensions, ratio, licence et checksums avant publication ;
6. publier les dérivés dans Cloud Storage et garder 1k/2k localement comme fallback.

GitHub reste réservé au code, au manifeste et aux petits dérivés contrôlés. Git LFS n'est pas une
solution pour l'archive de 109 Go : les limites de fichier et le coût de clonage restent inadaptés.
Le traitement d'une source brute se prépare avec `pnpm textures:process-large --body=venus --source=<local-file>` (dry-run). GDAL est requis pour le `--apply` ; Sharp ne reçoit ensuite que la mosaïque intermédiaire bornée.

Le script `pnpm textures:publish --bucket=<bucket>` ne publie que les fichiers déjà présents dans
`public/assets/textures/`, fonctionne en dry-run par défaut et n'active l'envoi qu'avec `--apply`.

## 8. Contrat de qualite pour les corps actuels et futurs

Pour declarer un corps pret, chaque couche configuree doit etre classee comme native, derived, dynamic ou illustrative dans le manifeste. Une couche normalMap ou bump doit provenir de donnees de relief ou d'un modele documente : l'albedo ne doit jamais etre reutilise comme faux relief. Les couches dynamiques (nuages et atmospheres des geantes gazeuses) sont datees comme des observations, pas comme une surface solide.

Le test textureAssets.test.ts impose une fiche de provenance pour chaque couche et un LOD present sur disque. Le workflow de surface et le workflow DEM acceptent une nouvelle cle sans liste codee en dur ; la validation echoue si la source, la projection ou la resolution manquent. Les sorties de traitement restent dans tmp/ et les sources brutes restent hors Git.

Definition de fini operationnelle : source officielle verifiee, projection equirectangulaire validee pour une sphere, couche scientifiquement justifiee, LOD sans upscale artificiel, fallback explicite si la couverture est incomplete, attribution et licence conservees, audit pnpm textures:audit et gate pnpm verify passes. Une texture seulement plausible mais non verifiee reste un candidat et ne remplace pas l'asset courant.
