# Catalogue de l'univers representable

Ce document definit ce que Galaxy peut deja representer, ce qui peut etre ajoute sans changer de frontiere, et ce qui necessite une extension du moteur. Il sert de contrat de contenu : un nouvel objet doit avoir une source de donnees, un referentiel, une representation visuelle et une strategie de performance avant d'entrer dans le catalogue.

## 1. Etat actuel

| Famille                    | Catalogue actuel                                               | Donnees de position                                  | Representation actuelle                 |
| -------------------------- | -------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------- |
| Etoiles et fond            | Soleil, fond etoile                                            | astronomy-engine pour le Soleil, skybox pour le fond | Sphere emettrice, starfield             |
| Planetes                   | Mercure, Venus, Terre, Mars, Jupiter, Saturne, Uranus, Neptune | astronomy-engine                                     | Spheres texturees, couches optionnelles |
| Satellites                 | 29 lunes, de la Lune aux quatre petites lunes de Pluton         | astronomy-engine (Lune, galileennes), sinon binaires Horizons relatifs au parent, repli keplerien | Spheres texturees, bump pour la Lune    |
| Planetes naines            | Ceres, Pluton, Eris, Haumea, Makemake, Orcus, Quaoar, Gonggong, Sedna | Horizons local puis Kepler                     | Spheres texturees                       |
| Petits corps               | Vesta, Pallas, Hygiea, Halley, Bennu (modele de forme 3D)      | Elements orbitaux Kepler, sans repli Horizons        | Spheres texturees et orbites            |
| Collections instrumentales | Champ SBDB des petits corps, filtrable par categorie (NEO, cometes, TNO, ceinture principale) | Donnees chargees en couche UI  | Marqueurs 2D, pas de meshes physiques   |
| Engins spatiaux            | 11 missions, de Voyager 1 a Hayabusa2                          | Binaires Horizons bornes a la couverture reelle de chaque mission | Marqueurs 2D en couche instrument, mode Exploration uniquement |
| Objets interstellaires     | 1I/ʻOumuamua, 2I/Borisov, 3I/ATLAS                             | Elements hyperboliques Horizons (e > 1), fenetre ±20 ans autour du perihelie | Marqueur 2D en couche instrument, Educatif et Exploration ; trajectoire en option (Reglages) |

Les textures actuelles sont dans public/assets/textures/. Le chargeur supporte actuellement des fichiers JPEG nommes par corps, couche et resolution. Les fichiers ephemerides Horizons sont locaux dans public/assets/ephemerides/ : le rendu deploye ne depend pas d'un appel reseau au demarrage.

## 2. Regles de representation

### Corps spheriques

Une planete, lune, naine ou petite sphere n'a pas besoin d'un modele 3D externe : le moteur construit une sphere Three.js et applique les couches configurees.

    public/assets/textures/{body}/{body}_{layer}_{quality}.jpg

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

**Le contrat existe depuis 2026-09-10** : `ModelConfig` dans `src/types.ts` (`url` + `credit`,
tous deux obligatoires), chargement paresseux dans `CelestialObject._loadShapeModel()`,
proprietaire explicite (`_modelRoot` / `_modelMeshes`) et liberation dans `dispose()`. Bennu est
le premier corps a l'utiliser.

**La sphere reste toujours construite.** Le modele ne la remplace pas, il la masque. Le repli
n'est donc pas une branche qu'on pourrait oublier d'ecrire : reseau coupe, 404, glTF illisible,
appareil qui abandonne — le corps reste visible et rond. Un test verifie que tout corps declarant
un modele a bien de quoi s'afficher sans lui (texture ou `fallbackColor`).

**Deux pieges payes une fois**, tous deux invisibles sans mesure :

- **Un modele « leger » trouve en ligne n'est pas forcement un modele de forme.** Celui du depot
  NASA-3D-Resources, seul petit corps qu'il contienne, est une sphere bosselee : ecart-type du
  rayon 0,76 % et rapport equateur/poles 0,999, alors que Bennu est une toupie a 6,00 % et 1,118.
  Son maillage est d'ailleurs nomme « Fake ». Mesurer ces deux nombres AVANT d'integrer un
  maillage, avec `scripts/decimate-shape-model.mjs` qui les imprime.
- **`Box3.getBoundingSphere()` ne donne pas le rayon d'un corps** mais celui de la sphere
  circonscrite a la BOITE, soit la demi-diagonale — √3 fois trop pour un corps rond. Le modele
  sortait 42 % trop petit sans que rien ne le signale. Le calcul vit maintenant dans
  `core/modelFit.ts`, pur et teste.

**Deux autres pieges, payes avec la vague A (2026-09-15)** :

- **Le rayon MAXIMAL n'est pas un rayon moyen.** Le modele etait ajuste en faisant coincider son
  sommet le plus lointain avec le rayon du catalogue — qui est un rayon moyen (equivalent-volume).
  Bennu sortait 15 % trop petit ; Eros et Ida, dont R_max / R_equivalent vaut 2,09 et 2,00,
  seraient sortis deux fois trop petits, en violation directe de l'invariant Explo. L'echelle vient
  maintenant du rayon equivalent-volume et le centrage du centre de masse (`core/modelFit.ts`).
- **Le pole doit etre sur +Y.** La scene fait tourner chaque corps autour de son Y local ; les
  produits PDS, et le fichier SVS de Bennu, portent le pole sur Z. Bennu tournait donc autour d'un
  axe equatorial depuis sa livraison — axe de plus grande inertie mesure a 89,9° de Y. Un test
  verifie maintenant, pour chaque modele livre, que cet axe est a moins de 5° de Y (mesure : 0,1 a
  1,0°), et que son volume retrouve le rayon du catalogue a 3 % pres.

**Mesurer la forme, pas l'echantillonnage.** Les statistiques par sommet (ecart-type du rayon,
rapport equateur/poles) dependent de la repartition des sommets : la grille latitude/longitude
d'Ida donne 0,94 par sommet et 2,3 pondere par l'aire. Le script imprime donc aussi la version
PONDEREE PAR L'AIRE et le rayon equivalent-volume, et c'est sur elle que porte l'alerte de
lissage. Sur les quatre corps de la vague A, decimation comprise : ecart-type a ±0,02 point,
equateur/poles a ±0,001, rayon equivalent a 0,04 % pres.

**Sources et licences retenues** : Eros, Itokawa et Ida viennent de la PDS Small Bodies Node
(donnees NASA, sans restriction) ; Ryugu de JAXA DARTS (politique ISAS : usage libre, commercial
compris, modification permise, credit « ISAS/JAXA » et mention des modifications). Le script lit
directement les tables sommets/plaques et les grilles latitude/longitude de la PDS, et l'OBJ.

**Sautes, et pourquoi** :

- **Apophis** : le seul modele de forme mesure (radar Goldstone/Arecibo, Brozovic et al. 2018)
  n'est pas diffuse — ni PDS3, ni PDS4, ni l'index des modeles radar de la SBN. Il existe des
  modeles convexes par inversion de courbes de lumiere, mais une enveloppe convexe n'est pas une
  forme mesuree : ce serait inventer.
- **67P/Churyumov-Gerasimenko** : les modeles (SHAP5 OSIRIS, MTP019 NAVCAM) sont archives a l'ESA
  sous CC BY-NC 3.0 IGO, dont les conditions visent tout usage « generant directement ou
  indirectement un gain » — douteux avec le bouton de don du site. La version NAVCAM diffusee en
  CC BY-SA IGO 3.0 en 2015 n'est plus en ligne (page d'archive disparue). A reprendre si l'ESA
  confirme l'usage (data.licences@esa.int) ou si la version CC BY-SA reapparait.

**Limite levee le 2026-09-16** : en Explo, la camera s'arretait a 85 km
(`CAMERA_CONTROLS_SETTINGS.exploMinFloor`, 0,00002 unite, soit 350 rayons de Bennu) et son plan
near a 4 km, si bien que les corps sous-kilometriques n'y etaient qu'un point. Le plancher de zoom
et le near sont desormais RELATIFS au corps vise ; on approche Bennu a 1 km et son maillage se
lit. Deux pieges au passage : le near absolu coupait le corps des qu'on approchait, et surtout la
borne d'approche doit se prendre sur le rayon MAXIMAL du maillage (`model.extentRatio`, mesure sur
le fichier) et non sur le rayon moyen — Eros et Ida depassent le double de leur sphere
equivalente, et s'en approcher « a 1,15 rayon » mettait l'objectif DEDANS : ecran noir, sans erreur.

**Poids.** Les modeles scientifiques publies sont hors de portee du web : celui de Bennu fait
3,37 M de triangles et 60 Mo. `scripts/decimate-shape-model.mjs --target N` le ramene au budget
voulu par regroupement de sommets, en imprimant avant/apres les deux statistiques de forme —
sur Bennu 6,00 % → 6,03 % et 1,118 → 1,119, donc la signature du corps survit. Le fichier produit
est deterministe.

**Niveaux de detail (2026-09-16).** Chaque modele est livre en `{corps}/{corps}_shape_{1k,2k,4k}.glb`
(~4 000 / 15 000 / 60 000 triangles), chemin derive par `catalog.modelPath`, niveaux declares dans
`model.resolutions`. Le script REFUSE un niveau que la source ne contient pas : Ida (grille de 2°,
~32 400 triangles d'information) n'a pas de 4k. `core/modelLod.ts` charge le plus leger, puis le
plus fin que justifie la distance (≤ 12 rayons 4k, ≤ 60 rayons 2k), plafonne par le palier de
qualite (bas 1k, moyen 2k, haut 4k). Mesure dans le navigateur : la vue d'ensemble ne telecharge
que des 1k (`e2e/modelLod.spec.ts`). Aucun modele dans le precache PWA.

**Couleur reelle (2026-09-16).** `scripts/bake-shape-colour.mjs` cuit une couleur par sommet dans
chaque niveau. Luminosite moyenne = albedo geometrique PUBLIE × 2,6, convention d'affichage
MESUREE sur la texture lunaire (0,312 pour un albedo de 0,12 ; les autres textures s'etalent de 1,6
a 3,8, ecart assume). Contrastes et couleur tires des cartes de mission : mosaique d'albedo OCAMS
de Bennu, albedo normal en bande v de Ryugu (DARTS), albedos NEAR MSI d'Eros a 760/550/450 nm.
Itokawa et Ida n'ont aucune carte globale publiee : couleur uniforme a leur albedo, via le
materiau. Longitude du bord gauche lue dans les etiquettes GeoTIFF (0° Bennu/Ryugu, −180° Eros).
Deux pieges vus a l'ecran : normaliser chaque bande par sa moyenne effacait la couleur d'Eros ;
un redimensionnement cubique melangeait le NoData (−3,4e38) aux pixels voisins.

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
- [x] Titan, Encelade, Rhéa et Japet, avec vecteurs locaux Horizons issus de SAT441 et mosaïques Cassini/Voyager 1k.
- [x] Contrat PreciseEphemerisProvider et lecteur DAF/SPK types 2/3 (l'adaptateur synchrone SpiceEphemerisService, jamais branché, a été retiré le 2026-09-14 au profit du seul chemin Worker).
- [x] Worker SPK asynchrone pour charger et parser un kernel same-origin hors thread principal.
- [x] Triton, Charon, Phobos et Deimos, avec vecteurs locaux Horizons relatifs au parent et textures USGS/NASA 1k.
- [x] Lunes mineures de Saturne, Uranus, Neptune et Pluton (Mimas, Tethys, Dione, Hyperion, Miranda, Ariel, Umbriel, Titania, Oberon, Protee, Nereide, Styx, Nix, Kerberos, Hydra) et Amalthee.
- [x] Transneptuniens Orcus, Quaoar, Gonggong et Sedna (vague A ci-dessous, partiellement close : Salacia et Varuna restent).
- [x] Vague C close : onze missions (Voyager 1 et 2, Parker Solar Probe, James Webb, New Horizons, Cassini, Juno, Rosetta, BepiColombo, OSIRIS-REx, Hayabusa2). Hubble exclu pour cause, voir la vague C ci-dessous.
- [x] Contrat ModelConfig + premier corps a maillage reel : Bennu, modele de forme OSIRIS-REx decime.
- [x] Vague A, asteroides remarquables : Eros (NEAR, Gaskell), Itokawa (Hayabusa, Gaskell), Ryugu (Hayabusa2, Watanabe et al. 2019) et Ida (Galileo, Thomas et al. 1996), chacun avec son modele de forme scientifique et ses elements Horizons a l'epoque 2026-01-01. **Apophis et 67P sautes, raisons ci-dessous** (§ Corps irreguliers).
- [x] Population SBDB filtrable par categorie, en couche instrument 2D (amorce de la vague B pour la ceinture principale et Kuiper).
- [x] Objets interstellaires 1I/ʻOumuamua, 2I/Borisov et 3I/ATLAS : solveur hyperbolique dans `core/kepler.ts`, elements Horizons a l'epoque de chaque solution (`scripts/derive-interstellar-elements.mjs`), trajectoire bornee a ±20 ans autour du perihelie, la plage verifiee contre les vecteurs Horizons. Les comètes hyperboliques de SBDB restent ecartees : SBDB arrondit `ma` au centieme de degre, ce qui laisse la date de perihelie d'une orbite quasi parabolique libre de centaines de jours.

Le catalogue fait foi, pas cette liste, et **rien ne verifie qu'elle reste juste** : elle a deja
derive une fois, en omettant quinze lunes, quatre transneptuniens et quatre missions deja livres.
Avant de s'y fier, lire `flattenBodies(CELESTIAL_CONFIG)` — c'est l'etat reel en une ligne.

### Vague A - completude du Systeme solaire

Priorite haute, compatible avec les frontieres actuelles :

- lunes galileennes : Io, Europe, Ganymede, Callisto (positions et textures 1k/2k integrees) ;
- [x] Triton et Charon, avec textures USGS et vecteurs Horizons relatifs ;
- [x] Phobos et Deimos, avec textures USGS/NASA et vecteurs Horizons relatifs ;
- [x] asteroides remarquables : Eros, Itokawa, Bennu, Ryugu, Ida (Apophis saute : aucun modele radar public) ;
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

**Close, a une exclusion motivee pres.** Onze missions sont livrees : Voyager 1 et 2, Parker
Solar Probe, James Webb, New Horizons, Cassini, Juno, Rosetta, BepiColombo, OSIRIS-REx et
Hayabusa2 (`src/registry/spacecraft/`, exposes via `src/config/spacecraft.ts`, marqueurs 2D en couche instrument, mode Exploration).

**Hubble est exclu deliberement**, ce n'est pas un oubli : il orbite a 540 km en 95 minutes. A
l'echelle du Systeme solaire son marqueur se superposerait exactement a celui de la Terre, et
l'echantillonnage a 4 jours des binaires ne represente rien d'une orbite de 95 minutes. On
afficherait un point faux a un endroit deja occupe. Son ID Horizons est -48 si la couche
instrument apprend un jour a zoomer sur l'orbite terrestre. Philae n'a pas non plus d'entree
propre : pose sur 67P, sa position est celle de Rosetta a l'echelle ou on la regarde.

Chaque mission a une fiche, une trajectoire locale versionnee et une date de validite. Les
donnees de trajectoire ne sont jamais recuperees a chaque frame depuis une API distante.

**La fenetre de validite est la partie qui demande du soin.** Contrairement a la theorie
planetaire, la solution de trajectoire d'une sonde est bornee dans le temps. Chaque borne est
LUE dans la reponse de Horizons, jamais devinee : demander une fenetre trop large fait repondre
`No ephemeris for target "X" prior to / after <date>`, qui nomme les bornes reelles. En dehors,
`getHeliocentricAU` rend `null` et la couche saute la sonde — c'est ainsi que Cassini cesse de
voler apres sa plongee finale de 2017 et Rosetta apres son poser de 2016, ce qu'un test tient
explicitement.

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
   Pour importer une source validee, utiliser pnpm textures:import --only io
   (un corps a la fois ; --dry-run annonce sans ecrire).

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

Voir aussi ARCHITECTURE.md et TESTING.md.

## 6. Audit et provenance des textures

La commande `pnpm textures:audit` est le controle obligatoire avant d'ajouter ou de remplacer un objet. Elle combine le test du catalogue avec un controle Sharp de chaque JPEG present : fichier lisible, dimensions valides, projection equirectangulaire pour les surfaces et respect du plafond 8k.

La qualite est classee ainsi :

- native : resolution issue de la source mission/cartographique, sans agrandissement artificiel ;
- derivee : LOD reduit depuis une source native ;
- approximative : largeur historique proche d'un palier (par exemple 3674 px ou 4000 px), conservee sans upscale ;
- a verifier : provenance ou projection non documentee.

Une texture ne doit pas etre remplacee par la premiere image trouvee sur le Web. La fiche de la couche dans `src/registry/products/textures/` doit contenir la page officielle, le telechargement, la projection, la resolution native, la licence et le credit. Les mosaïques USGS/NASA sont privilegiees ; les sources trop volumineuses ou non equirectangulaires doivent etre reprojetees et traitees hors du pipeline avant import.

## 7. Sources volumineuses et import local

Les sources cartographiques brutes restent hors Git et hors du bundle public. Le depot conserve les assets JPEG valides, leur provenance et les resolutions effectivement utilisees par le viewer.

Un nouvel asset doit etre importe manuellement depuis une source officielle, controle pour sa projection, sa licence, sa couverture et sa resolution, puis passe par `pnpm textures:audit`. Aucun workflow distant ni bucket externe n'est requis pour le fonctionnement de l'application.

## 8. Contrat de qualite pour les corps actuels et futurs

Pour declarer un corps pret, chaque couche configuree doit etre classee comme native, derived, dynamic ou illustrative dans le manifeste. Une couche normalMap ou bump doit provenir de donnees de relief ou d'un modele documente : l'albedo ne doit jamais etre reutilise comme faux relief. Les couches dynamiques (nuages et atmospheres des geantes gazeuses) sont datees comme des observations, pas comme une surface solide.

Le test textureAssets.test.ts impose une fiche de provenance pour chaque couche et un LOD present sur disque. Le workflow de surface et le workflow DEM acceptent une nouvelle cle sans liste codee en dur ; la validation echoue si la source, la projection ou la resolution manquent. Les sorties de traitement restent dans tmp/ et les sources brutes restent hors Git.

Definition de fini operationnelle : source officielle verifiee, projection equirectangulaire validee pour une sphere, couche scientifiquement justifiee, LOD sans upscale artificiel, fallback explicite si la couverture est incomplete, attribution et licence conservees, audit pnpm textures:audit et gate pnpm verify passes. Une texture seulement plausible mais non verifiee reste un candidat et ne remplace pas l'asset courant.

- [x] Integration runtime SPK optionnelle via Worker, cache synchronise par vitesse et fallback Horizons ;
- [x] Streaming HTTP Range du Worker pour charger les segments SPK a la demande ;
- [x] Publier et verifier un artefact SAT441 same-origin avec support Range en production.
