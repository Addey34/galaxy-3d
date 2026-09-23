# Architecture — Solar System 3D

> Vue d'ensemble et arborescence : [`README.md`](../README.md). Invariants à respecter et marche
> à suivre pour contribuer : [`CONTRIBUTING.md`](../CONTRIBUTING.md). Cette page documente
> l'ordre exact de la boucle par frame, la propriété des ressources, la carte CSS, le contrat de
> sécurité et le pipeline de contenu.

## Boucle par frame

```text
requestAnimationFrame
  -> tween caméra
  -> OrbitalMechanics (date + positions)
  -> éclairage physique / occultation en Exploration
  -> frustum culling + rotation des corps + shaders
  -> suivi caméra
  -> LOD textures périodique
  -> callbacks UI (labels, petits corps, distance cible)
  -> rendu WebGL
```

## Index des répertoires

| Répertoire                  | Responsabilité                                                | Dépendances autorisées                 |
| --------------------------- | -------------------------------------------------------------- | -------------------------------------- |
| `src/config`                | Catalogues et réglages moteur                                  | Données pures et types partagés        |
| `src/core`                  | Horloges, repères, échelles, éphémérides, mécanique orbitale   | Three.js seulement à la frontière service |
| `src/components/systems`    | Renderer, caméra, textures, éclairage, animation               | Three.js et config                     |
| `src/components/celestial`  | Construction et disposal des meshes/couches                    | Three.js, config et TextureSystem      |
| `src/ui`                    | Contrôles DOM et overlays projetés                              | DOM, i18n et PublicAPI                 |
| `src/i18n`                  | État de locale et traduction statique/dynamique                | DOM seulement dans `dom.ts`            |
| `src/utils`                 | Helpers navigateur transverses et logging                       | Pas d'orchestration applicative        |
| `src/seo`                   | Pages d'atterrissage par corps et par éclipse, pages `/methodology` et `/sources`, sitemap, vignettes | Catalogue seulement — **jamais chargé par l'application**, tenu par `src/seo/buildOnly.test.ts` |
| `scripts`                   | Génération d'assets réservée aux mainteneurs                   | Node.js et dépendances de dev          |

## Propriété des ressources

- `SceneSystem` possède scène, renderer, lignes d'orbite et corps construits.
- `TextureSystem` possède le cache de textures GPU et les promesses de chargement.
- `CelestialObject` possède géométries et matériaux et se désinscrit d'`AnimationSystem` lors de `dispose()`.
- `AnimationSystem` annule le RAF, vide ses callbacks et son cache d'updatables.
- `SolarSystemApp.dispose()` orchestre le nettoyage dans l'ordre inverse de l'initialisation.

Toute nouvelle ressource doit avoir un propriétaire unique et un chemin de libération explicite.

## Carte CSS

`src/styles.css` est volontairement une seule feuille déployable. Ses sections sont ordonnées par
propriétaire de mise en page : surface de scène partagée et règles d'input navigateur ; nav du
haut ; sélecteur de mode ; loader/erreur ; aide/langue/crédits ; panneau temps/lecture ; visite
guidée ; overrides mobile ; options d'orbite ; labels Exploration projetés et fiche corps.

Les variables partagées `.scene-panel` sont le contrat visuel des overlays : un composant peut
surcharger son accent ou sa géométrie, mais ne doit pas dupliquer la surface, la bordure, le flou
et l'ombre de base. Les règles mobiles désactivent le flou de fond coûteux, bornent la largeur des
panneaux au viewport, préservent des cibles tactiles classe 44px, et gardent les contrôles de mode
au-dessus du panneau temps.

`overlayCoordinator.ts` possède l'exclusivité contextuelle (fiche corps, options d'orbite,
événements et aide se ferment mutuellement). `timePanel.ts` compose le deck de commande persistant.
Quand on ajoute un sélecteur, vérifier son producteur dans `index.html` ou `src/ui` — les labels
dynamiques d'`exploHud.ts` peuvent être absents du HTML statique tout en étant vivants. Préférer
l'état de classe à l'état de style inline pour que le clavier et les audits d'accessibilité
automatisés observent le même résultat.

## Contrat de sécurité

Firebase Hosting fournit CSP et en-têtes de durcissement depuis `firebase.json`. L'application doit
donc garder scripts et styles externes et ne jamais réintroduire de gestionnaires d'événements
inline. Le texte utilisateur est assigné via `textContent` ; pas de parsing HTML pour du contenu
traduit ou dérivé du réseau.

Le manifeste Horizons est traité comme une entrée non fiable : schéma, plages numériques, nom de
fichier binaire haché et URL same-origin sont vérifiés avant de charger un binaire. Les liens
externes vers un corps sont restreints aux hôtes Wikipedia HTTPS, toujours avec `noopener
noreferrer`.

Ces contrôles ne font pas d'un front public un coffre secret : clés API, identifiants et fichiers
de compte de service restent hors du bundle client et sont ignorés par Git.

**Ces en-têtes sont désormais TENUS, au commit et après déploiement.** Ils ne l'étaient pas :
leur disparition ne casse rien, ne ralentit rien, et ne se voit qu'en interrogeant le site à la
main — une en-tête retirée par inadvertance ne se manifeste que le jour où elle aurait servi.
`src/config/hostingPayload.test.ts` exige les huit sur le bloc `**` et refuse une CSP qui
passerait la liste sans rien protéger (`default-src *`), parce que vérifier la présence d'une clé
ne dit rien de sa valeur.

Le même test garde le **cache**, et celui-là est sans retour arrière : `/assets/**` porte un cache
immuable d'un an, ce qui est juste puisque ces noms sont hachés, mais les vignettes de partage ont
un nom STABLE et des octets réécrits à chaque build. Les faire tomber sous cette règle figerait
une image fausse chez tous ceux qui l'ont déjà vue, et aucun redéploiement ne la corrigerait.
Tout cache long déclaré hors de `/assets/` est donc refusé.

Enfin, `scripts/check-deployed-bundle.mjs` tourne en CI **après** le déploiement : il récupère
l'index servi et compare le nom haché de l'entrée applicative à celle qu'on vient de construire,
puis vérifie l'en-tête de cache d'une vignette. Il ne bloque rien — il tourne après, il ne peut
rien empêcher — mais il transforme une question qu'il fallait penser à se poser en une réponse
qui s'affiche. « CI verte » ne dit rien de ce qui est en ligne, et lire la pastille globale d'un
run au lieu du job qui déploie a produit deux affirmations fausses sur l'état de la production.

## Pipeline de contenu et d'assets

Le catalogue est organisé en trois niveaux : données (position, époque, référentiel, rayon,
orientation, source, incertitude), représentation (sphère, couche texturée, anneau, particules ou
futur modèle 3D), présentation (labels, fiche, couleur, filtres, aides de navigation).

**Depuis le lot 7 (phase 4), le catalogue est de la donnée, pas du TypeScript.** Chaque corps est
une fiche JSON dans `src/registry/entities/` (un fait = un seul objet : valeur, unité, source,
méthode, `asOf`, incertitude, ou `published: false` + raison ; un calcul se DÉCLARE par une forme
nommée sur un ensemble fermé, `{"$deg": 7.25}`, `{"$gm": …}`, connu de `src/registry/load.ts`),
l'ordre de premier niveau est `order.json` et les satellites sont la liste de leur fiche parente.
`src/registry/load.ts` reconstruit le `CelestialConfig` à l'identité de bits près, et
`config/bodies.ts` ne garde que du code : dérivation des chemins de texture et contrôles
structurels. Ajouter un corps = ajouter une fiche et régénérer les artefacts de relevé
(`pnpm facts:snapshot`, `pnpm ephemeris:validate`) — corps d'épreuve livré : 16 Psyché, ajoutée
sans toucher une ligne de TypeScript, fiche et artefacts régénérés par script uniquement.

Les corps naturels sont ajoutés au catalogue avant leurs assets. Les textures JPEG suivent
`public/assets/textures/{body}/{body}_{layer}_{quality}.jpg` (snake_case ; le chemin est dérivé de
la clé du corps par `catalog.texturePath`, jamais écrit à la main). Modèles GLB, missions,
populations et ciel profond attendent une capacité de rendu typée, un propriétaire GPU, une
politique LOD et un fallback avant d'entrer dans le catalogue — voir `docs/UNIVERSE_CATALOG.md`
pour la matrice complète des familles, assets et candidats.

`generate-horizons-ephemerides.mjs` télécharge des vecteurs JPL Horizons fixes et écrit le
manifeste local plus les binaires hachés ; ces fichiers générés vivent dans
`public/assets/ephemerides` car le déploiement doit fonctionner sans appel réseau NASA au
démarrage. `resize-textures.mjs` crée les résolutions dérivées manquantes sans jamais écraser une
destination existante — outil mainteneur, pas partie du bundle navigateur. Ne pas ajouter de
rapports générés, fichiers temporaires, identifiants ou état Firebase local au dépôt : `.gitignore`
couvre ces sorties, les éphémérides et textures commitées restent des assets de déploiement
intentionnellement suivis.

## Checklist de changement

1. Étendre la configuration/catalogue en premier.
2. Garder les calculs purs dans `src/core` et ajouter un test Vitest déterministe.
3. Donner à chaque ressource Three.js un propriétaire unique et un chemin de disposal explicite.
4. Utiliser les API DOM et des nœuds de texte traduits pour la sortie UI.
5. Ajouter ou mettre à jour un contrat Playwright pour tout comportement UI/WebGL visible.
6. Lancer `pnpm verify`, `pnpm build`, et l'e2e ciblé ; `pnpm verify:all` pour une release ou un
   changement UI substantiel.

Voir aussi [`TESTING.md`](./TESTING.md).

## Position d'un corps — quelle source, quelle interpolation

Quatre défauts livrés se sont logés dans cette chaîne sans qu'aucun ne produise d'erreur ni de
log : une position fausse reste une position. Les règles ci-dessous sont donc écrites une fois
ici, et chacune est verrouillée par un test nommé.

### Les sources, par ordre de priorité

`OrbitalMechanics._positionAU` essaie dans cet ordre, et le premier qui répond gagne :

| Source | Pour qui | Remarque |
| --- | --- | --- |
| Binaire Horizons (`HorizonsEphemerisService`) | planètes (dont Jupiter et Uranus depuis le lot 2b), naines, satellites, sondes, et depuis le lot 11 tous les petits corps du catalogue | états exacts à pas fixe par fichier (4 jours en général, 1 jour pour 5 sondes, 4 à 64 jours pour les petits corps : cf. « Binaires des petits corps ») |
| Noyau SPK (optionnel, `VITE_SPK_KERNEL_URL`) | lunes de Saturne de SAT441 | prime sur les binaires quand il est actif |
| `JupiterMoons()` d'astronomy-engine | Io et Europe ; Ganymède et Callisto hors de la couverture de leur fichier | vecteurs jovicentriques directs |
| Éphéméride astronomy-engine (`astroBody`) | la Lune, Io et Europe (plus précis que tout fichier abordable, mesuré au lot 12), le Soleil, et le repli des planètes hors de la couverture de leur fichier | théorie planétaire |
| Éléments képlériens du catalogue | **repli** d'un petit corps hors de la couverture de son binaire, et de tout satellite | cf. « le repli » ci-dessous |

Une position issue d'un binaire passe d'abord `isPlausibleRelativePosition` /
`isPlausibleHeliocentricPosition`, qui bornent la distance **des deux côtés**. La borne basse
n'est pas décorative : c'est son absence qui a laissé Encelade osciller d'un facteur 11,4 en
distance à Saturne pendant des mois, sous un garde-fou censé attraper exactement ça.

La borne héliocentrique d'un corps qui a des éléments est **[q/2 ; 2Q]** (périhélie, aphélie),
comme la borne relative, et non plus [a/2 ; 2a]. Celle-ci ne vaut que pour une orbite presque
circulaire : mesurée au lot 11 sur les vecteurs Horizons à un jour de 1900 à 2100, elle aurait
refusé Sedna **tous les jours** (a = 506 UA, le corps entre 76 et 132 UA) et Halley 5 284 jours
autour de ses périhélies. Un binaire exact aurait été écarté en silence au profit des éléments.
`ephemerisPlausibility.test.ts` balaie désormais 2 000 dates de chaque binaire héliocentrique
(il ne regardait que la date du milieu, où Halley passait).

**Tout est mesuré contre JPL Horizons** par `pnpm ephemeris:validate`
(`scripts/validate-against-horizons.mjs`, rapport dans `reports/`, non versionné, et un résumé
versionné `src/config/horizons-validation-summary.json` que publie `/methodology`) : erreur
moyenne, médiane, p95, max par corps et par source, en km et en rayons.

### Une seule échelle de temps : `core/timeScale.ts`

Une `Date` est lue en UTC ; TT = UTC + table des secondes intercalaires depuis 1972, **figée à
69,184 s après 2017** (ce que fait Horizons pour `TIME_TYPE=UT`, et l'hypothèse défendable
depuis l'abandon des secondes intercalaires voté en 2022) ; avant 1972, UT1 et le ΔT historique
d'Espenak-Meeus. Le module installe cette convention dans astronomy-engine
(`SetDeltaTFunction`) à son import, et fournit la seule conversion vers TDB (binaires, SPK).
Trois chemins avaient chacun la leur : le SPK et astronomy-engine extrapolaient ΔT (383 s en
2175), d'où Titan à 1 733 km en 2175 pour une erreur de noyau de quelques km, et Mercure à
51 000 km en 2400. `timeScale.test.ts` exige l'import dans tout module qui passe une date à
astronomy-engine.

### Interpolation entre deux échantillons : jamais une cubique seule

Un fichier Horizons est échantillonné à pas fixe. L'interpolation de Hermite entre deux états
suppose un mouvement **lisse sur l'intervalle**, hypothèse fausse dès que le corps y fait
plusieurs tours. Avec le pas de 4 jours livré, 22 des 24 satellites du catalogue ont une période
plus courte que ce pas, et la cubique ne reconstruisait alors plus rien : Phobos balayait 2° au
lieu de 360° sur une période.

`HorizonsEphemerisService` choisit donc son interpolation d'après le nombre d'échantillons par
révolution, calculé sur la période **catalogue** (stable) et non sur la période osculatrice de
l'état courant (erratique dès que le mouvement n'est pas à deux corps) :

- **≥ 100 échantillons/orbite** → Hermite cubique (planètes, sondes).
- **< 100** → `twoBodyPropagation.ts` : les deux états qui encadrent la date sont propagés le long
  de leur conique, l'un vers l'avant l'autre vers l'arrière, puis fondus en smoothstep. Chaque
  ancre reste exacte à l'échantillon (poids 0 puis 1, dérivée nulle aux deux bouts → raccord C¹),
  donc les perturbations réelles restent portées par les données. **On ne remplace pas les
  données par un modèle, on les relie par la bonne courbe.**

Le seuil a longtemps valu 5, mesuré alors que la dynamique portait encore les deux biais
ci-dessous ; remesuré ensuite palier par palier contre Horizons : Hypérion 5 455 → 65 km,
Néréide 50 → 12, Japet 47 → 39, et Mars (172 éch./orbite), où la cubique repasse devant.

Deux biais retirés, parce qu'ils faisaient perdre la dynamique pour de mauvaises raisons :

- **Le ballant autour d'un barycentre** (`BodyDynamics.reflex`, `config/gravity.ts`). Un
  satellite de plus de 5 % de sa planète la fait tourner hors d'elle : Charon promène Pluton sur
  ~2 100 km en 6,39 jours, que 4 jours ne résolvent pas (Pluton 579 km d'erreur, ses petites
  lunes 460 à 570). Les échantillons étant exacts, le barycentre l'est aussi à chaque
  échantillon (B = P + q·C) : on interpole la série lisse et on rajoute le ballant à la date
  depuis le binaire de Charon. Pluton 579 → 1,9 km, sans un octet d'asset.
- **La période osculatrice sous J2** (`MEAN_MOTION_PROPAGATION`). Près d'une planète aplatie,
  l'état osculateur surestime a, donc la période (Mimas 5 355 ppm) : la conique est parcourue au
  rythme moyen, facteur constant par fichier. Liste déclarée et non règle, parce que mesurée
  corps par corps : ailleurs la correction dégrade (Titan 19 → 33 km).

La propagation a besoin d'un μ : `config/gravity.ts` le dérive des masses du catalogue, avec la
règle du problème à deux corps relatif : **la masse du parent plus tout ce qui orbite à
l'intérieur de l'orbite du corps, lui compris**. Charon pèse 12,2 % de Pluton : l'ignorer donnait
13° d'erreur de phase par pas.

**SPK** : la façade synchrone (`SpkWorkerEphemerisProvider`) et le Worker choisissent leurs
segments par la même fonction, `planSpkSegments` (segment direct, sinon centre commun). La façade
n'indexait que les paires directes ; SAT441 ne stockant les lunes que par rapport au barycentre
de Saturne, aucune position n'était jamais demandée, même noyau activé.

### Binaires des petits corps (lot 11)

Les quatorze corps que seuls leurs éléments plaçaient (erreur moyenne de 1,4e4 km pour Sedna à
1,7e8 km pour Bennu sur 1900-2100) ont un binaire, produit par
`scripts/generate-horizons-ephemerides.mjs --only …`. L'écart mesuré en production tombe à
quelques km pour chacun ; les chiffres font foi sur `/methodology`, pas ici. Trois décisions :

- **Le pas est choisi par corps, et mesuré.** C'est le plus grossier dont l'interpolation, par
  le chemin même du service, reste sous 20 km d'écart MAXIMAL à des vecteurs Horizons au pas
  d'un jour sur toute la plage (l'écart maximal déjà accepté du fichier de Cérès), jamais plus
  fin que 4 jours. Transneptuniens à 64 jours, astéroïdes de la ceinture à 8 ou 16, géocroiseurs
  et Halley à 4 (leur écart maximal vient des rencontres avec la Terre ou du périhélie). Le
  tableau de mesure est en commentaire dans le générateur. Coût : 6,4 Mo, contre 12,3 au pas
  uniforme de 4 jours.
- **La requête est coupée à l'époque de la solution** (`splitAtSolutionEpoch`). Pour un petit
  corps qu'il intègre, Horizons rend une position qui dépend de l'ÉTENDUE de la requête : une
  requête 1900-2101 coïncide avec une requête courte au début de la plage et s'en écarte ensuite,
  comme une intégration partie de la première date. Itokawa, qui croise souvent la Terre,
  s'écartait ainsi de 14 663 km en 2098. Coupée à l'époque (lue dans la ligne `EPOCH=` de
  l'en-tête), chaque moitié part de la solution et l'écart tombe sous 3 km. Bennu est l'exception
  déclarée : Horizons le lit dans le fichier de trajectoire de la mission OSIRIS-REx, sans ligne
  EPOCH, et la requête longue n'y dérive pas (0,0 km).
- **La validation a le même défaut, et il est corrigé au même endroit.** Une liste de 48 dates
  étalée sur deux siècles se comporte comme la requête longue : le binaire d'Itokawa s'en
  écartait de 775 km en moyenne, et de 3,7 km de requêtes courtes, une par date. La référence
  mesurait sa propre dérive. `validate-against-horizons.mjs` coupe donc ses listes à l'époque
  pour tout corps qui en a une. La référence corrigée mesurait Cérès, Éris, Hauméa et Makémaké,
  dont les binaires étaient antérieurs à la coupure, 0,5 à 1 km plus loin ; régénérés coupés
  (lot 11b), ils passent sous leurs valeurs d'avant (Éris 0,32 km en moyenne).

**Chargés au démarrage, comme les autres, par décision mesurée.** Un chargement à la demande
aurait placé le corps sur ses éléments jusqu'à l'arrivée du fichier, puis l'aurait fait sauter
(jusqu'à 1,7e8 km pour Bennu), ou exigé un état « position en attente » qui n'existe nulle part.
Mesuré A/B sur le même build, ancien manifeste servi contre nouveau (`page.route`, réseau bridé
par CDP) : +6,4 Mo servis (32,57 → 38,96 Mo d'éphémérides), aucun écart sans bridage, +1,0 s à
50 Mbit/s (16,1 → 17,0 s jusqu'au loader caché), +5,4 s à 10 Mbit/s (36,7 → 42,1 s). **Les
éphémérides pèsent désormais environ les trois quarts des octets du démarrage** : les charger
toutes à la demande est un chantier à part entière, qui demanderait sa conversation de
conception.

### Pas optimisé pour tous les fichiers, et parité (lot 12)

La règle du lot 11 (le pas le plus grossier sous 20 km d'écart maximal d'interpolation, mesuré
par le code même du service) s'applique à **tous** les fichiers, pas seulement aux nouveaux.
Mesuré en décimant chaque fichier livré contre ses propres échantillons : Cérès passe à 16 jours,
Éris, Hauméa et Makémaké à 64, Mars, Déimos et Triton à 8. Rien d'autre ne tient : Pluton
tiendrait 32 jours, mais son ballant se lit sur Charon à la même grille, et les petites lunes de
Pluton ne tiennent pas plus de 4 jours ; les géantes, les autres lunes et les sondes dépassent
20 km dès le double du pas.

Parité : un corps qu'astronomy-engine plaçait seul reçoit un fichier **quand il fait mieux**,
mesuré contre des vecteurs Horizons à un jour, dans le même repère. Mercure, Vénus et le
barycentre Terre-Lune (où la Terre est dessinée) à 8 jours, Ganymède à 2, Callisto à 4. La Lune,
Io et Europe n'en ont pas, et c'est mesuré : à un pas abordable leur interpolation reste au-dessus
d'astronomy-engine (Lune 86 km au pas de 2 jours contre 10,8 ; Io 362 au mieux contre 218 ;
Europe 250 contre 119). Pour eux, la parité est la position mesurée contre Horizons, qu'ils ont.
Les chiffres de production font foi sur `/methodology`. Poids, en octets exacts du manifeste :
4,46 Mo économisés sur les fichiers existants, 3,96 Mo ajoutés (dont Ganymède, 1,76 Mo au pas de
2 jours), soit 38,94 → 38,45 Mo pour cinq fichiers de plus ; démarrage inchangé à la mesure
(16,9 s à 50 Mbit/s, 41,5 s à 10).

### Le repli képlérien

Il sert quand un binaire manque, sort de sa couverture ou échoue au test de plausibilité —
notamment si les assets ne se chargent pas, auquel cas il travaille **aux dates courantes**.
Deux règles :

- **Le corps central n'est pas le Soleil.** `kepler.ts` déduit sinon le mouvement moyen de la
  constante de Gauss, soit μ☉ : un satellite tournait de 32× à 11 661× trop vite. Passer
  `periodDays` est obligatoire pour tout `relativeOrbitalElements`.
- **Cette période est la période SIDÉRALE MOYENNE, pas l'osculatrice.** Mimas, Téthys, Dioné,
  Hypérion, les lunes d'Uranus, Protée, Amalthée et Phobos portaient 2π√(a³/μ) de leur état,
  faux de 47 à 6 957 ppm : phase aléatoire en quelques semaines. Elle vient de
  `derive-relative-elements.mjs --mean-motion` (taux moyen mesuré sur 200 ans de binaire, qui
  retrouve les périodes publiées par JPL), et la rotation des lunes synchrones la reprend au
  chiffre près (`bodies.test.ts`). Horizon de validité mesuré et tenu par
  `relativeElements.test.ts` : ≤ 12 % du rayon orbital à 10 ans, sauf Mimas (résonance avec
  Téthys), Hypérion (chaotique) et Miranda (plan qui précesse). Le repli n'est pas coupé au-delà :
  `null` gèlerait le corps en Éduc et le cacherait dans sa planète en Explo.
- **Les angles sont ÉCLIPTIQUES.** Les valeurs publiées le sont souvent par rapport à l'équateur
  de la planète, et rien ne distingue les deux dans un fichier de config : 8 jeux sur 20 étaient
  dans le mauvais repère. Ne pas les saisir à la main : `scripts/derive-relative-elements.mjs`
  (`pnpm ephemeris:elements`) les dérive des états exacts des binaires.

Pour les petits corps héliocentriques (`config/smallBodies.ts`), chaque jeu est l'osculateur
Horizons **exactement** à son époque (`pnpm ephemeris:small-body`), comparé à un vecteur
Horizons à cette époque par `smallBodies.test.ts` (Cérès, Éris, Hauméa, Makémaké et Pluton
étaient faux dès l'époque : Cérès à 5,8e8 km). Au-delà de Neptune ils sont **barycentriques**
(`barycentric: true`, `--center 500@0`, μ augmenté des planètes, barycentre ajouté par
astronomy-engine) : l'osculateur héliocentrique y porte le réflexe solaire de 12 ans (Éris
2,5e7 km sur 1900-2100 en héliocentrique, 1,1e4 en barycentrique ; l'inverse pour Cérès).

### Ligne d'orbite : répartir les points, pas le temps

`computeOrbitPoints` échantillonne une période. Uniformément **dans le temps**, la deuxième loi
de Kepler place presque tous les points près de l'aphélie : Halley (e = 0,967) se retrouvait avec
une corde droite de 130° en travers du périhélie, et la courbe n'atteignait jamais sa distance
minimale. Les points sont donc répartis uniformément en **anomalie excentrique** dès que
e ≥ 0,2 — seule la répartition change, jamais la courbe.

Trois règles de plus, trouvées au lot 11 quand les corps excentriques ont reçu un binaire, et
toutes invisibles tant que corps et ligne venaient des mêmes éléments :

- **La phase 0 tombe sur la date affichée.** L'anomalie moyenne courante est recalculée depuis
  l'anomalie excentrique résolue : `solveKepler` ramène M dans [-π ; π], et la valeur brute,
  qui compte les tours depuis l'époque, décalait chaque date de la ligne d'un nombre entier de
  périodes. Halley en 2026 était tracé sur sa révolution de 1950, à 2e7 km du corps.
- **L'orbite qui répartit les points est celle de la source qui les fournit.** Ligne tirée d'un
  binaire héliocentrique : orbite osculatrice de son état à la date (vitesse par différence
  centrée). Ligne tirée des éléments : les éléments. Répartie par les éléments alors qu'elle
  venait du binaire, la ligne de Halley s'ouvrait de 24° à son périhélie de 2061 en Éducatif.
- **Quand le binaire répond à la date sans couvrir toute la période, la ligne est la conique
  osculatrice de son état** (`osculatingOrbitPoints`), et non plus les éléments. Sinon le corps
  (binaire) et sa ligne (éléments) venaient de deux sources, et leur écart devenait l'écart
  entre le corps et sa propre orbite : 1,5e8 km pour Halley de 1900 à 1938 et de 2063 à 2100,
  jusqu'à 3e6 km pour les astéroïdes dans leur première et leur dernière demi-période, Cérès
  comprise. Pas pour les éléments **barycentriques** (transneptuniens) : leur état
  héliocentrique porte le ballant du Soleil, et leurs éléments ne s'écartent du corps que de
  2,4e6 km au plus (Quaoar en 1900, à 43 UA : 0,02°).

### Trajectoires ouvertes : les objets interstellaires

1I/ʻOumuamua, 2I/Borisov et 3I/ATLAS suivent une hyperbole (e > 1). Ils ne passent **pas** par
`OrbitalMechanics` ni par le catalogue : pas de mesh (quelques centaines de mètres, invisibles à
vraie échelle), donc couche instrument 2D, `ui/interstellarOverlay.ts`. Quatre règles :

- **Le solveur n'est pas celui de l'ellipse.** `solveHyperbolicKepler` résout
  `M = e·sinh F − F` ; M n'est pas un angle et ne se réduit **jamais** modulo 2π (Horizons donne
  818° pour 3I à son époque). `keplerianPositionEcliptic` aiguille sur e > 1 ; a est négatif,
  convention Horizons.
- **Les éléments viennent d'Horizons, à l'époque de sa propre solution**
  (`scripts/derive-interstellar-elements.mjs`, `pnpm ephemeris:interstellar`, cible vérifiée par
  son nom). Mesuré contre 21 vecteurs Horizons, accélérations non gravitationnelles comprises :
  ≤ 0,1 % de la distance sur ±20 ans, 0,3 % au périhélie de 1I (0,26 UA).
- **Une trajectoire ouverte n'a pas de tour complet : sa fenêtre est bornée**, à ±20 ans autour
  du périhélie — exactement la plage vérifiée. Hors fenêtre, ni marqueur ni ligne. La ligne ne
  dépend donc pas de la date : calculée une fois, seule sa projection change par frame.
- **La ligne est répartie en anomalie hyperbolique F**, pas dans le temps. En temps uniforme,
  1I franchissait 178,5° entre deux points consécutifs et ne descendait jamais sous 2,17 × q :
  le défaut de Halley en pire. En F : 3,7° au pire, 1,0003 × q.

La couche est active dans les **deux** modes. En Éducatif chaque point subit la compression √
des planètes, et pendant la transition elle lit `OrbitalMechanics.scaleMorph`, le même facteur
que les corps — sans quoi la trajectoire décrocherait d'eux pendant 1,2 s.

**Coût de rendu, mesuré.** Active en Éducatif, elle repeint un canvas plein écran là où aucune
couche 2D ne le faisait avant. Sa première version (pointillés `setLineDash`, tous segments
tracés) a été attrapée par `e2e/perf-fps.spec.ts` dans la suite complète, puis mesurée A/B avec
et sans la couche : 12 contre 50 fps en vue mobile sous CPU ×4. Un motif de tirets se calcule sur
toute la longueur tracée, or une trajectoire de ±20 ans déborde de l'écran de milliers de pixels.
Trait plein et segments hors écran écartés : parité (16 / 12,5 / 59 fps), même en forçant un
redessin à chaque frame. Le saut de redessin quand rien ne bouge n'est qu'une économie de repos.

**Pourquoi SBDB écarte toujours e ≥ 1** (`core/sbdb.ts`) : ce n'est plus faute de solveur.
SBDB arrondit `ma` au centième de degré ; pour une comète quasi parabolique (a ≈ −2900 UA) cela
laisse la date du périhélie libre de ±800 jours. Il faudrait `tp` et `q` pour les positionner.

### Un chargement partiel se garde, se reprend, et se dit (lot 15)

Les 64 binaires étaient demandés par un `Promise.all` enveloppé dans un `catch` : **une seule
rejection rendait un service VIDE**, et rien ne le disait, `Logger.warn` étant muet hors debug.
Mesuré en production le 2026-09-22 depuis un lien à 24 ko/s, en rejouant le pipeline du service
dans la page : **25 fetchs sur 64 aboutissent, 39 échouent en « TypeError: Failed to fetch » après
706 s**. Conséquence à l'écran, remesurée depuis sur deux builds du même arbre, cinq fichiers
servis et les 59 autres coupés :

| | avant | après |
| --- | --- | --- |
| Mercure, dont le fichier ÉTAIT arrivé | Astronomy Engine, 2 600 km | binaire Horizons, 7,3 km |
| Juno, dont le fichier ÉTAIT arrivé | entrée `aria-disabled`, inerte | sélectionnable |
| ce que l'écran en dit | rien | le bandeau `#ephemeris-notice` |

Trois décisions, prises avant d'écrire, chacune tenue par une garde falsifiée.

**(1) Ce qui arrive est gardé.** Un passage tolère l'échec fichier par fichier, et le service
sert ce qu'il a. Refuser en bloc jetterait les 25 fichiers arrivés pour punir les 39 perdus,
alors que le modèle de position est DÉJÀ par corps et par source (`BodyPositionResolver`) : un
corps sans binaire retombe sur astronomy-engine ou ses éléments, ce qui est une situation
normale et nommée, pas une avarie. Un binaire n'est jamais servi à moitié : la taille exacte est
vérifiée avant de le retenir.

**(2) Ce qui manque est DIT, sans ouvrir une fiche.** `ui/ephemerisNotice` n'existe dans le DOM
que si un fichier manque vraiment — le silence est l'information. Il compte ce qui est arrivé
sur ce qui est déclaré, distingue les corps (placés par une source moins précise, nommée dans
leur fiche) des **sondes**, qui n'ont aucun repli et restent donc sans position, et propose la
reprise. Le projet avait déjà refusé deux fois de dégrader en silence (modèle temporel et
provenance, lot 6) : un `allSettled` posé à la place du `all` aurait corrigé la perte sans
corriger le mensonge.

**(3) La reprise est bornée, et porte sur le PASSAGE.** Deux reprises, 1 s puis 4 s, plus une
reprise manuelle depuis le bandeau, qui remplit le service en place et rafraîchit les lignes
d'orbite (`OrbitalMechanics.refreshPositionSources`) : un corps repris passe alors de son repli à
son binaire EN COURS DE SESSION, ce qui le déplace d'autant. C'est un gain, il est demandé, et sa
fiche nomme la source. Ce qui ne se reprend pas : un 404, une origine étrangère, une taille
fausse — des défauts de déploiement, que réessayer ne ferait que payer sur le lien du visiteur.
Une absence définitive sort donc des passages suivants tout en restant NOMMÉE dans le rapport :
ne plus la redemander n'est pas l'oublier (écrit après avoir relu le diff, où un 404 mêlé à des
pannes de lien repartait à chaque passage). Un seul chargement court à la fois, pour qu'un
double clic sur la reprise ne double pas les requêtes.
**Défaut trouvé en mesurant** : la première forme reprenait chaque FICHIER, donc 64 / 6 × 5 s,
soit 53 s d'attente pure ajoutées au démarrage (85 s jusqu'au loader masqué, contre 24 s par
passage).

**La cause, et pas seulement le symptôme : six requêtes à la fois.** 64 requêtes ouvertes
ensemble partagent une connexion HTTP/2 et la bande passante : chacune reste ouverte aussi
longtemps que le TOTAL, et c'est cette durée qui expirait. Mesuré sur le build, mêmes octets,
bridage à 500 ko/s, page statique de la même origine (la page d'accueil fausserait la mesure avec
ses propres requêtes) :

| requêtes simultanées | total | requête médiane | requête la plus longue |
| --- | --- | --- | --- |
| 64 | 77,1 s | 50,1 s | 77,1 s |
| 12 | 77,1 s | 12,9 s | 21,2 s |
| **6** | **77,1 s** | **10,2 s** | **10,6 s** |

Le total ne bouge pas, la bande passante le fixe ; la requête la plus longue est divisée par
7,3. Démarrage complet mesuré sur deux builds du même arbre, actifs identiques au SHA-256 :
18,2 → 16,9 s à 50 Mbit/s, 47,9 → 47,0 s à 10 Mbit/s. Aucune régression.

Le service worker met `/assets/**` en CACHE D'ABORD : dès qu'il contrôle la page, un binaire
déjà obtenu revient de son cache, et seul ce qui manque repart sur le réseau. Ce que cela vaut
pour la TOUTE première visite n'est pas établi ici, le service worker s'installant pendant ce
chargement-là. **Piège de mesure** : ce même service worker relaie les requêtes hors de `page.route`,
donc une garde Playwright qui coupe des `.bin` sur le build doit bloquer le service worker, sinon
elle mesure un chargement complet en croyant l'avoir coupé (58 fichiers passés, 6 coupés).

| Garde | Ce qu'elle tient |
| --- | --- |
| `core/HorizonsEphemerisService.test.ts` | tolérance par fichier, raison et reprenabilité de chaque absence, calendrier par passage, 404 et taille fausse jamais repris même au milieu d'échecs reprenables, reprise qui ne redemande pas ce qu'elle a, un seul chargement à la fois, borne de simultanéité |
| `utils/concurrency.test.ts` | la borne elle-même, et l'ordre des résultats |
| `e2e/ephemerisDegraded.spec.ts` | ce qui est arrivé sert, ce qui manque est écrit avec ses comptes, la reprise répare sans recharger, un chargement complet ne dit rien, et à 390 px le bandeau ne recouvre aucun dock |

### Une position ne coûte pas un fichier (lot 17, phases 17A et 17B)

Les binaires couvrent 1900-2100 ; la scène, elle, affiche un instant. **Placer les 64 corps à
une date coûte 5 952 octets, soit 96 par corps** : `HorizonsEphemerisService._sampleGrid` lit
l'échantillon qui encadre la date et le suivant, rien d'autre. `core/ephemerisWindow.ts` (pur)
traduit cela en un PLAN : date vers index, index vers plage d'octets, et le contrat d'une
réponse partielle.

**Deux consommateurs, et ils ne demandent pas la même chose.** La position lit deux états ; la
LIGNE D'ORBITE (`core/orbitPath.ts`) échantillonne la source précise sur une période entière
centrée sur la date, et elle est **tout ou rien** : `needsElementsOnly` sonde les deux
extrémités de la courbe, et si la source ne répond pas à l'une des deux, toute la courbe repart
des éléments ou de la conique osculatrice. Une fenêtre trop courte d'un seul échantillon ne
dégrade donc pas un peu le tracé : elle le change entièrement, sans aucune erreur. Le
planificateur n'élargit à la période que si elle tient dans la couverture — sinon ces octets
seraient payés pour rien, ce qui est déjà le cas de Neptune, dont la demi-période atteint 2108.

**Deux choses ne se déduisent pas d'une fenêtre, et c'est un test rouge qui l'a montré**, pas
une relecture :

| | ce qu'une fenêtre changeait | comment le contrat le règle |
| --- | --- | --- |
| facteur d'échelle du temps de propagation | 28,2 m sur Encelade, jusqu'à 202,4 m sur Mimas | il est **publié au manifeste** (`meanMotionScale`), calculé une fois depuis le fichier entier |
| ballant de Pluton et de ses petites lunes | position visiblement autre | le compagnon (Charon) se charge sur le **même intervalle d'index** : `_withoutReflex` soustrait état par état et exige une grille identique |

Le facteur est la médiane, sur le fichier ENTIER, du rapport période osculatrice sur période du
catalogue : il échantillonne de l'index 0 à l'index `count - 1`, donc aucune fenêtre ne peut le
reconstituer. La formule vit dans `core/meanMotionScale.ts` et **nulle part ailleurs** : le
service la lit, `pnpm ephemeris:meanmotion` la lit pour remplir le manifeste, et le test la lit
pour confronter le manifeste au binaire. Trois copies auraient dérivé sans que rien ne le dise.

**Ce qu'une réponse partielle doit prouver.** Un `206` est accepté seulement si sa taille ET son
`Content-Range` correspondent à ce qui a été demandé, total du fichier compris. Sans cette
confrontation, une plage prise dans le flux COMPRESSÉ passerait : son total annonce alors la
longueur brotli et ses octets ne sont pas ceux du fichier. Un `200` signifie que le serveur a
ignoré la plage et rendu tout le fichier : on le GARDE, ce qui dégrade proprement vers le
comportement d'avant sur un hôte sans plages.

| Garde | Ce qu'elle tient |
| --- | --- |
| `core/ephemerisWindow.test.ts` | la plage désigne bien ces octets-là dans le fichier livré, l'échantillon suivant est toujours inclus, rien n'est demandé hors couverture, la fenêtre couvre les deux extrémités d'une ligne d'orbite, et **une fenêtre place chaque corps au bit près comme le fichier entier** |
| `core/meanMotionScale.test.ts` | le facteur est publié pour les corps qui le déclarent et pour eux seuls, il vaut exactement ce que le binaire donne, et forcer 1 déplace le corps (il n'est pas décoratif) |
| `pnpm ephemeris:meanmotion --check` | le manifeste committé n'a pas dérivé des binaires |

### Tests qui verrouillent tout ça

| Fichier | Ce qu'il garde |
| --- | --- |
| `core/horizonsSatelliteOrbits.test.ts` | chaque satellite boucle un tour sur sa période, sur les binaires **réellement committés** |
| `core/relativeElements.test.ts` | le repli décrit la même orbite que le binaire (deux sources sans code commun) |
| `core/satelliteOrbitRate.test.ts` | la cadence du repli, sur la sortie observable |
| `core/twoBodyPropagation.test.ts` | la propagation, jusqu'à 40 révolutions |
| `core/orbitLineSampling.test.ts` | amplitude **et** régularité de la ligne, dans les deux modes ; le corps à moins de 1 000 km de sa ligne, aux bords de la couverture et au milieu |
| `core/orbitPath.test.ts` | la phase 0 de la ligne tombe sur la date affichée, pas une période avant |
| `core/kepler.test.ts` | solveur hyperbolique (résidu, M non réduite, vis-viva, asymptote ν∞) |
| `config/interstellar.test.ts` | 21 vecteurs Horizons de −20 à +20 ans, Tp dérivé, ligne répartie en F |
| `core/ephemerisPlausibility.test.ts` | les deux bornes, sur 400 dates par fichier relatif et 2 000 par fichier héliocentrique ; Sedna et Halley acceptés |
| `core/horizonsInterpolation.test.ts` | vecteurs Horizons ENTRE échantillons : rythme moyen, ballant de Pluton, seuil 100, binaires de Jupiter et d'Uranus |
| `core/timeScale.test.ts` | convention TT/TDB unique, installée dans astronomy-engine, importée partout |
| `config/smallBodies.test.ts` | chaque jeu d'éléments contre Horizons à son époque ; décalage barycentrique |
| `components/celestial/spinDirection.test.ts` | sens de rotation des corps du catalogue, dans les deux sens du temps |

## Terminateur jour/nuit — contrat partagé entre couches

`src/core/terminator.ts` est la **source unique** de toute décision jour/nuit. Le module expose
une implémentation JS *et* son miroir GLSL exact (`TERMINATOR_GLSL`, injecté dans les shaders en
remplacement de `#include <common>`) : les deux côtés doivent rester la même formule, c'est ce
qui rend les invariants ci-dessous testables sans GPU.

### Les trois courbes

| Fonction | Pour quoi | Bande | Forme |
| --- | --- | --- | --- |
| `terminatorLight(raw, wrap)` | éclairement direct d'une surface (remplace le `dotNL` de three.js) | `+wrap` → `−wrap` | Lambert pur au-dessus de `+wrap`, extinction tangente en `−wrap` |
| `terminatorDay(raw, wrap)` | fraction de jour d'un calque superposé (nuages, pluie, halo) | `+wrap` → `−wrap` | smootherstep |
| `terminatorNight(raw, onset, rampWidth)` | couche qui **apparaît** la nuit (lumières de ville, clair de Lune) | `onset` → `onset − rampWidth` | ease-out cubique |
| `terminatorTwilight(raw, wrap)` | lueur du **ciel** au-dessus d'un sol déjà éteint (bandeau crépusculaire) | `+wrap` → ~`−wrap` | colonne d'air éclairée × extinction côté jour |

`raw` est **toujours** `dot(normaleMonde, directionSoleil)`, c'est-à-dire le sinus de la hauteur
solaire. Aucune couche ne doit re-dériver sa propre rampe.

### Quatre invariants, chacun verrouillé par un test

1. **Règle produit — rien de nocturne sur le côté éclairé.** Toute couche qui n'existe que la
   nuit vaut `0` *exactement* dès que le Soleil est au-dessus de l'horizon. C'est pourquoi
   `terminatorNight` part de `onset = 0` et non d'une valeur reculée.

2. **Direction du Soleil par fragment, jamais depuis le centre du corps.** Une direction unique
   pour toute la sphère est fausse de `asin(R/D)` — négligeable en Explo (~0,002° pour la Terre)
   mais ~1,64° en Éducatif, où les distances sont compressées alors que les rayons ne le sont
   pas. C'est l'ordre de grandeur des largeurs de crépuscule elles-mêmes. Les matériaux patchés
   disposent de `fragmentSunDir()`; les shaders écrits à la main calculent
   `normalize(sunPosition - vWorldPosition)`.

3. **Normale géométrique dans la bande du terminateur.** La surface abandonne sa normal map
   avant le terminateur (`reliefFade`, bornes `RELIEF_FADE_START/END`) parce qu'à lumière
   rasante les micro-facettes dessinent des contours durs. Toute couche qui décide un masque sur
   `dot(N, Soleil)` dans cette zone doit donc employer la normale **non perturbée** — sinon deux
   couches concentriques décident du même terminateur à partir de deux normales différentes et
   le bord suit le relief au lieu de suivre l'ombre.

4. **Pas de creux de luminosité au terminateur.** Le sol ne vaut plus que `wrap/4` au coucher et
   s'effondre ; la couche nocturne qui prend le relais doit monter **au moins aussi vite**, dès
   le coucher. D'où l'ease-out cubique (`f'(0) = 3`) et non smootherstep, dont les dérivées
   première et seconde nulles en `0` laissaient une marge sombre le long du terminateur.

5. **La bande ne doit pas dépendre de l'albédo.** L'invariant 4 était formulé en *relatif* —
   « la somme sol + villes ne descend pas sous sa valeur au terminateur » — et cela ne suffit
   pas : cette valeur de référence, `wrap/4 ≈ 2,6 %` du plein soleil, est elle-même **sous le
   plancher d'affichage** une fois multipliée par l'albédo et compressée par le tone mapping.
   Mesuré sur le rendu (albédo neutre 0,5) : la surface atteint le noir 8 bits dès `raw ≈
   +0,013`, soit **0,75° au-dessus** de l'horizon, et vaut 0 sur toute la bande de crépuscule.
   Statistique pixel par pixel du disque texturé : 100 % des pixels au-dessus du plancher à
   +8°, 4 % à +0,6°, **0 % de 0° à −2°**. La rampe des villes ne peut pas combler ce trou —
   elle ne s'allume que là où il y a des villes.

   La lumière qui manque est de la lumière de **ciel**, pas de sol : indépendante de l'albédo,
   présente au-dessus de l'océan comme du continent. `AtmosphereShader` la modélise déjà mais
   son facteur `rim = (1 − |N·V|)^power` s'annule en incidence normale : par construction il ne
   dessine que le limbe. D'où `terminatorTwilight`, ajouté sur la **surface** (là où vit déjà
   le clair de Lune), additif et sans multiplier `diffuseColor` :

   - `sunlitColumnFraction(raw) = exp(−R·(1/cos h − 1)/H)` — la part de colonne d'air encore au
     soleil, avec `H = 8 km` (hauteur d'échelle). Aucun paramètre libre : 1,00 au coucher, 0,89
     à 1°, 0,34 à 3°, 0,012 à 6°. La lueur s'éteint donc d'elle-même à la fin du crépuscule
     civil — la même borne que `TERMINATOR_WRAP_ATMOSPHERE`, sans qu'on l'ait imposée.
   - `× (1 − terminatorDay(raw, wrap))` — nul **exactement** en `+wrap`, ce qui borne la bande
     côté jour.

   **La largeur passée est celle de la COQUE atmosphérique (`TERMINATOR_WRAP_TWILIGHT_SKY`,
   13,2°), pas celle du sol.** C'est une correction du 2026-09-11, et une erreur de couche :
   calé sur le sol, le terme s'annulait en +6° avec une pente nulle, donc restait quasi nul bien
   en dessous — alors que le sol, lui, s'était déjà effondré à cette hauteur. Il restait un
   **creux** entre l'extinction du sol et le démarrage de la lueur : luminance moyenne 23 à +8°,
   **7,5 à +5°**, 25 au terminateur. Ce facteur 3 se lit comme un trait sombre séparant le jour
   de sa propre lueur, et faisait paraître le bandeau posé sur l'image plutôt qu'issu d'elle.
   La règle du projet dit où est la faute : **la largeur est une propriété de la couche**, et
   cette lueur est émise par l'air, pas par le sol. Après correction, 18,6 contre une épaule à
   25. Côté nuit rien ne déborde : c'est `sunlitColumnFraction` qui y décide de l'extinction.

   Amplitude posée par **continuité**, pas à l'œil : le maximum vaut l'éclairement du sol au
   haut de la bande (`wrap × I × albédo / π`, albédo de Bond publié 0,306), donc la courbe
   rendue prolonge la rampe du jour au lieu de tomber d'une falaise. Après correction, mesuré au
   même endroit : 100 % des pixels au-dessus du plancher de +3,4° à −4,0°, 0 % dès −5,2° (les
   villes reprennent, contraste intact).

6. **La couleur doit avoir un pilote distinct de la luminosité.** Corollaire du point 5, et le
   défaut qu'il a fallu livrer deux fois pour comprendre. Le bandeau passe du doré au bleu, et
   ce fondu était piloté par `sunlitColumnFraction` — qui est **aussi** un facteur de son
   amplitude. La partie dorée couvrait donc exactement la partie visible, et le bleu n'arrivait
   que là où il ne restait plus rien à colorer. Mesuré tranche par tranche : rapport rouge/bleu
   **11,2 au terminateur**, encore 3,5 à +2,9° au-dessus de l'horizon. Rendu, un bandeau
   brun-rouge en travers de tout le disque, jour compris.

   `terminatorTwilightWarmth(raw, wrap)` rejoint donc le contrat, avec ses propres facteurs :
   `sunlitColumnFraction²` (le rapport bleu/rouge du trajet rasant s'effondre bien plus vite que
   `s` lui-même, loi de Rayleigh en λ⁻⁴) et une retombée **côté jour** via `1 − terminatorDay`
   remis à l'échelle de sa valeur ½ au terminateur — sans quoi la teinte chaude tiendrait à fond
   jusqu'à `+wrap`, alors qu'à 3° de hauteur le ciel est bleu. Résultat : or dans les deux
   degrés qui encadrent le terminateur, bleu de part et d'autre.

7. **Une teinte normalisée en luminance n'est pas une teinte désaturée.** Les deux teintes du
   bandeau étaient sursaturées d'un facteur ~3, chacune pour sa propre raison. La chaude était
   choisie trop rouge (rapport rouge/bleu de 11,6 en linéaire, quand un ciel de soleil rasant
   photographié depuis l'orbite se situe vers 3 à 4). La froide n'était **pas choisie pour cet
   usage** : c'est `atmosphereColor` du catalogue, écrite pour le **halo au limbe**, où le
   regard traverse des centaines de kilomètres d'air en rasant. Vue au zénith d'un point du
   disque, après diffusions multiples, elle doit être gris-bleu — même couleur, deux géométries,
   deux saturations. La normalisation en luminance **aggrave** le problème plutôt que de le
   corriger : diviser un bleu sombre par sa faible luminance fait exploser son canal bleu
   (rapport rendu 0,06 à 2,9° sous l'horizon, un bleu de synthèse sans aucun rouge).
   `TWILIGHT_SKY_NEUTRAL_SHARE` mélange donc la teinte froide vers le blanc — qui a par
   définition une luminance de 1, donc désature **sans** toucher à la luminosité, et la
   séparation teinte/amplitude tient toujours.

   Les deux rapports sont bornés par `src/config/twilightTint.test.ts`, qui lit les uniformes
   réellement posés par le matériau. C'est le test qui manquait : toutes les garanties
   existantes portaient sur la LUMINOSITÉ du bandeau et étaient vraies, or un bandeau brun-rouge
   saturé et un coucher de soleil crédible rendent exactement la même luminance. La sonde de
   terminateur (`?debug-terminator`) renvoie désormais aussi la moyenne des trois canaux par
   tranche — sans elle, ce défaut n'était pas observable.

8. **L'or n'existe qu'en VUE RASANTE — et c'était une erreur de géométrie, pas de teinte.**
   Le point 7 a été réglé deux fois, dans les deux sens, sans succès : bandeau signalé
   « brun-rouge », désaturé, puis signalé « voile blanchâtre ». Trois saturations essayées
   (rapports 3,59 / 3,01 / 2,19) rendent des images **mesurément indiscernables**. La
   saturation n'était pas le levier.

   Deux photographies NASA, mesurées pixel par pixel, donnent la réponse. Sur une vue ISS du
   limbe au lever orbital, la coupe verticale à travers l'arc donne, en rapport rouge/bleu puis
   luminance : bleu 0,30 / 109, blanc 1,00 / 252, or 1,84 / 175, orange 2,60 / 152, rouge
   6,6 / 94. L'or est donc réel **et lumineux**. Sur une image Galileo de la Terre à moitié
   éclairée — le terminateur traversant le disque exactement comme dans cette application — le
   même rapport ne dépasse **jamais 0,75**.

   Le rendu avait 2,05 à une luminance de 25 : la teinte de l'or réel au sixième de sa
   luminosité, ce qui s'appelle du brun, et peinte là où la photographie n'en montre aucun.
   Vers le limbe la ligne de visée traverse des centaines de kilomètres d'air et Rayleigh a
   dépouillé le bleu ; vers le centre du disque elle traverse une seule masse d'air, et le ciel
   crépusculaire y est gris-bleu.

   `twilightWarmthViewFactor(viewCos) = (1 − |N·V|)²` borne donc la chaudeur par la géométrie du
   regard. Le carré n'est pas un réglage : c'est la forme du `rim` du halo atmosphérique, qui
   décrit déjà cette dépendance pour la même raison. Mesuré après correction, terminateur au
   centre du disque : rapport entre 0,51 et 0,79 sur toute la bande, dans la fourchette de la
   photographie. **Leçon de méthode** : « réaliste » se tranche contre une référence mesurée,
   pas contre un jugement — deux réglages à l'aveugle n'avaient rien donné, une photographie a
   réglé la question en une passe.

   Le bandeau est réservé aux corps qui ont **à la fois** une atmosphère et le socle `moonlight`
   dont il réutilise les varyings monde — aujourd'hui la Terre seule. L'étendre à Vénus ou Mars
   demande d'y activer ces varyings, pas de toucher au terme.

### Largeurs

La largeur du crépuscule est une **propriété du corps et de l'altitude de la couche**, pas un
réglage global : `TERMINATOR_WRAP_VACUUM` (3°) pour un corps sans atmosphère,
`TERMINATOR_WRAP_ATMOSPHERE` (6°, crépuscule civil) pour un corps qui en a une, et
`twilightWrapAtAltitude()` pour les couches en altitude — une couche haute reste au soleil après
le coucher au sol, c'est ce qui fait rougeoyer les nuages sur un sol déjà sombre.

### Ajouter une couche

Les couches sont **opt-in par corps** : aujourd'hui seule la Terre porte la pile complète
(surface, lumières, nuages, pluie, thermique, atmosphère) et seule elle a une normal map. Un
corps sans couche ne paie rien — les uniformes et les blocs GLSL ne sont injectés que si l'option
correspondante est demandée (`moonlight`, `cloudShadow`, `eclipseShadow`…). Pour en ajouter une :

1. déclarer la géométrie/matériau dans `config/layerConfig.ts` et son rayon dans
   `LAYER_RADIUS_SCALE` ;
2. trancher d'abord **apparence physique ou couche d'instrument** (voir ci-dessous) ; si c'est
   une apparence, lui donner une entrée dans `LAYER_TERMINATOR_WRAP`, choisie par son
   **altitude réelle** et non par son rayon de mesh ;
3. appeler la fonction partagée qui correspond à sa nature (calque diurne → `terminatorDay`,
   couche nocturne → `terminatorNight`), jamais une formule maison ;
4. dériver la direction du Soleil par fragment.

### Apparence physique ou couche d'instrument

La règle produit est de rendre le plus réaliste possible sous nos contraintes, à l'échelle
équivalente. Elle sépare les couches en deux familles, et c'est cette séparation — longtemps
implicite — qui décide de la présence d'un terminateur :

- **apparence physique** (nuages, précipitations) : un objet qu'on verrait depuis l'orbite. Le
  Soleil l'éclaire, donc il s'éteint la nuit, à la largeur de **son** altitude. Une entrée dans
  `LAYER_TERMINATOR_WRAP`.
- **couche d'instrument** (température, pression, humidité, vent) : un champ de données colorié,
  l'apparence de rien. L'assombrir la nuit ne le rendrait pas plus réaliste, cela rendrait
  illisible une information qui n'a jamais prétendu être une image. Même famille que le HUD et
  les labels (cf. l'invariant Explo). Pas d'entrée.

La largeur est une propriété de la **couche**, jamais de la **source** de la donnée. Défaut
réellement livré et corrigé par cette carte : les couches modèle (Open-Meteo) passent par
`CelestialObject.setDataOverlay`, qui remplaçait le matériau de la couche par un
`MeshBasicMaterial` nu — les nuages satellite s'éteignaient au terminateur et les nuages modèle,
la même chose physique sur le **même mesh**, brillaient à plein régime sur la face nuit.

`src/config/layerConfig.test.ts` et `src/shaders/terminatorUsage.test.ts` refusent une couche qui
appelle une fonction du terminateur sans en embarquer la définition, ou qui contourne le contrat.

### Mesurer le terminateur en pixels (`?debug-terminator`)

Les deux derniers défauts de cette section sont passés sous des tests unitaires verts : les
courbes étaient justes, c'est ce que l'écran en faisait qui ne l'était pas. `src/ui/
terminatorProbe.ts` rend cette mesure reproductible — `frame()` place la caméra à 90° du Soleil
(le terminateur traverse le centre du disque), `sample()` renvoie par tranche d'éclairement la
part de pixels au-dessus du plancher d'affichage, la luminance moyenne et le maximum.
`e2e/terminator.spec.ts` s'en sert comme garde-fou.

Deux pièges y sont encodés, tous deux payés une fois : l'instantané doit être **atomique**
(pixels, pose de caméra et position du corps lus dans la même frame, sinon la correspondance
pixel → éclairement est fausse en silence), et le **bord du disque** doit être exclu (`N·V <
0.45`) — le rayon y est tangent et le halo atmosphérique additif y est brillant, si bien que
chaque tranche ramasse un pixel de limbe et la mesure sort plate.

**Limite connue** : sous le rendu logiciel des runners, la `DataTexture` des couches météo
MODÈLE ne remonte pas — le calque sort noir opaque, avec ou sans correction. Une assertion en
pixels y serait verte pour une mauvaise raison ; c'est pourquoi le test de ces couches lit la
largeur de crépuscule annoncée par le matériau (`twilight=` dans `?debug-meteo`) plutôt que des
pixels.

## Ce que montre la première vue, avant tout réglage

UNE règle, écrite une fois dans `ui/defaultDisplay.ts` et lue par le tableau des Réglages, parce
que chaque couche décidait jusque-là de son propre défaut et que c'est le genre d'incohérence
qu'on ne voit plus à force de la regarder :

- **Les ÉTIQUETTES** : le Soleil, les huit planètes et la Lune (`MAJOR_BODIES` dans
  `ui/exploHud`). Reçue le 2026-09-11 : toutes les afficher donnait vingt-quatre étiquettes
  empilées sur la vue initiale, Phobos, Hygie, Orcus et Bennu comprises.
- **Les OBJETS** : tout le catalogue est dessiné, puisque c'est la scène elle-même.
- **Les ORBITES** : celles des planètes seules ; lunes, naines et petits corps en option.
- **Les OBJETS D'INSTRUMENT** (sondes, objets interstellaires) : ni point ni étiquette, en option
  comme les orbites des petits corps (lot 14, 2026-09-22). Mesuré avant : BepiColombo,
  OSIRIS-REx, Parker Solar Probe, Juno et 3I/ATLAS nommés dès le chargement, le nom
  d'OSIRIS-REx sur celui de Vénus. Ce sont des aides de navigation peintes par-dessus la scène,
  pas des corps qu'elle contient.

Tenu par `ui/defaultDisplay.test.ts` (chaque ligne du tableau confrontée à la règle) et par
`e2e/spacecraft.spec.ts` et `e2e/interstellar.spec.ts` (`data-markers` à 0 au chargement).

Trois exceptions qui ne se devinent pas :

- **L'objet SÉLECTIONNÉ est toujours peint et nommé**, dans toutes les couches
  (`SpacecraftOverlay.setTarget`, `InterstellarOverlay.setTarget`, et le filtre de l'`ExploHud`
  ci-dessous). Sans elle, choisir Juno dans la palette, sondes masquées, ouvrirait une vue sur un
  point que rien ne dessine : le défaut même qui avait rendu les sondes actives dans les deux
  modes. Falsifié : `?body=juno` doit peindre exactement un marqueur.

- **Masquer n'est pas SUPPRIMER.** `ExploHud.update` crée l'élément DOM du libellé AVANT
  d'appliquer le filtre du panneau. L'ordre inverse a été livré une fois : les corps décochés
  n'obtenaient plus d'élément, et Cérès, Vesta, Pallas, Halley et les quatre lunes galiléennes
  devenaient **introuvables par la recherche**, pas seulement anonymes.
- **La cible traverse toujours le filtre**, mais pas pour afficher son nom — le CSS masque
  délibérément texte et trait d'une cible pour ne pas écrire par-dessus l'astre visé. Ce que
  l'exception garantit, mesuré en la retirant, c'est la classe `is-target` : sans elle un corps
  décoché puis sélectionné ne l'obtient jamais, et l'élément reste anonyme pour le HUD,
  l'animation d'acquisition et plusieurs scénarios e2e.

**Les lignes d'orbite s'effacent à l'approche** (`core/orbitFade.ts`). De près, le trait passe
DEVANT le globe — géométriquement juste, puisque la caméra est à l'intérieur de l'orbite — et se
lit comme un globe transparent. Le `depthTest` n'y peut rien, il est déjà actif et a raison : ce
n'est pas un défaut de profondeur mais de PERTINENCE. La règle est énoncée en **rayons du corps**,
seul cadrage valable pour Mercure comme pour Jupiter et invariant au changement d'échelle
éduc↔explo : rien sous 15 rayons (≈ 3,8° de rayon apparent), ligne pleine au-delà de 60 (< 1°,
environ la Lune vue de la Terre). Chaque ligne est jugée sur SON corps, donc celle d'un corps
lointain reste pleine pendant que celle du corps approché s'efface.

## Libellés : une seule place occupée pour toutes les couches

Les noms projetés viennent de deux familles qui s'ignoraient : les libellés DOM de l'`ExploHud`,
qui évitaient déjà les panneaux et leurs voisins, et les noms dessinés au canvas par les couches
d'instrument (sondes, objets interstellaires), qui n'évitaient rien. Le 19 octobre 2017,
« 1I/ʻOumuamua » s'imprimait par-dessus « Lune » et « OSIRIS-REx ».

`core/labelSpace.ts` tient le compte commun — sans DOM, sans canvas, sans Three.js. Une image =
un `reset()` (emprises des panneaux), puis chaque couche demande une place (`placeText`, huit
positions candidates autour du marqueur) et déclare celle qu'elle prend (`add`), dans l'ordre où
elle dessine. Quand rien ne tient, la couche dessine son marqueur SANS son nom : un marqueur seul
reste lisible, deux noms superposés ne le sont ni l'un ni l'autre.

Une subtilité qui se paie si on l'oublie : la couche interstellaire ne repeint que si la vue a
changé. Sa décision inclut donc l'empreinte (`signature()`) de la place commune, sinon elle
garderait un nom posé là où une autre couche vient d'écrire.

**Honnêteté sur la vérification** : le mécanisme est tenu par `core/labelSpace.test.ts` (quatre
mutations tombées, dont une qui a révélé que l'empreinte n'était pas testée), et l'écran montre
des libellés séparés en Éduc comme en Explo. La scène EXACTE du rapport (1I par-dessus « Lune »)
n'a pas pu être reproduite dans cette session : à cette date, ces marqueurs tombent hors des
cadrages essayés. C'est donc vérifié structurellement, pas contre cette image-là.

### Deux pièges des couches canvas

- **Taille d'affichage.** `position: fixed; inset: 0` n'étire PAS un `<canvas>` : élément
  remplacé, il garde la taille de son tampon (fenêtre × densité de pixels). À 125 % (réglage
  Windows courant), sondes, petits corps et objets interstellaires étaient dessinés 1,25 fois trop
  grands et glissaient loin des corps 3D. D'où `width/height: 100%` explicites, tenus par
  `e2e/overlayCanvasSize.spec.ts` à densité 1,25 — le reste de la suite tourne à 1, où le défaut
  est invisible.
- **Écart marqueur-nom.** Il doit dépasser le rayon du point PLUS la marge de respiration :
  à 6 px, la position collée était toujours « occupée » par le point lui-même, et chaque nom
  partait à +40 px jusqu'à être coupé au bord. `markerLabelCandidates` calcule les positions sur
  la largeur du texte, avec `MARKER_LABEL_GAP` = 8 px.

**Trajectoires interstellaires : en option.** Une hyperbole ne se referme jamais ; tracées par
défaut, les trois se lisaient comme des orbites cassées en travers de la vue d'ensemble. Depuis le
lot 14, le tracé est la colonne « Orbite » de la ligne de chaque objet (une hyperbole y tient la
place d'une orbite), et il ne se conserve pas d'une visite à l'autre, comme tout le contenu de la
scène (cf. « La surface Réglages d'affichage »).

## Couches d'instrument pendant le morph Éduc↔Explo

Les corps 3D n'sautent pas d'un mode à l'autre : `OrbitalMechanics` interpole leur position
pendant 1,2 s (`scaleMorph`). Une couche 2D qui dessine à l'échelle Explo pendant ce temps part
aussitôt à sa position finale et se décolle des corps qu'elle annonce — c'est ce que faisaient
les marqueurs de sondes et de petits corps. `core/overlayScale.ts` porte la règle
(`morphedSceneRadius`, `scaleToScene`) : les positions Éduc et Explo étant colinéaires,
interpoler le rayon revient exactement à interpoler la position.

L'ÉCHELLE de toutes ces couches suit le morph. Leur VISIBILITÉ, elle, ne se décide plus de la
même façon pour toutes. Le champ de petits corps SBDB (`smallBodyOverlay`) suit toujours le
morph : il apparaît dès que la transition démarre et ne disparaît qu'une fois revenu à
l'Éducatif. Les sondes et les objets interstellaires sont, eux, actifs dans les DEUX modes
depuis qu'ils sont sélectionnables (§ « Objets d'instrument navigables » ci-dessous) — les
restreindre à un mode ouvrait une vue sur un point que rien ne dessinait. L'échelle reste tenue
par `core/overlayScale.test.ts`, qui compare les deux extrémités à `ScaleService` — la source
d'échelle de la scène — plutôt qu'à une formule recopiée.

**Ce que les tests ne voient pas** : la suite e2e tourne en `reducedMotion: 'reduce'`, donc le
morph y est INSTANTANÉ ; aucun scénario ne peut observer un état intermédiaire. La vérification
est la comparaison à l'écran, faite à 450 ms de transition : sans la correction, le marqueur de
Juno quitte le champ pendant que Jupiter glisse encore ; avec, il reste collé à la planète.

## Objets d'instrument navigables — sondes et interstellaires

Onze sondes (`src/registry/spacecraft/`) et trois objets interstellaires
(`src/registry/interstellar/`) sont peints par une couche 2D. Ils portaient un nom à l'écran et
n'existaient nulle part ailleurs : introuvables à la recherche, impossibles à cliquer, absents
du tableau Réglages, sans fiche. C'était la seule catégorie d'objets nommés dans cette
situation.

**Ils n'entrent PAS dans `CELESTIAL_CONFIG`, et c'est le choix central.** Ce catalogue décrit ce
que la scène fabrique : un mesh, des textures à précharger, une ligne d'orbite fermée, une page
d'atterrissage, une vignette de partage, une fiche de faits sourcés. Une sonde n'a rien de tout
cela, et l'invariant Explo lui interdit même une taille apparente plancher. L'y faire entrer
aurait demandé une exception dans `CelestialObjectFactory`, dans `TextureSystem`, dans
`catalogValidation`, dans `OrbitalMechanics` et dans les quatre générateurs de pages — cinq
exceptions pour partager quatre champs. `src/config/navigable.ts` ne partage donc que ce qui est
réellement commun : un nom, une catégorie, une couleur, une description, et le droit d'être
cherché, ciblé et réglé. `NAVIGABLE_BODIES` est la table que consulte la couche UI là où elle
lisait `flattenBodies(CELESTIAL_CONFIG)` ; la scène, elle, ne connaît toujours que le catalogue.
`src/config/navigable.test.ts` tient les deux moitiés du contrat, dont l'absence du catalogue.

**L'ancre.** La caméra a besoin d'un `Object3D` à suivre. `ui/navigableAnchors.ts` en crée un
par objet : un `THREE.Group` VIDE, sans géométrie ni matériau, qui ne dessine aucun pixel. Ce
n'est pas une sphère mandataire déguisée — rien ne la rend visible, et le marqueur affiché reste
celui de la couche 2D. Elle est placée par le placeur que reçoit aussi la couche des sondes
(`core/instrumentPlacement.ts`) : la caméra regarde donc le point où le marqueur est peint, dans
les deux modes, pendant toute la transition, et quand une sonde en orbite est posée dans le
système de son corps (§ suivant). `CameraSystem` les reçoit par
`registerTargets` ; ce qu'il demande d'une cible est décrit par `CameraTarget`, bien plus petit
qu'un `CelestialObject`.

**La disponibilité est MESURÉE, jamais déduite.** Un corps du catalogue existe à toute date ;
une sonde, non. Hors de la couverture de son fichier Horizons — avant le lancement, au-delà de
la solution de trajectoire — la source ne répond pas, et un objet interstellaire n'est dessiné
que dans sa fenêtre autour du périhélie. L'ancre retient donc « la source a répondu », pas une
date écrite à côté d'elle. L'entrée de palette reste listée et cherchable, mais `aria-disabled`
et inerte : son absence dit quelque chose de la DATE affichée, pas de l'objet. Mesuré au
2026-09-19 : Cassini (mission finie en 2017) et Rosetta (2016) sont grisées ; en 1970 les
quatorze le sont.

**Le clic.** Les canvas d'instrument sont en `pointer-events: none`. Le picker du canvas WebGL
consulte donc leurs marqueurs AVANT de lancer son rayon (`ui/bodyPicker.ts`, `OverlayHitTest`) —
dans cet ordre, parce qu'ils sont peints par-dessus la scène : ce qui est sous le pointeur est
le marqueur, pas ce que le rayon trouverait derrière lui. Falsifié en inversant l'ordre.

**Ce qu'ils n'ont pas, et pourquoi.** Pas de case dans la colonne « Orbite » du tableau
Réglages pour une sonde : elle n'a pas d'orbite fermée (assistances gravitationnelles, halo L2),
et sa trajectoire n'est pas dessinée ; la cellule reste vide plutôt que de porter une case sans
effet. Un objet interstellaire, lui, y a sa trajectoire hyperbolique. Pas de fait chiffré dans
leur fiche non plus : leurs registres portent une date de lancement et une désignation, mais
sans champ `source`, et un fait sans provenance ne s'affiche pas (§ « Faits sourcés »). Les
sourcer est le travail qui rendrait leur fiche comparable à celle d'un corps.

## Une sonde en orbite se pose comme une lune (lot 14)

**Le défaut, mesuré.** Les couches d'instrument plaçaient chaque objet par `scaleToScene`, la
compression radiale √r du Soleil. Or l'Éducatif agrandit les corps et écarte les lunes de leur
planète (`educationalParentOrbitScale`) : une sonde en orbite, comprimée comme un objet
héliocentrique, tombait au centre de la sphère agrandie. Au 2026-09-22 : JWST à 0,16 unité du
centre de la Terre (rayon 1), Juno à 0,56 du centre de Jupiter (rayon 4), BepiColombo à 0,19 de
celui de Mercure (rayon 0,38). Sur la couverture de leurs fichiers, Cassini dans Saturne 68 % du
temps, Juno dans Jupiter 72 %, JWST dans la Terre 100 %. Aucun objet n'est jamais dans un corps
à vraie échelle : l'Explo n'était pas en cause.

**La règle.** Le catalogue DÉCLARE le repère d'une lune (`frame: 'parentRelative'`) ; une sonde
déclare les PHASES où elle est le satellite d'un corps (`satelliteOf` dans sa fiche
`src/registry/spacecraft/*.json`). Pendant une phase, `core/instrumentPlacement.ts` la place
comme une lune : la position Éducatif du corps, plus le vecteur relatif réel compressé par
`educationalSatelliteDistance`, qui est la règle des lunes appliquée à un satellite sans rayon
(même facteur commun, puis au moins la surface agrandie plus l'écart, là où la sphère Éducatif
a déjà cessé d'être à l'échelle). L'ordre avec les lunes est conservé : Juno à l'apojove
(0,054 UA) est tracée au-delà de Callisto (0,0126 UA), à 28 unités de Jupiter contre 13,5. La
position du corps vient de `OrbitalMechanics.heliocentricAU`, la règle même qui le dessine.
**L'Explo reste la vraie position, sans exception** (tenu par `core/instrumentPlacement.test.ts`),
et le morph interpole les deux comme pour un corps.

**Les phases sont DÉRIVÉES, jamais saisies** (`core/satellitePhases.ts`, `pnpm spacecraft:phases`),
et `src/config/satellitePhases.test.ts` les confronte aux fichiers livrés. Critère, jour par
jour : énergie à deux corps négative et dans la sphère de Hill ; pour un corps dont toute la
sphère de Hill tombe sur la surface agrandie (`educationalSurfaceClampAU`, Bennu et Ryugu, aucune
planète), la présence dans la sphère suffit, puisque l'énergie d'un astéroïde est sous le bruit.
Une phase va du premier au dernier jour retenu, s'il y en a au moins 30. Résultat : JWST et la
Terre dès le 2021-12-27, lendemain du début de son fichier, jusqu'à sa fin, Juno et Jupiter depuis le 2016-07-05, jour où s'achève son
insertion en orbite (la NASA la publie au 4 juillet, heure de Californie : la combustion s'est
terminée à 03 h 53 UTC le 5), Cassini et Saturne du 2004-07-01 au 2017-09-13, BepiColombo et Mercure dès le 2026-10-13
(fichier prédit), OSIRIS-REx et Bennu du 2018-12-01 au 2021-04-15, Hayabusa2 et Ryugu du
2018-06-22 au 2019-11-20. Aucune pour les Voyager, New Horizons, Parker, Rosetta (67P n'est pas
au catalogue).

**Pourquoi un survol reste héliocentrique.** La règle des lunes étire √d : à la frontière de la
sphère de Hill de Jupiter elle poserait l'objet à 35 × 3,43 × √0,355 ≈ 49 unités de la planète,
l'orbite de Saturne à l'écran, et un fondu entre les deux repères le ferait jaillir puis revenir.
3I/ATLAS, passé à 1,01 rayon de Hill de Jupiter en mars 2026, sortirait ainsi de sa propre
trajectoire tracée. Un passage qui n'est pas une mise en orbite garde donc la compression
héliocentrique, et peut traverser la sphère agrandie d'une planète : c'est la conséquence des
tailles Éducatif.

**Ce qui reste, mesuré tous les deux jours sur toutes les couvertures** : 16 350 jours-sonde dans
une sphère Éducatif avant, **1 972 après** (−88 %), tous des approches, départs et survols
(Voyager 2 à Jupiter 140 jours, Hayabusa2 à l'approche de Ryugu 226, BepiColombo à Mercure
jusqu'au 2026-10-11, dont la date du 2026-09-22 : écrit dans le test plutôt qu'omis). Le
changement de repère fait sauter l'objet une fois à l'entrée et à la sortie d'une phase : au plus
3,69 rayons Éducatif du corps, depuis le centre de la sphère où il était caché.

## La surface Réglages d'affichage : un rangement, un vocabulaire

Les réglages avaient été ajoutés au fil des lots, chacun s'accrochant à la fin du panneau dans
l'ordre des appels (les trajectoires interstellaires tombaient sous les quatre boutons de qualité
graphique), et le champ d'astéroïdes avait son propre bouton, visible en Exploration seulement,
qui faisait changer la rangée du haut d'un mode à l'autre. Depuis le lot 14 :

- **Une surface, cinq sections titrées, dans un ordre fixe** : Dans la scène (le tableau), Champ
  d'astéroïdes et de comètes, Rendu (luminosité, qualité, imagerie de surface), Accessibilité et
  unités, Vue (le zoom optique, en Explo seulement). Chaque module se range dans SA section par
  son id (`#settings-section-…`). Les couches de la Terre (météo, événements terrestres) et les
  événements astronomiques gardent leur bouton : ce sont des données à consulter, pas des
  réglages d'affichage.
- **Trois colonnes, les mêmes mots partout** : Étiquette, Objet, Orbite (Label, Object, Orbit),
  dans l'en-tête, dans les lignes de groupe et dans le nom accessible de chaque case. Les groupes
  sont ceux de la palette de recherche (`ui/bodyGroups.ts`), sous les mêmes noms ; une ligne de
  groupe règle tout son groupe et le déplie. Les planètes seules sont dépliées au départ.
- **Les mêmes puces** : pastille de couleur, nom, case, pour une ligne de corps comme pour une
  catégorie du champ d'astéroïdes.
- **Un seul défileur** : le tableau n'a plus sa propre boîte qui défile dans le panneau qui
  défile (huit lignes visibles sur un téléphone). Tenu par `e2e/modes.spec.ts`.
- **Ce qui se conserve** : les préférences de rendu et de lecture (qualité, luminosité, imagerie
  de surface, palette daltonienne, unités). Le contenu de la scène (le tableau, le champ) ne se
  conserve pas : la première vue reste celle de la règle ci-dessus. La clé
  `ssv-interstellar-paths` est retirée et effacée au démarrage (`RETIRED_STORAGE_KEYS`), pour que
  `public/privacy.html` ne liste que ce qui est enregistré.

## Descendre vers une surface — ce qui borne l'approche

Deux grandeurs décident de ce qu'on voit en s'approchant d'un corps, et les deux étaient, jusqu'au
2026-09-21, des constantes uniques pour tout le catalogue. Le calcul vit dans
`core/surfaceApproach.ts` (pur, testé) ; `CameraSystem` et `CelestialObject` ne font que
l'appliquer, et `?debug-surface` (`ui/surfaceProbe.ts`) affiche les chiffres en direct.

**Le plancher d'approche est une propriété du CORPS, pas du système.** `controls.minDistance` vaut
`rayon de dégagement × facteur`, sans jamais passer sous le garde-fou du mode, et ce facteur est
désormais dérivé de la finesse de l'image que le corps affiche : altitude = budget × taille d'un
texel au sol, donc facteur = 1 + budget × 2π / largeur de la texture. Le rayon disparaît de l'expression, ce qui n'est pas une approximation mais une
identité — un texel d'équirectangulaire mesure `2πr / W`, donc les deux termes portent le même `r`.
Le budget (96,1 texels) vient d'un écran de RÉFÉRENCE déclaré une fois (hauteur 800 px, champ de
visite 55°, celui de `focusFov` — l'écran sur lequel la lisibilité a été regardée était
1280 × 800) et d'un agrandissement maximal accepté de 8 pixels par texel : au-delà,
l'écran montre l'image grossie, jamais du détail que la source possède. C'est l'invariant
d'exploration appliqué à la résolution, comme il l'est déjà aux tailles et aux distances.

La constante unique de 1,15 rayon n'était juste que pour une texture 4k, pour laquelle la règle
dérivée rend 1,1473. Mesuré le 2026-09-20, à 1280 × 800 : elle agrandissait un texel à 4 pixels
sur un corps 8k (on s'arrêtait deux fois trop haut) et à 31 sur un corps 1k (on descendait quatre
fois trop bas). Les planchers qui en résultent : Lune 260,6 → 128,0 km, Mars 508,4 → 249,7 km,
Terre 955,6 → 469,3 km, Encelade 37,8 → 148,6 km, Titan 386,2 → 758,7 km.

Deux points qui ne se devinent pas :

- **la qualité prise en compte est celle qui est SERVIE, pas celle que le catalogue déclare**
  (`TextureSystem.resolveSurfaceQuality(nom, 0)`) : le profil mobile plafonne à 2k et un GPU peut
  refuser le 8k. Mesuré avant correction : un viewport de 390 px atteignait 33,8 pixels par texel
  alors que la règle en visait 8. Le plancher de la Lune y vaut donc 512 km, pas 128 ;
- **une cible sans surface garde `targetMinRadiusFactor`** : les ancres de sondes et d'objets
  interstellaires, les petits corps sans texture. Elles n'affichent aucune image, donc rien ne les
  rend plus ou moins approchables ; leur finesse est celle d'un maillage, une autre question.

**Le plan proche vaut la MOITIÉ DE L'ALTITUDE, et rien ne doit le relever.** Un plancher exprimé
en fraction du rayon (il valait 1 %) passe devant la surface dès qu'on descend sous cette
fraction, et le corps entier disparaît : pas d'erreur, pas de trace, une caméra correctement
placée, une distance juste dans la fiche, et un ciel vide. Mesuré le 2026-09-20 en abaissant le
plancher d'approche : Lune invisible sous 17,4 km d'altitude, Terre sous 63,7 km, Mars sous
33,9 km. Le défaut était présent depuis que ce plancher existe et restait invisible parce que
l'approche s'arrêtait quinze fois plus haut. Le minimum qui subsiste (`exploMinFloor`) ne sert
qu'à rester strictement positif si la caméra touche la sphère de dégagement ; il n'a pas à
protéger la précision de profondeur, que le `far` adaptatif borne déjà.

**Ce que la profondeur coûte réellement, mesuré plutôt que redouté.** Avec ce `near` serré, un
tampon de 24 bits distingue 1,5 cm au sol à 128 km au-dessus de la Lune et 5,6 cm à 469 km
au-dessus de la Terre (`depthResolutionKm`, `Δz = z² (1/n − 1/f) / (2^B − 1)`). Aucun tampon
logarithmique, aucune passe de rendu séparée n'est justifié aujourd'hui : le rapport `far/near`
est énorme (5,9e6 sur la Lune) mais c'est le terme `1/n` qui domine, et il est petit parce que
le `near` suit la surface.

**Ce que la descente ne corrige pas.** La silhouette reste une sphère de 64 segments, soit
2,09 km d'écart à la vraie surface sur la Lune — invisible tant que le limbe n'entre pas dans le
champ, ce qui n'arrive pas au ras du sol (moins d'un pixel à ces distances). Les couches
d'instrument 2D (petits corps, sondes, interstellaires) continuent de peindre leurs marqueurs
par-dessus le sol, sans zoom sémantique, contrairement aux événements terrestres. Et l'approche
d'un corps se termine souvent du côté NUIT (mesuré sur Mars : noir dès 3 100 km d'altitude, donc
déjà à l'ancien plancher), parce que la direction d'approche vise le terminateur. Aucun de ces
trois points n'a changé au lot 9C (2026-09-21), qui n'a touché ni la géométrie de la sphère, ni
les couches d'instrument, ni la direction d'approche ; le § suivant dit ce qu'il a changé.

## Imagerie de surface streamée — une mosaïque publiée, posée sur la sphère

Depuis le 2026-09-21 (lot 9, phase 9C), un corps peut déclarer un JEU DE TUILES : une mosaïque
publiée, servie à la demande par un service WMTS, posée sur la sphère existante à l'approche.
Aucune hauteur n'est ajoutée — le relief est la phase suivante, et le plan du lot interdit
d'employer une image de relief comme géométrie.

**Tout vient d'une fiche, et rien d'un nom de corps.** `src/registry/products/tilesets/*.json`
(type `tileset`) porte le gabarit, le jeu de matrices, les niveaux, la finesse publiée, la
campagne d'acquisition, la licence et les fournisseurs STAC. `config/surfaceTilesets.ts` est la
façade d'exécution, sur le modèle de `config/factSources.ts`. Le moteur
(`components/surface/PlanetarySurfaceEngine.ts`) ne connaît aucun corps, et ce n'est plus une
intention : **Mars a été ajoutée le 2026-09-21 par une fiche et rien d'autre** (phase 9E), sans
qu'un fichier de `src/components/surface/`, de `src/core/tile*.ts` ni `src/ui/surfacePanel.ts`
ne change.

**Deux jeux déclarés, et ils ne se ressemblent pas** — c'est ce qui rend la preuve utile :

| | Lune | Mars |
|---|---|---|
| Mosaïque | LRO WAC (LROC, ASU) | Viking MDIM 2.1 colorisée (USGS, NASA Ames) |
| Campagne | novembre 2009 à février 2011 | juin 1976 à août 1980 |
| Niveaux publiés par Trek | 0 à 8 | 0 à 7 (le niveau 8 répond 404, mesuré) |
| Finesse servie au maximum | 83 m/px | 325 m/px |
| Texture livrée du catalogue | 8k, 1,33 km/px | 8k, 2,60 km/px |
| Rapport à la texture livrée | 16x | 8x |
| Finesse publiée de la source | 303 px/degré | 256 px/degré |
| Niveau maximal vis-à-vis d'elle | l'agrandit de 1,20 | reste à 0,71, donc plus grossier |
| Plancher d'approche | 128,0 → 8,0 km | 249,7 → 31,2 km |

La dernière ligne du tableau est ce que le bandeau fait de différent : il n'annonce un
sur-échantillonnage que lorsqu'il y en a un, donc il se tait sur Mars. Et sur un poste, où la
texture servie est la 8k, le premier niveau que le moteur accepte de peindre y est le 5 : le
niveau 4 vaut exactement 8 192 px, comme la texture, et le refus porte sur une ÉGALITÉ. Sur un
téléphone, où la texture servie plafonne à 2k (10,4 km/px), le niveau 4 l'améliore déjà : mesuré
à 390 px, il est peint dès le premier arrêt, à 998,8 km d'altitude.

**Un carreau est un enfant du groupe qui tourne** (`CelestialObject.attachSpinningChild`), à la
même paramétrisation que la couche `surface` : `phi = longitude + π`, `theta = 90° − latitude`,
c'est-à-dire celle de `frames.geographicToLocalDirection`, mesurée au lot 8 contre quatre
épicentres publiés. Une tuile WMTS a sa ligne 0 au NORD et sa colonne 0 à −180° : ces deux
conventions se recouvrent sans conversion. SANS hauteurs, aucun décalage radial n'est appliqué —
`polygonOffset` décale la profondeur écrite, jamais la géométrie, parce qu'un décalage sans mesure
serait une altitude inventée. AVEC des hauteurs (§ suivant), les sommets sont déplacés par des
altitudes MESURÉES et `polygonOffset` est retiré.

**Le niveau servi est celui que l'écran mérite, borné par un budget déclaré par profil de
qualité.** On vise un pixel d'écran par pixel de mosaïque (`core/tilePyramid.ts`), puis on
redescend d'un niveau tant que la couverture dépasse le budget — mais seulement tant que
descendre RÉDUIT vraiment le nombre de carreaux. Une fenêtre de couverture vaut (2n+1)² et n vaut
au minimum 2, donc **25 carreaux est un plancher, jamais un réglage** : un budget inférieur ne
permet aucun niveau. Mesuré à l'écran le 2026-09-21 avec un budget de 24 à 390 px de large : la
Lune était servie à 5,3 km/px au lieu de 83 m/px, soit 540 pixels d'écran par texel, sans que
rien ne le dise.

**Jamais plus grossier que la texture livrée.** Loin du corps, le budget fait retomber le niveau
sous la finesse de la texture du catalogue ; peindre ces carreaux DÉGRADE la vue. Mesuré à
1 541 km d'altitude sur la Lune : niveau 3 servi, 2,67 km/px, contre 1,33 km/px pour la texture 8k.
Le moteur refuse donc de peindre tant que `pyramidWidthPx(niveau) ≤ largeur de la texture servie`
(`CelestialObject.shippedSurfaceWidthPx`). Sur la Lune, c'est ce qui fait que rien n'est peint à
1 541 km ni à 432 km d'altitude, alors que le niveau 6 l'est à 142 km : le seuil est celui où le
budget permet enfin un niveau plus fin que la texture livrée, et il est mesuré, pas choisi.

**Le plancher d'approche suit, une fois un carreau PEINT.** Le § précédent dérive ce plancher de
la finesse de l'image affichée ; l'imagerie streamée devient cette image. La finesse déclarée au
corps est celle du niveau MAXIMAL de la fiche — pas celle du niveau courant — et elle est
verrouillée dès le premier carreau posé, jusqu'au détachement. Les deux règles ont été payées :

- prendre le niveau COURANT crée une boucle de rétroaction. Les carreaux arrivent, le plancher
  descend, la caméra descend, le niveau monte, les carreaux du niveau précédent sont jetés, la
  finesse retombe à zéro, le plancher remonte et repousse la caméra. Mesuré : altitude alternant
  entre 128,0 et 32,0 km à chaque image, et 47 tuiles redemandées par seconde, indéfiniment ;
- l'ouvrir dès l'attachement, sur la foi de la fiche, laisserait un visiteur hors ligne descendre
  seize fois plus bas que ce que son écran peut montrer : à 8 km d'altitude, la texture 8k livrée
  vaut 1 024 pixels d'écran par texel, c'est-à-dire du gris uniforme (relevé de la phase 9B).

Sur la Lune, le plancher passe donc de 128,0 km (texture 8k) à **8,0 km** (niveau 8, 83 m/px), et
`?debug-surface` lit **8,00 px/texel** en bas, exactement comme avant : ce n'est pas la netteté
apparente qui change, c'est l'altitude à laquelle on l'obtient. À altitude égale, la différence
est entière — mesuré à 142 km sur la Lune, 333 m/px contre 1,33 km/px.

**Le bandeau dit ce qui est servi, pas ce qui est espéré.** `ui/surfacePanel.ts` affiche la
mosaïque, la résolution du niveau réellement peint, la campagne d'acquisition, la catégorie
temporelle tirée de `core/temporal.ts`, et le facteur de sur-échantillonnage quand le niveau
dépasse la finesse publiée (le niveau 8 de Trek vaut 364,09 pixels par degré contre 303 publiés,
soit 1,20). Une mosaïque est une MESURE sur l'intervalle de sa campagne : elle est servie telle
quelle quelle que soit la date de la scène, et se classe donc `observed` aussi bien pour une
scène en 1610 que pour une scène en 2050. Le bandeau n'apparaît que si un carreau est peint : une
provenance sans image serait un mensonge. Il se place juste au-dessus du dock du bas d'après la position MESURÉE de
ce dock, et non d'une hauteur recopiée en CSS : sous 768 px le sélecteur Éduc/Explo s'empile en
colonne, et, vu en production à 390 px, il recouvrait la ligne de crédit que les conditions de la
NASA demandent d'afficher.

**Ce que le moteur ne fait pas.** Il ne demande rien au démarrage ni au-dessus de 6 rayons
apparents (mesuré par comptage de requêtes) ; il annule par `AbortController` tout carreau qui
sort du champ ou dont la cible change ; il retient un échec plutôt que de redemander la même
tuile à chaque image ; et il ne remplace jamais la surface du corps, il la recouvre localement
(quand il pose du relief, il descend cette surface SOUS le relief au lieu de l'effacer, § suivant).
Le réglage « imagerie de surface » est actif par défaut et, éteint, n'émet aucune requête.

**Un hôte de tuiles se déclare en quatre endroits**, et `img-src` en fait partie — c'est le mur
exact sur lequel la légende GIBS s'est cassée au lot 8b : `firebase.json` (`connect-src` ET
`img-src`), `LIVE_DATA_SERVICES`, une fiche `tile-source` dans `src/registry/providers/`, et
`public/privacy.html` dans les deux langues. Le service worker sert ces tuiles en CACHE D'ABORD,
contrairement aux données temps réel : une adresse de tuile désigne un niveau, une ligne et une
colonne d'une version PUBLIÉE et figée de la mosaïque, dont les octets ne changent jamais.

**Le piège qui coûte le plus cher, et il est mesuré** : une tuile hors bornes fait répondre Trek
404 SANS en-tête `Access-Control-Allow-Origin`. Le navigateur rapporte alors ce qui ressemble mot
pour mot à un refus CORS, pour un simple calcul de ligne faux. `core/tileUrl.ts` refuse donc avant
d'émettre, en nommant la borne franchie. Second piège, silencieux celui-là : Three.js IGNORE
`Texture.flipY` pour un `ImageBitmap`, l'orientation doit être décidée à la création
(`imageOrientation: 'flipY'`) — sans quoi le carreau affiche le mauvais hémisphère sans aucune
erreur.

## Relief mesuré — des hauteurs cuites hors ligne, jamais devinées

Depuis le 2026-09-21 (lot 9, phase 9D), un corps peut déclarer un JEU DE HAUTEURS
(`src/registry/products/heightfields/*.json`, type `heightfield`) : les carreaux d'imagerie sont
alors DÉPLACÉS radialement par des altitudes mesurées, avec une jupe et des normales calculées.
Le relief n'est pas une image : c'est de la donnée, et elle se cite.

**Pourquoi nous les cuisons, au lieu de les streamer comme l'imagerie.** Il n'existe aucune
source de hauteurs tuilée servie avec l'en-tête d'origine croisée qu'un navigateur exige. La
seule couche de NASA Trek qui s'appelle « DEM » est une IMAGE 8 bits : en-tête PNG `bitDepth 8`,
`colorType 4`, une trentaine de gris distincts par tuile et un alpha constant à 255, soit environ
78 m par pas sur la Lune. Mesuré le 2026-09-20, REMESURÉ le 2026-09-21 avant d'écrire la première
ligne du cuiseur. L'employer comme géométrie terrasserait le corps.

`pnpm surface:tiles` (`scripts/bake-surface-height-tiles.mjs`) lit donc un modèle d'élévation
PDS3 publié et écrit nos propres tuiles, dans la MÊME pyramide que l'imagerie. Ses cibles sont de
la donnée (`scripts/surface-height-targets.json`), et trois règles y sont tenues :

- **le quantum vient de l'étiquette PDS** (`SCALING_FACTOR`) et il est RÉÉCRIT, avec l'offset de
  nos tuiles, dans l'en-tête de chacune : `core/heightTile.ts` ne devine rien. Le rayon de
  référence, que l'étiquette donne DEUX fois (`OFFSET` en mètres, `A_AXIS_RADIUS` en kilomètres),
  est lu des deux côtés et confronté, puis déclaré dans le manifeste ;
- **la géométrie déclarée est vérifiée** : lignes et colonnes doivent concorder avec l'emprise et
  la résolution de l'étiquette, sinon la cuisson s'arrête ;
- **rien n'est inventé entre deux échantillons** : rééchantillonnage bilinéaire de la grille
  publiée (registre PIXEL) vers nos tuiles (registre GRILLE), et rien d'autre.

**Un socle global, et des aires NOMMÉES.** Un globe de hauteurs 16 bits pèse 67 Mo au niveau 4 et
1,07 Go au niveau 6, PAR VERSION RETENUE sur un hébergement dont le quota de 10 Go a déjà sauté
une fois (`src/config/hostingPayload.test.ts`). Le jeu lunaire livré est donc un socle global au
niveau 4 (1 333 m/échantillon, depuis `LDEM_64`) plus trois aires cuites aux niveaux 7 et 8
(83 m/échantillon, depuis les fichiers régionaux `LDEM_1024`), chacune cadrée sur une entité du
répertoire de nomenclature de l'UAI : Tycho, Rima Hadley (site d'Apollo 15) et Statio
Tranquillitatis (site d'Apollo 11). 637 tuiles, 84,2 Mo.

| | Socle global | Aires nommées |
|---|---|---|
| Niveau | 4 | 7 et 8 |
| Finesse | 1 333 m/échantillon | 83 m/échantillon |
| Source | LOLA `LDEM_64` (64 px/degré) | LOLA `LDEM_1024` (1 024 px/degré) |
| Emprise | le corps entier | le carré dérivé du diamètre publié de l'entité |

**Ce que la fiche porte, et ce que le manifeste porte.** La fiche déclare l'identité, la mission,
l'instrument, la licence, les fournisseurs et l'intervalle d'acquisition. Tout ce qui se MESURE —
quantum, offset, rayon de référence, couverture, altitudes extrêmes, nombre de tuiles, poids,
répertoire — vit dans `manifest.json`, écrit par le cuiseur et lu à l'approche. C'est la
séparation déjà appliquée à la collection d'éphémérides, et un test confronte les deux.

**Ce que le relief demande, et quand.** Rien au démarrage. Le manifeste (2 Ko, sur notre propre
origine) est lu quand le corps passe sous huit rayons apparents, en même temps que le moteur
lui-même ; les tuiles ne sont demandées qu'avec les carreaux qu'elles déplacent, une tuile de
socle servant jusqu'à 256 carreaux du niveau 8. Le cache en mémoire est borné à 32 tuiles, soit
environ 4 Mo : sans cela, une session qui approche vingt fois le même corps finirait par garder
le socle entier.

**Les adresses sont HACHÉES par le contenu** (`assets/height-tiles/moon/<hachage>/…`), comme les
binaires d'éphémérides : les octets d'une adresse ne changent jamais, donc le cache immuable d'un
an de `/assets/**` leur convient et le service worker les sert en cache d'abord. Seul
`manifest.json` porte un nom stable : il reçoit donc une règle Firebase qui revalide et une règle
« réseau d'abord » dans le service worker, et un test croise les deux — servi depuis un cache, il
désignerait un répertoire supprimé, c'est-à-dire un relief absent sans la moindre erreur.

**La sphère livrée descend sous le relief.** Les altitudes d'un modèle d'élévation sont rapportées
à un rayon de référence, et **61 % de la surface lunaire est SOUS ce rayon** (mesuré sur les tuiles
livrées, pondéré par la surface ; les mers descendent à 2 ou 3 km en dessous et le minimum vaut
9 105 m). Laissée à sa taille, la sphère du catalogue masquerait tous
les fonds. `CelestialObject.setSurfaceShellScale` la met donc au minimum MESURÉ du jeu tant que
des carreaux de relief sont posés, et la rétablit ensuite : elle reste une borne inférieure de la
surface réelle et ne montre rien que la donnée ne porte pas.

**Deux carreaux voisins se touchent par construction.** Les tuiles de hauteurs sont à registre
GRILLE (257 échantillons par côté, soit 256 intervalles), donc le bord d'une tuile EST la première
colonne de sa voisine, et un carreau d'imagerie plus fin lit un sous-rectangle ALIGNÉ de sa tuile
ancêtre, sans interpolation. Un test rejoue ce chemin complet sur les octets livrés et mesure
l'écart entre deux carreaux voisins : moins d'un mètre au sol.

**Trois défauts trouvés à l'écran, aucun à la relecture** (2026-09-21) :

1. **la jupe descendait jusqu'à la sphère abaissée.** C'était l'idée d'origine — ne jamais voir à
   travers — et cela fait des murs de dix kilomètres sous CHAQUE carreau : le bord de chacun se
   dessinait en noir, et le sol ressemblait à un carrelage. La jupe vaut désormais le DÉNIVELÉ du
   carreau, qui borne la seule fissure qu'elle ait à boucher, celle entre deux niveaux voisins ;
2. **`polygonOffset` tirait la jupe vers la caméra**, ce qui redessinait la même ligne en plus
   fin. Un carreau qui porte du relief n'en a plus besoin, puisque la sphère est descendue : le
   décalage est retiré dès qu'il y a des hauteurs ;
3. **la couronne d'un carreau de bord était bornée à sa tuile**, donc la pente y était fausse et
   l'éclairage traçait une ligne à chaque frontière de tuile de socle. Le moteur traverse
   désormais la frontière : les colonnes s'enroulent, les lignes non, et les voisines nécessaires
   sont attendues avant de construire le carreau.

**Confronté à des altitudes publiées, pas seulement à lui-même.** L'équipe LROC publie, pour
Tycho, un plancher « about 4700 m below the rim » et un pic central « 2 km above the crater
floor » (M. Robinson, 29 juin 2011). Mesuré sur les tuiles livrées, avec des définitions écrites
dans le test : **4 502 m** du rempart moyen au plancher médian, et **2 217 m** de pic au-dessus de
ce plancher. L'étiquette de la source publie par ailleurs ses propres extrêmes (−9 125,5 m et
+10 773 m) ; nos tuiles, rééchantillonnées au niveau 4, rendent −9 105,5 et +10 747,5 m.

**Ce que le relief ne fait PAS.** Aucun relief fractal, aucun détail synthétisé sous la résolution
de la source, aucune carte d'ombrage employée comme géométrie (un ombrage fige un Soleil, et la
scène fait bouger le Soleil). Le plancher d'approche reste une altitude au-dessus du RAYON DE
RÉFÉRENCE, pas au-dessus du sol : au-dessus d'un massif, la caméra s'approche donc davantage du
sol que le plancher ne le laisse croire, et `?debug-surface` affiche l'altitude MESURÉE du sol
sous la caméra pour qu'on puisse le voir. Aucune aire fine n'est déclarée ailleurs que sur la
Lune, et Mars garde donc son imagerie sans relief.

## L'échelle de résolutions d'une texture : jusqu'où on livre, et pourquoi (lot 16)

« Chaque corps a tout ce qu'ont les autres » (règle de parité de l'utilisateur) ne veut **pas**
dire « agrandir jusqu'à 8k ». Livrer des octets qui ne montrent rien coûte au visiteur sans rien
lui apprendre. Une texture livre donc les paliers 1k, 2k, 4k, 8k jusqu'à son **plafond**, qui est
le plus bas de deux plafonds mesurés, tous deux nécessaires.

- **Plafond de provenance.** On ne livre jamais plus large que la source réellement importée,
  dont la largeur est **lue à son étiquette** (`LINE_SAMPLES` d'une étiquette PDS3, `Samples` d'un
  cube ISIS, ou les dimensions du fichier publié), jamais déduite d'un « m/pixel » ni du nom du
  produit. Elle vit dans `review.sourcePixelWidth` de la fiche du produit. `scripts/import-textures.mjs`
  refuse déjà tout agrandissement : le plafond est donc tenu à l'import, et la fiche le publie.
- **Plancher de détail.** Un palier au-dessus de 1k ne se livre que s'il porte du détail que le
  palier du dessous ne porte pas : la variance (pondérée par cos(latitude), parce qu'une
  équirectangulaire sur-échantillonne les pôles) de l'écart entre le fichier et son propre
  aller-retour en demi-résolution doit valoir au moins **0,25 %** de sa variance totale.

Les deux sont nécessaires, et c'est le point le moins évident du lot : **une source large n'est
pas une source fine.** La mosaïque Voyager 2 de Triton fait 14 138 px, donc le plafond de
provenance autorise le 8k — mais ce 8k n'ajoute que 0,15 % de variance, et il est indistinguable à
l'œil de son 4k agrandi. Le fichier n'est pourtant pas un agrandissement : le réimporter depuis la
mosaïque publiée reproduit le fichier livré **octet pour octet**. C'est la SOURCE qui est lisse
(imagerie Voyager, et un remplissage synthétique pour les zones jamais imagées).

Le plancher est une **politique**, pas une grandeur physique, comme
`SMALL_BODY_SNAPSHOT_MAX_AGE_DAYS`. Il est posé dans un écart mesuré, puis **regardé à l'écran**
au rapport 1:1 : Triton 8k (0,15 %), Saturne 2k (0,15 %) et Uranus 2k (0,04 %) sont
indistinguables de leur palier du dessous agrandi ; Triton 4k (0,31 %) est déjà plus net et
Triton 2k (0,44 %) nettement. 0,25 % tombe dans le facteur deux qui sépare les deux groupes.

**Une texture sans source mesurée** (surface illustrative, générée par
`scripts/generate-procedural-textures.mjs`) s'arrête à **2k, déclaré** : ses pixels sont inventés,
il n'y a rien à résoudre, et le plancher de détail ne sait pas l'arbitrer puisqu'un bruit
procédural est haute fréquence par construction : les 24 surfaces illustratives du dépôt
mesurent de 3,2 % à 62,2 % à leur palier 2k, quand Mars, vraie mosaïque, en mesure 2,1 %.

**L'échelle est contiguë et commence toujours à 1k.** Le LOD descend de palier en palier : un trou
au milieu lui ferait demander un fichier absent. Et 1k est le niveau de démarrage — vingt et un
corps n'en avaient aucun avant le lot 16 et chargeaient donc leur 2k à toute distance.

### Qui détient quoi

| | |
|---|---|
| La règle | `src/core/textureLadder.ts` (pur, testé) |
| Le relevé mesuré, palier par palier | `src/config/textureLadder.json`, écrit par `pnpm textures:ladder --write` |
| La largeur de la source, lue à son étiquette | `review.sourcePixelWidth` des fiches `src/registry/products/textures/*.json` |
| L'échelle déclarée au catalogue | `textureResolutions` (fiches d'entité), `surfaceResolutions` (petits corps) |
| La confrontation des quatre | `src/config/textureLadder.test.ts` |

Le relevé est **volontairement hors de `pnpm verify`** : il décode les 172 JPEG livrés, dont 23 jeux montant à 8k,
ce qui dure des minutes. La porte rapide est le test, qui lit le relevé committé, relit les
dimensions dans l'en-tête SOF de chaque JPEG (quelques kilo-octets, pas un décodage) et vérifie que
les poids relevés sont ceux des fichiers sur disque. Un fichier ajouté, retiré ou redimensionné
sans relancer `pnpm textures:ladder --write` fait rougir la porte.

## Modèles de forme : la vraie forme, et la texture du corps drapée dessus

Un corps irrégulier dont un modèle de forme scientifique est publié l'affiche, au lieu d'une
sphère (règle de parité de l'utilisateur, 2026-09-22). Quinze corps en ont un ; la liste fait foi
dans les fiches (`model`) et dans `THIRD_PARTY_NOTICES.md`, qu'un test confronte l'une à l'autre.
La sphère n'est jamais supprimée, seulement masquée : un modèle qui ne se charge pas laisse le
corps affiché.

- **La couleur.** Sans texture, la couleur est cuite par sommet à l'albédo publié
  (`scripts/bake-shape-colour.mjs`, Bennu, Éros, Psyché…). Avec une texture, le modèle est
  **drapé** de cette texture (`core/modelUv.ts`) : coordonnées tirées de la longitude et de la
  latitude de chaque sommet dans le repère du fichier, géométrie dépliée pour la couture à ±180°
  et les pôles, et le **même matériau** que la sphère, donc mêmes niveaux de détail, ombres et
  éclipses. ~30 000 sommets de couleur cuite ne gardent qu'une carte de 256 px ; la texture en
  garde des milliers. Un test confronte les coordonnées à celles de `THREE.SphereGeometry`.
- **Le repère.** Un drapé n'est juste que si le fichier et la carte partagent leur système de
  longitudes. Vérifié par corps : Phobos (le creux local le plus profond du modèle tombe sur le
  cratère Stickney, garde permanente sur le fichier livré, falsifiée en omettant `--z-up`) ;
  Vesta (relief Dawn et mosaïque USGS dans le même système Claudia double prime, texture livrée
  corrélée à 0,971 à l'aperçu USGS sans décalage). Thomas et Stooke comptent les longitudes des
  satellites vers l'**Ouest** (mesuré sur le Phobos de Thomas : Stickney à 50 pour 49,7° O) :
  `decimate-shape-model.mjs --west`, faute de quoi le corps sort en miroir sans erreur.
- **L'orientation.** La scène fait tourner le corps autour de son Y local. Le test exige l'axe de
  plus grande inertie à moins de 10° de Y quand le plus grand moment domine (plus de 3 %), sinon
  Y perpendiculaire au grand axe (corps en cigare comme Halley, presque ronds comme Protée). Les
  corps sans repère de rotation publié utile passent par `--principal` (axes principaux
  d'inertie) : Hypérion (rotation chaotique, grand axe sur le Z du fichier), Halley (« nord » le
  long du grand axe dans son modèle), Protée.
- **La taille.** Le maillage est mis à l'échelle du rayon du catalogue par son rayon
  équivalent-volume. Le test exige l'accord à 3 % ou à l'incertitude publiée ; un écart au-delà
  n'est admis que déclaré (`model.radiusMismatch`) quand les deux sont des grandeurs publiées
  différentes : Halley (diamètre effectif de la SBDB contre volume du modèle de Stooke, 4,58 km
  pour 5,5) et Hygie (diamètre IRAS de la SBDB contre modèle de Vernazza et al. 2020, 216,9 km pour
  203,6).
- **Les niveaux.** Un niveau n'est livré que si la source en contient le détail : les grilles de
  5° (Déimos, Amalthée, Protée, Halley) et les modèles DAMIT (Pallas, Hygie, Psyché) n'ont qu'un
  niveau léger, Hypérion n'a pas de 4k.
- **Les faces** pointent vers l'extérieur (volume signé positif), garde ajoutée quand le lecteur de
  grille a appris à inverser les longitudes.

## Halo lumineux — qui brille, et combien

Le palier de qualité `high` ajoute un halo autour des sources de lumière (Soleil, étoiles
ponctuelles, lumières de ville). Les paliers inférieurs n'en ont pas et rendent sans
`EffectComposer`. Deux fichiers : `components/systems/glowSelection.ts` (le contrat) et
`components/systems/GlowPass.ts` (la passe).

**Pourquoi il a été réécrit (2026-09-16).** L'ancien `UnrealBloomPass` donnait des halos
CARRÉS, pour deux raisons indépendantes : il choisissait ses sources par LUMINANCE (tout pixel
au-dessus de 0,85), fond de ciel compris — un JPEG dont les étoiles sont des blocs de compression
8×8, que le fond affiché à 1,4 faisait passer au-dessus du seuil ; et son flou (noyaux de 3 à
11 taps sur 5 mips, remontés en bilinéaire) laissait des plateaux carrés autour de chaque point.
Changer le seuil ou le rayon ne corrigeait ni l'un ni l'autre.

**La sélection est déclarative, par calques Three.js** — jamais par luminance :

- `markGlowSource(objet, gain)` : l'objet émet un halo, d'intensité `gain` (entrée de
  `GLOW_GAINS` dans `config/engine.ts`) ;
- `markGlowOccluder(objet)` : l'objet peut CACHER un halo — surfaces des corps, modèles de
  forme. Sans lui, le Soleil rayonnerait à travers la Lune pendant une éclipse ;
- le fond de ciel n'est sur aucun des deux : il ne brille plus, par construction.

Les calques s'AJOUTENT au calque 0, l'objet reste rendu normalement.

**La passe**, dans l'ordre :

1. **Sélection**, en demi-résolution, fond retiré : les occulteurs en noir (matériau de
   substitution) qui écrivent la profondeur, puis chaque classe d'intensité avec ses propres
   matériaux. Tout l'état touché (fond, calques de la caméra, matériau de substitution, couleur de
   fond, `autoClear`) est restauré à l'identique.
2. **Descente** : 13 taps (5 boîtes pondérées, Jimenez 2014), moyenne de Karis et seuil
   progressif (genou, UE4) au premier niveau seulement.
3. **Remontée** : tente 3×3 ajoutée niveau par niveau. Un halo ainsi construit est rond : il ne
   hérite d'aucune grille.
4. **Composition** : `scène + halo × force / (1 + 4 × luminance de la source)`. Le halo va
   AUTOUR de la source, pas dessus : sans ce facteur, le disque solaire blanchissait.

**Une intensité par source, pas un réglage global.** Mesuré : régler une force unique pour que
les villes retrouvent leur lueur rendait le halo solaire 2,6 fois plus fort. Chaque intensité
distincte reçoit donc son calque de classe (3 à 31). Toutes les classes sont rendues dans la MÊME
cible, par gain croissant ; après chaque classe, tout le tampon est multiplié (mélange
multiplicatif, `SCALE_FRAGMENT`) par `gain courant / gain suivant`, et par le dernier gain à la
fin. La contribution d'une classe subit toutes les remises à l'échelle qui la suivent, dont le
produit vaut exactement son gain — sans cible supplémentaire, et sans redessiner les occulteurs.
Les cibles sont en `HalfFloat` : un facteur > 1 n'y est pas écrêté.

**Réglages mesurés, pas choisis à l'œil** (capture `high`, DPR 2, 2026-09-16T00:00Z) :
énergie moyenne de la face nuit 5,19 avant la réécriture, 5,08 après ; anneau autour du disque
solaire (95–160 px) 10,4 avant, 10,7 après — avec, désormais, des halos ronds et plus aucun carré
dans le ciel.

**Coût** (A/B `perf-fps`, rendu logiciel) : la sélection en pleine résolution coûtait ~15 %
d'images par seconde, d'où la demi-résolution. Les classes d'intensité coûtent ensuite
~0,4 image/s (bureau et CPU bridé), rien en viewport mobile : ce sont les remises à l'échelle en
plein écran, que le rendu logiciel paie en remplissage. Chaque classe au gain différent de 1
ajoute un rendu filtré de la scène et un quad plein écran en demi-résolution.

**Faire briller un nouvel élément** : une entrée dans `GLOW_GAINS`, un appel
`markGlowSource(objet, GLOW_GAINS.xxx)` là où l'objet est créé — et `markGlowOccluder` sur tout
nouvel objet opaque qui doit pouvoir masquer un halo. Rien d'autre : ni seuil à régler, ni passe à
toucher. Deux sources de même gain partagent une classe (29 intensités distinctes au plus).

**Tenu par** `GlowPass.test.ts` : uniformes employés = déclarés = fournis pour les quatre
shaders ; les vraies couches (`buildLayers`) portent le bon marquage et le bon gain ; un faux
renderer vérifie l'ordre des rendus (occulteurs noirs, puis une classe par calque, jamais le
fond), que le produit des remises à l'échelle vaut le gain de chaque classe, et que l'état est
restauré. Chacun falsifié (douze mutations).

## Pages d'atterrissage par corps et vignettes de partage

L'application est une URL unique : `?body=jupiter` est un paramètre, pas une route. Un moteur de
recherche ne peut donc classer qu'UN sujet pour tout le site alors que le catalogue en contient
une cinquantaine. `src/seo/` produit, au build, une vraie page indexable par corps
(`dist/jupiter/index.html`) plus le sitemap complet et une vignette de partage par corps
(`dist/social/jupiter.jpg`).

**Ce module n'est jamais chargé par l'application.** Il n'est importé que par le plugin
`bodyLandingPages()` de `vite.config.ts`, via `ssrLoadModule`, pour lire EXACTEMENT le même
catalogue que l'app sans copie intermédiaire. Rien de tout cela n'entre dans le bundle client —
c'est vérifiable en cherchant `renderSphere` dans `dist/assets/*.js`.

### Quatre contraintes qui ont dicté la forme

1. **Fichiers statiques, pas routes.** `dist/jupiter/index.html` est servi par Firebase avant la
   réécriture SPA `** → /index.html`. Aucun changement d'hébergement ; en contrepartie une page
   de corps ne peut pas porter `?body=` dans son URL.
2. **Pas de script en ligne.** La CSP est `script-src 'self'` sans `unsafe-inline` : impossible
   d'injecter le corps courant par un `<script>` généré. C'est le CHEMIN qui porte l'information,
   relu par `core/permalink.ts::bodyFromPathname` — d'où `e2e/bodyLanding.spec.ts`, qui vérifie
   ce comportement côté APPLICATION, là où les tests unitaires ne voient que le HTML.

   **Et le chemin est désormais ÉCRIT autant que lu** (`pathnameForBody`). Il ne l'était pas :
   ouvrir `/jupiter/` ciblait Jupiter, mais naviguer ensuite vers Titan écrivait `?body=titan`
   sur ce même chemin — une adresse qui nommait deux corps différents, et un lien partagé qui
   montrait la vignette du mauvais. Chaque sélection remonte maintenant à l'adresse indexable
   du corps par `history.replaceState`, donc **sans rechargement** : vérifié par un marqueur
   JavaScript qui survit à toute la navigation et par zéro document HTML retéléchargé.
   `serializePermalink` omettait déjà `?body=` quand le chemin nomme ce corps, donc l'omission
   se déclenche d'elle-même et l'URL cesse d'affirmer deux fois la même chose.

   Trois points qui ont demandé une décision :

   - **La vue d'ensemble est `/`, pas `/all`.** `/` EST le global : l'URL canonique
     d'`index.html`, et la seule que le sitemap annonce. `/all` répondrait (la réécriture SPA
     sert `index.html` pour tout chemin d'un segment) mais créerait une seconde adresse pour un
     contenu identique. `?body=overview` disparaît de la racine pour la même raison, tout en
     restant écrit depuis une page de corps, où il dit encore quelque chose.
   - **Le slash final n'est pas décoratif.** Les pages sont servies en `/jupiter/` et `/jupiter`
     répond 301 vers elle — mesuré en production. Écrire la forme sans slash ferait payer une
     redirection à chaque rechargement et à chaque partage.
   - **Le TITRE du document doit suivre**, sinon l'adresse et l'onglet disent deux choses
     différentes et un signet porte le mauvais nom. `ui/documentTitle` le remet à jour, localisé,
     et `src/seo/titleParity.test.ts` vérifie que la version anglaise est mot pour mot celle de
     la page statique sur TOUS les corps — sans quoi un rechargement ferait clignoter le titre.
     La divergence française est assumée : la page statique est anglaise par référencement,
     l'interface doit parler la langue du visiteur.
3. **Du contenu réel.** Chaque page porte la description du catalogue et les données mesurées de
   ce corps. Cinquante coquilles identiques seraient du contenu dupliqué, exactement ce que
   l'opération existe pour éviter.
4. **Un repère absent doit CASSER le build.** `replaceBetween`/`replaceAttrAfter` lèvent une
   erreur quand leur ancre a disparu du HTML. Un `replace` qui ne correspond plus est un no-op
   silencieux : il produirait cinquante et une pages portant le titre de l'accueil, sans rien
   pour le signaler. Une évolution de Vite ou d'`index.html` doit casser le build, pas le
   référencement.

### La vignette

`src/seo/socialCard.ts` est pur (pixels et chaînes) ; le décodage/encodage d'image vit dans le
plugin. La sphère est un vrai rendu — projection orthographique de la carte équirectangulaire du
corps, éclairage lambertien en linéaire, bord lissé, assombrissement centre-bord pour une étoile
qui émet au lieu d'être éclairée. Calcul JavaScript pur, sans GPU ni navigateur, donc
DÉTERMINISTE : même entrée, même image, en local comme sur le runner.

**Deux chemins de rendu**, selon ce que le catalogue donne au corps. `renderSphere` projette une
carte équirectangulaire ; `renderShape` rastérise un **modèle de forme** (glTF binaire) en
projection orthographique avec tampon de profondeur. Un petit corps n'a pas de mosaïque publiée —
il n'y en a pas pour Bennu — donc sa vignette sphérique n'était qu'une bille de sa teinte de
repli. Or ce qui l'identifie n'est pas sa couleur mais sa **silhouette**. Les deux chemins
partagent la même direction de lumière et le même ambiant : une vignette qui s'éclairerait
autrement se verrait dans une galerie de partages. Depuis le lot parité, `renderShape` lit aussi
la carte équirectangulaire du corps quand il en a une, triangle par triangle, à la longitude et
latitude de son centre dans le repère du fichier : Phobos et Vesta gardent leur texture sur leur
forme, comme dans l'application.

Deux pièges du rendu de forme, tous deux payés une fois :

- **Trier les faces arrière sur le sens de parcours à l'écran est faux ici.** La projection
  retourne l'axe Y, ce qui inverse le signe de l'aire : le tri gardait exactement les faces qui
  tournent le dos, dont la normale pointe à l'opposé de la lumière. La bonne silhouette sortait
  en **noir**, à l'ambiant seul. Le tri se fait sur la normale du MODÈLE (`nz > 0`), énoncé qui
  ne dépend d'aucune convention d'orientation d'écran.
- **Dans la VIGNETTE, l'échelle vient du rayon MAXIMAL, jamais de la boîte englobante** : tout
  le corps doit tenir dans le cadre. `Box3.getBoundingSphere` circonscrit la boîte, donc rend `√3`
  de trop pour un corps rond. Dans la SCÈNE, c'est l'inverse : le modèle est mis à l'échelle par
  son rayon **équivalent-volume**, celui que publient les catalogues. Le rayon maximal y affichait
  Bennu 15 % trop petit et aurait affiché Éros deux fois trop petit (cf. `core/modelFit.ts` et
  `docs/UNIVERSE_CATALOG.md` § Corps irréguliers). La vignette lit le niveau `2k` (chemin dérivé
  par `catalog.modelPath`) et la teinte `fallbackColor`, qui vaut la couleur MOYENNE cuite dans le
  modèle — la vignette reste unie, seule la scène porte les contrastes de surface.

Trois règles à ne pas défaire :

- **Les vignettes ne sont PAS sous `/assets/`**, où `firebase.json` déclare un cache immuable d'un
  an. Leur nom est stable et leur contenu réécrit à chaque build ; un an de cache dessus, c'est
  une vignette périmée qu'on ne peut plus corriger. Servies telles quelles, elles héritent du
  `max-age=3600` par défaut — vérifié en production.
- **`og:image:width`/`height` sont réécrites depuis `CARD_WIDTH`/`CARD_HEIGHT`**, pas laissées en
  dur. Ce sont les deux nombres sur lesquels un réseau social réserve sa place avant d'avoir
  téléchargé l'image.
- **Chaque corps doit avoir une texture de surface OU un `fallbackColor`.** Sans l'un des deux il
  sort en boule grise anonyme — une vignette pire que l'ancienne, parce qu'elle prétend montrer
  ce corps-là. Le repli neutre du code existe pour ne pas casser le build ; c'est un test qui
  empêche de s'en contenter.

Le build échoue si une vignette manque ou sort vide : sinon la page se déploie, la balise pointe
vers un 404, et l'aperçu de partage tombe silencieusement sur rien.

### L'anneau

Un corps dont le catalogue déclare `ring` (Saturne, et elle seule aujourd'hui) est rendu
différemment, parce qu'une Saturne sans anneaux est une boule beige de plus :

- **La vue est inclinée de 20°** (`RING_TILT_DEG`). Sans inclinaison, la carte équirectangulaire
  est projetée sans basculement : le plan équatorial est vu par la tranche et l'anneau sort en
  trait. C'est un CHOIX DE COMPOSITION, pas l'ouverture réelle des anneaux à une date donnée —
  ne pas le relire comme une donnée physique. Le même angle incline le globe ET l'anneau, sinon
  les deux ne décrivent plus le même équateur.
- **Le globe rétrécit, la carte ne s'élargit pas.** L'anneau va à 2,2 rayons : à taille de globe
  égale il passerait sous le texte. `RINGED_SPAN` (540 px) borne le système entier, contre 440
  pour un corps nu, et un test tient la marge avec `TEXT_LEFT`.
- **L'occultation se décide par pixel.** L'anneau est intersecté en tant que plan ; l'arc dont le
  z est supérieur à celui de la surface passe devant, l'autre disparaît derrière. C'est cette
  seule asymétrie qui fait lire l'image en trois dimensions.
- **Les paramètres viennent du catalogue et de la scène 3D**, jamais de valeurs écrites dans la
  vignette : rayons de `config.ring`, opacité et partage diffus/émissif de `createRingMaterial`
  et `_loadRingTexture`, ombre cylindrique du globe reprise du shader de l'anneau. La vignette
  décrit la même représentation que la scène, elle n'en invente pas une seconde.
- **Rendu au double puis réduit.** L'ellipse et sa découpe sur le globe sont des bords
  géométriques francs, très visiblement crénelés sinon. Un corps sans anneau garde le rendu
  direct, ce qui laisse ses octets inchangés — propriété vérifiée par comparaison d'empreintes :
  après l'ajout de l'anneau, une seule des cinquante et une vignettes avait changé.

**Limites connues.** Les octets produits ne sont identiques d'une machine à l'autre que si les
polices le sont —
le runner rend le texte en DejaVu Sans, un poste Windows en Segoe UI. La mise en page et les
chiffres suscrits tiennent dans les deux cas (vérifié à l'écran sur l'artefact déployé), mais ne
pas s'attendre à une comparaison d'empreinte entre local et production.

## Pages d'éclipse

Une page par éclipse solaire ou lunaire de la fenêtre **fixe** 2024-2035 : 53 pages,
`/eclipse/2026-08-12/`. Même contrat que les pages de corps ci-dessus (fichier statique, pas de
script en ligne, contenu réel, repère absent = build cassé), avec un rendu commun,
`renderLandingPage`. La factorisation a été vérifiée en comparant l'ancien et le nouveau rendu
sur le vrai `dist/index.html` : les pages de corps, autant que de corps, identiques octet pour octet.

Les décisions, validées avant le code :

- **Le chemin porte le JOUR UTC, rien d'autre.** Deux éclipses ne tombent jamais le même jour
  (vérifié sur les 53). Pas le type : astronomy-engine pourrait reclasser une éclipse limite, et
  une URL déjà indexée ne doit pas en dépendre.
- **Fenêtre fixe, pas glissante.** Une fenêtre glissante sortirait chaque éclipse passée du
  sitemap et laisserait son URL indexée en 404.
- **La date du pic n'est écrite nulle part.** Le build parcourt la fenêtre avec
  `findUpcomingAstronomicalEvents` ; l'application recalcule l'éclipse du jour lu dans son chemin
  (`core/eclipsePages.ts::eclipseFromPathname`), par la même fonction. Écart mesuré entre les
  deux : **1 ms au plus** — la recherche itérative ne converge pas au même bit selon son départ.
- **L'adresse reste `/eclipse/…` tant que l'état décrit l'éclipse** (corps cadré, date à moins
  d'une minute du pic, `eclipseStillDescribed`) ; au premier changement elle devient le
  permalien ordinaire, `/jupiter/?mode=educ&date=2026-08-12T17:45:46Z`, qui porte la date réelle. La
  lecture est mise en pause à l'arrivée, comme depuis le panneau d'événements, sinon l'horloge
  ferait sortir l'état de l'éclipse d'elle-même. Le titre de l'onglet suit l'adresse.
- **Le corps cadré** (Terre pour une éclipse solaire, Lune pour une lunaire) vient de
  `eventFocusBody`, désormais dans `core/astronomicalEvents.ts` : panneau et pages appliquent la
  même règle. La vignette de partage est celle de ce corps.

**Service worker, défaut livré puis corrigé** : les deux règles PWA qui protègent les pages de
corps (`globIgnores`, `navigateFallbackDenylist`) étaient écrites pour UN segment de chemin. Les
pages d'éclipse en ont deux : elles étaient précachées (installation hors ligne de 1,1 à 3,1 Mio)
et, chez un visiteur déjà équipé du service worker, remplacées par l'`index.html` en cache — les
balises de tête de l'accueil. Ni les tests, ni l'e2e, ni le build ne l'ont vu ; c'est la ligne
`precache 80 entries` du build qui l'a trahi. Les règles vivent désormais dans
`src/seo/pwaRouting.ts`, et `pwaRouting.test.ts` les confronte à TOUTES les pages générées.

**Piège trouvé en falsifiant** : `Date.parse` accepte `2026-02-31` et le reporte au 3 mars —
jour d'une vraie éclipse totale de Lune. Le seul garde-fou est l'égalité finale entre le jour
réécrit de l'éclipse trouvée et le segment lu ; une vérification par aller-retour ajoutée en plus
était redondante et a été retirée quand sa mutation a survécu.

### Une Lune éclipsée est cuivrée, et se regarde depuis la Terre (2026-09-16)

Jusqu'à cette date, les 26 pages d'éclipse lunaire s'ouvraient sur un **disque noir**. Deux
défauts indépendants, chacun suffisant à lui seul :

1. **L'ombre était neutre.** Dans l'ombre d'un corps qui a une ATMOSPHÈRE, il reste la lumière
   réfractée par cette atmosphère, débarrassée de son bleu. `core/eclipse.ts` la modélise :
   `computeUmbralShadow` (CPU, mode Éducatif) et `eclipseShadowAt` (GPU, Explo) rendent un
   facteur **RVB**, plus un scalaire. L'occulteur réfracte si sa couche `atmosphere` existe
   (`CelestialObject.refractsLight`, lu depuis le catalogue) : la Terre sur la Lune est cuivrée,
   la Lune sur la Terre reste neutre (`MIN_LIGHT_ATTENUATION`).
2. **La caméra regardait la nuit lunaire.** Seule la face tournée vers la Terre est éclairée par
   cette lumière. `eclipseViewFrom` (core/eclipsePages.ts) impose, sans angle explicite dans
   l'adresse, de cadrer la Lune depuis la Terre (`CameraSystem.viewFromBody`, angles calculés par
   `core/viewAngles.ts`, vérifiés par aller-retour contre la conversion de Three.js).

**Teinte : mesurée, pas choisie.** Pixel par pixel sur une photographie NASA de totalité (3 mars
2026, aucun pixel saturé), en LINÉAIRE et normalisée en luminance, par quintile de clarté :
R/V passe de 1,8 au bord de l'ombre à 27 en son cœur. `umbralTint(profondeur)` ajuste ces cinq
points (`UMBRA_TINT_FIT`, source unique : le shader lit les mêmes coefficients). La PROFONDEUR se
prend sur la géométrie (`umbralDepth` : séparation rapportée au rayon angulaire de l'ombre), parce
que la fraction occultée sature à 1 dans toute l'ombre et ne distingue plus le bord du cœur.

**Niveau : choisi, mais borné par la mesure.** Physiquement, la Lune totalement éclipsée vaut
~1/60 000 de la pleine Lune (−0,8 contre −12,7 en magnitude) : rendu à exposition unique, c'est
noir. Sur la seule photographie en UNE exposition montrant le limbe éclairé ET l'ombre (ISS,
7 septembre 2025), le limbe est saturé, donc le rapport y est ≤ 0,15. `UMBRA_REFRACTED_LIGHT` =
0,10, et mesuré à l'écran : 0,091 entre la Lune éclipsée et la même Lune la veille.

**Piège trouvé en falsifiant l'e2e** : sur une éclipse PARTIELLE (2026-08-28), le cadrage par
défaut montre déjà la face éclairée — le test passait sans le cadrage imposé. Sur la totale du
3 mars 2026, rouge/bleu mesure 4,1 avec, 1,5 sans ; c'est cette page que teste
`e2e/eclipseLanding.spec.ts`.

## Faits sourcés : ce que la fiche et la page d'un corps affichent

Rayon, masse, gravité, température moyenne, distance, périodes, rotation, obliquité et nombre de
lunes sont des affirmations scientifiques. Chacune porte une provenance dans le catalogue, à côté
de la valeur que la simulation lit (`realData.sources[champ]`, type `FactProvenance`) :

- **source** : identifiant du registre `src/registry/providers/` (une fiche JSON par fournisseur
  depuis le lot 7 phase 1 ; `src/config/factSources.ts` en reste la façade et dérive
  `FACT_SOURCES`) : fiches NASA NSSDCA, tables
  JPL SSD des satellites, JPL SBDB, Horizons, pages NASA Science, articles et prépublications
  nommées comme telles). Jamais Wikipédia, qui reste seulement le lien « En savoir plus » ;
- **méthode** : `measured` (valeur de la source) ou `derived` (masse = GM/G avec G CODATA 2018,
  gravité = GM/R², rayon = diamètre/2, obliquité depuis le pôle publié, distance et période des
  petits corps depuis leurs éléments Horizons) ; `detail` dit ce que la source mesure exactement
  (rayon équatorial à 1 bar, période de courbe de lumière incomplète…) ;
- **asOf** pour un fait qui évolue (nombre de lunes), **uncertainty** quand la source la publie
  (affichée à partir de 5 % relatifs), **citation** pour la référence d'origine d'une base.

**Une seule règle d'affichage**, `src/core/bodyFacts.ts`, partagée par `ui/bodyInfo.ts` et
`seo/bodyLandingPage.ts` : hors sujet pour le `kind` (étoile : distance, période, lunes ; lune :
lunes) → absent ; déclaré `unknown` → marque « n/a » avec la raison, et cette déclaration prime sur
la valeur de simulation ; valeur sans provenance → jamais publiée, « pas encore sourcée ». Deux
raisons distinctes : aucune valeur publiée unique (une plage, une limite supérieure) ou
`NOT_YET_SOURCED` (Galaxy n'a pas encore rattaché de source). La fiche numérote les sources comme
des notes et les liste dans un bloc repliable ; la page publique omet les champs non affichés et
liste ses sources ; `/sources` compte depuis le catalogue ce qui est affiché, dérivé ou en attente.

**Confrontation aux sources.** `scripts/snapshot-fact-sources.mjs` (`pnpm facts:snapshot`, cache
dans `.cache/fact-sources/`, `--offline`) lit les tables elles-mêmes et écrit
`src/config/factSources.snapshot.json`, importé par les tests seulement. Pour un article, il
vérifie que chaque phrase citée figure MOT POUR MOT dans le texte publié (résumé arXiv, page
d'éditeur lue par curl car Nature sert un défi JavaScript au `fetch` de Node, tableau d'un PDF par
pdftotext). `src/config/factProvenance.test.ts` compare ensuite chaque valeur citée à sa ligne,
refuse une valeur affichable sans provenance, une source hors registre ou orpheline, un fait
évolutif non daté, une provenance sur une valeur non affichée et une citation SBDB différente de
la référence de la base. Pièges trouvés en la construisant : la page NASA Science de Saturne
porte « 274 » dans ses métadonnées et « 293 … as of August 2026 » dans son texte (la phrase datée
fait foi) ; la colonne P de la table JPL des éléments moyens est anomalistique (Io 1,7627 j contre
1,7691 j sidéraux), d'où les périodes lues dans les fiches NSSDCA des satellites ; le GM de la SBDB
pour Itokawa ne correspond pas à la masse publiée que ses propres notes citent.

### Les objets d'instrument : deux familles de faits, et une date

Les onze sondes et les trois objets interstellaires portent une fiche comme n'importe quel
corps, mais pas les mêmes grandeurs. `core/bodyFacts.ts` le DÉCLARE au lieu de le déduire de
l'absence de valeur : une sonde a une date de lancement, un lanceur, un site de lancement et une
masse, un interstellaire une excentricité, une périhélie, une première observation et une
magnitude absolue, et aucune des deux familles n'a de
rayon, de gravité, de lune ni d'orbite fermée. `notApplicableFacts` soustrait donc l'ensemble
complet des champs, et la réciproque vaut pour le catalogue. Le piège est dans l'union : la
masse d'une sonde est la MÊME grandeur que celle d'une planète, et la déclarer propre à la
couche instrument l'efface de tout le catalogue — 40 valeurs disparues d'un coup, attrapé par
`factProvenance.test.ts`.

**Un fait peut être une DATE, ou un NOM.** `FactValue` est une union fermée de trois natures :
nombre, date de calendrier, nom propre. Encoder une date en nombre aurait rendu la fiche JSON
illisible et laissé `displayedUncertainty` calculer une incertitude relative sur un instant. Les
pages publiques, elles, ne décrivent que des corps du catalogue, dont tous les faits sont
numériques : elles écartent explicitement les autres natures au lieu de le supposer.

La troisième nature est arrivée au lot 10 (2026-09-22), et c'était une décision de modèle, pas
une corvée. Le lanceur et le site de lancement ne sont pas des nombres, et le modèle avait été
fermé pour refuser le texte libre. Deux voies s'offraient. Publier une raison de non-publication
aurait été FAUX : le NSSDCA publie ces deux champs. Ouvrir le modèle au texte libre aurait défait
ce que la fermeture protégeait. La nature `name` se tient entre les deux : c'est **la chaîne que
la source écrit, recopiée à l'identique**, jamais traduite ni composée (« Titan IIIE-Centaur »,
« Kourou, French Guiana », y compris dans l'interface française), et `factProvenance.test.ts` la
compare caractère pour caractère au relevé, sans tolérance ni normalisation. Une phrase écrite
par nous ne passerait pas cette garde. Falsifié : un tiret retiré d'un lanceur, un site traduit
en français, tous deux rouges.

**Une magnitude porte son incertitude en valeur absolue.** La SBDB publie H = 22,08 ± 0,445 pour
ʻOumuamua. En relatif, cela ferait 2 %, sous le seuil d'affichage de 5 %, donc on le tairait ;
or 0,45 magnitude est un facteur 1,5 sur la brillance. `ABSOLUTE_UNCERTAINTY_FACTS` soustrait la
magnitude à la règle relative, et la fiche écrit « 22,08 (± 0,45) ».

**Aucune valeur n'est écrite deux fois.** La date de lancement vit en tête de fiche de sonde et
son fait ne porte que la provenance ; l'excentricité d'un interstellaire EST son élément
orbital, et la périhélie s'en dérive par q = a(1 − e). `spreadFacts` refuse une valeur répétée
dans un fait dont la valeur vit ailleurs : c'est la garde qui empêche deux vérités pour un même
nombre dans un même fichier.

**Le champ « Mass » du NSSDCA Master Catalog n'a pas le même sens d'une mission à l'autre**, et
c'est le défaut le plus intéressant du lot. Pour OSIRIS-REx il vaut 1528 kg quand la page écrit
« Launch mass including propellant is 1529 kg » ; pour New Horizons 385 kg, soit exactement la
masse sèche (« The 465 kg launch mass includes 80 kg of propellant ») ; pour BepiColombo 365 kg,
que la page attribue au SEUL module de propulsion, la pile du MPO pesant 1229 kg au lancement.
La valeur publiée dit donc ce qu'elle est (`DETAIL.nssdcaFactsInBrief` nomme le champ lu, et la
`citation` porte l'identifiant COSPAR, seul moyen de retrouver la fiche) ; **BepiColombo ne
publie aucune masse**, avec sa raison, parce qu'une ligne « 365 kg » serait fausse pour un
lecteur. Le relevé conserve à côté de chaque valeur les phrases de la page qui parlent d'une
masse au lancement, et le test EXIGE une précision dès que ces phrases existent.

**L'identité de la fiche lue est vérifiée**, comme l'est `Target body name:` côté Horizons : un
identifiant COSPAR faux ne renvoie pas d'erreur, il renvoie une autre mission. Falsifié :
`2011-029A` au lieu de `2011-040A` sort « ORS 1 au lieu de Juno ».

**La magnitude des deux comètes est refusée, avec sa raison, et cette raison est vérifiée.** La
SBDB ne publie pas H pour 2I/Borisov et 3I/ATLAS, mais M1, la magnitude TOTALE de la loi de
brillance cométaire, chevelure comprise : une autre grandeur, qu'on n'affiche pas sous le même
libellé. Le relevé conserve M1 (`cometTotalMagnitude`) précisément pour que le test confronte la
raison à la source dans les deux sens : un objet dont la SBDB publie H doit l'afficher, et une
raison qui cite M1 exige que M1 existe au relevé.

**Ce qui n'est pas publié, délibérément** : la puissance nominale. Le champ « Nominal Power » du
NSSDCA ne dit pas à QUELLE date il vaut, alors que la grandeur varie beaucoup : la puissance d'un
générateur à radio-isotope décroît d'année en année (celle des Voyager a fondu depuis 1977), et
celle d'un panneau solaire dépend de la distance au Soleil. La scène étant datée, un chiffre
unique se lirait comme la puissance à la date affichée, ce qui serait faux ; et 4 fiches sur 11
ne le donnent pas. Ce n'est donc pas un fait applicable, et aucune ligne ne l'annonce. La
rotation de 1I non plus, parce que la scène ne fait tourner aucun de ces objets et qu'on ne
publie pas une période que la simulation ne montre pas.

## Petits corps : un instantané livré, pas un flux

`ssd-api.jpl.nasa.gov` répond **HTTP 200 sans en-tête `Access-Control-Allow-Origin`** (mesuré au
curl avec l'`Origin` du site, quatre fois, le 2026-09-20) : un navigateur jette la réponse, et la
couche des petits corps était **vide en production depuis toujours**, en silence, alors qu'elle
se remplissait en développement derrière un serveur de dev de même origine. Ce n'était pas la
CSP, qui autorisait l'hôte en `connect-src`.

Les quatre requêtes sont donc tirées AU BUILD par `scripts/generate-small-body-dataset.mjs`
(`pnpm smallbodies:generate`), qui écrit `public/assets/small-bodies/dataset.json` **dans la
forme même de l'API** (`fields` + `data` par catégorie) : `parseSbdbRows` la lit sans une ligne
de conversion, et le fichier commité reste comparable à sa source. Conséquences :

- l'application ne contacte plus JPL du tout : l'hôte est retiré de la CSP, de
  `LIVE_DATA_SERVICES` et de `public/privacy.html` dans les deux langues ;
- la donnée est un **instantané daté**, et le panneau le dit (« 6965 objets, JPL Small-Body
  Database, relevé du … »). Une donnée figée qui se présenterait comme vivante serait le défaut,
  pas la correction ;
- le nombre publié est celui que l'APPLICATION obtient, pas le nombre de lignes du fichier :
  `parseSbdbRows` écarte les orbites non elliptiques et les lignes incomplètes, soit 8000 lignes
  pour 6965 orbites. `/sources` passe donc par `parseSmallBodyDataset`, comme le panneau ;
- la couche marche enfin **hors ligne** : le nom du fichier est stable, donc le service worker le
  sert « réseau d'abord, cache en secours », comme les textures ;
- **ce même nom stable lui interdit le cache immuable d'un an** que `firebase.json` applique à
  tout `/assets/**` : sans règle explicite, une régénération n'atteindrait jamais un visiteur
  déjà venu. Le piège est le même que pour les vignettes de partage, et il a failli repasser.
  `src/config/stableAssetCaching.test.ts` croise désormais les familles « réseau d'abord » du
  service worker avec les règles de cache de Firebase : en déclarer une d'un seul côté échoue.

**Un instantané se périme en silence, donc son âge est surveillé** (lot 10, 2026-09-22). Rien ne
change dans l'application quand le relevé vieillit : les orbites sont affinées à chaque nuit
d'observation et de nouveaux objets entrent dans les catégories, sans que la couche le sache.
`core/snapshotAge.ts` déclare un âge maximal, `SMALL_BODY_SNAPSHOT_MAX_AGE_DAYS` (180 jours).
C'est une politique, la cadence de relevé à laquelle on s'engage, et non une grandeur physique :
aucune date de la source ne dit qu'un relevé cesse d'être juste. Deux lecteurs de la même règle :

- le **panneau** le dit au visiteur au-delà de cet âge (« Ce relevé date de 8 mois : les orbites
  affinées depuis, et les objets catalogués depuis, peuvent y manquer »), d'après l'horloge du
  visiteur et non la date de la scène ;
- un **workflow GitHub planifié** (`.github/workflows/data-freshness.yml`, chaque lundi) lance
  `pnpm smallbodies:age`, qui échoue au-delà du même âge ; GitHub notifie alors le propriétaire
  du dépôt, sans que personne ait à y penser.

Écarté : un test daté dans `pnpm verify`. Une porte qui rougit parce que le calendrier a tourné
n'est plus reproductible, et elle bloquerait un déploiement sans rapport. Le contrôle daté vit
donc dans `snapshotAge.test.ts`, éteint sauf si `GALAXY_SNAPSHOT_AGE_CHECK=1`. Limite connue :
GitHub suspend les workflows planifiés d'un dépôt public après 60 jours sans activité, et c'est
alors le panneau qui reste. Falsifié : un relevé daté du 2026-03-20 fait sortir
`pnpm smallbodies:age` en code 1, et un seuil porté à 400 jours fait rougir le scénario e2e.

Mesuré en e2e : la couche PEINT (pixels non transparents comptés sur son canevas) et n'émet
AUCUNE requête vers `jpl.nasa.gov`. Les deux moitiés comptent : la première seule repasserait au
vert si on rebranchait l'API depuis une machine où elle répond, la seconde seule passerait sur
une couche morte.

## Légende d'une couche satellite : la rampe de la NASA, rendue par nous

La légende de la couche « température satellite » était un `<img src>` vers
`gibs.earthdata.nasa.gov/legends/….svg`, que **notre propre CSP** interdit
(`img-src 'self' data: blob:`). Elle n'est jamais apparue en production, et une image bloquée ne
se plaint pas. Le SVG pèse par ailleurs 324 ko et embarque un `<script>`.

GIBS publie le même barème sous forme lisible par une machine
(`/colormaps/v1.3/<couche>.xml`). `scripts/import-gibs-colormap.mjs` (`pnpm gibs:colormap`) en
tire `src/config/gibsColormap.json` — couleurs, bornes, unité, source et date de lecture — et
`core/gibsLegend.ts` en fait un dégradé CSS et deux bornes en degrés Celsius (220 K → 310 K,
soit −53 °C → +37 °C). **Les couleurs restent celles de la NASA** : ce n'est pas une palette de
remplacement. `legendUrl` a été SUPPRIMÉ du modèle de couche plutôt que laissé inutilisé : une
légende distante n'est plus exprimable, ce qui vaut mieux qu'un test qui l'interdirait. Deux
gardes restent, croisées avec `firebase.json` : `img-src` n'autorise aucun hôte tiers, et aucun
module d'interface ne construit une source d'image absolue.

## Modèle temporel : ce qu'une donnée dit du temps

`src/core/temporal.ts` (pur) répond à une question que la scène pose partout : **la donnée
affichée décrit-elle l'instant de la scène, et de quelle nature est-elle ?** Il remplace
`core/dataStatus.ts`, qui ne classait que la météo, sur la seule date — et appelait donc
« observée » une réanalyse ERA5 ou MERRA-2.

**Quatre temps, jamais confondus** : `simulationTime` (l'instant que la scène représente, unique),
`validTime` (l'INTERVALLE que décrit la donnée : un jour pour une tuile VIIRS, un mois pour
MERRA-2, un instant pour une position), `observationTime` / `publicationTime` (quand la mesure a
été prise, quand la source l'a publiée — pas encore portés par `DatedProduct`, aucune catégorie
n'en dépend), et `now`, l'instant RÉEL, seul à séparer ce qui a pu être observé de ce qui ne peut
être que prédit.

**La source déclare une NATURE** (`ProductKind` : `measurement`, `reanalysis`, `forecastModel`,
`ephemeris`) et `classifyTemporal` en tire une catégorie : `live`, `observed`, `reconstructed`,
`predicted`, `extrapolated`, `unavailable`. La règle, dans cet ordre : hors de la fenêtre où
l'écart de la source a été MESURÉ → `extrapolated` ; scène et donnée au présent, si la source
l'autorise (`liveToleranceMs`) → `live` ; intervalle commençant avant `now` → `observed` pour une
mesure, `reconstructed` pour un modèle ; sinon `predicted`, en confiance réduite au-delà de
`reliableHorizonMs`.

**Catégorie et exactitude sont deux axes.** Une éphéméride de Jupiter en 2050 et une prévision
météo à 12 jours sont toutes deux « prédites » et n'ont rien de commun : l'écart mesuré s'affiche
à côté, jamais fondu dans l'étiquette. « Mesuré » ne veut pas dire « exact » : les éléments képlériens
d'Hygie sont mesurés sur 1900-2100, à 6e7 km (depuis le lot 11 ils ne servent plus qu'en repli
hors de la couverture de son binaire).

**L'écart à la scène est une donnée à part entière.** `validTime` s'éloigne de `simulationTime`
dès qu'aucune donnée n'existe pour la date demandée : une scène en 2030 reçoit la dernière image
satellite réelle. Le stamp porte alors `offset`, et la surface l'ÉCRIT (« scène au 2030-01-01 »).
C'était le défaut : la tuile ramenée à J-2 s'affichait « observé », `approx: false`, sans rien
dire de l'écart.

**Position d'un corps** : `BodyPositionResolver.resolveSource` nomme la source qui a répondu, par
la MÊME règle que `resolve` (une seule implémentation, `_resolve`, avec un paramètre de sortie
facultatif — la boucle de rendu n'alloue rien). `core/positionProvenance.ts` en tire le produit
daté et l'écart mesuré, lus dans `src/config/horizons-validation-summary.json` (chargé À LA
DEMANDE par `ui/positionProvenance.ts`, morceau séparé : personne ne le télécharge sans ouvrir une
fiche). Un binaire Horizons ou un noyau SPK ne peut pas être « extrapolé » : hors couverture il ne
répond pas, une autre source prend le relais. astronomy-engine et les éléments képlériens, eux,
répondent à toute date : hors des fenêtres mesurées, la fiche dit « extrapolé », et sans aucune
mesure elle le dit partout. Les fenêtres d'un satellite sont RELATIVES à son parent (la Lune :
11 km relatifs, 900 km en héliocentrique) et les deux repères ne se mélangent jamais.

**Aucun réglage global de précision.** Chaque donnée porte son étiquette là où elle s'affiche :
badge du panneau météo, bloc « Position à cette date » de la fiche. La page `/methodology` publie
les catégories en lisant le dictionnaire de l'application, et `docPages.test.ts` refuse qu'une
catégorie manque ou qu'un libellé se replie sur sa clé.

**Rien n'est affiché à la place de rien** : hors de la plage d'un modèle, la couche masque son
overlay (`meteoModelLayer`) et le vent masque ses particules plutôt que de garder la grille d'une
autre date. L'ancienne étiquette « moyenne climatique » a disparu avec cette correction : aucune
climatologie n'était servie.

## Pages `/methodology` et `/sources`

Deux documents, chacun en anglais (`/methodology/`, `/sources/`) et en français
(`/fr/methodology/`, `/fr/sources/`), générés au build et ajoutés au sitemap. Liés depuis les
crédits de l'aide (`data-i18n-href` : le lien suit la langue de l'interface).

- **Documents autonomes, pas des copies d'`index.html`.** On y vient pour lire : même habillage
  que `privacy.html` (`privacy.css` + `docs.css`), aucun script, aucune scène WebGL.
- **Une URL par langue, reliées par `hreflang`**, plutôt qu'une page bilingue masquée par script
  comme `privacy.html`, dont un moteur n'indexe correctement qu'une langue.
- **Aucun nombre écrit à la main.** Le texte explique la méthode ; chaque valeur est lue au build
  dans ce qui fait foi : erreurs mesurées (`horizons-validation-summary.json`), pas et couverture
  des binaires (`manifest.json`), constantes importées du code qui les applique (`OBLIQUITY_RAD`,
  `SQRT_K`, `MIN_SAMPLES_PER_ORBIT_FOR_HERMITE`, `TT_MINUS_UTC`, `INTERSTELLAR_WINDOW_YEARS`),
  crédits de textures (registre `src/registry/products/`, couches livrées), crédits des modèles
  (`ModelConfig`), éléments orbitaux (registres `src/registry/entities/` et `src/registry/interstellar/`, exposés par les façades `config/`), versions et licences
  des dépendances INSTALLÉES, et `THIRD_PARTY_NOTICES.md` rendu intégralement (`markdown.ts`,
  sous-ensemble minimal, tout le reste échappé).

**Le résumé de validation est versionné, le rapport ne l'est pas.** `reports/` est ignoré par
git, donc invisible du build de CI. `pnpm ephemeris:validate` écrit aussi
`src/config/horizons-validation-summary.json` (statistiques sans échantillons, 4 chiffres
significatifs), mais **seulement** pour une mesure complète : `--only`, `--providers`,
`--inject-*`, `--samples` non standard ou `--out` redirigé laissent le fichier intact. Une
falsification ne peut donc pas finir publiée.

Trois refus bruyants plutôt qu'une page fausse :

- `assertPublishableSummary` : moins de 20 lignes « production », ou une ligne sans mesure ;
- `sourcesPages` : une couche de texture que le catalogue charge sans entrée de provenance. Ce
  contrôle a trouvé à sa première exécution `earth/displacement` (ETOPO 2022) absent du bloc
  `imported`, et la normal map de la Terre encore créditée à « NASA Visible Earth » alors
  qu'elle est dérivée d'ETOPO 2022 depuis `8e7b5d5` ;
- `sourcesPages` encore : chaque hôte `connect-src` de la CSP (`firebase.json`) doit être décrit
  dans `LIVE_DATA_SERVICES`, et réciproquement ;
- `docPages.test.ts` : chaque corps positionné du catalogue doit figurer dans le résumé. Ajouter
  un corps oblige donc à relancer la validation, sinon le tableau de précision le tairait.

**Chaque phrase de la page est confrontée au code, pas seulement ses chiffres.** La relecture du
lot 3 contre le code a trouvé cinq affirmations fausses dans la première version, toutes
désormais tenues par un test de `docPages.test.ts` :

- l'ordre des sources : le SPK, quand il est actif, passe AVANT les fichiers Horizons
  (`FallbackPreciseEphemerisProvider(spk, horizons)` dans `SolarSystemApp.ts`) ;
- le mode Éducatif n'est pas « distances seules » : les corps y ont des tailles pédagogiques ;
- la dérive de rotation ne concerne que les lunes presque synchrones, calculée corps par corps
  (`synchronousSpinDrifts`) ; les 18 autres sont verrouillées à 1e-9 ;
- la Terre est dessinée au barycentre Terre-Lune (`positionBody: Body.EMB`), ce que mesure sa
  ligne du tableau (4 823 km en moyenne ; 4 683 depuis que le barycentre vient d'un fichier
  Horizons, lot 12) ;
- « contacté seulement quand la couche est utilisée » était faux : SBDB était interrogé au
  démarrage, et la couche de nuages satellite (active par défaut sur ordinateur) comble ses
  trous avec Open-Meteo. **Depuis le lot 8b, SBDB n'est plus contacté du tout** : les petits
  corps viennent d'un instantané livré (§ « Petits corps : un instantané livré, pas un flux »).
  Le second point, lui, tient toujours.

**Obliquité corrigée, trouvée par cette relecture.** `frames.ts` tournait les vecteurs
d'astronomy-engine de 23,4394°, alors que l'écliptique J2000 des fichiers Horizons et des
éléments est défini par l'obliquité IAU 1976, 84 381,448″ (23,4392911°, écrit dans l'en-tête de
chaque réponse Horizons). Deux sources de la même scène étaient donc dans deux repères décalés
de 0,39″, environ 280 km à 1 UA. Remesuré hors ligne : Vénus 1 451 → 1 428 km, Mars
(astronomy-engine) 2 992 → 2 891, Jupiter 22 990 → 22 820 ; Uranus 111 200 → 112 200, dans le
bruit de VSOP87 et sans effet en production (fichier Horizons).

**Attribution des données météo, manquante avant le lot 3.** Open-Meteo diffuse sous CC BY 4.0 et
demande un lien d'attribution près des données affichées ; ERA5 demande sa citation Copernicus.
Rien de cela n'apparaissait : le badge affichait « Open-Meteo » sans lien ni licence. Ajouté en
pied du panneau météo et dans les crédits de l'aide ; conditions lues à la source le 2026-09-17
(README et « Terms » d'Open-Meteo, page « Historical Weather API », « Data Use Guidance » de NASA
Earthdata). L'usage gratuit d'Open-Meteo est réservé au non commercial ; Galaxy (gratuit, sans
abonnement ni publicité) entre dans leurs exemples d'usage non commercial.

Piège payé : `THIRD_PARTY_NOTICES.md` est en CRLF dans un checkout Windows, et `.` ne franchit
pas le retour chariot (`\r`) en JavaScript. Le retrait du titre de premier niveau était un no-op silencieux ; le
test le rejoue désormais en CRLF.

## Événements terrestres — séismes USGS et événements rapportés EONET

La Terre porte deux couches d'événements optionnelles, éteintes au départ : les séismes du
catalogue USGS et les événements naturels agrégés par NASA EONET. Elles répondent à la date de
la scène comme les couches météo, mais ce ne sont ni des images ni des grilles : ce sont des
POINTS datés, posés à leurs coordonnées réelles.

**Deux fournisseurs, et pas un de plus.** L'USGS a été écrit d'abord, sans aucune abstraction
(`core/usgsEarthquakes.ts`), EONET ensuite (`core/nasaEonet.ts`). `core/earthEvents.ts` n'existe
que parce que les deux étaient là : il ne porte que ce qu'ils partagent RÉELLEMENT — une clé
tirée de la date, une fenêtre bornée par `now`, des points datés portant chacun son
`DatedProduct`, et un lot qui porte sa traçabilité sous la forme du `SourceCandidate` que le
badge météo sait déjà écrire. Ce qu'ils ne partagent pas est resté chez eux : longueur de
fenêtre, paramètres de requête, forme de la géométrie, taxonomie des catégories, et le fait
qu'un intervalle puisse rester ouvert. Copernicus/STAC et le trafic aérien sont hors de ce lot
(authentification openEO d'un côté, accord écrit exigé de l'autre).

**Le marqueur tombe sur sa VRAIE longitude, et c'est le point technique du lot.** Un épicentre
est posé par `CelestialObject.surfacePointToWorld`, qui compose la translation du corps, le
quaternion du vrai pôle IAU et la rotation propre du `_meshGroup` — celle que
`OrbitalMechanics.syncEarthSurfaceRotation` recale sur la date À CHAQUE IMAGE. Recalculer la
position ailleurs, depuis le rayon et l'axe, donnerait une phase indépendante de celle qui est
RENDUE : les marqueurs glisseraient par rapport aux continents sans rien déformer, donc sans se
voir sur une capture isolée. `core/frames.ts::geographicToLocalDirection` est la réciproque
exacte de `localDirectionToGeographic`, qui servait déjà au point subsolaire.

`e2e/earthEvents.spec.ts` le MESURE, à six dates réparties sur l'année et sur la journée. Pour
quatre épicentres PUBLIÉS par l'USGS (Tōhoku 2011, Maule 2010, Sumatra 2004, San Francisco
1906), `?debug-geo` compare la direction du Soleil vue depuis ce point sur la scène rendue à
celle qu'astronomy-engine calcule pour un observateur aux mêmes coordonnées. Les deux chemins
n'ont en commun que l'éphéméride du Soleil : le premier passe par le graphe de scène, le second
par le temps sidéral. Écart mesuré : 0,002 à 0,006°, résidu attendu (aberration 0,006°,
barycentre Terre-Lune 0,002°, parallaxe 0,002°) ; seuil 0,05°, le même que le point subsolaire.
Falsifié deux fois : 0,1° de longitude injecté, les six dates rougissent ; la phase diurne
ignorée (`_tiltGroup` au lieu de `_meshGroup`), rouge aussi. **Sensibilité assumée** : une
erreur de phase déplace un site de δ·cos(latitude), donc le seuil de 0,05° attrape à partir
d'environ 0,05° de phase, soit 5,6 km au sol à l'équateur, et pas moins.

**Une mesure et un rapport ne portent jamais la même étiquette.** `core/temporal.ts` gagne un
`ProductKind` `report` et une catégorie visible `reported`. Une solution d'origine sismologique
est une mesure d'un instant (`observed`) ; un événement EONET est agrégé depuis des sources
tierces, et EONET demande lui-même que ses emprises ne soient pas tenues pour officielles. Un
événement qu'EONET n'a pas clos (`closed: null`) porte `openEnded` : son intervalle va jusqu'à
`now` et pas au-delà, la liste du panneau écrit « en cours », et aucune date de fin n'est
fabriquée. `validTime.to` garde le dernier relevé CONNU.

**Trois pièges de format, chacun payé en lisant la documentation des services :**

- EONET sans `status=all` ne rend que les événements OUVERTS : une scène en 2011 recevrait les
  incendies d'aujourd'hui et rien de 2011 ;
- la géométrie EONET est une SUITE de relevés datés ; le relevé retenu est le dernier qui
  précède la scène, sinon une tempête serait peinte là où elle a fini ;
- `Number(null)` vaut 0 : une entrée GeoJSON sans instant devenait le 1er janvier 1970 et un
  couple de coordonnées manquant le point (0, 0). D'où `utils/jsonNumber.ts`, trouvé en
  écrivant le test, pas en relisant le code.

**Ce que la couche déclare, et où.** Zoom sémantique (`minEarthRadiusPx`, sous lequel rien
n'est peint : vue depuis Saturne, la Terre fait moins d'un pixel), priorité de dessin et
plafond de marqueurs vivent dans `EarthEventLayer`. Couverture temporelle STAC, cadence
EPNCore, licence SPDX, conditions et date de leur lecture vivent dans la fiche du fournisseur
(`src/registry/providers/`, rôle `event-source`, troisième rôle du registre). Les lignes de
`/sources` sont DÉRIVÉES de ces fiches, pas recopiées, et `docPages.test.ts` croise l'hôte de
chaque fiche avec le `connect-src` de `firebase.json`.

Ces deux fiches vivent dans `providers/events.ts`, que `providers/index.ts` ne réexporte
PAS. L'application importe `index.ts` : avec les fiches dedans, la prose bilingue de leurs
conditions partait dans le bundle de chaque visiteur alors que rien à l'exécution ne les lit —
une couche ne connaît de son fournisseur que son identifiant. Trouvé en cherchant la chaîne
dans le bundle construit, pas en relisant le code ; `providers.test.ts` tient la règle en
lisant la source, et la garde a été falsifiée.

**Une couche éteinte ne demande RIEN.** Le socle daté n'est créé qu'à la première activation et
détruit à l'extinction — différent du panneau météo, qui garde ses couches vivantes en fond.
Un service public interrogé pour un affichage que personne n'a demandé n'est pas un bon voisin.
Mesuré par e2e (comptage de requêtes), et falsifié en démarrant les couches au boot.

**Conditions lues à la source le 2026-09-20.** USGS : « USGS authored or produced data and
information are considered to be in the U.S. Public Domain », avec demande de crédit. NASA
Earthdata : partage plein et ouvert, sans période d'accès exclusif. Les deux crédits sont
AFFICHÉS sous le panneau, pas seulement déclarés — la leçon d'Open-Meteo, dont la mention
CC BY 4.0 n'apparaissait nulle part pendant des mois.

**`public/privacy.html` énumère les services contactés**, et l'ajout de deux hôtes l'a trouvée
incomplète : elle en citait trois quand la CSP en autorisait six. Les deux nouveaux y sont
désormais dans les deux langues, avec la mention qu'ils ne sont interrogés que si la couche est
allumée, et `config/privacyDisclosure.test.ts` croise chaque hôte `connect-src` avec la page.
La comparaison se fait par SUFFIXE : citer « open-meteo.com » décrit honnêtement
`api.open-meteo.com` et `archive-api.open-meteo.com`.

**Pas fait, délibérément** : un marqueur d'événement ne se clique pas (il n'est la cible d'aucune
commande de navigation, contrairement aux sondes), et aucun réglage n'est persisté, donc aucune
clé `STORAGE_KEYS` nouvelle à déclarer.

## Architecture météo

Trois frontières simples (le plan directeur complet avec l'historique des décisions et des
tranches T1–T6 vit hors dépôt, dans la documentation privée du projet) :

- `src/core/` décide la source, la date, le fallback, la grille et la conversion en données
  testables sans DOM ni Three.js.
- `src/ui/` orchestre le cycle date → chargement → cache → badge et expose un `WeatherLayerHandle`
  uniforme au panneau.
- `CelestialObject` et `src/config/layerConfig.ts` possèdent le rendu Three.js, les matériaux, les
  UV, l'alpha et l'éclairage.

Les couches satellite réutilisent `ui/observedTextureLayer.ts`, les couches Open-Meteo
`ui/meteoModelLayer.ts` ; leurs fichiers spécifiques ne contiennent que variable, palette, grille
et configuration. `ui/weatherLayers.ts` ne connaît pas le type de source : il construit le panneau
et applique les groupes exclusifs (déclarés dans `MainSolarSystemApp.ts`) sur les couches qui
partagent un mesh.

Règle produit : une donnée absente, en attente ou hors couverture reste absente à l'écran — aucun
modèle ou remplissage synthétique n'est présenté comme une observation officielle. Chaque couche
porte un statut (`observed`/`analysis`/`forecast`/`forecast_uncertain`/`climatology`/
`unavailable`) affiché dans son badge (la carte de repérage fichier par fichier utile en debug
vit hors dépôt, dans la documentation privée du projet).
