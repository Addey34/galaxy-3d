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
Les chiffres de production font foi sur `/methodology`. **La portée de cette méthode a une limite, mesurée au lot 26** : une décimation de vecteurs au pas d'UN JOUR ne peut rien dire d'un satellite dont la période est plus courte qu'un jour, puisque la référence elle-même replie l'orbite. Les quatorze binaires sous-échantillonnés n'ont donc pas été atteints par elle ; voir la section suivante. Poids, en octets exacts du manifeste :
4,46 Mo économisés sur les fichiers existants, 3,96 Mo ajoutés (dont Ganymède, 1,76 Mo au pas de
2 jours), soit 38,94 → 38,45 Mo pour cinq fichiers de plus ; démarrage inchangé à la mesure
(16,9 s à 50 Mbit/s, 41,5 s à 10).

### L'écart d'un satellite se mesure contre l'ARC PROPAGÉ (lot 26)

Sous le seuil d'Hermite, le service propage une conique à deux corps depuis l'échantillon
encadrant. L'écart ne dépend donc pas de QUAND on regarde mais de la durée propagée depuis le
nœud le plus proche, et c'est ce que mesure `pnpm ephemeris:propagation`. Sur Amalthée :

| distance au nœud | écart moyen |
|---|---|
| 0 à 0,005 j | **12,7 km** |
| 0,01 à 0,02 j | 263 km |
| 0,04 à 0,08 j | 851 km |
| au-delà de 0,125 j | ~1 100 km, **saturé** |

**Deux régimes**, et c'est ce qui explique qu'un pas seize fois plus fin (4 j vers 6 h) n'ait
divisé l'écart que par deux : 6 h propage encore jusqu'à 0,125 jour, soit toujours dans la
saturation. Un pas n'achète quelque chose que s'il maintient l'arc dans le régime linéaire.

Trois choses ont été ÉCARTÉES par la mesure, et non par un avis :

- **le démarrage n'est pas la contrainte.** Depuis la phase 17C les fichiers se lisent par
  fenêtres `Range` : chacune de ces lunes coûte 336 octets au démarrage, 816 au pas d'une heure ;
- **rétrécir la couverture pour financer un pas fin dégraderait tout le reste du temps**, parce
  que le repli képlérien est bien pire que le binaire grossier (Mimas : 504 rayons contre 4,3) ;
- **aucun réglage à zéro octet ne reste.** Le facteur `meanMotionScale` a été balayé sur
  Amalthée (1,0060 rend 1 181 km, 1,0069219 — la valeur publiée — 1 100, 1,0081 1 225) : il est
  déjà à son optimum.

Reste le coût en OCTETS LIVRÉS, et il est économique : Firebase facture la somme des versions
retenues. `src/config/ephemerisStepBudget.ts` porte donc la règle, l'arithmétique du coût et la
liste des refus DÉCLARÉS, que `pnpm inventory:gaps` imprime à côté du manque qu'ils expliquent :
un manque ne s'y lit jamais sans sa raison. Le coût n'y est pas écrit, il se dérive du pas, et
sa garde rougit si un corps s'améliore, se dégrade, ou si un chiffre dérive du relevé committé.

Le générateur sait désormais EXÉCUTER une telle décision : il exprime un pas en minutes (le
précédent arrondissait en heures, donc tout pas sous une heure partait en `'0 h'` et Horizons
rendait sa page d'erreur) et découpe une demande trop longue en tranches dont les frontières se
prennent sur la GRILLE DU FICHIER (`JD <nœud>`), jamais sur une date recalculée, qui dériverait
de ~69 s entre TDB et UT. Le chemin découpé rend un fichier identique octet pour octet au chemin
d'un bloc, vérifié sur Encelade.

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

Les binaires couvrent 1900-2100 ; la scène, elle, affiche un instant. **Placer un corps coûte
96 octets**, et les 62 corps que la couverture contient au 2026-09-23 en coûtent donc **5 952**
(les deux autres n'ont aucune position à cette date, et ne demandent rien) : `HorizonsEphemerisService._sampleGrid` lit
l'échantillon qui encadre la date et le suivant, rien d'autre. `core/ephemerisWindow.ts` (pur)
traduit cela en un PLAN : date vers index, index vers plage d'octets, et le contrat d'une
réponse partielle.

**Deux consommateurs, et ils ne demandent pas la même chose.** La position lit deux états ; la
LIGNE D'ORBITE (`core/orbitPath.ts`) échantillonne la source précise sur une période entière
centrée sur la date. Une fenêtre trop courte d'un seul échantillon ne dégrade donc pas un peu le
tracé, et ce qu'elle lui fait dépend du corps. Pour un corps qui a des éléments képlériens,
`needsElementsOnly` sonde les deux extrémités et bascule TOUTE la courbe sur les éléments ou sur
la conique osculatrice. Pour un corps qui n'en a pas, et **les huit planètes sont exactement
dans ce cas alors que leur orbite est la seule tracée par défaut**, la ligne est échantillonnée
par `resolve`, qui retombe sur astronomy-engine point par point : la courbe ÉPISSE alors deux
sources, ce que ce module rejette par principe ailleurs. Avant que le binaire d'Uranus n'existe,
les deux sources s'écartaient de 111 196 km (lot 12). Dans les deux cas, rien n'est journalisé. Le
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

### Le service charge des fenêtres, et l'horloge les attend (lot 17, phase 17C)

Le service ne demande plus des FICHIERS, il demande des PLAGES, et l'horloge n'avance que sur
des octets arrivés. Mesuré contre le build livré, service worker bloqué, même build des deux
côtés (un seul drapeau du serveur décide s'il honore `Range`, ce qui reproduit exactement le
comportement d'avant) :

| | A : fichiers entiers | B : fenêtres | |
| --- | --- | --- | --- |
| éphémérides au démarrage | 38 040 720 o, 62 requêtes | **987 168 o**, 62 plages | **38,5 fois moins** |
| octets servis jusqu'au loader masqué, lien non bridé | 48 111 453 o | **11 057 901 o** | 4,4 fois moins |
| démarrage complet, lien non bridé | 12,84 / 12,67 s | 12,49 / 13,47 s | aucun gain |
| démarrage, 10 Mbit/s | 47,17 / 55,46 s | 28,65 / 17,58 s | ~2 fois |
| démarrage, 2 Mbit/s | 186,48 / 180,70 s | **36,80 / 28,00 s** | ~5,7 fois |

Annoncer « 38 fois plus léger » serait vrai en octets et trompeur en secondes : sur un lien
rapide il n'y a rien à gagner, ce sont les allers-retours et le décodage qui dominent. Le gain
est celui d'un vrai visiteur mal connecté, et c'est tout l'objet de la série « accès ».

**Ce que la scène demande.** `SceneWindowRequest` porte la date affichée, l'avance de lecture
que réclame la vitesse, et la période de révolution des corps dont une ligne d'orbite sera
tracée. La couche de composition (`SolarSystemApp`) la construit, puisqu'elle seule connaît à
la fois le service et le catalogue. Sans cette demande, le service charge les fichiers entiers
comme avant : c'est ce que font les tests de fixture, le validateur et tout ce qui lit ces
binaires hors du navigateur.

**Le bandeau compte ce que la scène DEMANDE, pas ce que le manifeste déclare.** Un corps hors
couverture n'a aucun fichier à recevoir : il n'est donc ni « reçu » ni « manquant », et
`report.declared` vaut le nombre de corps dont un fichier doit être lu à cette date. Sans cette
règle, le bandeau annonçait « 3 sur 64 » alors qu'UN SEUL fichier était arrivé, les deux missions
closes (Cassini 2017, Rosetta 2016) étant comptées comme reçues. Identité tenue par un test :
reçus + manquants = demandés.

**Un corps que la date ne concerne pas ne coûte RIEN.** Sa couverture se lit au manifeste, et il
n'est pas pour autant « manquant » : il ne répondrait pas davantage avec son fichier entier, donc
le bandeau reste muet. Onze corps sur 64 sont dans ce cas au 1969-07-20. La règle vaut AUSSI
sans plages, et le contrôle est arithmétique : les 38 040 720 octets de la colonne A ci-dessus
sont les 38 445 024 livrés moins 404 304, c'est-à-dire exactement Cassini (349 104) et Rosetta
(55 200), dont les missions sont closes depuis 2017 et 2016.

**L'horloge n'avance que sur des données arrivées (décision D3).** `OrbitalMechanics` interroge
`EphemerisWindows.ready` avant de laisser la date bouger ; sinon elle revient où elle était
(`SimulationClock.holdAt`, qui ré-ancre l'offset pour qu'aucune dette ne soit rattrapée à la
reprise) et la fenêtre est redemandée. Un saut de date ne s'applique pas tant que ses octets ne
sont pas là — et il demande les positions ET les lignes en une seule fois, un saut redessinant
toute la scène. Écarté explicitement : afficher la position de repli en attendant, qui est mot
pour mot « une position fausse en attendant » (Mercure à 2 600 km au lieu de 7,3, lot 15).

**Rien ne fige la scène pour toujours.** Après deux demandes revenues sans les octets, la date
avance quand même : les corps concernés repassent sur leur repli et le bandeau du lot 15 les
NOMME. Une attente infinie serait une autre façon de se taire, et redemander sans fin brûlerait
le lien de l'utilisateur.

**L'avance de lecture (décision D4) est mesurée, pas choisie.** Dix secondes de lecture au
curseur maximal (un an simulé par seconde réelle) :

| avance | 10 Mbit/s | 2 Mbit/s |
| --- | --- | --- |
| 2 s | 3,97 ans parcourus, 1,16 Mbit/s | 2,07 ans, 0,71 Mbit/s |
| **4 s (livré)** | **5,10 ans, 2,01 Mbit/s** | **2,75 ans, 0,84 Mbit/s** |
| 12 s | 6,35 ans, 4,34 Mbit/s | **la date n'avance plus du tout** |

La dernière ligne est le contre-intuitif du lot : un plus gros tampon d'avance n'aide pas un lien
pauvre, il l'achève, chaque demande portant alors plus de trois mégaoctets.

**Ce que ça coûte, et il faut l'écrire.** Un saut de date passe de **1,2 s à 3,2 s** (10 Mbit/s,
284 352 octets demandés), et la lecture au curseur maximal parcourt **5,1 ans par dix secondes au
lieu de 9,6** : la date ralentit pour rester exacte. C'est la question laissée ouverte au § 9b du
plan — ralentir, ou avancer en disant que les positions sont en retard — et la phase 17D la
tranche en connaissance de cause, maintenant qu'elle est chiffrée.

**Un lien daté démarre À SA date.** `core/permalink.requestedSceneDate` (pure) lit la date que
l'adresse demande — la query, ou le CHEMIN d'une page d'éclipse — et la couche de composition la
passe à `SolarSystemApp.init`, qui en fait la demande de scène ET la date de départ de
l'horloge. Sans cela, l'application chargeait la fenêtre d'aujourd'hui, puis celle du lien, la
seconde arrivant pendant que la première image se rend : **8,4 secondes** mesurées sur
`/eclipse/2026-08-12/` avant la correction, par vagues de six requêtes entre deux images, contre
**zéro requête après le démarrage** ensuite. L'adresse de la page d'éclipse y survit aussi : le
permalien ne se resynchronise pas tant qu'un saut attend ses octets, sinon il effaçait l'adresse
`/eclipse/…` au profit de `/earth/?date=…` au moment même où la page atteignait son pic.

**Les lignes d'orbite ont UNE porte, `OrbitalMechanics._emitOrbitsChanged`.** Tant que les octets
d'une période entière ne sont pas là, la couche app n'est pas prévenue : la ligne précédente
reste à l'écran et personne ne trace une courbe qui épisserait deux sources. Toutes les raisons
de redessiner (saut, changement de mode, fin de morph, reprise des éphémérides) passent par là.

**Un hôte sans plages continue de marcher (décision D7).** Un `200` avec tout le fichier est
gardé, et le service cesse alors d'en demander pour tout le monde — sinon il redemanderait une
plage par corps et par saut pour se faire rendre le fichier entier à chaque fois.

**Ce que ce lot RETIRE, et il faut le dire.** Les réponses `206` ne sont pas mises en cache par
le service worker (`cacheableResponse: statuses [0, 200]`, vérifié dans le `sw.js` construit) :
les éphémérides ne sont donc plus disponibles hors ligne. **La phase 17E le rend**, et autrement
que ce paragraphe l'annonçait : non par une règle de service worker mais par un magasin que
l'application tient elle-même, décrit au § « Ce que l'appareil tient » ci-dessous.

**Et le même fait a une seconde face, mesurée, qui n'était pas dans le plan : la visite de
RETOUR.** Une plage n'est servie ni par le cache du navigateur ni par le service worker, donc un
visiteur qui revient redemande sa fenêtre à chaque visite : **987 168 octets au lieu de zéro**,
mesuré sur trois chargements successifs dans le même navigateur (62 requêtes à chaque fois). La
première visite gagne énormément (186,5 → 32 s à 2 Mbit/s), la suivante perd un peu. **17E
couvre ce cas, et par le même mécanisme que le hors-ligne** (§ « Ce que l'appareil tient »).

**Conséquence sur le SERVEUR DE DEV, et sur lui seul.** Il parle HTTP/1.1, six connexions par
hôte : les 62 plages occupent les connexions et retardent les ressources du document, celles
qu'attend l'événement `load`. Mesuré, contexte neuf : `load` tombe exactement quand la dernière
plage arrive (17,0 s à froid, 4,7 s à chaud, contre 3,4 s avec les fichiers entiers servis par le
cache). Ce n'est pas le serveur qui coûte, il sert une plage PLUS VITE qu'un fichier entier
(1,1 ms contre 1,9 ms, curl) ; et en production, où l'hôte parle HTTP/2, l'A/B sur le même build
ne montre aucun écart (12,5 s contre 12,8 s). C'est pour cette raison, et avec cette mesure écrite
à côté du chiffre, que le budget local de `playwright.config.ts` rejoint celui de la CI.

| Garde | Ce qu'elle tient |
| --- | --- |
| `core/ephemerisWindowLoad.test.ts` | contre les binaires RÉELLEMENT livrés : une fenêtre place chaque corps au bit près comme le fichier entier (Mercure, Uranus, Encelade, Mimas, Pluton, Nix, Bennu, Voyager 1), moins de 3 % des octets, aucune requête pour un corps hors couverture, le compagnon du ballant couvre TOUTE sa famille, un hôte sans plages est absorbé, une fenêtre perdue est nommée et comptée par le bandeau, et un corps hors couverture n'entre dans AUCUN des deux comptes |
| `core/ephemerisClockGate.test.ts` | la date se fige et est redemandée, elle repart exactement où elle s'était arrêtée, un saut atterrit exactement sur sa cible, deux clics pendant l'attente comptent deux, l'avance suit la vitesse et son signe, et rien ne fige la scène pour toujours |
| `core/SimulationClock.test.ts` | `holdAt` ne laisse aucune dette : la reprise ne rattrape pas l'attente |
| `e2e/ephemerisWindow.spec.ts` | dans un vrai navigateur : chaque demande porte un `Range`, moins d'un vingtième des octets, la fiche dit toujours « JPL Horizons », un saut de cinquante ans garde cette source, un lien daté démarre à sa date SANS seconde fenêtre, et une fenêtre qui échoue EN COURS DE SESSION fait apparaître le bandeau |
| `core/permalink.test.ts` | la date demandée se lit dans la query puis dans le chemin d'éclipse, la query prime, et une date illisible ne devient pas une date |

### Le curseur se plafonne au débit mesuré, et une attente se dit (lot 17, phase 17D)

La phase 17C a fait que **la date n'avance que sur des données arrivées**. Elle a aussi chiffré ce
que cela coûte : au curseur maximal, la lecture parcourt 5,1 années par dix secondes au lieu de
9,6 sur un lien à 10 Mbit/s, parce que la date RALENTIT pour rester exacte. Restait une question
de produit, tranchée par l'utilisateur le 2026-09-24 (§ 9b du plan du lot 17, option (c)) :

**La date reste exacte, et c'est le CURSEUR qui renonce, en l'affichant.** Un curseur qui promet
un an par seconde sur un lien qui n'en sert pas le tiers ne mesure rien : il fait attendre, sans
le dire. Les deux options écartées, gardées pour la trace : laisser la date ralentir sans toucher
au curseur (il continue de promettre ce qu'il ne tient pas), et laisser la date avancer en
annonçant des positions en retard, qui est « une position fausse en attendant » sous une étiquette
— ce que la décision D3 a refusé et dont le lot 15 a chiffré le prix (Mercure à 2 600 km).

**Le plafond est DÉRIVÉ, jamais écrit à la main** (`core/playbackBudget.ts`, pur) :

- la DEMANDE vient de ce que la scène demande vraiment. Quand la date avance d'un pas de grille,
  un corps a besoin d'un échantillon de plus, soit `BYTES_PER_SAMPLE` octets tous les `stepDays`
  jours simulés ; la somme sur les corps COUVERTS à cette date donne des octets par jour simulé.
  S'y ajoute le coût fixe des marges, redemandées à chaque glissement de fenêtre (3 072 o/s pour
  64 corps, soit 24,6 kbit/s) ;
- le DÉBIT est mesuré (`core/transferRate.ts`), et le plafond est la vitesse dont la demande y
  tient.

**Le modèle de demande reproduit la seule mesure publiée du plan, et c'est ce qui le valide** :
les 64 corps du manifeste livré (5 fichiers au pas de 1 jour, 1 à 2, 39 à 4, 9 à 8, 3 à 16, 7 à
64) donnent **800,2 octets par jour simulé**, donc **292 291 o/s = 2,34 Mbit/s** à la vitesse
maximale : exactement le chiffre mesuré le 2026-09-23. Conséquence à écrire parce qu'elle borne
l'utilité de la phase : **au-dessus de 2,36 Mbit/s (les 2,34 de demande plus le coût fixe des
marges) il n'y a AUCUN plafond à afficher**, et l'interface n'affiche alors rien. À 2 Mbit/s il
vaut 84,5 % de la course, à 120 ko/s 40 %.

**Mis à jour le 2026-10-04, et c'est un coût, pas une retouche** : les 23 cibles de missions et
leurs deux satellites portent le manifeste à 89 fichiers, donc **993 octets par jour simulé,
2,90 Mbit/s** à la vitesse maximale et 4 272 o/s de marges. Le seuil sans plafond passe à
**2,94 Mbit/s** ; à 2 Mbit/s le plafond vaut **67,8 %** du maximum, à 120 ko/s **31,9 %** (avec
les seules 23 cibles : 2,83 Mbit/s, 69,5 % et 32,7 %). Chaque corps dessiné fait venir ses
positions en lecture accélérée, ligne d'orbite ou non. Mesuré par les fonctions de
`core/playbackBudget.ts`, tenu par `playbackBudget.test.ts`.

**Mis à jour le 2026-10-05** : Patrocle passe du pas de 16 jours au pas de 4 jours de Menoetius,
pour que son ballant autour du barycentre se retire (§ « La position composée d'un satellite de
petit corps »). **1 002 octets par jour simulé, 2,93 Mbit/s** à la vitesse maximale, seuil sans
plafond **2,96 Mbit/s** ; à 2 Mbit/s le plafond vaut **67,1 %** du maximum, à 120 ko/s
**31,6 %**. Les éphémérides livrées passent de 51 193 104 à 51 853 824 octets.

**Mis à jour le 2026-10-05, encore** : Didymos et Dimorphos passent au pas d'un jour, pour que
Dimorphos composé tienne sous son diamètre (même §). **1 074 octets par jour simulé,
3,14 Mbit/s** à la vitesse maximale, seuil sans plafond **3,17 Mbit/s** ; à 2 Mbit/s le plafond
vaut **62,6 %** du maximum, à 120 ko/s **29,5 %**. Les éphémérides livrées passent de
51 853 824 à 54 904 128 octets (Didymos 880 992 → 3 523 920, Dimorphos 135 840 → 543 216).

**Le débit se mesure sur le TEMPS OCCUPÉ, pas par requête.** Six requêtes simultanées se partagent
la bande passante : `octets / durée` d'UNE requête sous-estime le lien d'un facteur proche du
nombre de requêtes en vol, et c'est la mesure qui a trompé le lot 15 (64 requêtes de 77 s chacune
pour 77 s de trafic au total). Le compteur additionne donc les périodes pendant lesquelles au
moins une requête était en vol, ignore les trous, et compte le temps d'une requête qui ÉCHOUE avec
ses zéro octet — l'oublier ferait passer le lien pour deux fois plus rapide. Il ne répond rien
avant 32 768 octets et 120 ms de temps occupé : plafonner sur du bruit serait pire que ne pas
plafonner.

**Et il OUBLIE.** Au-delà de 4 Mo, octets et temps occupé sont réduits dans la même proportion :
le débit mesuré ne bouge pas à cet instant, mais les mesures suivantes pèsent davantage. Sans
cela, un visiteur qui démarre sur la fibre puis passe sur un lien de train garderait le plafond de
la fibre et la date se remettrait à attendre en silence ; l'inverse est vrai aussi, un démarrage
lent brimerait la lecture pour le reste de la session. Quatre mégaoctets, parce que la fenêtre de
démarrage en pèse environ un : le démarrage n'est pas oublié aussitôt, et quelques mégaoctets de
navigation suffisent à ce qu'il ne décide plus.

**Le plafond ne descend jamais sous le temps réel 1:1**, où la demande est négligeable, et il
s'applique à la MAGNITUDE et non au signe : remonter le temps coûte exactement les mêmes octets
que le parcourir. La poignée REVIENT sur le plafond, sinon deux positions rendraient la même
vitesse et la fin de course ne voudrait plus rien dire.

**Une ATTENTE n'est pas une ABSENCE, et le bandeau ne dit pas la même chose.** Le bandeau du lot 15
est étendu, pas doublé (décision D4) : il gagne un état `waiting`, avec son propre titre, sans
bouton de reprise, et **une absence de fichier PRIME sur une attente** (elle est plus grave et
porte la seule action qui répare). Écrire « précision réduite » pendant une attente serait FAUX :
aucune position n'y est remplacée par une autre, la date est seulement plus lente que demandé. La
décision est prise par une fonction pure, `ui/ephemerisNotice.noticeState`.

**Et on se tait sous 1,5 s.** Mesuré au 2026-09-23 : la fenêtre de démarrage arrive en 0,89 s à
10 Mbit/s et un saut de date coûte 3,2 s. Une attente d'une seconde est donc le prix NORMAL d'un
saut, et l'annoncer ferait clignoter un bandeau à chaque clic dans le panneau de dates.

| Garde | Ce qu'elle tient |
| --- | --- |
| `core/playbackBudget.test.ts` | la demande reproduit les 2,34 Mbit/s mesurés du plan depuis le manifeste LIVRÉ, le coût fixe des marges est compté, aucun plafond au-dessus de la demande maximale, jamais sous le temps réel, et un pas deux fois plus fin coûte deux fois plus |
| `core/transferRate.test.ts` | le débit mesure LE LIEN et non la requête, additionne les périodes occupées sans les trous, compte le temps d'un échec, se tait sous ses deux seuils, et OUBLIE le lien du départ sans déformer le débit à l'instant où il oublie |
| `core/playbackCeiling.test.ts` | chemin de production, contre les binaires livrés : les octets comptés sont ceux que l'hôte a SERVIS, un corps hors couverture n'entre ni dans la mesure ni dans le budget (62 sur 64 au 2026-09-23, Cassini et Rosetta étant des missions closes), et un lien à 2 Mbit/s plafonne là où un lien rapide ne plafonne rien |
| `ui/speedSlider.test.ts` | l'inverse du curseur est exact sur toute la demi-course, la poignée revient sur le plafond, le plafond porte sur la magnitude et garde le sens du temps, et un plafond absurde ne fige pas la scène |
| `ui/ephemerisNotice.test.ts` | un fichier manquant PRIME sur une attente, le seuil de 1,5 s se tait juste en dessous, et une reprise réussie garde sa ligne |
| `core/ephemerisClockGate.test.ts` | l'attente se compte en temps RÉEL, se remet à zéro dès que la date repart, et cesse d'être une attente quand on renonce à attendre |
| `e2e/playbackCeiling.spec.ts` | dans un vrai navigateur : sur un lien lent le curseur affiche la vitesse soutenable et sa raison, la poignée y revient, la fiche dit toujours « JPL Horizons » ; quand les octets ne viennent pas le bandeau dit que la date attend, sans le mot « precision » et sans reprise ; et à 390 px il ne couvre aucun dock, passe axe et ne déborde pas |

### Ce que l'appareil tient, et qui ne se redemande pas (lot 17, phase 17E)

La phase 17C a rendu le démarrage 38,5 fois plus léger en lisant des PLAGES. Une réponse `206`
n'est mise en cache ni par le navigateur ni par le service worker, et cela a deux conséquences
qu'il a fallu MESURER pour les voir, le 2026-09-24, sur le build livré de 17D, octets comptés
côté SERVEUR (le trafic du service worker n'apparaît pas dans le CDP de la page), service worker
actif, trois chargements successifs dans le même navigateur :

| | visite 1, à froid | visite 2 | visite 3 |
| --- | --- | --- | --- |
| total servi | 11 310 743 o, 173 requêtes | **987 168 o, 62 requêtes** | 991 799 o, 63 requêtes |
| dont éphémérides | 987 168 o (62 plages) | 987 168 o | 987 168 o |
| part des éphémérides | 8,7 % | **100 %** | 99,5 % |
| entrées `.bin` en cache | 0 | 0 | 0 |

**La visite de retour était donc de l'éphéméride et RIEN d'autre** : textures, modèles,
JavaScript et page venaient tous du service worker, et seuls les 987 168 octets de fenêtres se
repayaient. Et le cache `ssv-assets` ne contenait **aucun `.bin`** (il n'était même pas créé)
là où il en tenait 64 avant 17C, d'où la perte du hors-ligne.

**Un seul mécanisme traite les deux : un magasin que l'application tient elle-même**
(`core/ephemerisStore.ts`), un `Cache` nommé `ssv-ephemerides-v1` où chaque fichier a UNE entrée,
la tranche d'échantillons contiguë qu'on en tient. La question posée au magasin avant toute
requête est celle que 17A avait déjà écrite et testée, `windowContains` : « ce que je tiens
contient-il ce que je veux ? ». Elle répond aussi bien à une fenêtre qu'à un fichier entier, donc
au retour comme au hors-ligne.

**L'option (a3) du plan, une règle de service worker rangeant les fenêtres sous une clé
synthétique, est écartée par ce qu'elle ne sait pas faire**, et pas seulement pour son coût en
code : une clé par plage ne répond que si la plage demandée est EXACTEMENT celle d'avant, et elle
ignore le cas du bouton « préparer le hors-ligne », qui range des fichiers entiers dont toute
fenêtre est ensuite un sous-ensemble.

**La clé n'est PAS l'adresse du binaire**, elle vit sous un chemin qui n'a jamais existé sur le
serveur (`/__ephemeris-store/<fichier>?samples=<premier>-<dernier>`). Une clé ressemblant à
`/assets/ephemerides/…` pourrait être servie par la règle `CacheFirst` du service worker à une
requête réelle, avec des octets partiels présentés comme le fichier entier.

**UNE entrée par fichier, et la règle est celle de l'inclusion.** Une tranche déjà contenue dans
ce qu'on tient ne s'écrit pas : sans quoi la première fenêtre de 96 octets venue remplacerait le
fichier entier qu'une préparation hors ligne vient de ranger ; une tranche plus large ou disjointe
remplace l'ancienne. Deux tranches disjointes ne se fusionnent JAMAIS : les octets du trou n'ont
jamais été téléchargés, et inventer une tranche qu'on ne tient pas ferait lire n'importe quoi.
Sans cette borne, un lecteur qui se promène dans le temps accumulerait une entrée par date
visitée, jusqu'au quota du navigateur.

**Et un doublon se guérit tout seul.** L'écriture range la nouvelle tranche PUIS retire
l'ancienne, et cet ordre est le bon : l'inverse perdrait des octets déjà payés si le navigateur
s'arrêtait entre les deux. Un arrêt entre les deux laisse donc deux entrées pour un fichier ;
l'inventaire choisit alors la plus large, qui répond à tout ce que l'autre répondait, et la purge
du démarrage suivant retire la perdante au lieu de la laisser occuper la place jusqu'au quota.

**RANGER N'EST PAS CHARGER : aucune écriture du magasin ne se trouve dans le chemin de
chargement.** Les écritures partent en tâche de fond, enchaînées une à la fois, et le rangement
de la copie du manifeste comme la purge des orphelins avec elles. La raison est mesurée et elle
a coûté deux passages de CI : `OrbitalMechanics._requestWindows` ne garde QU'UNE demande de
fenêtre en vol, donc une écriture attendue entre deux téléchargements retarde la demande
suivante, et pendant une lecture accélérée l'horloge cale à chaque pas. Rien ne dépend de la fin
d'une écriture, les octets étant déjà en mémoire.

**Ce que cela implique, et qui doit être dit** : le magasin finit de se remplir PEU APRÈS que la
page soit utilisable. Un visiteur qui ferme l'onglet une seconde après le chargement peut n'avoir
rangé qu'une partie de ses fenêtres ; la visite suivante redemande simplement ce qui manque.
Mesuré : avec huit secondes de présence, les visites de retour ne demandent plus AUCUN binaire ;
avec six, un dernier fichier n'était pas encore rangé.

**Toute lecture est CONFRONTÉE à la tranche que sa clé annonce**, comme le chemin HTTP confronte
son `Content-Range` : une entrée tronquée (quota atteint pendant l'écriture) serait sinon lue
comme si elle commençait au bon échantillon, et placerait le corps à une autre date sans que rien
ne le dise. Une entrée fausse est SUPPRIMÉE, pas seulement ignorée.

**Le manifeste a sa copie, et sans elle le hors-ligne ne tiendrait pas une heure.** Il est servi
en `NetworkFirst` avec une péremption d'une heure (`ssv-ephemeris-manifest`), donc un appareil
préparé le matin afficherait l'après-midi « aucune éphéméride précise » alors que tous ses fichiers
sont là. L'ordre reste le réseau d'abord : le manifeste est le seul fichier MUTABLE de cette
famille et il pointe des binaires nommés par le hachage de leur contenu. Quand il arrive, il
purge du magasin ce qu'il ne nomme plus, et c'est la cohérence que ce magasin doit tenir lui-même,
le coût annoncé au § 9a du plan.

**Le bouton « préparer le hors-ligne » (option (a2), tranchée par l'utilisateur le 2026-09-23)**
vit dans une sixième section de la surface de réglages, `#settings-section-offline`. Il télécharge
les fichiers ENTIERS que l'appareil n'a pas, six à la fois, annulable. Ce n'est pas un pis-aller :
une école à connexion pauvre est la cible du projet, et « je prépare chez moi, j'enseigne sans
réseau » est une fonctionnalité. Rien n'est téléchargé sans demande : 38 Mo pris d'office sur le
forfait de quelqu'un seraient une décision prise à sa place.

**Ce que la section affiche est LU, jamais mémorisé.** `offlineState()` recompte les entrées
réellement présentes à chaque lecture. Un « c'est prêt » enregistré après un téléchargement
survivrait à une purge de quota, et l'appareil partirait en classe en ayant oublié ses fichiers.
C'est la règle que le projet applique à la disponibilité des sondes depuis le lot 7e.

**Une lecture du magasin ne mesure RIEN du lien, et c'est un défaut vu en écrivant la phase.**
Des octets relus localement, passés au compteur de débit de 17D, donneraient un débit de plusieurs
gigabits, donc aucun plafond de vitesse, puis la date se remettrait à attendre EN SILENCE à la
première fenêtre réellement manquante, ce que 17D existe pour supprimer. La lecture du magasin se
fait donc AVANT `TransferRateMeter.begin`, et `fetchBody` ne connaît plus que le réseau.

**Et la conséquence vraie de la préparation est écrite, elle aussi** : un corps dont l'appareil
tient le fichier entier sort du budget de `budgetGrids`. Il ne demandera plus un octet à aucune
date, donc le compter plafonnerait la lecture au nom d'un trafic qui n'aura pas lieu. Une fois
tous les fichiers préparés, le curseur de vitesse n'a plus de plafond du tout.

**Ce que la phase ne fait pas, et le dit.** Elle ne remet pas les éphémérides dans le précache du
service worker : `sw.js` continue de ne garder que l'app shell, et les 38 Mo restent une décision
de l'utilisateur. Un navigateur sans `Cache` (navigation privée stricte) n'a pas de magasin du
tout : la section le DIT, et l'application redemande ses fenêtres comme avant cette phase.

| Garde | Ce qu'elle tient |
| --- | --- |
| `core/ephemerisStore.test.ts` | l'aller-retour d'une clé, le refus d'une clé étrangère ou d'une tranche inversée, l'inclusion exigée à un échantillon près, « fichier entier » qui n'accepte que le fichier entier, une tranche contenue qui n'écrase jamais la plus large, UNE entrée par fichier, un doublon laissé par un arrêt en cours d'écriture qui se résout sans hésiter puis se purge, une entrée tronquée SUPPRIMÉE au lieu d'être lue, la purge qui épargne le manifeste, et l'absence de magasin qui ne lève pas |
| `core/ephemerisOffline.test.ts` | chemin de production contre les binaires livrés : une visite de retour ne fait AUCUNE requête et place les corps au bit près, une date éloignée redemande ce qui manque et lui seul, une lecture du magasin n'entre pas dans le débit observé, la préparation rend un état LU, une visite entière sans le moindre octet à n'importe quelle date, des octets tronqués qui ne sont pas rangés, et un manifeste injoignable qui reste un échec quand le magasin est vide |
| `e2e/ephemerisOffline.spec.ts` | dans un vrai navigateur, avec le vrai `Cache` : la visite de retour ne demande plus un seul octet d'éphéméride, la section dit ce que l'appareil tient et rend la place, et une fois préparé l'appareil place les corps à une date jamais visitée avec TOUT `/assets/ephemerides/**` coupé |

### Le budget du démarrage, famille par famille (lot 17, phase 17F)

Le lot 17 a fait fondre le démarrage. Restait à empêcher qu'il regrossisse sans que personne le
voie, et la façon de le faire n'est pas neutre : **il n'y a PAS de budget global.** Un seuil unique
« le démarrage doit tenir sous N octets » créerait une pression permanente à dégrader les textures
pour financer autre chose, puisqu'elles sont la plus grosse famille du démarrage. Ce serait la
contradiction frontale de la règle de parité du lot 16, qui vient de poser que chaque corps livre
l'échelle complète de ce que sa source contient. Chaque famille est donc jugée sur SON plafond, et
aucune somme ne circule entre elles : améliorer une texture ne peut pas échouer à cause d'une
régression d'éphéméride, ni l'inverse.

La règle et les plafonds vivent dans `src/core/startupBudget.ts`, module pur.

**Ce que le démarrage coûte, MESURÉ.** Production (`galaxy.adrianguichard.dev`, build de 17E), le
2026-09-26, service worker bloqué, contexte neuf, fenêtre 1280 x 800, octets du FIL relevés par le
CDP (`encodedDataLength`, en-têtes comprises), observation arrêtée quand `#loader` est masqué après
avoir été attendu VISIBLE. Neuf visites ; les six dernières tiennent dans 0,01 % l'une de l'autre.
La méthode est un script, pas un paragraphe : `node scripts/measure-startup-bytes.mjs`.

| famille | octets servis | requêtes | part |
| --- | --- | --- | --- |
| textures | 6 866 520 | 62 | **59,6 %** |
| éphémérides | 1 048 819 | 63 | 9,1 % |
| modèles de forme | 828 987 | 15 | 7,2 % |
| JavaScript | 309 678 | 12 | 2,7 % |
| instantané des petits corps | 177 624 | 1 | 1,5 % |
| CSS | 9 125 | 1 | 0,1 % |
| HTML | 7 667 | 1 | 0,1 % |
| divers (balise Cloudflare) | 179 | 2 | 0,0 % |
| **total** | **11 511 538** | **157** | chargeur masqué à 10,0 s |

Le renversement du lot 17 est là, en une ligne : les éphémérides pesaient **77,5 %** du démarrage
au § 2 du plan, elles en pèsent **9,1 %**, et ce sont les textures qui dominent désormais.

**Les plafonds sont en octets BRUTS**, ceux des fichiers livrés, parce que c'est la seule grandeur
que le dépôt contrôle et qu'une machine sans réseau peut recompter. Le rapport au fil est MESURÉ à
côté : textures 0,984 (Firebase comprime certains JPEG à faible entropie : la surface 1k d'Uranus
tombe de 11 230 à 3 658 octets), maillages 0,768, JavaScript 0,254, et les plages d'éphémérides
légèrement au-DESSUS de 1, leurs en-têtes pesant plus que ce qu'un `206` économise.

**Deux origines de plafond, et la différence est le cœur de la phase.**

| famille | plafond | origine |
| --- | --- | --- |
| textures | 6 979 356 o | **dérivé** : la somme du palier PLANCHER (`core/textureLadder.TIERS[0]`, soit 1k) des 60 couches que le démarrage touche, plus deux raffinements de première vue nommés |
| modèles | 1 079 152 o | **dérivé** : le niveau le plus léger (`core/modelLod`) des 15 corps modélisés |
| éphémérides | 1 800 000 o | **posé** : le pire cas mesuré sur toute la couverture, plus 5,3 % |
| JavaScript | 1 300 000 o | **posé** : la mesure, plus environ huit lots de croissance ordinaire |

Un plafond **dérivé** ne se choisit pas, il se recalcule, et c'est ce qui rend ces deux familles
insensibles à la pression : ajouter un palier 2k, 4k ou 8k ne coûte RIEN au démarrage, qui ne
demande que le plancher ; et rétrécir une texture ferait baisser le coût ET le plafond du même
nombre d'octets, donc n'achèterait rien pour une autre famille. La qualité reste arbitrée par
`src/config/textureLadder.test.ts`, son seul propriétaire. Ce qui fait rougir ces familles est
précis : un démarrage qui se met à demander plus gros que le plancher.

**Les deux raffinements de première vue sont nommés, pas noyés dans une somme** : le ciel en 8k
(979 007 o), parce qu'il entoure la caméra et que sa distance normalisée est nulle, donc le LOD
résout `ultra` ; et le Soleil en 2k (398 892 o), parce que la première vue est centrée sur lui, à
moins de 40 rayons. Ce sont les deux SEULS paliers fins que le démarrage demande, mesuré. Une
troisième entrée fait rougir la garde : soit la première vue s'est mise à charger un palier fin,
soit c'est légitime et il faut l'écrire avec sa raison.

**Le plafond des éphémérides a corrigé un chiffre que cette série citait depuis 17C.** La fenêtre
de démarrage a été balayée sur toute la couverture livrée, en faisant tourner le VRAI service
contre les VRAIS binaires du dépôt. Elle varie d'un facteur 80 :

| date de scène | octets de la fenêtre de démarrage |
| --- | --- |
| 1900-06-15 | 21 216 (presque tout hors couverture) |
| 1969-07-20 | 984 624 |
| **2015-06-15** | **1 709 040**, pire cas : la ligne de Neptune tient dans la couverture, 722 544 o à elle seule |
| 2026-09-23 | 987 264 (17C en mesurait 987 168 dans un navigateur : un échantillon d'écart) |
| 2099-12-01 | 57 888 |

Les 987 168 octets de 17C sont donc un cas MOYEN, ni le pire ni un majorant : une adresse datée de
l'an 2000 fait payer 1,71 Mo au démarrage, la demi-période de Neptune ne tenant dans la couverture
qu'entre 1982 et 2018 environ. C'est le piège 8 du plan, confirmé dans le sens qui coûte. Le budget
est donc posé sur le PIRE cas : sur la date du jour, il rougirait pour un simple lien daté.

**La famille JavaScript ne se compte pas comme « tout `dist/assets/*.js` »**, ce qui serait faux
dans les deux sens. Elle est la clôture des imports STATIQUES depuis l'entrée déclarée par
`dist/index.html`, plus les morceaux que le démarrage importe DYNAMIQUEMENT, déclarés un par un
avec leur raison. La partition est EXHAUSTIVE : tout morceau est dans la clôture, déclaré
dynamique au démarrage, ou déclaré hors démarrage (le résumé de validation Horizons, le moteur de
surfaces, le noyau SPK, deux façades de fiches). Sans cette exhaustivité, retirer une déclaration
ferait baisser le coût mesuré de 61 703 octets sans qu'aucune garde ne rougisse, et un budget qui
compte moins que la réalité est pire qu'aucun budget. La clôture calculée est en outre CONFRONTÉE
aux `modulepreload` que Vite écrit dans le document : si l'analyse dérive, le script échoue en le
disant au lieu de rendre un nombre plausible.

| Garde | Ce qu'elle tient | Où |
| --- | --- | --- |
| `core/startupBudget.test.ts` | la règle : le classement par famille, l'indépendance des verdicts, le palier du démarrage, et qu'une texture dégradée n'achète rien | `pnpm verify` |
| `config/startupBudget.test.ts` | les trois familles qui se comptent sur les artefacts COMMITTÉS : la fenêtre d'éphémérides à quatre dates fixes dont le pire cas, les 60 couches de texture au plancher, les 15 maillages au plus léger | `pnpm verify` |
| `scripts/check-startup-budget.mjs` | la famille JavaScript, la seule qui exige un build : clôture, partition exhaustive, témoin des `modulepreload` | étape bloquante de `ci.yml`, après `pnpm build` |
| `e2e/startupBudget.spec.ts` | dans un vrai navigateur : aucun palier au-dessus du plancher sauf les raffinements déclarés, chacun d'eux réellement demandé, les maillages au plus léger, et la fenêtre sous son plafond | `pnpm test:e2e` |

**Ce que la phase ne budgète pas, et l'écrit.** L'instantané des petits corps (177 624 o), la CSS,
le HTML et la balise d'audience ne portent pas de plafond : ils ne croissent pas par décision de
chargement, et un plafond de plus serait un contrôle que personne ne lirait. Ils restent NOMMÉS
dans le relevé, parce qu'une famille « divers » qui grossit sans nom est exactement la façon dont
un budget se contourne sans mentir. La ligne « autres, 2 228 918 o, 4,9 % » du § 2 du plan n'a
jamais été ouverte, et cette phase a mesuré une fois, au même endroit, **2 263 107 octets de trois
images WMS de NASA GIBS** (1,5 % d'écart, mêmes couches) : très probablement les mêmes octets, mais
ce n'est pas affirmé, la mesure du plan n'ayant pas été refaite. Le classement porte donc désormais
une famille `external-imagery`, pour que ces octets aient un nom la prochaine fois. **Et ce qui
n'est pas expliqué est écrit tel quel** : ces trois requêtes ne sont réapparues dans AUCUNE des huit
visites suivantes, même avec vingt secondes d'observation après le chargeur. Une visite sur neuf,
pour un comportement identique ; le déclencheur n'est pas identifié.

### La profondeur du temps : un écart par millénaire, et ce qu'il a fallu pour l'obtenir (lot 39)

L'horloge accepte n'importe quelle date, mais les fenêtres de validation s'arrêtaient à
1600-2400 : au-delà, la fiche disait « écart à JPL Horizons non mesuré à cette date ». Honnête,
et muet. Le relevé porte désormais **un millénaire par ligne, de l'an 1 à l'an 9999**, pour les
dix corps dont la référence existe si loin. **Aucune ligne d'interface n'a été écrite** : la
fiche nommait déjà la fenêtre à côté du chiffre.

**Ce que l'API sert, mesuré et non supposé.** Le centre d'une planète vient d'une théorie de
satellites bornée, donc Horizons le refuse avant 1600 (Saturne 1749, Neptune et Pluton 1800).
Le **barycentre** du système, lui, vient de DE441 et va du 9999-MAR-21 av. J.-C. (calendrier julien ; « 15 mars », écrit ici au lot 39, n'avait jamais été mesuré, corrigé le 2026-10-02) au
9999-DEC-30. Mercure, Vénus, la Terre et la Lune sont dans DE441 même : leur cible profonde
EST le corps. D'où une substitution, déclarée par corps dans `scripts/validation-targets.json`
et jamais devinée par le script. Un corps sans déclaration n'a pas de profondeur : les petits
corps sont refusés avant le 1599-12-10 (intégration), Io avant 1600, Charon avant 1800.

**Le témoin, et ce qu'il a trouvé.** Une courbe d'écart aux époques profondes est crédible quoi
qu'elle vaille. Le script mesure donc, là où Horizons sert le corps ET son barycentre
(1801-2199), **la même source contre les deux, aux mêmes dates** : la plus grande différence de
leurs écarts est le PLANCHER de la substitution. Ce plancher n'est pas la distance géométrique
corps ↔ barycentre, et les confondre était l'erreur.

Les deux chiffres coïncident pour Mars, Jupiter, Saturne et Pluton. **Pour Uranus et Neptune,
non** : le plancher du chemin réel vaut respectivement 8 915 km et 2 271 km, contre 43 km et
74 km de distance géométrique. **Horizons n'est pas cohérent avec lui-même sur ces deux corps**
— le barycentre qu'il sert comme cible et celui qu'implique l'éphéméride du corps ne sont pas le
même point, et leur écart s'annule autour du survol unique de Voyager 2 qui a caractérisé chaque
système. Sans le témoin, le plancher d'Uranus aurait été annoncé à 43 km. La table complète, à
jour, est celle que publie `/methodology` § « La profondeur du temps », dérivée du bloc `deep`
de `src/config/horizons-validation-summary.json` ; elle n'est pas recopiée ici.

**La règle de publication** : une ligne n'est publiée que si son plancher reste sous un centième
de l'écart mesuré, bien en deçà de la résolution des deux chiffres significatifs qu'affiche la
fiche. Cinq millénaires d'Uranus sont retenus par là, avec leur raison, et restent VISIBLES sur
`/methodology`. Le rayon du corps ne décide de rien — il l'a fait une demi-heure, et refusait les
millénaires de Pluton (barycentre à 1,8 rayon) alors que leur écart se compte en milliards de km.

**Ce que la mesure a dit au lot 39**, et qui ne se devinait pas : sur le millénaire 1000-2000,
Galaxy place Jupiter à 59 440 km en moyenne de là où JPL le place, soit **moins d'un rayon de
Jupiter** ; la Lune est à 50 km de sa position relative à la Terre, et la Terre à 6 900 km. Le
repli képlérien de Pluton, lui, est à 36 millions de km dès 2000-3000 : le chiffre dit de ne pas
s'y fier, ce qu'aucune étiquette ne disait. Ces valeurs vivent dans le résumé et sur
`/methodology` ; celles-ci datent du lot et n'y sont rappelées que pour l'ordre de grandeur.

**Un TROU se dit.** `positionProduct` prenait l'ENVELOPPE [min, max] des fenêtres mesurées d'un
corps. Tant qu'elles étaient emboîtées, l'enveloppe suffisait ; un pavage par millénaires peut
avoir un trou (une ligne retenue), et l'enveloppe le déclarait mesuré — la fiche aurait dit
« reconstruit » sans pouvoir citer le moindre écart. Elle retient maintenant **la fenêtre qui
contient la date**, et rien d'autre.

**Deux bornes ferment la fenêtre, et aucune n'est un choix** : l'API Horizons s'arrête à ±9999
(mesuré ; le noyau DE441 va plus loin, l'API non), et un `<input type="date">` ne sait pas écrire
une année négative — l'application ne pouvait donc pas AFFICHER une date avant l'an 1, même si son
horloge y allait (SUPERSEDED le 2026-10-02 : avant le 15 octobre 1582, la barre de temps affiche un
groupe julien, voir le paragraphe « L'interface » ci-dessous). Au passage, un défaut que la profondeur a rendu ordinaire : le champ écrivait
`500-05-14` pour l'an 500, que le navigateur refuse, et il se vidait sans un mot
(`src/ui/dateField.ts`).

**Avant l'an 1 (ligne 22.10, front des années avant J.-C., pas 1, 2026-10-02).** Les tranches
remontent désormais jusqu'en **9998 av. J.-C.** (année astronomique -9997). L'API répond au jour
julien NÉGATIF et refuse avant ce qu'elle annonce elle-même, « prior to B.C. 9999-MAR-21 » : pour
tous les corps et les deux centres, et dans le calendrier JULIEN qu'Horizons emploie avant 1582.
Le « 15 mars » écrit plus haut au lot 39 n'avait jamais été mesuré ; il est corrigé. Cent lignes
nouvelles, toutes profondes, et les lignes déjà publiées sont inchangées.

**Le témoin ΔT.** Chaque écart compare deux positions à un même Temps universel, que chaque côté
convertit avec son propre ΔT : Horizons le sien (il le publie, quantité 30 de ses tables
d'observation, « TDB-UT »), l'application celui de `core/timeScale.ts`. Avant l'époque des
observations, aucun des deux n'est une mesure. Le script mesure leur désaccord au milieu de chaque
tranche et le publie (`deep.deltaT` du résumé, tableau de `/methodology`) : il entre dans l'écart
sans être une erreur de position. Pour le futur, les deux figent ΔT à sa valeur actuelle, donc
leur accord ne dit rien de la rotation réelle de la Terre, et la page le dit.

**Quatre défauts des années négatives, trouvés avant de livrer** : le script coupait
« -001000-01-01 » en « -001000-01 » (`slice(0, 10)`) ; `/methodology` lisait l'année « -001 »
(`slice(0, 4)`) ; la page ET la garde du pavage triaient des dates comme des chaînes, où
« -001000 » passe avant « -009997 » ; et la fiche comparait l'an 1 à 1901, `Date.UTC` plaçant les
années 0 à 99 en 1900-1999. La fiche écrit une tranche avant l'ère en années av. J.-C. (« 1001
av. J.-C. »), jamais « -1000 », parce que le permalien sait déjà ouvrir une telle date.

**L'interface (pas 2, 2026-10-02) : le calendrier julien avant 1582.** Un champ de date de
navigateur est grégorien : il ne sait écrire ni une année négative, ni le 29 février 1500, que le
julien a et que le grégorien n'a pas, et il se viderait sans un mot. Avant le 15 octobre 1582, la
barre de temps le REMPLACE donc par un groupe jour, mois, année et ère, étiqueté « calendrier
julien » : c'est le calendrier des historiens, et celui dans lequel Horizons imprime ses dates.
Après, le champ de date habituel revient, avec son sélecteur natif. La conversion vit dans
`core/calendar.ts`, pure, testée contre des dates qu'HORIZONS a imprimées (B.C. 0587-Jul-30,
le 4 et le 15 octobre 1582, le 29 février 1500, l'an 1 av. J.-C. bissextile), et non contre
elle-même. **Le permalien ne change pas** : il reste une date ISO dans le grégorien prolongé, le
format machine de JavaScript, si bien qu'aucun lien publié ne casse ; c'est l'AFFICHAGE qui est
julien. Conséquence visible et voulue : le lien `-000584-05-28` s'affiche « 3 juin 585 av. J.-C. »,
la date julienne du même jour.

Gardes : `src/core/calendar.test.ts` (les témoins d'Horizons, l'aller-retour sur toute la plage
de l'horloge, les dates qui n'existent pas en julien) ; `e2e/temporal.spec.ts` (le groupe affiche
la date julienne d'Horizons, une saisie déplace la scène, le 29 février 1500 tient, le champ
habituel revient le 15 octobre 1582) ; `e2e/a11y-audit.spec.ts` (le groupe à 390 px dans les quatre
langues, à un jour de DEUX chiffres et une année de QUATRE : à un jour d'un seul chiffre, la garde
du texte rogné ne pouvait pas voir le champ trop étroit, et sa falsification restait verte).

**Quand l'écart dépasse le diamètre (2026-10-03) : « dessiné hors de sa place réelle ».** La
fiche affichait l'écart juste, sans dire ce qu'il implique : 1 413 000 km pour la Terre vers
9998 av. J.-C., c'est 111 fois son diamètre. Au-delà d'UN diamètre, la sphère dessinée et la vraie
ne se recouvrent plus du tout, et la fiche l'écrit en une seconde phrase du même bloc (« Soit 5,7
fois son diamètre : à cette date, le corps est dessiné hors de sa place réelle. »). Le critère est
celui du diamètre parce qu'il a ce sens physique exact ; le rayon le déclencherait quand les deux
sphères se recouvrent encore. Le calcul est `diametersOff` de `core/positionProvenance.ts`, sur le
rayon que le script de validation écrit dans LA MÊME ligne du résumé que l'écart, jamais recopié.
**Ce n'est pas qu'une affaire de temps profond**, et c'est voulu : mesuré sur le résumé du
2026-10-02, 289 fenêtres dépassent le rayon, dont, AUJOURD'HUI, les satellites interpolés depuis
leur binaire Horizons (Amalthée et Styx à 6 et 8 diamètres). La fiche le dit à toute date.

Gardes : `src/ui/bodyInfo.test.ts` (la phrase juste au-dessus d'un diamètre, son absence juste
en dessous et sans rayon publié, et le cas réel de la Terre) ; `src/config/positionOffset.test.ts`
(chaque ligne mesurée d'un corps du catalogue porte un rayon, ÉGAL à celui de la fiche : les
deux falsifications, rayon absent et rayon décalé d'un kilomètre, sont rouges ; seuls les objets
d'instrument en sont dépourvus, et leur fiche n'a pas de bloc position) ; `e2e/temporal.spec.ts`
(Jupiter en 585 av. J.-C. à 5,7 diamètres, et le contre-témoin, la Terre en 2026 à 0,4 diamètre,
dont la phrase reste masquée alors que le bloc est visible : rouge avec un seuil à 0,1).

Gardes : `src/config/deepTimeWindows.test.ts` (les corps mesurés sont ceux qui se déclarent, la
cible interrogée est la cible déclarée, la règle du centième rejouée sur la donnée livrée, le
pavage sans trou de l'an 1 à l'an 9999), `src/core/positionProvenance.test.ts` (le trou est
extrapolé, pas reconstruit), `src/ui/dateField.test.ts` et `e2e/temporal.spec.ts` (un visiteur
parti à l'an 1000 LIT un chiffre, et la barre de temps garde sa date à l'an 500).

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
d'atterrissage, une vignette de partage, une fiche de faits sourcés. Une sonde n'avait rien de tout
cela (**SUPERSEDED pour la page et la vignette le 2026-10-03** : les sondes ont gagné depuis des
faits de lancement sourcés et ce que l'archive du PDS déclare qu'elles embarquent, et elles ont
désormais leur page, par un générateur À PART, sans entrer dans ce catalogue ; cf. § « Pages
d'atterrissage par corps et vignettes de partage », paragraphe « Les objets d'instrument »), et l'invariant Explo lui interdit même une taille apparente plancher. L'y faire entrer
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

### Quels corps peuvent porter un jeu de tuiles, et lequel ne le peut pas (lot 27)

Une tuile est une CALOTTE SPHÉRIQUE attachée comme enfant du `_meshGroup` du corps, dont elle
hérite le pôle IAU et la phase de rotation. La conséquence est une contrainte, et elle s'est
présentée dès le deuxième groupe de corps : **un corps rendu à partir d'un MODÈLE DE FORME publié
ne peut pas recevoir de tuiles sphériques**, puisque l'imagerie se poserait à côté de sa
géométrie réelle. NASA Trek publie pourtant un portail pour Vesta, et sa mosaïque HAMO/LAMO est
la plus fine de son groupe : elle est ÉCARTÉE pour cette seule raison, pas par manque de source.

Le critère est donc lisible sans juger à l'œil : un corps qui livre un fichier dans
`public/assets/models/` est hors du périmètre du streaming d'imagerie tant que le moteur pose des
calottes. Drapper une mosaïque sur un maillage irrégulier est un autre travail, avec sa propre
paramétrisation UV, et ce n'est pas ce que `components/surface/` fait aujourd'hui.

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

## L'orientation en longitude d'une texture (2026-10-04)

**Le contrat.** Toute carte livrée a la longitude 0 au CENTRE et l'Est vers la droite : c'est ce
que supposent le drapé d'un modèle (`core/modelUv.ts`, u = 0,5 + atan2(−z, x) / 2π) et la sphère
(`SphereGeometry` met u = 0,5 sur +X), et c'est le cadrage des tuiles Trek, déclarées de −180 à
+180. Une source centrée sur 180° se ROULE d'une demi-largeur à l'import :
`centerLongitude: 180` dans l'entrée de `scripts/import-textures.mjs`, valeur lue dans l'étiquette
de la source et jamais devinée.

**Ce qui l'a imposé.** L'import gardait le cadrage de la source. Sept corps ont donc été livrés
tournés d'un demi-tour : Bennu (étiquette ISIS `CenterLongitude = 180.0`, pic de recalage sur le
modèle à 179°), Cérès, Pluton (son cœur du côté de Charon), Europe, Ganymède, Callisto et Titan.
Chacun a au moins deux preuves indépendantes : l'étiquette, un repère du gazetteer de l'UAI, les
tuiles Trek (corrélation 0,90 à 0,95 après correction), ou le modèle drapé. Bennu a été réimporté
depuis sa source ; les six autres ont été roulés sur leurs paliers livrés (une passe JPEG de plus,
qualité 88, comme l'import), leurs sources pesant plusieurs Go.

**Trois pièges mesurés en route.** L'étiquette ne prédit pas seule : Rhéa est étiquetée
« centre 180 » à l'USGS et sa carte livrée est juste (corrélation 0,999 avec la mosaïque Cassini
du PDS), sa source ayant été recadrée ailleurs. Trek peut déclarer −180..180 et servir autre chose :
sa couche ISS de Titan met Menrva à +180°. Et une mosaïque de référence peut porter son propre
méridien origine : la carte NEAR de 2001 d'Éros est décalée d'environ 78° sur le gazetteer.
**Seule une mesure sur un repère nommé tranche.**

**La garde** est `src/config/textureOrientation.test.ts`, dans `pnpm verify` : des témoins
nommés (un repère nettement clair ou sombre contre le même parallèle à 180°, coordonnées lues au
gazetteer livré) et, pour les corps drapés où il est net, le recalage pente du modèle / variance
de la carte, dont le pic doit tomber à moins de 5° de 0 et sans miroir. Elle a été falsifiée sur
les cartes d'avant la correction : exactement les sept corps rougissent, les autres restent verts.
Les corps sans témoin assez contrasté (Encelade, Dioné, Téthys, Io, Triton, Charon, Déimos,
Mercure) ont été vérifiés le même jour contre une référence indépendante quand elle existait (tuiles
Trek, mosaïques Cassini du PDS), ou sur un repère à l'œil seulement (Io, Triton, Charon, Déimos).

### Les petits corps modélisés : une carte drapée seulement si les DEUX repères concordent (2026-10-04)

Quinze corps portaient un modèle de forme sans texture, peints à leur albédo. Draper une carte
suppose que la carte ET le modèle soient dans le même repère, et c'est la condition qui a trié :

| Corps | Carte | Carte contre l'UAI | Modèle contre l'UAI ou contre la carte | Décision |
|---|---|---|---|---|
| Éros | albédos NEAR MSI de Golish et al. (2023), 760/550/450 nm, composés en couleur | Psyche à sa longitude, Himeros à son antipode | 25 des 33 grands cratères nommés sont des creux du modèle à 0°, 17 au mieux autrement | **drapée** |
| Itokawa | photomosaïque AMICA de Stooke (PDS) | grille de la carte (0 aux bords) | recalage sur le modèle : pic à 1°, sans miroir | **drapée** |
| Ida | photomosaïque Galileo de Stooke et Nyrtsov (30 % imagé), projetée sur le modèle de Thomas | 92 % des noms sur des pixels imagés, Afon au méridien | modèle en longitudes Est (étiquette `243ida.lbl`), repère de Davies et al. 1996 ; recalage par l'ombrage : pic à 0°, sans miroir ni pôle retourné | **drapée** (2026-10-05) |
| Gaspra | photomosaïque Galileo de Stooke (35 % imagé), contrôle de position de Thomas | 91 % des noms sur des pixels imagés | modèle de Thomas laissé dans le repère de son pôle mesuré (il était tourné dans ses axes principaux, pôle déplacé de 11°) ; recalage par l'ombrage : pic à 0°, sans miroir ni pôle retourné | **drapée** (2026-10-05), **couleur moyenne mesurée** (ci-dessous) |
| Ryugu | carte d'albédo à 550 nm FABRIQUÉE depuis les cubes ONC recalés (aucune n'est publiée comme donnée) | plans de latitude et longitude de l'ONC : direction de visée résolue par image, résidu d'émission médian 9,4° (7,7 à 10,9), contre 17 à 18° décalée de 90° ou 180° ou en miroir | 6 des 7 cratères nommés sont des creux du modèle de Watanabe à 0°, 1 à 3 décalés, 2 en miroir | **drapée** (2026-10-05), **albédo seul, couleur moyenne** (ci-dessous) |
| Mathilde | photomosaïque NEAR de Stooke et Pfau (20 % imagé), grille sans étiquettes | 83 % des noms sur des pixels imagés | le recalage par l'ombrage ne s'y distingue pas du hasard (R² 0,30 à 0°, jusqu'à 0,42 ailleurs, autant qu'un couple de deux corps différents) | en attente : aucune mesure ne prouve le repère de la carte |

**Le recalage par l'ombrage (2026-10-05)**, parce que ni les cratères ni la pente n'ont tranché pour
ces trois corps. Le test des creux (le centre d'un cratère nommé plus bas que son pourtour) ne
discrimine pas sur une grille de 2° : Gaspra 13 cratères sur 26 à 0°, jusqu'à 20 ailleurs sans aucun pic, et le
témoin Déimos n'en a que deux de mesurables. La pente contre la variance de la carte, qui a recalé
Itokawa, change de vainqueur selon le seuil du masque. Dans une photomosaïque OMBRÉE, en revanche,
la luminosité d'une région vue sous un même Soleil suit l'orientation des facettes : on ajuste
luminosité ≈ a + b·n par moindres carrés (n normale du modèle, b direction du Soleil fois
l'albédo), et l'on compare le R² sur 720 repères candidats (décalage de longitude, miroir, pôle
retourné). Le niveau du hasard se mesure en posant la carte d'un corps sur le modèle d'un AUTRE :
0,41 à 0,47. Gaspra (0,53) et Ida (0,48) culminent exactement à l'identité, avec une pente
régulière (0,27 à 30°) ; un ombrage lambertien (max(0, n·s), Soleil cherché) rend la même
réponse. Les cartes aplanies (Itokawa, Éros, Vesta, Mimas, Phobos) n'ont pas d'ombrage, et la
mesure n'y dit rien (R² autour de 0,1 partout) : elle ne remplace pas les autres. Elle est tenue
sur les fichiers LIVRÉS par `src/config/textureOrientation.test.ts`, qui échantillonne l'intérieur
des triangles (un sommet par cellule ne suffit pas à un modèle décimé) ; falsifiée par une texture
roulée d'un demi-tour, une texture en miroir, et l'ancien Gaspra tourné dans ses axes principaux
(pic à 248°). Le test des creux qui tenait Ida en attente le 2026-10-04 (11 à 14 cratères sur 21 quelle que
soit l'orientation) était donc une mesure sans pouvoir de décision, pas un désaccord.

**La couleur de Gaspra, et pourquoi elle est MOYENNE (2026-10-05).** Le PDS sert, chez PSI, les
cubes couleur Galileo SSI de Domingue et al. (`galileo.ast-gaspra.color_geom_cubes`) : six
filtres de 404 à 986 nm, étalonnés en réflectance, recalés entre eux, avec les angles d'incidence,
d'émission et de phase calculés sur le modèle de Thomas. Ce ne sont **pas des cartes** : des images
de 150 × 150 pixels vues de la sonde, d'un seul côté, sans longitude ni latitude, et les noyaux de
pointage n'ont jamais été archivés. Poser une couleur VARIABLE sur le modèle demanderait de
reconstruire la géométrie de chaque prise de vue ; la couleur MOYENNE se mesure sans cela, et c'est
elle qui est livrée. `scripts/measure-mean-colour.mjs` la DÉRIVE des cubes (règles d'Éros : rapports
entre bandes gardés, lus comme du RVB linéaire, encodés en sRGB ; seule la chrominance est posée,
sur la luminance de la mosaïque). Trois séries sur six servent : A et F n'ont pas les trois bandes,
et **C est écartée parce que l'archive est fausse** : ses trois premières bandes sont décalées d'un
cran (son « violet » vaut le rouge des séries voisines à 1 % près, son « vert » leur violet), alors
que son étiquette annonce le même ordre. Le script écarte toute série à plus de 10 % de la médiane,
et le dit. Rapports au vert : 1,133 (671 nm) et 0,777 (404 nm), la pente rouge d'un type S.

**Ida reste sans couleur, et la raison est MESURÉE (2026-10-05).** Pour Ida, PSI ne sert pas de
cubes couleur, seulement les images étalonnées de Domingue (`galileo.ast-ida.ssi.cal-images`),
une par filtre, dont une seule série (E) porte rouge, vert et violet. Leur moyenne sur les pixels
éclairés est stable au seuil près (rouge/vert 1,118 à 1,122, violet/vert 0,758 à 0,762), mais la
méthode **échoue à son témoin** : appliquée aux images étalonnées de GASPRA, celles-là mêmes que
ses cubes recalent, elle ne rend pas ce que les cubes disent. Série B, rapports au vert :

| Filtre | Cube | Images étalonnées |
|---|---|---|
| violet 404 nm | 0,713 | 0,731 |
| rouge 671 nm | 1,158 | 1,513 |
| IR 756 nm | 1,320 | 1,507 |
| IR 889 nm | 0,996 | 1,393 |
| IR 968 nm | 0,903 | 1,518 |

Le cube montre le spectre d'un type S, qui monte jusqu'à 756 nm puis creuse la bande à 1 µm ; les
images étalonnées n'ont aucune bande (968 nm égal à 671 nm), et leurs niveaux absolus sont quatre
à cinq fois ceux du cube, alors que la documentation des cubes ne décrit qu'un recalage. Les
séries C, D et E donnent rouge/vert de 1,34 à 1,44 sur les images, contre 1,133 sur les cubes.
C'est donc l'étalonnage des images qui n'est pas fiable pour une COULEUR, et non celui des cubes :
la couleur de Gaspra tient, celle d'Ida ne se dérive pas de cette archive. Transposer à Ida les
facteurs mesurés sur Gaspra rendrait rouge/vert 0,86, un spectre bleu impossible pour un type S :
la correction n'est pas une constante de filtre. Les spectres NIMS d'Ida commencent à 0,7 µm et
n'ont ni vert ni violet. Ce qui rouvrirait la question : des cubes couleur d'Ida publiés, ou un
étalonnage des filtres SSI documenté pour 1993.

**La couleur VARIABLE de Gaspra n'est pas livrée, et la raison est MESURÉE (2026-10-05).** La
moyenne de #115 reste. La tentative a suivi le plan « pose, puis report, puis validation
croisée », sur des sondes hors dépôt ; ce qu'elle a établi vaut d'être gardé.

- **La pose de chaque série se retrouve** depuis les plans d'angles des cubes, par rendu du
  modèle de Thomas et ajustement, sans noyaux SPICE. Ces angles ont été calculés avec une caméra
  en perspective à ~71 km (la phase varie linéairement de 11° sur le corps, alors que Galileo
  était à plus de 1 600 km). Sur les plans à 350 px : recouvrement des silhouettes 0,997,
  émission 1,6 à 2,1°, incidence 1,6 à 1,9°, sur les six séries ; le modèle de Mathilde, témoin,
  plafonne à 0,86, 19° et 30°.
- **Trois défauts de l'archive, au-delà de la série C de #115.** Le fond des cubes couleur vaut
  0,0 et non −1 comme dans les fichiers de géométrie. Les bandes de chaque série restent décalées
  de 0,2 à 0,7 px les unes des autres, dans une direction propre à chaque série, alors que la
  documentation annonce un recalage. Et les images couleur sont décalées de leurs PROPRES plans
  d'angles : 1,5 à 2,0 px pour B à E, 6,5 px pour F, mesuré en maximisant l'accord entre la
  luminosité et l'ombrage de Lommel-Seeliger prédit par ces plans. Les rapports par série
  retrouvent la couleur moyenne de #115 (rouge/vert 1,124 à 1,127, violet/vert 0,769 à 0,777),
  série C comprise une fois ses bandes remises dans l'ordre.
- **Ce qui a décidé.** Après les trois corrections, B, C, D et E s'accordent par blocs de 20°
  (violet/vert : corrélation 0,65 à 0,98 ; rouge/vert : 0,32 à 0,65), et l'accord survit au
  retrait de ce qu'expliquent les angles (2 à 26 % de la variance). Mais ces quatre séries
  voient Gaspra du MÊME point, à 2° de rotation près : un défaut fixe dans l'image tomberait aux
  mêmes endroits. Seule F, 25 minutes plus tard et tournée d'environ 25°, peut trancher. Elle
  varie autant (écart-type 0,025 à 0,028 contre 0,019 à 0,040) et retrouve la même moyenne
  (0,758), mais **pas aux mêmes endroits** : corrélation −0,14 à +0,10 avec chacune des quatre,
  à toutes les échelles. Le motif commun est donc lié au point de vue, pas à la surface.

Ce qui rouvrirait la question : une seconde série couleur COMPLÈTE prise d'un autre point de
vue (A n'a pas de vert, F pas de rouge), ou des noyaux de pointage qui permettraient de recaler
les images brutes sans passer par les plans de l'archive.

**La carte de Ryugu est FABRIQUÉE, et elle est livrée (2026-10-05).** Aucune carte d'albédo de
Ryugu n'est publiée comme donnée, mais PSI sert les cubes ONC à sept filtres, photométriquement
corrigés et recalés, avec pour chacun ses plans de latitude, longitude, incidence et émission
(`hyb2_onc`, collections `data_reflectance_coregistered` et `geometry`). Chaque pixel se reporte
donc par ses PROPRES coordonnées, sans ajuster de pose : `scripts/mosaic-onc-images.mjs`, à 0,25°,
pondéré par cos i · cos e, puis `scripts/compose-albedo-texture.mjs` calé sur l'albédo géométrique
0,045. Ce qui l'a rendue livrable, contrairement à la couleur variable de Gaspra, ce sont des vues
INDÉPENDANTES : Ryugu tourne en 7,6 h, donc trois dates voient chaque lieu sous d'autres angles.
L'albédo s'y reproduit (r 0,79 à 0,84 par blocs de 2°, 0,73 à 0,83 sans la moyenne de chaque
latitude) ; la couleur non (pente 860/480 et UV 390/480 : r 0,01 à 0,24), donc seule sa MOYENNE
est posée (700/550/480 nm : 1,013 / 1 / 0,994). Deux cubes du 2018-06-28 sont écartés (bandes 860
et 950 nm vides, les cinq autres vingt fois trop basses). 87 % de la surface est mesurée ; le
reste (ombres, calottes) est comblé par propagation depuis les bords, sans détail : le `fillHoles`
de l'import, un seul flou, laissait noires les calottes polaires, vu sur la vignette.

Pour les autres, aucune carte n'a été trouvée là où l'on a cherché le 2026-10-04 : le dépôt S3
complet des mosaïques de l'USGS (18 844 clés listées), les cartes de Stooke au PDS (Ida, Gaspra,
Mathilde, Éros, Itokawa, Phobos, Déimos, Amalthée, Hypérion, Épiméthée, Wild 2 seulement) et les
archives SPICE de NAIF. Cela vaut pour Psyché, Apophis, Lutetia, Šteins, Didymos, Dimorphos,
Donaldjohanson, Arrokoth et Tempel 1. Psyché n'a pas encore été visitée, Apophis n'est connue
que par radar ; pour les autres, une recherche plus large (archives propres à chaque mission)
reste à faire et n'est pas une absence prouvée.

**Les images brutes des corps gris, recensées le 2026-10-05.** Une carte qui n'existe pas peut se
FABRIQUER si l'on a le modèle de forme, des images et de quoi poser chaque image sur le modèle
(noyaux SPICE, ou plans de latitude et longitude livrés avec l'image). Recensement fait sur les
3 863 collections du registre du PDS (l'hôte de chaque étiquette relu), puis par requête directe.
Les deux hôtes de l'Université du Maryland répondent 403 sur leurs `holdings`, y compris aux
adresses exactes que le registre publie (`pdssbn.astro.umd.edu` et
`pds-smallbodies.astro.umd.edu`).

| Corps | Images | Hôte | Pose | Verdict |
|---|---|---|---|---|
| Ryugu | ONC : I/F étalonnés et réflectances multi-filtres recalées | PSI (`hyb2_onc`) | plans de latitude et longitude par pixel | **accessible**, carte livrée le 2026-10-05 (ci-dessus) |
| Mathilde | NEAR MSI : images brutes et étalonnées en I/F | PSI (`NEAR_A_MSI_3_EDR_MATHILDE_V1_0`) | noyaux du survol à PSI (`NEAR_A_SPICE_6_MATHILDE_V1_0`) | accessible, mais **aucune pose établie sur le modèle** (2026-10-06, ci-dessous) : rien de livré |
| Lutetia, Šteins | OSIRIS NAC et WAC, niveaux 2 à 4 (réflectance) | PSA de l'ESA | noyaux de Rosetta chez NAIF | accessible ; licence CC BY-NC 3.0 IGO lue et acceptée le 2026-10-06 (ci-dessous) |
| Didymos, Dimorphos | DRACO, dont des images étalonnées avec plans géométriques | UMD seulement | | bloqué (403) |
| Arrokoth | LORRI, produits dérivés | UMD seulement | | bloqué (403) |
| Donaldjohanson | aucune image L'LORRI au registre, seulement des spectres LEISA | UMD seulement | | bloqué |
| Tempel 1 | Deep Impact et Stardust-NExT | UMD seulement | | bloqué (403) |
| Psyché, Apophis | aucune image rapprochée n'existe encore | | | sans objet |

**Mathilde : les images se posent sur le ciel, pas sur le modèle (2026-10-06).** Le plan était
celui de Ryugu, la pose en plus : calculer chaque prise de vue depuis les noyaux, projeter chaque
pixel sur le modèle de Thomas, bâtir la carte, la valider entre vues indépendantes. Rien n'est
livré, et voici ce qui a été mesuré, sur des sondes hors dépôt (`.cache/mathilde-msi/probe/`).

- **Le volume ne donne aucun angle.** `geometry/` ne contient que `geominfo.txt`, qui renvoie au
  volume SPICE ; dans l'index, latitude, longitude, incidence, émission et phase valent `+1.0E32`
  sur les 980 lignes, et les étiquettes portent `"UNK"`. 363 des 534 images du jour du survol
  existent en I/F (l'I/F est réservé aux vues résolues, la radiance aux sources ponctuelles).
- **SPICE place Mathilde, pas son orientation.** Les noyaux (CK des jours 177 et 178, `msi15.ti`,
  `math9749.bsp`, trajectoire de croisière) mettent le corps à quelques milliradians de sa place
  dans l'image ; l'écart se décompose en un biais de pointage constant (0,74 et −0,39 mrad) et une
  erreur de position relative de 37 km, ajustés sur les centroïdes de 220 vues entières : résidu
  de quelques pixels (10 au plus) sur les 214 vues du départ ; les six vues du croissant d'approche
  s'écartent de 43 px, ce qu'explique le décalage de la partie éclairée à phase 136°. Mais
  ni le volume ni le PCK générique de NAIF ne donnent l'orientation de Mathilde (des rayons
  seulement) : la rotation du repère J2000 vers celui du modèle doit être AJUSTÉE. Une seule
  rotation suffit pour tout le survol, Mathilde tournant de 0,4° en 25 minutes.
- **Ce qui a décidé : le modèle d'un AUTRE corps fait aussi bien.** Rendu du modèle avec ombres
  portées et ombrage de Lommel-Seeliger, comparé à huit vues entières (le croissant d'approche à
  phase 136°, le départ à 42-48°), recherche exhaustive puis affinement. Le témoin est le modèle de
  Gaspra, mis à l'échelle, ajusté de la même façon. Sur la luminosité : Mathilde 0,83, Gaspra
  0,85, le miroir de Mathilde 0,81. Sur les contours (laplacien de gaussienne, limbe et bords
  d'ombre), après affinement de dix candidats de chaque côté : Mathilde 0,38, Gaspra 0,43, et le
  résultat ne bouge pas quand on triple la densité du rendu. Le modèle de Mathilde gagne sur le
  croissant d'approche (0,58 contre 0,54) et perd sur le départ (0,32 contre 0,40), les vues où
  domine la grande concavité dans l'ombre, qu'aucune orientation ne reproduit. Toutes ses
  meilleures solutions convergent vers une même rotation (pôle du modèle à environ 3° du pôle
  céleste nord) : une solution stable, mais pas meilleure que celle d'un corps étranger, donc pas
  une pose.
- **Les cratères nommés ne tranchent pas non plus** : 10 des 20 cratères mesurables sont plus
  bas que leur pourtour dans le modèle à l'orientation livrée, 15 sur 22 au mieux sous un décalage
  de longitude, sans pic, ni direct ni en miroir.

**Ce qui a départagé l'outil et le modèle (2026-10-06) : le même outil sur ÉROS.** Mêmes caméra,
noyaux, format d'images et moteur ; images de l'approche du 11 février 2000 (Éros à 2 700 km,
même taille apparente que Mathilde au départ), trois rafales à 80 minutes d'écart, une seule
orientation ajustée et propagée par la seule vitesse de rotation de l'UAI (l'orientation vraie,
lue dans `erosatt_1999304_2001151.bpc`, ne sert qu'à juger). À la pose vraie, le rendu reproduit
les images (contours 0,70 à 0,77, contre 0,22 au hasard). À l'aveugle, l'ajustement la retrouve à
**0,8°** près, et le bon modèle écrase les témoins : Éros 0,76, Gaspra 0,34, Mathilde 0,31, tous
mis à la même taille. L'outil marche ; c'est le modèle de Mathilde qui ne reproduit pas ses images.
**La raison est dans le fichier : 49 % de l'aire du modèle est une sphère de remplissage.** 3 688
des 7 381 rayons valent exactement 26,5 km, pour l'essentiel en une seule grande région, et l'étiquette PDS
ne le dit pas. Les autres grilles de Thomas en cache n'ont rien de tel (Protée 0,4 %, les autres
0 %). Exclure de la comparaison les pixels qui tombent sur cette sphère ne suffit pas : Mathilde
0,60, Gaspra 0,57, et les meilleures solutions de Mathilde dispersées entre des orientations sans
rapport. Conséquence pour l'application : le Mathilde affiché est à moitié une sphère, puisque le
maillage livré vient de ce fichier. C'est désormais DIT : le crédit du modèle (fiche et
`/sources`, quatre langues) et `THIRD_PARTY_NOTICES.md` le déclarent. Et c'est GARDÉ :
`scripts/generate-shape-models.mjs` mesure, pour toute grille, la part d'aire du rayon le plus
fréquent et refuse de produire un maillage au-delà de 2 % tant que la recette ne déclare pas
`placeholderRadiusKm` (une déclaration que la source ne porte plus échoue aussi) ; seul Mathilde
déclenche, les douze autres grilles ressortent identiques à l'octet. `shapeModels.test.ts` exige
que le rayon déclaré figure dans le crédit de chaque langue (falsifié).

Ce qui rouvrirait la question : un modèle de forme de Mathilde complet, ou une forme reconstruite
depuis les images elles-mêmes (stéréophotoclinométrie), ce qui est un chantier en soi.
**Leçon** : la corrélation d'une silhouette éclairée récompense « une tache de la bonne taille »,
et seul un témoin de forme ÉTRANGÈRE le montre ; sans lui, 0,83 se lisait comme un succès.

**L'outil de pose SPICE, versionné (2026-10-06).** La sonde qui a tranché Mathilde est devenue un
script du dépôt : `pnpm pose:spice` (`scripts/spice-pose.mjs`, `scripts/spice-pose/posekit.py`,
`pose.py`), sa recette est une donnée (`scripts/spice-pose-targets.json`). Il retrouve
l'orientation d'un petit corps dans les images d'une mission : SPICE place la sonde, le corps et
la caméra, l'orientation s'AJUSTE (une rotation J2000 vers le repère du modèle, propagée par la
période de rotation LUE dans la fiche), sur la ressemblance des contours (laplacien de gaussienne)
entre l'image et le rendu du modèle avec ombres portées, du grossier (400 pôles × 36 méridiens,
luminosité) au fin (Nelder-Mead sur les contours depuis huit départs distants d'au moins 20°,
choisis avant tout affinement, donc indépendants du parallélisme).

- **Python et spiceypy, pas un lecteur SPK/CK en Node.** La géométrie est ce que la garde juge ;
  un lecteur maison (SPK de types 1, 2 et 13, CK, PCK binaire, chaînes de repères, horloges, temps
  de lumière) serait une seconde source d'erreur, à valider contre la boîte à outils de NAIF, que
  spiceypy est. L'outil tourne hors ligne comme les mosaïques : ni bundle, ni CI. Le lanceur crée
  un environnement aux versions exactes de `requirements.txt` et appelle `python -I`, qui
  n'importe rien du dossier courant (les images téléchargées sont des données).
- **Le modèle est celui qui est LIVRÉ** (le niveau le plus fin de `public/assets/models/{corps}/`,
  ramené pôle sur Z), donc une pose trouvée est celle du maillage sur lequel une carte serait
  drapée. Le pas des points et les tolérances du rendu dérivent du pixel au sol ; l'échelle de la
  caméra vient du champ de vue du noyau d'instrument (`getfov`).
- **La garde, rejouable** : `pnpm pose:spice fetch eros-approach` puis `guard eros-approach`
  (environ 7 min sur 14 processus). Six images de l'approche d'Éros (2000-02-11), orientation
  vraie (`erosatt_1999304_2001151.bpc`) jamais utilisée pour ajuster. Mesuré deux fois : Éros
  retrouvé à **1,28° puis 1,48°** (borne 2°) ; contours 0,77 contre 0,37 pour Gaspra et 0,26 à
  0,28 pour Mathilde, mis au même volume (0,48 et 0,34 à 0,36 du bon modèle, borne 0,8). Les
  départs qui convergent s'accordent à environ 1°, ce qui est la précision de la méthode.
  **Falsifiée** : la même garde avec une caméra en miroir rompt (meilleur Éros à 152°, contours
  0,23, code 1). Sans réseau, `src/config/spicePose.test.ts` confronte la recette à ce qui est
  livré (fiche, période, modèle du corps et des témoins, niveaux lisibles), falsifié par un témoin
  sans modèle.
- **Piège payé** : les processus de travail sous Windows RELISENT le module au démarrage de chaque
  pool ; modifier `posekit.py` pendant une recherche a fait planter une falsification en
  `KeyError`, un code 1 qui ne prouvait rien. On ne touche pas au code pendant qu'il tourne.

**Le contrôle de la sphère de remplissage se fait sur la SOURCE, jamais sur le maillage livré.**
Sur les maillages livrés, Mathilde ne montre que 0,6 % d'aire au rayon dominant : `--principal`
recentre le maillage, et la sphère de 26,5 km n'est plus centrée sur l'origine. Sur les sources
(Mathilde témoin à 49,5 %), tous les corps gris sont sous 1 % : Lutetia 0,9 % (512 triangles, la
résolution seule), Šteins 0,1 %, Tempel 1 0,1 %, Didymos 0,1 %, Dimorphos 0,1 %, Donaldjohanson
0,0 %, Arrokoth 0,0 %, Apophis 0,3 %.

**Le recensement, refait le 2026-10-06.** Les deux hôtes de l'UMD répondent toujours 403 sur
`holdings/` (la racine 200, témoin) : DART, New Horizons, Lucy et Deep Impact restent bloqués, et
le registre (3 863 collections relues) n'a toujours aucune image L'LORRI de Donaldjohanson. Seuls
**Lutetia et Šteins** ont images et noyaux accessibles : OSIRIS à la PSA (niveaux 2 à 4, dont la
réflectance), noyaux de Rosetta chez NAIF (`ro_rl-e_m_a_c-spice-6-v1.0`), avec deux trouvailles :

- **La licence est DÉCLARÉE à la source.** Les conditions des archives scientifiques de l'ESA
  (`cosmos.esa.int/web/esdc/terms-and-conditions`, lues le 2026-10-06) placent leurs données sous
  **CC BY-NC 3.0 IGO**, crédit OSIRIS « ESA, H. Sierks », usage commercial soumis à autorisation
  (`data.licences@esa.int`). L'utilisateur a décidé le même jour de livrer sous cette licence,
  malgré le lien Ko-fi du site. Cela rouvre 67P.
- **L'archive Rosetta porte des DSK OSIRIS de Lutetia** (`ROS_LU_K003` à `K780`, `M002`, `M003` ;
  `K098` pèse 8 Mo) et son PCK (`ROS_LUTETIA_RSOC_V03`) : le modèle livré de Lutetia (DAMIT 282,
  512 triangles) peut être remplacé par celui de la mission, comme Šteins l'a été.

**Šteins : les noyaux sont ceux que nomment les étiquettes.** L'éphéméride « prédite »
(`2867_STEINS_2004_2016.BSP`) place l'astéroïde à 983 km de Rosetta à 18:38:18 UTC, quand
l'étiquette de l'image dit 802,7 km, et hors du champ. Chaque étiquette OSIRIS liste les noyaux du
pipeline (`SPICE_FILE_NAME`) : avec `ORHO_…_00077`, `ORHR_…T19_00122` et
`ATNR_…_T6_00127`, la distance est 802,7 km. Les produits `EF` et `ID` sont deux fenêtres de la
même pose (512 et 256 px) ; la recette prend `EF`.

**Šteins : aucune pose établie, et ce n'est pas l'orientation du PCK (mesuré).** À
l'orientation de `ROS_STEINS_V05` (repère `STEINS_FIXED`, celui du DSK livré, vérifié dans le
fichier), aucun des huit arrangements d'axes de la caméra WAC ne reproduit la silhouette : 0,22 au
mieux (lignes −Y, échantillons −X), contre 0,75 pour Éros à sa pose vraie. Pôle gardé et méridien
balayé, le maximum reste 0,27 : ce n'est donc pas le méridien seul, bien que la vitesse du PCK
(1 428,099 °/j, soit 6,0500 h) diffère de la période publiée par Jorda et al. 2012 (6,04681 h).
Le modèle est hors de cause (6,81 × 5,62 × 4,20 km).

**La recherche à l'aveugle tranche dans l'autre sens : AUCUNE orientation ne reproduit ces images.**
Sept images, 400 pôles × 36 méridiens puis huit affinements (17 min) : contours 0,215 à 0,275, et
les huit solutions ne convergent pas (jusqu'à 179° l'une de l'autre), là où Éros en fait converger
cinq à 1° près à 0,77. Le défaut n'est donc PAS l'orientation du PCK, mais la mise en image de la
WAC dans l'outil (échelle des images corrigées de leur distorsion contre le champ de vue de l'IK,
interprétation des fenêtres `FIRST_LINE`/`FIRST_LINE_SAMPLE`, ou un corps de 40 à 80 px trop
petit pour le critère des contours). **Rien n'est drapé.** Ce qui rouvrirait la question : une
caméra validée d'abord sur un corps à orientation SÛRE vu par OSIRIS (la garde Éros ne valide que
la MSI de NEAR), puis Lutetia, vue en NAC sur environ 2 000 px.

Pour la couleur de Ryugu, aucun produit n'avait été trouvé sur DARTS ; PSI sert pourtant la
collection `data_reflectance_coregistered` de l'ONC, multi-filtres et recalée, avec ses plans
géométriques.

**Les archives des missions, lues le 2026-10-05** pour les cinq corps NASA, par le registre du PDS
(`pds.nasa.gov/api/search/1`, les 3 863 collections listées puis filtrées, la requête
`lid like … and …` étant refusée par l'API) :

| Corps | Ce que la mission publie | Servi par | Statut |
|---|---|---|---|
| Tempel 1 | le modèle de forme de Farnham et Thomas (`DIF-C-HRIV/ITS/MRI-5-TEMPEL1-SHAPE-V2.0`), aucune carte | — | absence prouvée |
| Donaldjohanson | des spectres LEISA bruts et étalonnés, aucun produit dérivé ; **aucune collection d'images L'LORRI du survol** au registre (relu le 2026-10-05 : les seules données L'LORRI sont celles de Didymos ; « images L'LORRI brutes » écrit plus tôt le même jour était faux) | — | absence prouvée |
| Didymos, Dimorphos | une table d'albédo RELATIF par facette du modèle SPC (`dart_shapemodel`, `data_derived_*`), sans question de repère | `pdssbn.astro.umd.edu` seulement | bloqué par la source |
| Arrokoth | la carte d'albédo de Porter et al. 2024 (deux projections azimutales polaires, une par lobe, ses coordonnées de texture dans l'OBJ du même jeu), et les cartes d'albédo et de réflectance de `nh_derived:arrokoth_geophysics` | `pdssbn.astro.umd.edu` seulement | bloqué par la source |

**Le blocage est mesuré, pas supposé** : les deux hôtes de l'UMD répondent HTTP 403 sur tout
`holdings/`, avec ou sans en-têtes de navigateur, depuis un service distant, et dans le navigateur
de l'utilisateur ; la racine du site répond 200 (témoin). Aucun miroir : PSI n'héberge pas ces
missions, et les copies de livraison de `pds.nasa.gov/data/pds4/releases/sbn/` ne portent que les
étiquettes et les inventaires. **Ce qui rouvrirait la question** : un `holdings/` de nouveau servi.
Didymos et Dimorphos passeraient alors par `bake-shape-colour.mjs` (valeur par facette) ; Arrokoth
demanderait en plus de livrer dans le glb les coordonnées de texture de Porter, puisque son repère
n'admet pas de projection en longitude et latitude.

**Trois outils nés de ce tri.** `scripts/compose-albedo-texture.mjs` compose des albédos
flottants en couleur selon les règles de la couleur cuite (rapports entre bandes gardés, un seul
facteur vers l'albédo publié, convention lue dans `scripts/display-albedo.mjs`, NoData jamais
mélangé), et ne lisse que la chrominance. Les membres d'un zip de 2,57 Go se lisent un à un par
requêtes Range. Et une bande flottante sort de sharp en TROIS copies : on la reprend par
`extractChannel(0)` après avoir vérifié que le fichier n'en porte qu'une.

**Ce qui ne tranche pas pour Éros**, et pourquoi il n'est pas dans la garde d'orientation : ses
cartes sont corrigées à phase nulle, donc sans ombrage, si bien que ni le recalage pente/variance
(qui donnait un miroir à 191°, r = 0,230) ni un témoin de luminosité ne mesurent quoi que ce soit.
Deux repères nommés lus à l'œil et le test des cratères sur le modèle tiennent la décision.

## Modèles de forme : la vraie forme, et la texture du corps drapée dessus

Un corps irrégulier dont un modèle de forme scientifique est publié l'affiche, au lieu d'une
sphère (règle de parité de l'utilisateur, 2026-09-22). La liste des corps qui en ont un fait foi
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
- **La surface est fermée** (2026-10-04) : chaque arête bordée par exactement deux triangles, de
  sens opposés. Le regroupement de sommets qui produisait les niveaux laissait des trous, des
  arêtes non manifold et des faces retournées sur 38 des 49 niveaux, alors que toutes les sources
  mesurées en avaient zéro ; la scène les dessinait en triangles noirs. La réduction est désormais
  un effondrement d'arêtes (meshoptimizer, outil de build, jamais servi), suivi du retrait des
  « nageoires » (deux triangles sur les mêmes sommets en sens opposés, feuillet sans volume que
  l'effondrement laisse parfois) et d'un contrôle de fermeture : le script REFUSE d'écrire un
  niveau ouvert. Garde dans `shapeModels.test.ts`, sommets soudés par position, falsifiée sur
  l'ancien Éros 1k.
- **La recette est une donnée.** `scripts/shape-model-targets.json` porte, par corps, la source (cache,
  adresse vérifiée ou nom du jeu de données) et les options ; `pnpm shapes:generate` régénère tout.
  Ce qui appartient à la fiche n'y est pas recopié : les niveaux (`model.resolutions`), la cuisson
  (présente si `model.albedo` l'est) et le crédit embarqué dans le glTF (`model.credit.en`, que 19
  fichiers sur 24 remplaçaient par « source à documenter »). Les options n'étaient écrites nulle
  part : elles ont été **dérivées** en produisant chaque combinaison et en la comparant au fichier
  livré (distance moyenne de ses sommets à une version dense du nouveau maillage). La bonne
  coïncide à 0,1-1,7 %, la suivante à 3-17 % ; seule exception, `--z-up` devient sans effet après
  `--principal`. Deux pièges de cette mesure : normaliser par le rayon moyen des SOMMETS la rend
  dépendante de l'échantillonnage (une grille est dense aux pôles), et le pôle d'une grille doit
  être UN point (`cos 90°` vaut 6e-17 en flottant, et la soudure exacte laissait Vesta ouverte).
- **La couleur cuite se moyenne sur l'empreinte d'un sommet.** Prélever un pixel de carte par
  sommet mesurait le bruit de la carte : sur la couleur livrée de Bennu, deux sommets voisins
  étaient décorrélés (−0,02) pour 13,7 % d'écart. Bennu étant drapé de sa texture, cette couleur
  n'était d'ailleurs pas affichée, et elle n'est plus cuite. Éros et Ryugu gardent leur couleur
  mesurée, reportée depuis les fichiers du commit `3a36b12` et moyennée sur l'empreinte de chaque
  nouveau sommet (`bake-shape-colour.mjs --from`), parce que leurs cartes ne se relisaient pas ce
  jour-là ; une carte relue passe par la même moyenne (`lowPass`). [SUPERSEDED pour ces deux corps : la couleur de Ryugu, lue dans une figure, a été retirée le
  2026-10-04 et Éros est drapé de sa texture depuis le même jour ; Ryugu est drapé de sa carte ONC
  depuis le 2026-10-05. Aucun modèle livré ne porte plus de couleur cuite.]

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

**Les objets d'instrument ont leur page depuis le 2026-10-03.** Les onze sondes et les trois
interstellaires étaient les seuls objets nommés de l'application sans page ni vignette : une
décision écrite, juste à son époque (§ « Objets d'instrument navigables »), plus depuis.
`src/seo/instrumentLandingPage.ts` les rend par le même `renderLandingPage` que les corps et les
éclipses, dans les quatre langues, à `/{nom}/` : description, faits de lancement ou d'orbite cités
par leur source (`core/bodyFacts.ts`, la règle de la fiche), couverture du fichier Horizons LUE dans
le manifeste, et pour une sonde ce que l'archive du PDS déclare qu'elle embarque, identifiant
compris, ou la raison de son absence (Parker, JWST). Ils n'entrent PAS dans `CELESTIAL_CONFIG` : le
générateur lit `NAVIGABLE_TARGETS`, la table que la fiche lit déjà. **Une seule liste des adresses
qui ont une page**, `LANDING_PAGE_BODIES` (`config/navigable.ts`), lue par le permalien (qui GARDE
donc `/voyager1/` au lieu de le renvoyer à la racine) et confrontée aux pages générées par
`instrumentLandingPage.test.ts`. Le titre dit « trajectoire » et non « orbite » (`title.instrument`,
le même pour l'onglet, tenu par `titleParity.test.ts`). **La vignette ne peint pas de sphère** : un
point de la couleur du marqueur, comme l'application, puisqu'une sphère inventerait une forme que
rien ne publie. Son titre tient désormais dans sa colonne, ce que le nom de ʻOumuamua avait
montré en débordant, vu en REGARDANT la vignette : `cardTitleFit.test.ts` rasterise chaque titre
et exige qu'aucun pixel n'entre dans la marge (falsifié : quatre noms débordaient à 84 px fixes).
La taille reste 84 tant qu'un nom tient, donc aucune vignette de corps n'a changé d'un octet.

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

**Le libellé suit la grandeur que la source déclare (2026-10-03).** Un champ ne dit pas la même
chose d'un corps à l'autre : `meanTempC` est une moyenne pour la Terre (NSSDCA, « Mean
Temperature »), une moyenne au niveau de 1 bar pour une géante (la même note : « or for the gas
giants at the one bar level »), la température effective pour le Soleil, et une température de
surface pour Encelade et Triton (NASA Science : « the surface temperature is… », « found surface
temperatures of… »). `rotationPeriod` est sidérale pour une planète (« relative to the fixed
background stars ») ou une rotation synchrone, synodique pour un petit corps de la SBDB (« body
rotation period (synodic) », le `desc` de la base, désormais gardé dans le relevé), prise à 16° de
latitude pour le Soleil, et sans adjectif quand l'article source n'en écrit pas (Néréide, Quaoar).
La fiche et les pages publiques écrivaient « température moyenne » et « rotation sidérale » pour
tous. `core/factQuantity.ts` rend la clé du libellé exact depuis la provenance, une règle et deux
lecteurs (`t()` pour la fiche, le dictionnaire de la langue pour les pages). Gardes :
`src/config/factQuantity.test.ts` confronte chaque libellé à la phrase, au champ ou à la citation
de sa source dans le relevé livré (falsifié trois fois : SBDB dite sidérale, la précision de
surface d'Encelade retirée, la température effective du Soleil dite moyenne) ;
`src/ui/bodyInfo.test.ts` le lit sur la fiche rendue.

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

### L'obliquité d'un satellite se DÉRIVE d'un pôle publié (lot 23)

Aucune table d'agence ne publie l'obliquité d'un satellite. Les fiches NSSDCA la publient pour
onze corps et pour eux seuls (les huit planètes, Pluton, la Lune, et le Soleil, dont les 7,25°
sont l'inclinaison de son équateur sur l'écliptique, pas sur une orbite qu'il n'a pas). Ce qui EST
publié pour une lune, c'est son PÔLE : le rapport du groupe de travail de l'UAI sur les éléments
de rotation, que NASA NAIF livre sous forme lisible par une machine (`pck00011.tpc`, fournisseur
`naif-pck`). L'obliquité s'en dérive, exactement comme elle se dérivait déjà du pôle SBDB pour les
sept astéroïdes dont la base publie un pôle.

Le calcul vit dans `src/core/iauPole.ts`, module pur : **angle entre le moment cinétique de
rotation et la normale de l'orbite**. Le relevé (`pnpm facts:snapshot`) conserve les COEFFICIENTS
du noyau, jamais un pôle calculé, parce qu'un pôle dépend de l'instant. La normale vient de là où
l'orbite du corps est décrite : les éléments écliptiques que sa fiche déclare, ou astronomy-engine
pour les quatre lunes galiléennes, que la fiche ne décrit pas puisque c'est lui qui les place.

**Trois pièges, chacun payé, chacun tenu par `iauPole.test.ts`**, qui confronte les ONZE
obliquités publiées par la NSSDCA à celle qu'on dérive, sans un seul nombre écrit à la main (les
orbites viennent d'astronomy-engine, la valeur attendue du relevé) :

1. **le pôle n'est pas une constante.** Le modèle est un polynôme du temps PLUS une somme de
   termes trigonométriques. Pour la Lune, le premier vaut à lui seul 3,2° : l'ignorer ne donne pas
   un pôle approché, il donne un autre pôle ;
2. **les arguments de ces termes sont linéaires pour six systèmes et QUADRATIQUES pour celui de
   Mars.** Les lire comme des couples quand ce sont des triplets déplaçait le pôle de Mars de 3°
   en déclinaison : 22,98° d'obliquité là où la NSSDCA publie 25,19, et Deimos, dans la foulée, à
   3,5° au lieu de 0,002. Le relevé livre donc chaque argument comme un TABLEAU de coefficients ;
3. **le pôle nord de l'UAI n'est pas la direction du moment cinétique.** Pour un corps en rotation
   rétrograde (Vénus, Uranus, Triton, les lunes d'Uranus), le corps tourne dans le sens horaire
   autour de ce pôle, et c'est son antipode qui porte le moment cinétique. Le signe se lit dans la
   vitesse du méridien d'origine, jamais deviné : sans lui, Uranus rend 82,23° au lieu de 97,77 et
   Triton 179,5 au lieu de 0,5.

Falsifié quatre fois, chacune rouge pour sa raison : signe rétrograde ignoré (Uranus et Vénus),
termes trigonométriques ignorés (Mars et la Lune), arguments de Mars mis à plat et relus par
couples (Mars). Le quatrième cas, tronquer le coefficient quadratique lui-même, reste VERT sur la
fenêtre de la garde : sur vingt ans autour de J2000 ce terme pèse moins que le seuil, et c'est le
PAIRAGE qui compte, pas le degré.

### Une raison de ne pas publier est confrontée à sa source, comme une valeur (lot 23)

« La base des petits corps ne publie pas de température » est une affirmation SUR UNE SOURCE. Non
vérifiée, elle ne vaut pas mieux qu'un chiffre sans provenance, le défaut que les faits sourcés
avaient réglé pour les VALEURS au lot 4. Le relevé porte donc de quoi trancher, et `factProvenance.test.ts` tranche, dans
les deux sens :

- les fiches NSSDCA des satellites déclarent si elles publient une température
  (`publishesTemperature`, calculé sur la SECTION des satellites pour la fiche de Mars, dont la
  planète en a bien une) ; la table JPL des paramètres physiques livre ses INTITULÉS de colonnes ;
  la SBDB livre les NOMS de tous ses paramètres physiques ;
- une raison ne peut pas dire « personne ne publie » d'un chiffre qui est dans un de ces relevés ;
- symétriquement, une obliquité manque EXACTEMENT là où le noyau de NAIF ne publie pas de pôle
  (Hypérion, Néréide et les quatre petites lunes de Pluton, dont la rotation n'a pas d'éléments
  publiés), et une fiche dont le noyau publie un pôle doit afficher une obliquité ;
- quand une page de la NASA publie une PLAGE plutôt qu'une moyenne (Phobos, Rhéa, Éris), la fiche
  écrit une raison qui cite ces mêmes bornes, et le test vérifie chaque borne dans les quatre
  langues ;
- quand une raison cite les nombres d'un article (le limbe elliptique de Haumea, la taille du
  système d'Orcus), ces nombres doivent figurer dans les citations que `facts:snapshot` a
  retrouvées mot pour mot dans l'article.

**Un champ peut porter une valeur ET une raison de ne pas l'afficher, mais seulement trois.** La
scène lit l'obliquité pour orienter un corps, le rayon pour décider d'une approche de surface et
la masse pour le mouvement du parent : `SIMULATION_ONLY_FACTS` (`core/bodyFacts.ts`) les déclare,
et `catalogueCompleteness.test.ts` refuse tout autre champ dans ce cas. Quatre gravités de surface
traînaient ainsi, non publiées et lues par personne.

### Une date de lecture appartient à la RÉPONSE, pas à l'exécution (lot 25)

`factSources.snapshot.json` portait **un seul `retrieved`**, écrit avec `new Date()` à la fin du
relevé. Un cache chaud en héritait : le fichier livré au lot 23 annonçait le 2026-09-28 pour les
huit réponses d'articles lues le 2026-09-20 (six résumés arXiv, la page Nature et le PDF d'Haumea,
soit neuf fichiers de cache datés du 20, le PDF en occupant deux). Ce n'était pas une note interne :
**vingt fiches AFFICHAIENT cette date d'exécution** derrière leur nombre de lunes, dans les quatre
langues et sur les pages par corps.

La règle, et elle tient en une phrase : **une réponse est horodatée quand elle arrive, et plus
personne ne demande l'heure ensuite.**

- **Chaque réponse mise en cache porte sa date** dans un fichier voisin (`<clé>.at`), écrit à
  l'instant où elle arrive. C'est le seul moment où l'heure courante EST la date de lecture.
- **Une entrée déjà en cache sans voisin** est datée de la date d'écriture de son fichier, puis
  FIXÉE à côté d'elle. C'est un relevé, pas une supposition, et il ne coûte aucune requête : c'est
  ce qui a permis de retrouver le 2026-09-20 de ces huit réponses au lieu de le perdre.
- **Tout objet du relevé qui cite une `url` porte un `retrieved`.** `assertEveryUrlDated` refuse
  d'écrire un relevé daté à moitié, et il nomme le chemin fautif.
- **La date d'une SECTION est dérivée de ses réponses**, jamais écrite : `retrieved` est un tableau
  des jours distincts, triés, où cette section a été lue. Une section lue en deux fois en porte
  deux, et `articles` en est un cas réel. Une date unique pour dix sources était le mensonge
  d'origine ; une date unique par section en serait un plus petit.
- **Ce qui s'affiche suit.** Quand une source ne date pas son chiffre, la fiche affiche la date de
  LA RÉPONSE qui le porte : `sbdb[corps].retrieved` pour un nombre de satellites de la SBDB,
  `nasaMoonCounts[planète].retrieved` pour une page de la NASA qui a perdu son « as of ». Quand la
  source date son chiffre, c'est SA date qui gagne (« as of August 2026 »).

**Le cas particulier hors ligne a disparu**, et c'est un signe que la correction est à la bonne
profondeur : le relevé recopiait l'ancien `retrieved` quand il tournait sans réseau, pour ne pas
produire de diff. La date venant maintenant du cache, une régénération sans réseau rend
exactement le même fichier, sans rattrapage.

**Trois familles de gardes, dont une vise la CAUSE** (`src/config/factSourceDates.test.ts`,
mécanisme éprouvé sur un vrai cache temporaire) : un cache chaud garde sa date ; le relevé livré
annonce, section par
section, exactement les dates de ses propres réponses, recalculées depuis elles ; et **le script du
relevé ne lit l'horloge nulle part**, le seul endroit qui en a le droit étant celui qui horodate une
réponse qui arrive. Cette dernière garde compte le CODE et non les commentaires : sans cela elle
accusait l'en-tête du module, qui cite `new Date()` pour expliquer le défaut, et un garde qui
accuse une phrase est un garde qu'on finit par désarmer.

**Et `tsc` tient la porte** : les trois endroits qui lisaient la date globale demandent
désormais celle d'une entrée ou celle de toutes (deux dans `factProvenance.test.ts`, un dans
`vite.config.ts`), donc un relevé à l'ancienne forme ne compile plus. La faute ne peut pas
revenir en silence.

**Et une réponse qu'une source REFUSE de servir se reprend, en le disant.** Par défaut le relevé
échoue, et cela ne change pas : une source muette ne doit pas produire un relevé silencieusement
incomplet. Mais `--carry-over-unavailable` demande explicitement de REPRENDRE du relevé précédent
l'entrée qu'on n'a pas pu relire, avec `retrieved: null` et `carriedOver: true`. La reprise passe par
un `entry(section, clé, lecture)` partagé, et **une seule section l'utilise aujourd'hui**, celle où
le besoin s'est présenté : les autres échouent, drapeau ou pas, tant qu'un deuxième cas réel ne
force pas l'abstraction. Le besoin est
mesuré : le 2026-09-28, quatre fiches du Master Catalog du NSSDCA (Cassini, Rosetta, BepiColombo,
Hayabusa2) ont servi leur page « Errors and Messages » en HTTP 200 pendant plus de sept heures, les
mêmes quatre à chaque tour, quel que soit le client HTTP et par toute autre adresse du site, tandis
que les sept autres répondaient. Leur date de lecture n'existait plus nulle part, le cache ayant été
vidé : elle s'écrit donc ABSENTE plutôt que devinée, ce qui est le contraire de la faute corrigée
ici. Quatre gardes l'encadrent : la liste des reprises est ÉNUMÉRÉE dans le test, une reprise de
plus comme une reprise de moins la fait rougir, une entrée sans date doit se déclarer reprise, et
**aucun fait affiché ne peut tenir sa date d'une reprise**. Cette liste doit se vider dès que la
source répond.

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

## Ce que l'application DIT, et où va le focus (lot 19)

Le lot 19 a écouté l'application avec un vrai lecteur d'écran et a relevé treize défauts, tous
sous des tests verts. Le relevé complet, chiffré, vit dans `docs/private/LECTEUR_ECRAN_LOT19.md`.
Ce qui suit est le contrat qui en reste.

### Une seule région live, attachée au document

`src/ui/announcer.ts` possède **l'unique** région `aria-live` de l'application. Trois règles :

1. **Elle est attachée au `<body>`, jamais à un panneau.** Une région live dans un conteneur qui
   porte `hidden` n'annonce rien. C'était le défaut de la région que `ui/offlineData` posait dans
   la section hors ligne : la fin d'un téléchargement lancé puis laissé de côté ne se disait pas.
2. **C'est une FILE, pas une variable.** Une région live ne garde que son dernier état : deux
   messages émis coup sur coup n'en font qu'un, et c'est le premier qui disparaît. Les messages
   sont donc espacés de 1 200 ms. Un canal facultatif regroupe les messages qui se CORRIGENT au
   lieu de s'ajouter, comme le nombre de résultats d'une recherche qui change à chaque lettre.
3. **`polite`, jamais `assertive`.** Rien ici n'est assez urgent pour couper la parole à
   quelqu'un au milieu d'une phrase.

Ce qui est annoncé, et rien d'autre : la fin du chargement (et son échec), le corps choisi, le
changement de date provoqué par un événement, le nombre de résultats d'une recherche, l'état du
hors-ligne. Les étapes intermédiaires d'un chargement ne le sont PAS, délibérément : six étapes
puis soixante-quatre pas de téléchargement rendraient le reste de l'interface inaudible.

### Ouvrir une surface y emmène le focus

`src/ui/surfaceFocus.ts` possède la règle. Une surface contextuelle qui s'ouvre prend le focus
sur son bouton de fermeture ; quand elle se referme, le focus revient à son déclencheur, mais
SEULEMENT s'il était encore à l'intérieur.

Ce n'est pas une préférence de style. Les panneaux sont déclarés après tout le dock dans
`index.html`, donc laisser le focus sur le déclencheur met leur contenu à quinze tabulations.
Et leur écouteur d'Échap est posé sur le panneau : tant que le focus n'y entre pas, Échap ne peut
pas se déclencher. La même correction règle les deux.

Corollaire pour un dialogue qui déclare `aria-modal="true"` : il DOIT retenir le focus
(`trapFocus`). Déclarer le reste de la page inerte sans le tenir est pire que ne rien déclarer,
puisque le lecteur d'écran restreint sa lecture à un contenu que le focus a déjà quitté.

### Un focus qui allait être perdu est adopté

Après une action qui ferme la surface d'où elle partait, le focus retombe sur `document.body` et
la personne au clavier doit repartir du début du document. La fiche d'information ADOPTE ce
focus quand il est orphelin (sur le `body`, ou dans un élément qu'on vient de masquer), et ne le
prend jamais à un élément bien vivant.

### La langue du chrome invisible

Le `<title>` et le `<h1 class="sr-only">` restent ANGLAIS dans `index.html` : le premier est lu
par les robots, le second est en plus l'ancre que `src/seo/bodyLandingPage.ts` remplace.
L'application les remplace par leur version localisée au démarrage, `ui/documentTitle` pour l'un
et `ui/documentChrome` pour l'autre. Les versions anglaises des deux côtés doivent coïncider au
caractère près, sinon un rechargement fait clignoter le texte : `src/seo/titleParity.test.ts` et
`src/seo/headingParity.test.ts` le vérifient.

### Mesurer ce qu'un lecteur d'écran dit vraiment

`scripts/capture-screenreader.mjs` pilote une copie portable de NVDA, muette, et lit son journal.
Le point qui décide de tout : **NVDA pose un crochet clavier au niveau du système, donc les
frappes injectées par CDP lui sont invisibles**. Les touches partent en `SendInput` et CDP ne
sert qu'à observer. Le parseur du journal est pur et testé (`src/core/speechTranscript.ts`) :
une mesure fausse est pire qu'une mesure absente, et le premier parseur écrit pour cette passe
accusait l'application d'un défaut qui était le sien.

Ce banc demande Windows et NVDA : il ne tourne pas en intégration continue. Ce qui y tourne, ce
sont les gardes de `e2e/a11y-screenreader.spec.ts`, qui vérifient les CONDITIONS de ce qui a été
entendu (le focus est là, le nom existe, la région live porte le message), jamais la parole.

## Citer Galaxy : un DOI, écrit à un seul endroit (lot 18)

Depuis la version 0.10.0, Galaxy est archivé sur Zenodo et porte un identifiant pérenne. Ce qui
suit décrit d'où vient ce DOI, pourquoi il n'est écrit qu'une fois, et ce qui empêche ses copies de
diverger.

**Deux DOI, et le choix entre eux n'est pas neutre.** Zenodo en frappe deux à chaque publication :
un **DOI de version**, qui désigne l'état publié ce jour-là, et un **DOI de concept**, qui désigne
l'œuvre et résout toujours vers la version la plus récente. C'est le DOI de concept qui est mis en
avant partout, parce qu'une référence écrite aujourd'hui ne doit pas pourrir à la prochaine
publication ; le DOI de version est déclaré à côté, pour qui veut désigner un état figé.

| | |
| --- | --- |
| DOI de concept | `10.5281/zenodo.22985614` |
| DOI de la version 0.10.0 | `10.5281/zenodo.22985615` |

**Un seul propriétaire : `CITATION.cff`.** C'est déjà le fichier que GitHub et la plupart des
gestionnaires de références lisent ; il n'y avait donc aucune raison d'inventer une seconde source.
Le DOI y est écrit une fois, et tout le reste le LIT :

- `src/seo/citation.ts` (module PUR, sans E/S) reçoit le TEXTE de `CITATION.cff`, en extrait la
  citation et rend le bloc « Comment citer » ; il ne contient aucun DOI, aucune version, aucune
  date ;
- le plugin de build (`vite.config.ts`) lit le fichier une fois et passe le résultat aux deux
  générateurs de pages, comme il lisait déjà `repository-code` ;
- `/methodology` et `/sources`, dans les DEUX langues, affichent ce bloc. Le même module le rend
  pour les quatre documents : deux copies d'un même texte divergent, et celle qu'on oublie est
  celle que le lecteur a sous les yeux ;
- le README est la SEULE copie du dépôt, parce que c'est du Markdown que rien ne construit. Elle
  est donc confrontée à `CITATION.cff` par un test.

**Le module REFUSE un fichier incomplet, bruyamment.** Une page « comment citer » sans DOI serait
exactement le genre de texte publié faux que ce dépôt corrige depuis le lot 3 : `parseCitation`
lève une erreur qui NOMME les champs manquants, et le build s'arrête. Elle refuse aussi une URL
complète écrite à la place du DOI (le cas réel : un lecteur finit par cliquer sur
`https://doi.org/https://doi.org/…`) et une date qui n'est pas ISO.

| Garde | Ce qu'elle tient |
| --- | --- |
| `src/seo/citation.test.ts` | la lecture du VRAI `CITATION.cff` livré, l'ordre des auteurs, la référence d'une ligne, et six refus (un champ manquant, une URL au lieu d'un DOI, une date non ISO, aucun auteur lisible) |
| `src/config/citationMetadata.test.ts` | que `package.json`, `CITATION.cff` et le titre de section du `CHANGELOG` disent la MÊME version et la même date ; qu'aucun DOI du README ne soit inconnu de `CITATION.cff` ; que le DOI de concept y domine celui de version ; et qu'un DOI ne soit jamais publié sous une forme non résolvable |
| `src/seo/docPages.test.ts` | que les QUATRE documents affichent le DOI qu'on leur donne, sous forme résolvable, avec la section titrée dans leur langue |

**Un piège payé en écrivant ces gardes, et c'est sa falsification qui l'a dit.** La première
version de « le README cite le même DOI » comptait les occurrences : « au moins deux égales au DOI
de concept ». Or le README en porte trois. En corrompre UNE en laissait deux, donc la garde restait
VERTE pour un badge qui pointait ailleurs. La propriété juste ne compte rien : elle n'admet **aucun
DOI inconnu** de `CITATION.cff`. Un second détail du même ordre : le badge de Zenodo s'écrit
`.../DOI/10.5281/zenodo.NNN.svg`, et ce `.svg` appartient à l'URL de l'image, pas au DOI ; sans le
retirer, la garde refusait son propre badge.

**Ce que la publication a confirmé et qui n'était pas acquis** : Zenodo a reconnu de lui-même la
licence du projet (`polyform-noncommercial-1.0.0`), alors qu'elle ne fait pas partie des choix
courants. Aucune intervention manuelle n'a été nécessaire.

**Ce que ce lot ne fait pas** : il ne touche ni le bundle, ni une texture, ni un binaire. Le module
de citation est du code de BUILD, absent du JavaScript servi (vérifiable comme `renderSphere` :
`grep parseCitation dist/assets/*.js` ne rend rien). Les seuls documents qui changent sont les
quatre pages qui portent désormais le bloc.

## Quatre langues, une seule chargée (lot 20)

Galaxy est servi en **anglais, français, espagnol et portugais du Brésil**. Le contrat tient en une
phrase : *un visiteur télécharge la langue qu'il lit, et rien de plus*. Il se décline en quatre
règles, chacune tenue par une garde.

### 1. Les clés sont dérivées, jamais listées deux fois

`src/i18n/dict-en.ts` porte le dictionnaire anglais **et** exporte `MessageKey`, dérivé de cet
objet. Les trois autres dictionnaires sont typés `Record<MessageKey, string>` : une clé manquante ou
une clé en trop est une erreur de **compilation**, pas un test à écrire. Avant ce lot, `en` et `fr`
avaient le même nombre de clés par chance.

`src/i18n/translationFidelity.test.ts` ajoute ce qu'un type ne peut pas voir : les nombres, les
gabarits `{…}` et les noms propres d'une traduction doivent être ceux de la source, et une valeur
restée identique à l'anglais doit être **déclarée** avec sa raison.

### 2. Le dictionnaire de la langue active arrive par le réseau

L'anglais reste dans le bundle : c'est le repli de `t()`, donc le sortir ferait apparaître des clés
brutes. `i18n/locales.loadDictionary` charge les autres par un `import()` **littéral** — un
spécificateur calculé n'est pas analysable par Vite, qui embarquerait alors les quatre.

`initLocale()` est attendu **avant le premier rendu**, dans `loadApp`. Ce n'est pas une précaution :
le premier texte qu'un visiteur voit est celui du chargeur, et le chargeur ne se retraduit pas, il
disparaît. `e2e/i18n-locales.spec.ts` relève la SÉQUENCE complète des libellés du chargeur et refuse
qu'un seul libellé anglais y apparaisse dans une autre langue.

L'attente ne peut pas vivre au corps du module : `await` de premier niveau est refusé par la cible
de build du projet (`es2020`, Safari 14). Relever cette cible pour une commodité d'écriture
reviendrait à cesser de servir des navigateurs de 2020.

### 3. Le TEXTE DU CATALOGUE est dérivé des fiches, par langue

Les fiches du registre sont importées par `import.meta.glob({ eager: true })` : tout leur contenu
part chez le visiteur. Mesuré au lot 20, les traductions espagnole et portugaise ajoutaient
**50 263 octets payés par tous**, y compris par un anglophone qui ne les lira jamais.

Le greffon `deriveRegistryText` de `vite.config.ts` fait donc deux choses :

- il **retire** les langues autres que l'anglais des fiches servies au navigateur ;
- il **expose** `virtual:registry-text/catalogue-<langue>`, une carte « anglais → traduction »
  construite depuis les mêmes fiches, chargée avec le dictionnaire de la langue par
  `config/catalogueText.ts`, qui la repose EN PLACE sur les objets déjà construits (aucun lecteur ne
  change : la fiche, les étiquettes et les crédits lisent toujours `texte[langue] ?? texte.en`).

`options.ssr` décide : les générateurs de pages et Vitest ont besoin des quatre langues et passent
par la voie SSR, qui n'est pas allégée ; le navigateur, en dev comme en production, reçoit la
version allégée. La voie que les tests e2e exercent est donc bien celle qui est livrée.

La clé de la carte est une **empreinte courte** de la chaîne anglaise (`core/registryText.textKey`,
FNV-1a 32 bits) : indexée par la chaîne entière, la carte pesait 41 342 octets par langue, dont
environ 19 000 d'anglais recopié — un texte que le bundle porte déjà. Deux champs portant le même
anglais partagent la même traduction, ce qui est voulu ; deux traductions différentes pour un même
anglais sont **refusées au build**, en nommant les deux.

`src/registry/registryText.test.ts` prouve la neutralité de la séparation par un **aller-retour** sur
les fiches livrées : alléger puis reposer la carte d'une langue reconstruit exactement le texte de
cette langue.

### 3 bis. Le texte LONG d'une fiche n'arrive qu'à son ouverture (2026-10-04)

Mesuré avant d'ajouter 25 corps au catalogue : l'anglais localisé des 58 fiches pesait **23 896
octets** dans le bundle de démarrage (raisons 10 749, descriptions 7 572, crédits 2 659, liens
Wikipédia 2 360, noms 323), et la carte de chaque autre langue en portait la traduction. Or ce
texte n'est lu que par la fiche (`ui/bodyInfo.ts`). Une fiche comme celle d'Éros coûtait 2,3 Ko
au démarrage, pour une marge de 21 206 octets : le lot ne passait pas.

Les champs de `DEFERRED_TEXT_KEYS` (`core/registryText.ts` : `description`, `reason`, `credit`,
`colourSource`, `wiki`) des registres que lit la fiche (entités, sondes, interstellaires) sont donc
**différés dans les quatre langues, anglais compris** :

- le greffon remplace chaque bloc par `{ deferredText: empreinte }` (drapeau `unsourced` gardé) et
  l'exclut de la carte de démarrage de sa langue ;
- il expose `virtual:registry-text/card-<langue>` pour les quatre langues, que `config/cardText.ts`
  charge à la PREMIÈRE ouverture d'une fiche (l'anglais, repli de chaque bloc, plus la langue
  active) et repose en place ;
- la fiche se rend tout de suite avec ce qu'elle a, puis une seconde fois quand des blocs ont été
  reposés, jamais pour rien, puisque le chargement rend le nombre de blocs touchés ;
- la marque n'a pas de `$` en tête : `registry/load.ts` réserve ce préfixe aux formes de calcul, et
  la première version (`$k`) faisait refuser la fiche du Soleil au démarrage.

Résultat mesuré : démarrage **1 278 794 → 1 234 158 octets**, marge **21 206 → 65 842**, et la
carte de démarrage de chaque autre langue perd environ 23 Ko (5 908 octets pour le portugais). La
marque `deferredText`, répétée sur chaque bloc, coûte 2 320 octets de plus que `$k` : le prix d'un
nom lisible, mesuré.

Gardes : `src/config/catalogueText.test.ts` (chaque texte dans la bonne carte, aucun texte
seulement différé dans une carte de démarrage, falsifié en désactivant l'exclusion : 3 rouges, et
un aller-retour fiche allégée plus cartes égal à la fiche d'origine, dans les trois langues) ;
`e2e/cardText.spec.ts`, la seule garde qui voit cette voie, puisque Vitest et les pages générées
lisent des fiches complètes : description, lien, crédit en espagnol, aucun « undefined », et le
témoin qu'aucune carte de fiche ne part tant qu'aucune fiche ne s'ouvre (falsifié en supprimant le
second rendu : rouge).

En passant, un défaut visible corrigé : le crédit d'un modèle de forme ne choisissait qu'entre
`fr` et `en`, si bien qu'un visiteur espagnol ou portugais le lisait en anglais alors que la fiche
porte sa traduction.

### 4. Le budget compte des groupes EXCLUSIFS

Un visiteur charge **un** dictionnaire et **une** carte de texte. `BOOT_EXCLUSIVE_CHUNK_GROUPS`
(`core/startupBudget.ts`) déclare les deux groupes, et seul le membre le plus **lourd** de chaque
groupe entre dans le total : les additionner surestimerait de deux dictionnaires, les ignorer
sous-estimerait pour trois visiteurs sur quatre. Une cinquième langue ne coûtera donc rien au
démarrage des autres, sauf si son dictionnaire devient le plus lourd.

Résultat mesuré au lot 20 : **1 239 699 octets** pour un plafond de 1 300 000. Le total du budget
compte le plus lourd de chaque groupe ; un visiteur anglophone n'en charge AUCUN, donc il paie
1 239 699 − 24 275 (`catalogue-fr`) − 21 345 (`dict-fr`) = **1 194 079 octets**, soit **31 530 de
moins qu'au lot 19** avec deux langues de plus. Ce calcul se refait à chaque build depuis la sortie
de `node scripts/check-startup-budget.mjs` : ne pas recopier ces nombres, les relire.

### Une adresse par langue

L'anglais reste à la **racine** (`/jupiter/`, `/methodology/`) : ses URL sont indexées depuis le
2026-09-10, et une adresse publiée ne se déplace pas. Les autres langues vivent sous leur segment,
donné par `LOCALE_PATH` — `/fr/jupiter/`, `/es/eclipse/2026-08-12/`, `/pt-br/sources/` (le brésilien
s'écrit en minuscules dans une URL).

Trois contraintes, chacune payée au moins une fois ailleurs :

- **`hreflang` doit être RÉCIPROQUE**, `x-default` compris : chaque page nomme toutes ses sœurs,
  elle-même incluse. Un ensemble non réciproque est purement ignoré par Google, donc le travail
  entier serait décoratif sans qu'aucune erreur ne le dise.
- **Le service worker ne doit pas remplacer ces pages par l'app shell** en cache
  (`seo/pwaRouting.ts`). Une éclipse traduite a **trois** segments, et c'est exactement le motif que
  ce module avait déjà manqué une fois.
- **La vignette de partage est PARTAGÉE par les quatre langues** : `seo/socialCard.ts` peint la
  texture du corps, sans un mot de texte. C'est aussi ce qui garde le relevé d'empreinte à 57
  vignettes, la preuve qu'aucune texture n'a bougé.

Les **libellés de faits d'une page** ne viennent PAS du dictionnaire de l'application, et c'est une
correction mesurée : quatre d'entre eux y sont écrits autrement (une fiche a une colonne étroite, une
page a de la place), si bien que les aligner réécrivait l'anglais indexé de 57 pages et de **34
vignettes**. Ils vivent dans `FACT_LABELS` (`seo/bodyLandingPage.ts`), en quatre langues, et
`seo/localisedPages.test.ts` tient leur anglais au caractère près. Le **titre**, lui, vient bien du
dictionnaire, et `seo/titleParity.test.ts` vérifie dans les quatre langues qu'il est identique à
celui que `ui/documentTitle` écrit pendant la navigation.

Enfin, les **noms de mois** d'une page sont écrits en toutes lettres plutôt que lus dans `Intl` : une
page statique doit rendre le même octet sur n'importe quelle machine, et les données ICU bougent avec
la version du moteur.

### Ce que ces règles ne couvrent pas

`public/privacy.html` est une page statique du dossier `public/`, hors du générateur, et reste en
deux langues (français et anglais) : un visiteur hispanophone y lit de l'anglais. C'est un texte de
nature juridique, dont la traduction demande une relecture que ce lot n'a pas eue.

Les traductions espagnole et portugaise ont été produites par Claude et **relues par aucun locuteur
natif**. Ce qu'une machine peut vérifier l'est (nombres, unités, noms propres, gabarits, parité des
clés, existence HTTP des liens) ; ce qu'elle ne peut pas — une tournure, un registre de langue, la
lisibilité d'une phrase scientifique — reste dû.

## Une visite guidée est une FICHE, pas du code (lot 21)

Une visite guidée scénarisée (« Naissance d'une éclipse », « La danse des Galiléennes »…) est une
fiche JSON du registre, `src/registry/tours/{id}.json`, plus son identifiant dans
`src/registry/tours/order.json`. **Ajouter une visite ne touche aucune ligne de TypeScript** : c'est
le même patron de donnée que le registre d'entités, les jeux de tuiles et les champs de hauteur,
prouvé ici une quatrième fois.

Les six pièces, dans l'ordre où une fiche les traverse :

| Pièce | Rôle |
|---|---|
| `src/registry/tours/*.json` | la visite : un titre, une suite d'étapes |
| `src/registry/schema/tour.ts` | le schéma Zod, SEULE déclaration de la forme ; `tour.schema.json` en est généré par `pnpm schema:generate` et comparé octet pour octet |
| `src/registry/tours/index.ts` | l'entrée/sortie : le glob, l'ordre, la conversion pure |
| `src/config/tourScripts.ts` | la façade d'exécution, et la résolution d'un événement |
| `src/core/tourEngine.ts` | le séquenceur PUR qui exécute les étapes |
| `src/ui/tourPlayer.ts` | la carte, le sélecteur, le focus, la localisation |

## Les noms de la surface viennent de l'UAI, et arrivent à l'approche

Trente-six corps du catalogue portent des formations nommées, dont 9 087 pour la seule Lune ; le
total se lit dans `src/config/gazetteerIndex.json` (15 920 au 2026-09-30, après le retrait de douze
doublons que l'UAI publie elle-même, cf. ci-dessous). La seule autorité qui nomme une formation planétaire est le *Working Group for
Planetary System Nomenclature* de l'UAI, et son Gazetteer publie chaque nuit, par corps, un KMZ
qui porte tout ce qu'elle a approuvé. `pnpm gazetteer:generate` le lit ; rien n'est saisi à la
main, et surtout pas une étymologie.

**Trois décisions tiennent ce contrat.**

- **La liste des corps se DÉRIVE** : la page de téléchargement de l'UAI dit lesquels elle couvre,
  et on croise avec `src/registry/entities/`. Ajouter un corps au catalogue amène ses noms ; un
  corps que l'UAI ne couvre pas ne produit pas de fichier vide. C'est la leçon du lot 29.
- **L'index vit dans `src/`, les données dans `public/`**, et ce n'est pas un goût : Vite REFUSE
  qu'un module de l'application importe depuis `public/`. L'application a besoin, AU BUILD, de
  savoir quels corps portent des noms — c'est ce qui lui évite de demander quoi que ce soit au
  démarrage — et pas des formations elles-mêmes. 2 729 octets entrent dans le bundle, 3 174 028 sont
  servis à l'approche, sous 8 rayons apparents, comme les tuiles de surface.
- **L'UAI publie parfois DEUX FOIS la même formation**, sous le même lien de fiche et sans champ
  qui dise laquelle est courante (mesuré le 2026-09-30 : douze identifiants sur Dione, Mars et
  Mercure). Une copie identique est retirée ; une copie DIVERGENTE (Kunisada : deux centres à
  0,16° l'un de l'autre) est tranchée par la FICHE de l'UAI, diamètre puis latitude, et une fiche
  illisible fait échouer le générateur. La longitude de la fiche n'est pas comparée : elle y est
  affichée positive vers l'OUEST. Trouvé par la garde du lot 40.3, qui compte les formations
  observées par identifiant et en voyait une de moins que l'index.
- **La provenance voyage AVEC la donnée**, dans l'index : le registre `src/registry/providers/`
  décrit les sources des FAITS affichés par corps, et sa garde refuse une fiche que rien ne cite.
  La mention de domaine public et la citation sont celles que l'UAI DEMANDE, lues dans sa FAQ.

**LE DÉFAUT QUI NE SE VERRAIT SUR AUCUNE CAPTURE.** L'UAI publie ses KML en longitude **EST de 0 à
360** ; `core/frames.ts` travaille en **EST de −180 à 180**. Les deux sont EST : il n'y a aucun
miroir à appliquer, seulement un repliement, et l'intervalle rendu est semi-ouvert `[-180, 180)`
pour que la couture ne fasse pas dériver un aller-retour de 360°. Un miroir ne déformerait rien et
poserait chaque nom à l'exact opposé de sa formation, sur une sphère qui aurait toujours l'air
juste. `core/gazetteer.test.ts` le croise contre `frames.ts` plutôt que contre un signe deviné.

**Le placement passe par `CelestialObject.surfacePointToWorld`**, donc par la chaîne qui oriente
vraiment la surface à l'instant de la scène — la même que les épicentres de séismes. Reconstruire
la phase autrement redonnerait une longitude indépendante de celle qui est RENDUE.

**Ce que le navigateur a trouvé et que le code ne montrait pas** : une adresse d'actif RELATIVE
résout contre le CHEMIN du corps (`/moon/assets/gazetteer/moon.json`, 404), et le témoin
`data-names` que lit l'e2e gardait la valeur de l'image précédente sur chaque sortie anticipée,
donc il annonçait encore cinq noms après qu'on se soit éloigné.

### Le vocabulaire des étapes est FERMÉ

Une fiche ne porte aucune expression : elle choisit parmi sept formes nommées, exactement comme les
formes déclarées du registre d'entités (`{"$deg": …}`). C'est cette fermeture qui permet à la
donnée de décrire un comportement sans devenir du code.

| Forme | Effet |
|---|---|
| `flyTo` | vole vers un corps ou une cible navigable, par `PlanetNavigation.selectBody` |
| `jumpToDate` | saute à une date déclarée, `{"$date": "…Z"}` |
| `jumpToEvent` | saute à la prochaine occurrence RÉELLE d'un événement, depuis la date courante |
| `setTimeScale` | accélère (ou renverse) le temps, plafonné à ce que le curseur sait représenter |
| `setMode` | bascule l'échelle, `educ` ou `explo` (lot 35) |
| `caption` | une légende localisée ; sans `durationMs` elle attend un geste |
| `wait` | laisse la scène tourner |

**`setMode` est la seule forme ajoutée depuis le lot 21**, et elle suit le patron de `flyTo` :
l'hôte agit, puis le moteur attend un FAIT (`isMorphing`), jamais une durée. Recopier
`MORPH_DURATION_S` ici l'aurait rendue silencieusement trop courte le jour où elle change, et la
légende suivante se serait affichée sur une scène à mi-chemin, c'est-à-dire sur aucune des deux
échelles. **Une visite RESTITUE ce qu'elle emprunte** : `tourPlayer.finish()` remet le mode du
DÉPART, comme il remettait déjà la vitesse, et jamais « éduc » en dur — un utilisateur déjà en
Explo ne doit pas en être sorti par une visite. La preuve qu'une forme n'est pas spéculative est
qu'une fiche s'en serve : « Voyage aux confins » passe en Explo juste avant Sedna, là où la
ceinture cesse d'être une file de points bien rangés.

**`jumpToEvent` est la forme qui a fait disparaître une exception de code.** Jusqu'au lot 21,
`ui/tourPlayer.ts` préfixait un saut de date à la visite dont l'identifiant valait `eclipse` : une
visite n'était donc pas tout à fait de la donnée, et une deuxième visite voulant sauter à une date
réelle aurait exigé une deuxième exception. La date est désormais résolue à l'exécution, depuis
`core/astronomicalEvents.ts`, dont `ASTRONOMICAL_EVENT_KINDS` est le propriétaire unique des
quatorze formes ; le schéma les cite en les important, jamais en les recopiant. **Une date écrite en
dur dans une fiche deviendrait fausse avec le temps ; une date dérivée ne peut pas.**

Le moteur reste sans astronomie : il passe la forme et le corps à l'hôte
(`TourRuntimeHost.jumpToEvent`), et c'est la façade qui résout (`resolveEventDate`). La fenêtre de
recherche s'ÉLARGIT (400 puis 4 000 jours) au lieu de partir large, parce qu'une opposition de Mars
(780 jours de période synodique) sort d'une fenêtre calquée sur l'éclipse. Aucune occurrence trouvée
rend `null`, et l'étape ne saute pas plutôt que de sauter à côté ; un test résout chaque forme citée
par une fiche depuis dix dates de référence étalées sur une décennie, pour que ce cas reste
théorique.

### Le texte d'une visite suit la voie des quatre langues

Les légendes et les titres sont des blocs localisés à QUATRE langues obligatoires, comme partout
dans le registre depuis le lot 20. Ils passent donc par la même dérivation : le navigateur ne reçoit
que l'anglais des fiches, les trois autres langues arrivent dans la carte de leur langue
(§ « Quatre langues, une seule chargée »). Avant ce lot, les neuf légendes et les trois titres des visites étaient
écrits dans `config/tourScripts.ts`, donc **les quatre langues partaient chez tous les visiteurs** :
faire de la visite une donnée l'a allégée au lieu de l'alourdir.

Le prix à payer est nommé : le texte du registre passe par **cinq listes de dossiers tenues à la
main** (le greffon `deriveRegistryText` de `vite.config.ts`, `TEXT_ROOTS` de
`config/catalogueText.ts`, `scripts/localized-fields.mjs`, `src/registry/registryText.test.ts`, et
la découverte de `config/catalogueText.test.ts`), et **aucune n'échoue bruyamment si on l'oublie**.
D'où la garde du lot : `src/config/catalogueText.test.ts` confronte la carte livrée aux fiches du
DISQUE dans les deux sens, en DÉCOUVRANT les dossiers plutôt qu'en les listant. Elle a immédiatement
dénoncé un défaut réel, décrit ci-dessous.

### Le défaut qu'elle a trouvé : `Object.values` d'une `Map` est vide

`hydrateLocalized` traversait tableaux et objets, pas les `Map`. Or `NAVIGABLE_TARGETS` et
`NAVIGABLE_BODIES` sont des `Map` : les **14 objets d'instrument** (11 sondes, 3 interstellaires)
lisaient donc l'ANGLAIS dans les trois autres langues, alors que leur traduction était bel et bien
téléchargée dans la carte. Mesuré le 2026-09-28 : **0 bloc reposé au lieu de 28**. Le défaut est né
avec la dérivation du lot 20 et n'était visible que dans le navigateur, puisqu'en test les fiches ne
sont pas allégées. `core/registryText.ts` traverse maintenant une `Map`, et deux gardes le tiennent
(une unitaire dans `src/registry/registryText.test.ts`, une d'intégration dans
`src/config/catalogueText.test.ts`), chacune falsifiée séparément.

## Quelles missions ont étudié ce corps (lot 40)

L'application savait **où** est une sonde à une date (trajectoires Horizons, lot 8) et, depuis le
lot 37, **nommer** une formation. Elle ne savait pas dire ce qui est venu ici, ni quand. Elle le
dit maintenant, sur la fiche de chaque corps : **112 missions distinctes**, dont **48 corps sur 58
en déclarent au moins une**, et les dix autres portent la phrase qui l'explique.

**La source est le registre de contexte du Planetary Data System**, interrogé par
`pnpm missions:generate`, et elle a été choisie après mesure, pas par élimination :

- **il fédère cinq espaces de noms sous une seule API** — `urn:nasa:pds`, mais aussi
  `urn:esa:psa` (BepiColombo, JUICE, Mars Express, Rosetta, Venus Express, ExoMars),
  `urn:jaxa:darts` (Hayabusa2), `urn:isro:isda` (Chandrayaan-1) et `urn:kari:kpds`. La priorité
  ESA du projet est donc servie sans seconde source. **Cette liste est DÉRIVÉE** des identifiants
  livrés : ma version écrite à la main en oubliait deux, et c'est la garde qui l'a dit ;
- **la cible d'une investigation est complète** : Voyager y déclare 55 cibles, dont les cinq
  grandes lunes d'Uranus et les quatre de Neptune ;
- **une seule requête rend tout le registre**, donc le relevé ne dépend pas de 112 disponibilités.

**CE QUE LE BLOC AFFIRME, ET RIEN DE PLUS.** Le PDS déclare des **cibles**, c'est-à-dire ce dont
l'archive d'une mission parle ; ce n'est pas un relevé d'observations. La formulation du bloc le
dit, et il faut qu'elle le dise : le registre déclare « Near Earth Asteroid Scout » sur
**16 Psyché**, alors que cette mission visait un géocroiseur et n'a jamais été contactée après son
lancement. C'est très probablement une erreur de métadonnée du PDS — elle n'est pas corrigée en
silence, parce qu'une correction inventerait un jugement que la source ne porte pas.

### Trois choses que la mesure a trouvées, et qu'aucune relecture n'aurait données

**`pds:Investigation.pds:start_date` N'EST PAS UNE DATE DE LANCEMENT.** Le registre fait commencer
« Voyager » le **1972-07-01**, alors que Voyager 2 a décollé le **1977-08-20** selon notre propre
registre des sondes. C'est le début du **projet**. Nommer ce champ « lancement » aurait publié une
affirmation fausse, et c'est le croisement avec nos `launchDate` qui l'a dit. Le témoin est
permanent : `src/config/missions.test.ts` exige que les deux dates DIFFÈRENT, pour que personne ne
« corrige » un jour l'une vers l'autre en croyant réparer une incohérence.

**DEUX FAÇONS DE NE PAS DÉCLARER UNE FIN, et elles se ressemblent exactement.** **36 des 112
investigations ne déclarent aucune fin** : sur les 113 LIGNES servies, 31 rendent `null` et 6
rendent la sentinelle `3000-01-01`, l'écart d'une unité étant Venus Express, servie en deux lignes
portant chacune une des deux formes. Aucune des deux ne veut dire « toujours en
cours » : Venus Express porte la sentinelle alors que la mission s'est terminée en 2014, et
Venera 4 rend `null` alors qu'elle s'est tue en 1967. Livrer la sentinelle telle quelle aurait
affiché « de 2018 à l'an 3000 » ; en déduire « en cours » aurait affiché une sonde soviétique
encore active. `core/missions.ts` a donc un **quatrième état**, `startedEndUndeclared`, et c'est le
seul qui compte vraiment : l'application ne sait pas, et c'est cela qu'elle dit.

**LE REGISTRE SE CONTREDIT LUI-MÊME SUR UN PRODUIT.**
`urn:esa:psa:context:investigation:mission.venus_express` arrive en **deux lignes**, sous le même
`lidvid` `::1.1`, l'une portant la sentinelle et l'autre `null` ; et `summary.hits` a rendu 113
puis 112 à une heure d'intervalle pour le même contenu. Deux lignes d'un même identifiant sont donc
fusionnées, **mais seulement si elles disent la même chose une fois normalisée** — ce qui est le cas
ici, les deux formes de « pas de fin déclarée » se réécrivant `null`. Un désaccord réel fait
ÉCHOUER le générateur : choisir entre deux versions divergentes serait arbitraire, et l'arbitraire
n'a pas sa place dans un chiffre publié. Le chiffre publié est donc celui des **missions**, pas
celui des lignes.

### L'appariement corps ↔ cible ne se devine pas

Deux règles, et un **accord de classe exigé dans les deux cas** :

- le segment terminal de l'identifiant PDS doit être un corps du catalogue
  (`satellite.jupiter.europa` → `europa`), ou, pour un petit corps, être préfixé de la désignation
  SBDB que `scripts/fact-source-targets.json` DÉCLARE déjà (`16_psyche`, `1p_halley`) ;
- et le `pds:Target.pds:type` publié doit égaler le `targetClass` de la fiche, une fois mis en
  minuscules et l'espace remplacé par un souligné (`Dwarf Planet` → `dwarf_planet`).

Sans ce second accord, « 106 Dione » l'astéroïde s'apparierait à Dione la lune de Saturne. Un
désaccord **échoue**, il ne se saute pas en silence, et la falsification est faite : changer le
`targetClass` de Triton fait sortir le générateur en code 1.

Tout ce qui ne s'apparie pas est **imprimé, groupé par type publié**, et c'est un inventaire à lire :
50 satellites, 17 astéroïdes, 11 comètes et un objet transneptunien que le catalogue n'a pas — 67P,
Arrokoth, Didymos, Lutetia, Gaspra, Mathilde, Steins, les Troyens de Lucy.

### Zéro octet au démarrage, mesuré

| | |
|---|---|
| Index (`src/config/missionIndex.json`) | morceau séparé, **hors** clôture de démarrage (`NON_BOOT_CHUNKS`) |
| Listes (`public/assets/missions/{corps}.json`) | 48 fichiers, servis à l'ouverture d'une fiche |
| Adresse | **ABSOLUE**, parce que le corps est porté par le CHEMIN de l'URL |

Un corps que l'index donne à zéro ne déclenche **aucune** requête : son fichier n'existe pas, et
demander pour recevoir un 404 serait une requête de trop. L'adresse absolue n'est pas un détail :
`assets/missions/titan.json` résoudrait en `/titan/assets/missions/titan.json`, c'est-à-dire le
défaut exact que le lot 37 a payé dans un vrai navigateur. `e2e/missions.spec.ts` le prouve en
exigeant une réponse **200 sur la liste elle-même**, et la falsification est faite : rendre
l'adresse relative fait rougir deux scénarios.

**UN CORPS À ZÉRO MISSION ET UNE SONDE NE SE RESSEMBLENT PAS, et `config/missions.ts` les
distingue.** La fiche s'ouvre aussi pour une sonde et pour un objet interstellaire
(`config/navigable.ts`), et l'index ne porte que les corps du catalogue. Rendre une liste vide pour
Voyager 1 afficherait « aucune mission ne déclare ce corps », ce qui n'a aucun sens pour une sonde :
une mission n'est pas la CIBLE d'une archive, elle en est l'auteur. `loadMissions` rend donc une
liste (même vide) pour un corps, et `null` quand l'index n'a pas d'entrée — le bloc reste alors
masqué. Falsifié : sans la distinction, le scénario de la sonde rougit.

**AUCUNE LICENCE N'EST REVENDIQUÉE POUR CETTE DONNÉE, et c'est une décision.** L'index avait
d'abord été écrit avec `rights: "public-domain"` pointant la page de citation du PDS. Cette page,
LUE le 2026-09-30, ne dit rien de tel : elle donne des consignes de citation, aux fournisseurs
comme aux réutilisateurs. Les pages de politique du site (`/home/policies/`, `/about/`,
`/home/faq/`) rendent 404, et le lien « Privacy / Copyright » de son pied de page mène à la page de
confidentialité de la NASA, qui ne traite pas de la réutilisation. L'index publie donc ce qu'il
peut POINTER — `citingGuidance` — et la garde `src/config/missions.test.ts` **exige que `rights`
reste absent**, pour qu'une licence devinée ne revienne pas par la porte de derrière.

**Le compte par corps est dans l'inventaire dérivé** (`pnpm inventory:gaps`, colonne `missions`),
avec `aucune` distinct de `HORS INDEX` : zéro mission est une réponse mesurée, une entrée absente
est un générateur qu'on a oublié de relancer. **Et la source est surveillée** comme les autres :
`pnpm sources:health` DÉRIVE l'URL de l'API depuis l'index lui-même, et son marqueur se DÉRIVE à
son tour de la classe que la requête interroge (`pds:Investigation.pds:name` ici,
`pds:Instrument_Host.pds:name` pour le lot 42) — parce que cette API rend **HTTP 200 avec zéro
résultat** quand la requête ne correspond à rien, 60 octets d'apparence parfaitement normale, même
classe de piège que la page d'erreur du NSSDCA servie en 200. Le marqueur était écrit en dur
jusqu'au lot 42, matché sur le seul PRÉFIXE de l'URL : une seconde requête sur une autre classe
aurait donc été déclarée MUETTE alors qu'elle répond, et un guetteur qui crie au loup finit ignoré.

## Ce qu'une sonde embarque, et où elle a servi (lot 42)

Le lot 40 répond « qu'est-ce qui est venu ICI » sur la fiche d'un CORPS, et **il y laisse un trou
qu'il nomme lui-même** : « une mission n'est pas la cible d'une archive, elle en est l'auteur »
(`src/config/missions.ts`), donc le bloc « Missions » reste masqué sur la fiche d'une SONDE, qui
n'avait alors que son nom, sa description et ses quatre faits de lancement. Le même registre de
contexte du PDS déclare pourtant ses INSTRUMENTS. C'est ce que ce lot publie.

**Le chemin des données.** `pnpm instruments:generate` écrit `src/config/instrumentIndex.json` (les
comptes par sonde, importé DYNAMIQUEMENT, hors clôture de démarrage) et
`public/assets/instruments/{sonde}.json` (la liste, servie à l'ouverture d'une fiche). Rien n'est
demandé au démarrage. Les modules : `core/instruments.ts` (pur, ordre et regroupement par porteur),
`config/instruments.ts` (façade), `ui/instrumentsBlock.ts` (le bloc de fiche).

**L'état d'une investigation dans le temps N'EST PAS redéfini.** Une investigation a exactement la
forme d'un `MissionRecord`, et `missionStanding` de `core/missions.ts` répond déjà, avec son
quatrième état pour celles qui ne déclarent aucune fin. Une seconde horloge aurait fait diverger
deux réponses à la même question.

**LA JOINTURE EST DÉCLARÉE, PAS DEVINÉE**, et le champ qui aurait servi de clé ne peut pas en être
une : mesuré le 2026-09-30 sur les 130 porteurs de type « Spacecraft »,
`pds:Instrument_Host.pds:naif_host_id` rend **17 fois un NOMBRE** (Hayabusa2 « -37 »), **86 fois un
MNÉMONIQUE** (Voyager 1 « VG1 »), **26 fois `null`** et **UNE fois la phrase littérale « not
applicable »**. Les cibles vivent donc dans `scripts/pds-archive-targets.json`, jamais dans la fiche
du registre (que le bundle client charge) ni dans le script (un script ne déclare pas ses cibles).
Le générateur CROISE ce qui y est déclaré : le produit doit exister, son type doit être
« Spacecraft », et **quand `naif_host_id` EST numérique il doit être ÉGAL au `identifiers.naif` de la
fiche** — exercé sur donnée réelle par Hayabusa2 et OSIRIS-REx. Le type se LIT et ne se déduit pas
du segment de l'identifiant : `instrument_host:spacecraft.insight` porte « spacecraft. » et le type
publié « Lander », et c'est sur ce produit que la garde a été falsifiée.

**LA JOINTURE EST ASYMÉTRIQUE, ET UN SEUL SENS PERD UNE MISSION.** L'investigation `mission.apex`
(OSIRIS-APEX, l'extension vers Apophis) déclare `spacecraft.orex` parmi ses porteurs, alors que le
produit `spacecraft.orex` ne déclare PAS `mission.apex` parmi ses investigations. Sur nos onze
porteurs c'est le seul désaccord, et il vaut une mission entière : le générateur prend l'**union des
deux sens** et IMPRIME l'asymétrie, parce qu'une contradiction de la source est une information.

**« PHASE » EST LE MAUVAIS MOT, et c'est la mesure qui l'a dit.** Une sonde est citée par une à
trois investigations : New Horizons en a bien trois (la mission, puis KEM1 et KEM2, ses deux
extensions Kuiper) et OSIRIS-REx deux, mais la SECONDE de Voyager 2 est « Comet D/1993 F2
(Shoemaker-Levy 9) Collision into Jupiter », une CAMPAGNE d'observation et non une phase de
Voyager 2. On publie donc « investigations », le mot de la source. Un témoin permanent l'exige.

**UN INSTRUMENT NE PUBLIE AUCUN TYPE**, mesuré sur cinq produits de trois agences : la classe
`pds:Instrument` ne sert que `name`, `description`, `naif_instrument_id` et `serial_number`. Il n'y
a rien à classer, et un type ne sera pas inventé. Le `naif_instrument_id` porte la même plaie que
celui du porteur et n'est publié **que lorsqu'il est numérique**.

**CE QUI N'EST PAS LIVRÉ : la description de chaque instrument.** Elle existe, elle est riche, et
elle n'existe qu'en ANGLAIS. Un nom d'instrument est un nom propre, publié tel quel dans les quatre
langues comme le bloc « Missions » publie « Lucy MIssion » sans le corriger ; un PARAGRAPHE de prose
anglaise sous une interface portugaise serait une régression, et le traduire serait inventer. Le
`lid` cite la fiche du PDS, qui la porte.

**DEUX SONDES SUR ONZE SONT ABSENTES DU REGISTRE, ET ELLES LE DISENT.** Parker Solar Probe et le
JWST : aucune des 113 investigations ne les nomme, et leurs identifiants plausibles rendent HTTP 404
alors que `spacecraft.vg1` rend 200 (témoin). Leur bloc AFFICHE la mesure au lieu de se masquer, ce
qui est une décision : un visiteur qui passe de Cassini à Parker verrait sinon un bloc disparaître
sans savoir pourquoi. Sa note est propre à ce cas, et c'est la relecture du rendu qui l'a exigée :
la note ordinaire promettait « ce que cette sonde embarque » et « l'identifiant sous chaque nom en
est la citation » sous un bloc qui venait de dire que l'archive ne déclare rien. La phrase elle-même
ne NOMME ni ne GENRE rien, « cette mission » serait faux pour le JWST, qui est un observatoire.

**BEPICOLOMBO EST TROIS ENGINS** sous une seule investigation (MPO, MMO, MTM). Un porteur qui ne
déclare AUCUN instrument garde sa place dans le rendu : c'est MMO, et le masquer ferait disparaître
un tiers de la sonde. Le nom du porteur n'est montré que quand la sonde en a plusieurs.

**UNE BOUCLE DE 500 ms, TROUVÉE EN RELISANT LE DIFF COMMITÉ ET MESURÉE.** Quand la réponse est
« rien à montrer », `sync` la redemandait toutes les 500 ms, indéfiniment — donc sur les 58 corps du
catalogue, qui sont le cas commun. Compteur temporaire : **19 appels en 10 s avant, 0 après**, une
seule chose changée entre les deux séries. La même structure vit dans `missionsBlock` depuis le
lot 40, où elle frappe les 11 sondes, et elle est corrigée aux DEUX endroits. La variable ne retient
que le cas VIDE, et c'est un choix : un drapeau « la réponse est arrivée » confronté à `!state`
introduirait un défaut, parce que le retour à la vue globale efface `state` sans rien dire de
l'archive. **Le chemin qui discrimine a demandé trois essais et deux mesures** : `toBeHidden()` est
vrai dès qu'un ANCÊTRE est masqué, et seul le retour à `#orbit-overview` remet le corps courant à
`null` — ouvrir la palette masque la fiche par l'autre mécanisme en gardant `currentBody()`. Sans ce
détour, la variante boguée passe les six scénarios de chaque fichier.

**LES GARDES, ET CE QU'ELLES ONT TROUVÉ.** `src/core/instruments.test.ts`,
`src/config/instruments.test.ts` (sept falsifications, toutes rouges), `e2e/instruments.spec.ts`,
quatre scénarios axe + 390 px sur la fiche d'une SONDE (`e2e/a11y-audit.spec.ts` : les scénarios
existants ouvrent la fiche d'un CORPS, où ce bloc est masqué, donc il n'aurait jamais été audité),
et la colonne `instruments` de `pnpm inventory:gaps`, où `absente (raison ecrite)` est distinct de
`HORS INDEX`. **Deux angles morts d'une garde du lot 40 ont été trouvés et corrigés en passant** :

- **la garde d'adresse absolue ne prouvait rien**, parce qu'elle bootait sur `?body=titan`, donc à
  la racine, où une adresse relative résout au même endroit qu'une absolue. Mesuré : un CORPS garde
  son chemin après le boot (`/titan/?mode=educ…`), une SONDE est normalisée vers la racine
  (`/?body=voyager1`), donc seul le boot par le CHEMIN d'un corps rend ce test falsifiable. Il l'est
  désormais, et il rougit. Corollaire pour ce lot : la même garde ne peut PAS exister pour une
  sonde, et son scénario le dit au lieu de le prétendre (**SUPERSEDED le 2026-10-03** : la sonde a
  sa page et GARDE son chemin, et la garde de `e2e/instruments.spec.ts` rougit désormais avec une
  adresse relative, falsifié) ;
- **`#body-info` est en `overflow-x: hidden`**, donc un texte trop large y est ROGNÉ et la fiche
  rapporte `scrollWidth === clientWidth` comme si tout allait bien : mesuré, un identifiant PDS
  débordant de 70 px laissait la fiche à 286 contre 286. La mesure du débordement est donc ÉLÉMENT
  PAR ÉLÉMENT, les `.sr-only` exclus parce que leur texte dépasse toujours de 179 à 213 px selon la
  langue. Le plus long identifiant rendu mesure **236 px dans une boîte de 250, soit 14 px de
  marge** : la coupure du mot est donc à la limite de porter, et la garde le prouve dès que la
  police s'élargit de plus que cette marge.

## Quels orbiteurs ont observé cette formation (ligne 40.3)

La fiche d'un corps qui porte des noms de l'UAI a un bloc « Formations observées » : pour une
formation nommée, les instruments en orbite dont une empreinte la touche, combien de fois, de quand
à quand, et l'étiquette PDS de la première observation, qui en est la source primaire. Les comptes
(formations observées, produits lus, jeux indisponibles) ne sont pas recopiés ici : ils se lisent
dans `src/config/placeObservationIndex.json`, que `pnpm places:generate` écrit.

**La source est l'Orbital Data Explorer** (PDS Geosciences Node, Washington University). Le
registre PDS4 ne peut pas répondre : son API n'accepte aucune conjonction et ne sert aucune
empreinte imagée (mesuré sur sept corps). L'ODE couvre QUATRE corps, la Lune, Mars, Mercure et
Vénus ; les trente-deux autres corps nommés le disent sur leur fiche, en nommant les corps couverts
LUS dans l'index, au lieu de masquer le bloc.

**La forme est l'inverse d'une requête.** L'ODE exige un jeu (hôte, instrument, type de produit) à
chaque question, donc « qu'est-ce qui a vu Tycho » s'éventaille sur 126 jeux lunaires, et le
pré-calcul formation par formation coûterait des mois. On tire donc les empreintes UNE fois, jeu par
jeu (`pnpm places:pull`, dans `.cache/ode-footprints/`, reprise possible), et on croise hors ligne
(`pnpm places:generate`). La géométrie vit dans `src/core/placeObservation.ts`, avec ses tests ; le
générateur l'importe par `ssrLoadModule` et ne la recopie pas.

**Ce que la mesure a imposé, et qu'il ne faut pas défaire :**

- **Le véhicule est `query=coveragetargz`**, un shapefile dont la table porte identifiant, date et
  étiquette. `results=x` est mono-produit selon le manuel ; `results=m` coûte quatre fois plus et
  sert de REPLI, parce que l'export shapefile de MGS MOC ne répond pas (600 s, pas même vingt
  produits) alors que ses métadonnées portent la géométrie en WKT.
- **Une page porte trois types de formes** : des surfaces (`_ga`), des traces au sol (`_gl`, les
  sondeurs radar) et des points (`_gp`, les spectromètres). Chacun se juge à sa façon : une surface
  contient ou touche, une trace passe à moins d'un rayon, un point tombe dans le disque. Une ligne
  ne CONTIENT rien, et la règle pair-impair lui ferait dire n'importe quoi.
- **Le croisement se fait sur les POLYGONES, jamais sur les bornes** : pour une empreinte qui
  traverse le méridien 0, les bornes de la table sont ambiguës (349° ou 10° de large). Le fichier
  `ga` découpe SOUVENT ces empreintes en plusieurs enregistrements, regroupés par `ODEId`, mais PAS
  toujours : un anneau de la caméra HDTV de Kaguya va de 348° à 353° puis à 5°. Lu tel quel dans le
  plan, ce triangle de 17° couvrait presque toutes les longitudes, « contenait » Copernic et
  l'antipode de Tycho. Un anneau dont un côté saute de plus de 180° (et de moins de 359,5°, un tour
  complet n'étant pas une traversée) est donc DÉROULÉ, et le déroulé n'est retenu que s'il est plus
  étroit que l'original. Trouvé par le contrôle des bornes ci-dessous, pas par une relecture.
- **Les grandes formes sont INDEXÉES** (segments par rangée de latitude et par cellule de 1°), à
  partir de 64 sommets : une carte micro-onde de Chang'e (1 014 sommets, 8 838 formations
  candidates) coûtait 600 ms par produit, soit une cinquantaine d'heures pour la Lune, contre
  20 minutes indexée (1 191 s, mesuré sur le croisement final). L'index ne change pas le test, et une garde compare ses verdicts à ceux du
  parcours complet sur des formes tirées au hasard.
- **Un contrôle INDÉPENDANT tient le croisement** : pour une formation de rayon r, le compte que
  l'ODE rend dans la boîte INSCRITE dans son disque (demi-côté r/√2) est un plancher, celui de la
  boîte qui le CIRCONSCRIT un plafond, pour un imageur sans grille globale. Le mien doit tomber
  entre les deux ; c'est ce contrôle qui a vu le défaut du méridien, dans les deux sens à la fois.
  Après correction, il tient sur sept des huit couples mesurés (Tycho, Copernic, Jezero, Gale ; LROC
  ou HiRISE et CTX, HDTV). Le huitième, HDTV à Tycho, dépasse le plafond de 41 produits sur 3 673
  (1,1 %), et l'écart est LU, pas supposé : ce sont des empreintes dont un côté longe -42,9° de 340°
  à 2° en traversant la couture, à 11 km du centre du cratère, donc dans son disque ; la boîte de
  l'ODE, qui coupe ce même côté, ne les rend pas, signe qu'elle lit ce côté par le long chemin.
- **Un produit qui couvre aussi l'antipode d'une formation ne l'observe pas.** À Tycho, 30 450 des
  37 338 produits que l'ODE rend pour la boîte du cratère rendent le même compte à l'antipode : ce
  sont des grilles globales. La règle est posée PAR PRODUIT, dérivée de sa géométrie, sans liste de
  types exclus. Elle ne vaut que pour une surface : une trace qui passe sur un lieu puis sur son
  antipode les a observés tous les deux.
- **Un type de produit redondant n'est pas tiré**, et la redondance se MESURE : par instrument, un
  type est redondant si au moins vingt de ses images d'une même journée sont toutes déjà dans les
  types gardés. « Le plus gros type par instrument » aurait été faux : THEMIS range IR et VIS, et
  MOC ses deux caméras, sous une même étiquette d'instrument.
- **Le gel de l'ensemble tiré est un jour FINI** : l'ODE lit `maxcreationtime=AAAA-MM-JJ` comme la
  fin de ce jour, et `maxcreationtime` seul est ignoré sans un mot (il faut la paire). Et **le gel
  exclut les produits sans date de création** : tout Viking Orbiter comptait zéro sous le gel. Un
  jeu dont le compte change sous le gel n'est donc pas gelé (`unfrozen.json`), ce qui est sans
  risque pour des missions finies.
- **Un jeu que l'ODE ne sert par aucune route est DÉCLARÉ**, pas tu : le tirage le note dans
  `unavailable.json` avec l'erreur mesurée, et l'index le publie.

**Livraison.** Les observations sont servies en MORCEAUX (`/assets/place-observations/{corps}/{k}.json`,
`k = iauId % shards`, le nombre de morceaux étant dérivé du poids) : une formation demandée ne fait
pas payer le fichier entier de la Lune. L'index est importé dynamiquement (`NON_BOOT_CHUNKS`), les
noms ne sont chargés qu'à l'ouverture du bloc, et rien n'est demandé au démarrage. L'adresse est
ABSOLUE, parce que la Lune garde son chemin (`/moon/`) après le boot ; `e2e/places.spec.ts` le
prouve par le `content-type` du morceau servi.

**Pourquoi un champ et non un clic sur la carte** : les noms du gazetteer sont écrits sur un canvas,
qu'aucun clavier ni lecteur d'écran n'atteint. Un `<input>` relié à une `<datalist>` est natif.

**Ce que ce bloc ne prouve pas** : une empreinte qui TOUCHE une formation n'est pas une image qui la
montre bien (angle, éclairage, résolution). Le bloc dit « observations », au sens de l'ODE, et
cite l'étiquette de chacune pour qu'on aille voir.

**Gardes** : `src/core/placeObservation.test.ts` (géométrie), `src/config/placeObservations.test.ts`
(donnée livrée : index complet, morceaux, identifiants présents au gazetteer, dates, sources https),
`src/config/gazetteer.test.ts` (aucun identifiant UAI en double), `src/config/sourceHealth.test.ts`
(l'ODE rend ses erreurs en HTTP 200 avec `"Status": "ERROR"`), `e2e/places.spec.ts`, et l'audit à
390 px de `e2e/a11y-audit.spec.ts` dans les quatre langues.

## Ce qu'on savait d'un corps à une date (lot 44, ligne 22.10)

Premier pas de la **timeline du SAVOIR**. La fiche de chaque corps porte un bloc « Découverte » :
ce que les sources primaires déclarent de sa découverte, avec la source et la date de lecture de
chaque affirmation ; ce qu'on en savait **à la date de la scène** ; et, pour Mars, Jupiter,
Saturne, Uranus, Neptune et Pluton, **combien de leurs lunes on avait déjà vues**, et la
découverte suivante. La question du réservoir de vision, « que savait-on de Jupiter en 1609, en
1610 », se pose donc en déplaçant l'horloge : zéro lune en 1609, une borne de zéro à quatre en
1610, quatre en 1611.

**CE N'EST PAS UN TRAVAIL DE BIBLIOGRAPHIE, et c'est la mesure qui l'a dit.** Le réservoir de
vision décrivait cette timeline comme une recherche par corps, chaque phrase demandant sa source.
La mesure du 2026-10-01 a trouvé que la découverte est DÉCLARÉE, champ par champ, par trois
sources primaires dont deux étaient déjà des sources du dépôt :

| Source | Ce qu'elle déclare | Corps couverts |
|---|---|---|
| JPL SSD, *Planetary Satellite Discovery Circumstances* | année, découvreurs, référence UAI, pour **chaque** satellite reconnu | les 30 lunes du catalogue hors la Lune, et les 460 satellites des six systèmes |
| JPL SBDB, `discovery=1` | jour, découvreurs, lieu | les 19 petits corps |
| JPL SBDB, `sat=1` (pas 2, ci-dessous) | année de découverte, référence, confirmation, par satellite | les petits corps qui ont une lune hors de la table du JPL (sept au 2026-10-02 ; la liste se lit dans `pnpm inventory:gaps`) |
| NSSDCA, fiches planétaires | `Discoverer`, `Discovery Date` | Uranus, Neptune, Pluton ; « Prehistoric » pour les cinq planètes visibles à l'œil nu |

Deux affirmations qu'aucune table ne déclare sont **citées mot pour mot** et retrouvées dans la
page servie à chaque génération, sans quoi le générateur échoue : la Lune (JPL, « known to mankind
since ancient times ») et Halley (NASA Science, ci-dessous). Le Soleil et la Terre sont **sans
objet**, raison écrite dans `scripts/discovery-targets.json` : aucune des sources ne leur attribue
de découverte, et la fiche du NSSDCA, qui en déclare une pour chaque autre planète, n'en porte
aucune pour la Terre. Leur bloc ne s'affiche pas ; l'inventaire dérivé, lui, le dit.

### Un corps ne porte pas une date, il porte des AFFIRMATIONS

C'est ce que la mesure a imposé, sur trois cas réels qu'une date unique aurait trahis :

- **une source qui ne donne que l'ANNÉE** (la table du JPL) : une année vaut l'année entière, et
  l'application ne prétend pas savoir quel jour de 1655 Huygens a vu Titan ;
- **une ligne qui porte DEUX années** : Thémisto « 1975, 2000 » (vue, perdue, retrouvée), Janus
  « 1966, 1980 », Épiméthée « 1977, 1980 ». Les deux sont publiées, aucune n'est choisie ;
- **deux sources qui divergent** : Pluton est découverte le **1930-01-23 selon SBDB** et le
  **1930-02-18 selon le NSSDCA**. La fiche montre les deux, et aucune explication n'est écrite de
  mémoire.

Une seule règle les couvre (`core/discovery.ts`, pur et testé) : avant la PREMIÈRE date publiée, le
corps n'était pas encore connu ; après la DERNIÈRE, il l'était ; entre les deux, la réponse dépend
de la source, et la fiche le dit au lieu de trancher. Le compte des lunes suit la même logique et
devient une **borne** (« entre 9 et 10 sur 293 » pour Saturne en 1972, à cause de Janus), jamais un
nombre inventé.

### Quatre choses que la mesure a trouvées

**LA DATE DE MISE À JOUR DE LA PAGE DU JPL MENT.** Elle se dit « last updated 2023-May-23 » et
recense une lune d'Uranus découverte en **2025**. La date publiée est donc celle de LECTURE, qui
appartient à la réponse (lot 25) ; le générateur imprime l'écart, et la garde refuse que cette date
déclarée soit jamais livrée.

**LE MOT « DÉCOUVERTE » D'UNE SOURCE NE VEUT PAS TOUJOURS DIRE DÉCOUVERTE.** SBDB fait découvrir
Halley le **1758-12-25 par Palitzsch**. Publier « découverte en 1758 » serait faux pour tout
lecteur, et le corriger de mémoire est interdit. NASA Science écrit que Halley avait prédit le
**retour** de la comète en 1758, et qu'elle a été rattachée à des observations de plus de deux mille
ans : le générateur exige que l'année citée soit celle de SBDB, puis requalifie cette date en
**retour prédit**. Le champ `first_obs` de SBDB, qui aurait pu servir de témoin interne, n'est que
le début de l'arc de l'orbite ajustée (Cérès : 1995) : inutilisable, et c'est mesuré.

**LE COMPTE DE LA TABLE EST CELUI QUE LA FICHE AFFICHE DÉJÀ.** 115 pour Jupiter, 293 pour Saturne,
29 pour Uranus, exactement les nombres de NASA Science. La garde
`src/config/discovery.test.ts` exige l'égalité : deux nombres différents sur une même fiche
seraient une contradiction visible, et le jour où l'une des sources avance sans l'autre, elle
rougit et oblige à relire les deux.

**CE QUE CE COMPTE NE DIT PAS, et la fiche l'écrit sous lui** : la table ne recense que les
satellites reconnus AUJOURD'HUI. Une lune annoncée puis réfutée n'y figure pas, donc ce n'est pas
ce que l'on CROYAIT à une date, mais ce que l'on avait déjà vu de ce qui est reconnu aujourd'hui.
Une timeline des croyances, réfutations comprises, demanderait une autre source, que rien ne
publie sous forme de table.

### Rien au démarrage, et le lot a fait de la place

| | |
|---|---|
| Index (`src/config/discoveryIndex.json`) | morceau séparé, **hors** clôture de démarrage (`NON_BOOT_CHUNKS`) |
| Satellites (`public/assets/discovery/{parent}.json`) | 6 fichiers, servis à l'ouverture de la fiche du parent |
| Adresse | **ABSOLUE**, pour la raison du lot 37 ; `e2e/discovery.spec.ts` boote par le CHEMIN (`/jupiter/`), la seule forme sous laquelle une adresse relative casserait, et rougit si on la rend relative (falsifié) |

**LES QUATRE BLOCS DE FICHE SONT SORTIS DU DÉMARRAGE.** Le lot 43 avait laissé 22 063 octets de
marge au budget JavaScript, et le bloc « Découverte » en coûtait environ huit mille. Or les blocs
Découverte, Missions, Instruments et Formations observées n'agissent pas avant qu'une fiche
existe : ils interrogent `bodyInfo.currentBody()` et restent masqués tant qu'il rend `null`.
`ui/cardBlocks.ts` les regroupe donc en un morceau chargé à la **première** ouverture d'une fiche,
retenté s'il échoue. Le nombre exact se lit dans `pnpm budget:startup`, il ne se recopie pas ici ;
au moment de ce lot, la marge est remontée au-dessus de ce qu'elle était avant lui.

### Les gardes, et leur falsification

- `src/core/discovery.test.ts` : l'année entière, les deux années de Janus, le désaccord de Pluton,
  l'Antiquité qui l'emporte sur un retour prédit, la borne du compte (1609, 1610, 1611, Thémisto).
- `src/config/discovery.test.ts` : chaque corps a des affirmations ou une raison écrite ; chaque
  lune du catalogue est dans la section de son parent ; le compte égale celui de la fiche ; les
  deux années, les deux dates de Pluton et la requalification de Halley restent livrées. **Quatre
  falsifications de la donnée, quatre rouges** : Halley non requalifié, une lune de Jupiter en
  moins, un corps oublié, Pluton arbitré.
- `e2e/discovery.spec.ts` : rien au démarrage, Jupiter en 1609 puis 1611, Titan avant et après
  1655, Pluton entre ses deux dates, Halley, la Terre masquée avec le détour par la vue globale du
  lot 42. **Deux falsifications du produit, deux rouges** : l'adresse relative, et l'horloge de la
  scène ignorée. Une troisième est restée verte, et c'était la falsification qui était mal posée :
  le premier rendu ignorait la date, et la synchronisation suivante, qui compare le jour rendu au
  jour de la scène, le corrigeait aussitôt.
- `e2e/a11y-audit.spec.ts` : Pluton en février 1930 (la seule fiche qui exerce tout le bloc) dans
  les quatre langues, et Neptune pour le découvreur le plus long, à 390 px, axe et débordement
  élément par élément.
- **Lire le rendu a trouvé un défaut** : la date et le découvreur n'étaient séparés que par une
  marge CSS, si bien que le texte de la ligne était « 1930Tombaugh », et c'est ce qu'un lecteur
  d'écran prononce. Un vrai séparateur est inséré, et le scénario de Pluton refuse qu'une année
  touche une lettre.

`pnpm discovery:generate` (`--offline`, `--check`, cache partagé avec le relevé des faits),
`pnpm inventory:gaps` (colonne `decouverte`, où `sans objet (raison ecrite)` est distinct de
`HORS INDEX`), et `pnpm sources:health`, qui DÉRIVE de l'index les adresses de chaque affirmation.

**Aucune licence n'est revendiquée**, pour la raison du lot 40 : la donnée est citée, source et date
de lecture sur chaque ligne de la fiche, et rien n'est affirmé qu'on ne puisse pointer.

### Pas 2 (2026-10-02) : les satellites des corps que la table du JPL n'a pas en section

La table du JPL n'a de section que pour Mars, Jupiter, Saturne, Uranus, Neptune et Pluton. Or la
fiche affiche un nombre de lunes, tiré de SBDB, pour des petits corps qu'elle ne couvre pas (sept au 2026-10-02) : la
fiche d'Ida disait « 1 lune », et le bloc « Découverte » ne pouvait rien en dire à une date. La
liste de ces corps n'est écrite nulle part : elle se DÉRIVE (toute désignation SBDB du catalogue
qui n'a pas déjà sa section au JPL), et `pnpm inventory:gaps` la montre dans sa colonne `lunes`.

**LA LISTE EST LUE DANS LA RÉPONSE MÊME QUI DONNE LE COMPTE DE LA FICHE.** SBDB déclare ses
satellites par `sat=1`. Le générateur pose la MÊME requête que le relevé des faits
(`phys-par=1&sat=1`), donc lit la même réponse, à la même date, dans le même cache : deux
lectures pourraient se contredire, une seule ne le peut pas. La garde l'exige (même date de
lecture, même compte que `confirmedSatellites`).

**Trois mesures ont décidé, chacune une réponse fausse d'apparence juste évitée :**

- **`year` est l'année de DÉCOUVERTE, et la référence en est souvent une autre.** Dactyl est daté
  de 1993 pour une référence de 1994 (Belton et al.), Vanth de 2005 pour une de 2007. Ce que
  `year` désigne a été LU dans la documentation de l'API (« year of discovery ») avant d'être
  affiché, puis PROUVÉ par un TÉMOIN : Pluton est dans les deux sources, et le générateur exige que
  ses cinq satellites y portent les mêmes noms et les mêmes années, sinon il échoue.
- **`confirmed` n'est PAS documenté par l'API.** Le relevé des faits comptait pourtant déjà dessus.
  Le générateur n'accepte que « Y » et « N » et échoue sur toute autre valeur :
  une troisième voudrait dire qu'on ne sait plus ce qu'on compte. Un satellite « N » n'est jamais
  compté, et la note de la fiche le NOMME ; aucun n'existe aujourd'hui parmi les corps du
  catalogue, donc ce chemin est tenu par le générateur et par le typage, pas par un scénario.
- **`iau_name` vaut la chaîne VIDE pour la lune de Makémaké**, pas `null`. Le nom est alors la
  désignation provisoire (« S/2015 (136472) 1 »), comme le fait la table du JPL.

**La parité est une règle du générateur, pas une liste** : tout corps dont la fiche affiche au
moins une lune a la liste de ses satellites, d'un compte ÉGAL au nombre affiché, ou une raison
écrite dans `satellitesNotCovered` de `scripts/discovery-targets.json`. Un écart arrête tout : il
s'écrit, il ne se tranche pas. Seule la Terre porte une raison : aucune des deux listes ne la
couvre, et la Lune n'a pas de date de découverte.

**La note dit quelle liste a été comptée.** « La table du JPL » pour les six systèmes, « la JPL
Small-Body Database » pour un petit corps ; et un compte sur un seul satellite s'écrit au
singulier, défaut trouvé en LISANT le rendu (« 0 sur les 1 », dans les quatre langues). `/sources`
le compte sans code propre à ce pas : chaque liste DÉCLARE sa source dans l'index, et la ligne de
cette source la compte.

**Les gardes, et leur falsification.** Trois falsifications de la donnée (une liste vidée, la
raison de la Terre retirée, une liste retirée de l'index), trois rouges dans `pnpm verify` ; trois
du générateur sur une réponse modifiée (une année de Pluton qui diverge, un `confirmed` inconnu,
un satellite devenu non confirmé), trois échecs qui nomment le corps ; deux du produit (la note
forcée sur la table du JPL, l'adresse rendue relative), deux rouges dans `e2e/discovery.spec.ts`.

### Front des noms (2026-10-02) : les noms que l'UAI avait rendus officiels à une date

Le bloc « Découverte » d'un corps qui porte des noms de l'UAI dit combien de ses noms de surface
étaient OFFICIELS à la date de la scène, la prochaine adoption, et ce que cette date n'est pas.
Pluton n'en a aucun avant le 8 août 2017, puis quatorze : la carte se remplit après New Horizons.

**UNE DATE D'ADOPTION N'EST PAS UNE DATE DE CONNAISSANCE, et c'est la source qui le dit.** La fiche
de Copernicus A au gazetteer porte « Approval Date : 2006 » et cite, pour référence, la liste de
Blagg et Müller de 1935. Et 7 050 des 7 058 noms lunaires de 2006 sont des désignations lettrées,
que la page de la Lune au gazetteer dit reprises d'un catalogue de la NASA de 1982. Compter des
noms « connus » à une date aurait fait d'un enregistrement administratif une découverte. La fiche
compte donc des noms OFFICIELS, le dit dans sa note, et compte les désignations lettrées sur une
ligne à part : ensemble, la Lune passerait d'environ 2 000 noms à plus de 9 000 en une seule année.

**LE « 1ER JANVIER » DU KML EST UNE ANNÉE SEULE, MESURÉ ET NON SUPPOSÉ.** Le KML écrit toujours un
jour (« 2006/01/01 00:00:00 »), mais la fiche de l'UAI n'affiche qu'une année quand ce jour est le
1er janvier, et un jour sinon (Occator : « Jul 03, 2015 »). Lu le 2026-10-02 sur **124 fiches** :
une par couple (corps, année au 1er janvier), les 89 couples, et une fiche datée au jour par corps
qui en a, soit 35. **124 conformes sur 124.** Les fichiers du gazetteer livrés portent donc
« AAAA » ou « AAAA-MM-JJ », et une année que la scène traverse rend une BORNE, comme le compte des
lunes (Mars en 1976 : entre 400 et 783 noms). Une heure autre que minuit arrête le générateur.

**Le compte est fait au générateur**, par corps et par date, dans
`src/config/gazetteerAdoptionIndex.json` (hors clôture de démarrage, `config/nameAdoptions.ts`) :
la fiche de la Lune n'a pas à télécharger ses 9 087 noms pour répondre. Le calcul vit dans
`core/nameAdoption.ts`, pur et testé. La date de lecture publiée (« lu le … ») était écrite en dur
dans le générateur, juste par coïncidence ; elle se DÉRIVE désormais de l'écriture des KMZ en
cache, et c'est la plus ancienne qui est publiée.

**Les gardes, et leur falsification.** `src/config/nameAdoptions.test.ts` recompte l'index depuis
les fichiers livrés et refuse tout « 1er janvier », dans l'index comme dans les fichiers ; deux
falsifications de la donnée (un compte modifié, un « 01-01 » réintroduit dans `pluto.json`), deux
rouges. Deux falsifications du produit (les lettrées fondues dans les noms propres, l'année seule
traitée comme un jour), deux rouges dans `e2e/discovery.spec.ts`. Un KMZ vieilli fait dériver
`--check`. La Lune n'est démarrée qu'à `MOON_SCENE_DATE`, comme l'exige
`src/config/e2eMoonDate.test.ts` ; la borne d'une année seule est donc éprouvée sur Mars.

### Front des croyances (2026-10-02) : ce qu'on a signalé, puis cherché sans le trouver

La fiche de Vénus dit, selon la date de la scène, qu'un possible satellite avait été signalé dès
1645 par F. Fontana, puis plusieurs fois par d'autres observateurs dont G. Cassini, et, à partir
du 15 juin 2009, qu'une recherche n'en a trouvé aucun jusqu'à environ 0,3 km de rayon.

**UNE SEULE SOURCE PRIMAIRE RACONTE L'HISTOIRE ET SA RÉFUTATION, EN TEXTE LISIBLE** : Sheppard et
Trujillo, *A Survey for Satellites of Venus* (arXiv 0906.2781). Le générateur lit son PDF par
`pdftotext`, avec la méthode et le cache du relevé des faits, et exige que chaque citation y soit
retrouvée MOT POUR MOT, puis que l'année, les noms et le rayon affichés figurent DANS ces
citations. La date de la non-détection est celle du dépôt sur arXiv, LUE sur la page de l'article,
comme ses auteurs et son titre. Trois falsifications du générateur rougissent : une année qui
n'est pas dans sa citation, une citation altérée d'un mot, un rayon absent des citations.

**CE QUE L'ARTICLE NE DIT PAS, LA FICHE NE LE DIT PAS.** Il ne date pas la fin de la croyance ; il
n'y a donc aucun état « on n'y croyait plus ». Les états sont : pas encore signalé, signalé
l'année même (la source ne donne que l'année, la fiche le dit), signalé, puis cherché sans succès
(`core/discovery.ts`, `refutedStanding`).

**TROIS CAS RESTENT DEHORS, AVEC LEUR RAISON MESURÉE** (`scripts/discovery-targets.json`,
`refutedClaims.notCovered`) : Thémis pour Saturne (Pickering, 1905), dont la source primaire
n'existe qu'en image scannée ; les quatre satellites d'Uranus de Herschel (1790 et 1794), dont
l'étude de 2020 n'est servie en texte par aucun de ses accès ; et un satellite de Mercure, pour
lequel aucune source n'a été trouvée. Le jour où l'un d'eux devient lisible, il s'ajoute comme de
la DONNÉE : une entrée dans les cibles, aucune ligne de code.

**Les gardes, et leur falsification.** `src/config/discovery.test.ts` exige une source décrite
pour chaque croyance livrée et une raison écrite pour chaque cas écarté ; deux falsifications de
la donnée, deux rouges. `e2e/discovery.spec.ts` éprouve Vénus en 1600, 1645, 1700 et 2010, par
son CHEMIN ; deux falsifications du produit (la recherche affichée à toute date, l'année même
traitée comme révolue), deux rouges. `/sources` porte l'article, et `pnpm sources:health` le
sonde, son marqueur dérivé de son adresse arXiv.

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

**Les sources des blocs de fiche (ligne 44.1, 2026-10-01).** Les blocs Découverte, Missions,
Instruments et Formations observées, et les noms de surface, lisent chacun un `*Index.json` de
`src/config/`, qui porte déjà sa provenance (éditeur, titre, adresse, date de lecture ou de gel).
`src/seo/cardBlockSources.ts` les lit et `/sources` en publie une ligne par source : ce qu'elle
couvre, COMPTÉ dans l'index, la date de ses données, et les blocs qui l'affichent, nommés par
leur libellé lu dans les dictionnaires, donc tels que la fiche les écrit. La découverte donne une
ligne par source DÉCLARÉE dans son index, et sa date est la plage des dates de lecture de ses
affirmations ; une source qu'aucun corps ne cite fait échouer le build. Une licence n'est publiée
que si l'index la DÉCLARE avec l'endroit où la source l'écrit (le gazetteer seul, aujourd'hui) :
celle du PDS a été retirée au lot 40 faute de texte qui la porte. La table du module est indexée
par nom de fichier, et `cardBlockSources.test.ts` exige qu'elle couvre EXACTEMENT les
`*Index.json` lus sur le disque : un sixième index rougit tant qu'il n'y est pas.

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

## Pages des missions (`/missions/`, 2026-10-04)

L'index `/missions/` et une page par mission que le registre de contexte du PDS déclare
(`/missions/cassini-huygens/`), dans les quatre langues, générés au build et ajoutés au sitemap.
Le lot 40 donnait à chaque fiche les missions qui visent son corps ; ces pages sont l'AUTRE sens
du même graphe : ce qu'une mission a visé, et ce que Galaxy en montre. Générateur pur :
`src/seo/missionPages.ts`.

- **Des documents, pas des copies d'`index.html`** (même rendu que `/methodology`,
  `documentPage.ts`). Une mission n'a pas de position que la scène pourrait ouvrir ; la scène est
  à un lien, puisque chaque cible du catalogue renvoie à la page de son corps et chaque sonde
  suivie à la sienne. Conséquence mesurée : **zéro octet** ajouté au démarrage (budget JS
  inchangé), aucune règle de permalien.
- **Le chemin vient de l'identifiant PDS** (segment terminal, `mission.` retiré, `_` réécrit
  `-`) : `bc` pour BepiColombo, `hyb2` pour Hayabusa2. Laids pour certains, mais STABLES, puisque
  c'est l'identifiant logique du produit ; un nom affiché, lui, change. Deux missions qui
  donneraient le même chemin font échouer le générateur.
- **Les données** : `pnpm missions:generate` écrit aussi `src/seo/missionCatalogue.json`
  (dossier jamais livré au client, `src/buildOnly.ts`) : chaque mission, ses cibles telles que
  l'archive les déclare (corps du catalogue, ou nom et type publiés), et sa description. La
  description vient d'une SECONDE requête, pas d'un champ ajouté à la première : changer
  l'adresse aurait changé la clé de cache, donc redaté le bloc « Missions » de la fiche, qui n'a
  pas changé. Les pages publient donc deux dates de lecture, chacune la sienne.
- **Les sondes d'une mission se lisent dans LEUR archive** (`public/assets/instruments/*.json`,
  lot 42), par l'identifiant de l'investigation : aucune table écrite à la main.
- **Les liens retour** : la page d'un corps porte une section « Missions » (le libellé du bloc de
  la fiche, `bi.missions.label`), la page d'une sonde lie ses investigations qui ont une page. Les
  deux dérivent du MÊME catalogue que les pages, donc un lien ne peut pas viser une page absente,
  et `missionPages.test.ts` exige que les missions d'un corps soient exactement celles que sa
  fiche affiche.

Ce que la page affirme, et rien de plus :

- **Le début est celui du PROJET** (mots de la source, `colStart`), jamais un lancement ; une fin
  non déclarée ne veut pas dire « en cours ». Les deux sont écrits sur chaque page.
- **La description est CITÉE en anglais**, `<blockquote lang="en">`, avec sa date de lecture : la
  traduire serait écrire à la place de l'archive. Deux descriptions sur 112 sont des documents
  PDS3 aplatis : le titre souligné de tête est retiré (la page a le sien), et celle d'ExoMars 2016
  s'arrête à la dernière phrase avant un tableau des phases dont les colonnes n'ont pas survécu,
  en le DISANT (`missionDescription`).
- **Les cibles d'étalonnage ne se listent pas** (types publiés `Calibrator` et
  `Calibration Field` : « PLAQUE », « DARK SKY »), mais leur nombre est écrit. Les types de cible
  sont traduits par une liste FERMÉE : un type nouveau fait échouer le build plutôt que de
  s'afficher en anglais sous un titre espagnol.

**Trouvé en REGARDANT l'index rendu, aucun test ne l'aurait dit** : DART ouvrait la liste au
**1000-01-01**, la sentinelle de DÉBUT de l'archive, pendant exact de la fin `3000-01-01` du
lot 40. Une seule mission sur 112, qui ne vise aucun corps du catalogue, donc la fiche ne l'a
jamais montrée. Le catalogue l'écrit `null` (« non déclaré », en fin d'index), et le générateur
REFUSE cette sentinelle sur une mission qui viserait un corps du catalogue, puisque
`core/missions.ts` suppose un vrai début.

Routage du service worker : les missions sont la seconde rubrique à DEUX segments après les
éclipses (`NESTED_SEGMENTS` de `pwaRouting.ts`), donc trois traduites ; `pwaRouting.test.ts`
confronte les deux listes à toutes les pages de mission, falsifié en retirant le segment.

Gardes : `src/seo/missionPages.test.ts` (catalogue contre l'index et les listes par corps
livrés, citation, sentinelle, étalonnage, liens, quatre langues ; règles falsifiées une à une),
`e2e/built-pages.spec.ts` (l'index et la page de Voyager, la plus longue, dans les quatre
langues : axe et 390 px, sur le build).

## Les cibles des missions entrées au catalogue (2026-10-04, vague 1)

Les pages des missions montraient ce que le registre du PDS déclare, et vingt de ses missions ne
visaient aucun corps du catalogue. **23 corps héliocentriques** y sont entrés : quinze astéroïdes
(Lutetia, Gaspra, Mathilde, Šteins, Annefrank, Masursky, Didymos, Dinkinesh, Donaldjohanson, les
cinq Troyens de Lucy, Apophis) et Arrokoth, plus sept comètes (Tempel 1, Borrelly, Wild 2, Hartley 2,
67P, Giacobini-Zinner, Grigg-Skjellerup). Chaque fiche suit la recette de 16 Psyché, sans une ligne
de TypeScript propre au corps : éléments d'Horizons à l'époque 2026-01-01 (barycentriques pour
Arrokoth), binaire Horizons au pas MESURÉ, faits lus à la SBDB, découverte, missions, noms de surface
de l'UAI quand ils existent, page et vignette.

**Ce que la mesure a décidé, corps par corps :**

- **Le pas de chaque binaire** sort de `scripts/measure-ephemeris-step.mjs`, la règle du lot 11
  enfin rejouable (elle avait été mesurée à la main) : 4 jours pour Didymos, Apophis et les comètes,
  8 pour la ceinture principale, 16 ou 32 pour les Troyens, 64 pour Arrokoth. Témoin : rejoué sur
  les cinq corps que le lot 11 a laissés à 4 jours, il retrouve chaque décision.
- **Une comète vise une SOLUTION d'Horizons**, l'apparition la plus proche (`CAP`) : la même requête
  rend `90000030` pour Halley, la solution déjà livrée.
- **Wild 2 était à 22 UA en 1901**, sur l'orbite d'avant sa capture par Jupiter en 1974 : la borne de
  plausibilité, calculée sur l'orbite actuelle, refusait sa position mesurée. Elle accepte désormais
  une distance MESURÉE et déclarée (`measuredMaxDistanceAU`), confrontée au fichier livré.
- **Les vecteurs de référence à ±10 ans** ne mesurent plus les éléments mais la physique pour
  Apophis (sa rencontre de 2029 avec la Terre), les Troyens (leur libration) et les comètes
  (Jupiter, forces non gravitationnelles) : ces lignes sont écartées, avec leur raison, et la ligne à
  l'époque reste pour chacun.
- **Les sentinelles** : le pôle de Didymos s'écrit « 78, -71 degrees » à la SBDB, que le relevé
  découpait en `NaN` (les deux formes se lisent désormais, et c'est bien RA/Dec, vérifié sur la
  source citée) ; DART déclare un début `1000-01-01`, que la fiche de Didymos aurait affiché comme
  l'an 1000 : il devient l'état `startUndeclared` de `core/missions.ts`.
- **Un fait que deux sources contredisent n'est pas publié** : NASA donne à Polymele un satellite
  sans nom, la SBDB n'en compte aucun ; son nombre de lunes porte cette raison.
- **Les rayons de travail** de Patrocle (le diamètre SBDB décrit la paire avec Menoetius) et
  d'Arrokoth (deux lobes, 35 × 20 × 10 km selon NASA Science) sont des valeurs non publiées, comme
  celui de Hauméa : ils servent au rendu et aux écarts en rayons, la fiche n'en affiche aucun.

**Ce qui reste, écrit** : les modèles de forme, que la vague 3 a soldés autant que les sources le
permettaient (ci-dessous) ; chaque manque restant porte sa cause dans `config/shapeModelGaps.ts`.
Les deux satellites sont entrés à la vague 2.

### Vague 2 : Dimorphos et Menoetius, deux satellites de petits corps (2026-10-04)

Les deux premières lunes du catalogue dont le parent est un petit corps. Mêmes règles que les
autres lunes, et chaque écart à ces règles est une MESURE :

- **Le binaire est relatif au PRIMAIRE, pas au barycentre.** Horizons sert Dimorphos par rapport
  à `920065803` (Didymos, solution DART s547) et Menoetius par rapport à `920000617` (Patrocle) :
  c'est la géométrie de la PAIRE qui se voit quand on s'approche. Mesuré contre Horizons, le
  binaire tient à 38 m pour Dimorphos (0,48 rayon au pire) et à 14 km pour Menoetius (0,26).
- **La couverture est BORNÉE**, lue dans les refus d'Horizons : 2000-2030 pour Dimorphos,
  2000-2050 pour Menoetius. Les fichiers commencent au 2000-01-05, premier nœud de la grille
  commune de 4 jours partie de 1900, pour que l'époque des éléments de repli soit celle de toutes
  les autres lunes. Hors de la couverture, le repli képlérien (éléments MOYENS du binaire) garde
  le rayon de l'orbite mais pas la phase de Dimorphos : sa période publiée est à ± 2 min (un tour
  par an), et Scheirich et al. 2024 mesurent une période qui change encore après l'impact. La
  borne de phase de `relativeElements.test.ts` le déclare au lieu de l'élargir pour tous.
- **L'impact de DART coûte un rayon, mesuré** : l'intervalle de 4 jours qui l'enjambe mélange
  deux orbites (période 11 h 55 puis 11 h 23), et l'outil de propagation ancré autour du
  2022-09-26 mesure un écart qui sature à 1,0-1,1 rayon de Dimorphos, contre 0,3 en régime
  ordinaire. [SUPERSEDED le 2026-10-05 : mesuré heure par heure, l'intervalle allait jusqu'à
  346 m, soit 4,3 rayons ; le saut de vitesse est désormais publié et l'intervalle ne fond plus
  les deux orbites, cf. § « La position composée d'un satellite de petit corps ».]
- **La position héliocentrique composée s'écarte davantage, et c'est le PARENT** : le fichier de
  Didymos est la solution au sol (`65803;`, 1900-2100) et celui de Patrocle le barycentre du
  couple (`617;`). Le composé s'écarte donc de 158 km (Dimorphos, comparé au barycentre DART que
  Horizons ne sert que du 2001-01-02 au 2025-07-13) et de 411 km (Menoetius, la distance du
  primaire au barycentre d'un couple presque égal). Le résumé de validation le publie tel quel ;
  `ephemerisStepBudget.test.ts` ne le compte pas comme un refus de pas, par une règle dérivée
  (binaire sous la cible et composé plus de dix fois le binaire). **[SUPERSEDED le 2026-10-05 :
  les deux causes étaient mal nommées et sont corrigées, § « La position composée d'un satellite
  de petit corps » ci-dessous.]**
- **Une couverture de référence que rien ne nomme se SONDE.** Horizons refuse Dimorphos vu du
  Soleil en 2000 par « Insufficient ephemeris data has been loaded », un refus SPICE qui ne nomme
  aucune borne, et que `validate-against-horizons.mjs` prenait pour une panne. Il trouve
  désormais la couverture par dichotomie au jour près, sur des requêtes d'une date mises en cache.

**Les faits, et ce qu'ils ont révélé ailleurs.** La SBDB ne publie rien de physique pour un
satellite. Dimorphos prend sa taille et sa période d'après l'impact sur la page de NASA Science
« Didymos & Dimorphos », Menoetius son orbite dans Grundy et al. 2018 (table 2 du PDF) : deux
sources citées mot pour mot par le relevé des faits. En cherchant la masse de Didymos, il est
apparu que la SBDB publie sa DENSITÉ (2,17, même référence que son diamètre) : sa fiche refusait
une masse « faute de GM » alors qu'elle se dérive. Le relevé lit désormais la densité, la fiche
publie la masse, et une garde refuse toute masse déclarée absente quand densité et diamètre de
la même référence sont publiés (Didymos était le seul cas). La masse du COUPLE de Patrocle est une
valeur de travail non publiée : elle donne le bon μ à la propagation de Menoetius, et la fiche
dit qu'aucune répartition n'est publiée.

**Trois raccords que le registre a demandés.** Le PDS classe Dimorphos « Asteroid » sous un
identifiant `satellite.65803_didymos.dimorphos` : le générateur des missions accepte cette paire
sous ce segment seulement. Les six raisons « le rapport de l'UAI donne l'axe de toutes les autres
lunes » étaient déjà fausses (six lunes sans pôle) : elles disent « la plupart », et les deux
nouvelles lunes portent la même raison, confrontée à leur absence du noyau NAIF. Enfin, sans pôle
publié, l'axe dessiné était celui d'une obliquité nulle : Dimorphos tournait à l'endroit autour de
Didymos qui tourne à l'envers. Les trois corps des deux couples portent maintenant, en valeur de
travail, l'inclinaison de la normale de l'orbite mesurée sur le binaire, puisqu'une rotation
synchrone se fait autour d'elle.

### La position composée d'un satellite de petit corps (2026-10-05)

**Horizons est cohérent avec lui-même, et c'est ce qui a nommé la vraie cause.** Dimorphos vu du
Soleil égale, à 0,00 km aux 26 dates mesurées, le primaire vu du Soleil plus Dimorphos vu du
primaire (Menoetius de même). Tout l'écart du composé venait donc du PARENT, lu sur sa solution
au sol plutôt que sur ce primaire, et la cause n'était ni la même ni celle qu'on avait écrite :

- **Didymos** : la solution au sol (`65803;`) et le primaire de la solution DART (`920065803`)
  sont deux orbites, qui divergent en remontant le temps : 112 km en 2002, 30 km en 2014, 1 à
  2 km en 2022-2024. Le décalage barycentre/primaire, lui, ne fait que ~10 m.
- **Patrocle** : l'écart au primaire (`920000617`) se décompose EXACTEMENT en −0,2202 × Menoetius
  plus une constante lente (47 km en 2005 et 2020, 312 km en 2040), résidu sous 1,7 km sur trois
  décades. C'est le ballant du primaire autour du barycentre du couple, en 4,28 jours, plus un
  écart de solution.

**Ce qui a changé.** Le générateur substitue au parent les vecteurs du PRIMAIRE sur l'intervalle
où Horizons le sert, SONDÉ par dichotomie à chaque génération (`overlayPrimary`) et publié au
manifeste (`primary`) : 2001-01-04 → 2025-07-11 pour Didymos (2001-01-03 → 2025-07-12 depuis
son pas d'un jour, la grille sondée étant plus fine), 2000-01-06 → 2050-11-25 pour
Patrocle. Ailleurs, la solution au sol reste ; le saut aux raccords (85 et 3 km pour Didymos, 496
et 527 km pour Patrocle) est un changement de SOLUTION, que le générateur imprime. Patrocle passe
au pas de 4 jours de Menoetius, sans quoi son ballant ne se retire pas, et c'est le mécanisme de
Pluton qui le retire et le remet (`BodyDynamics.reflex`), avec deux généralisations : les deux
grilles sont ALIGNÉES et non plus identiques (Menoetius commence 9 132 échantillons après
Patrocle, `alignedOffset`), et hors du fichier compagnon le corps s'interpole sans ballant, puisque
sa solution au sol n'en porte pas.

**Le facteur ne vient pas des masses, il est DÉRIVÉ des binaires.** Aucune répartition de la masse
du couple n'est publiée ; le facteur est celui qui rend le primaire LISSE une fois le compagnon
retiré (`core/reflexFactor.ts`, différences d'ordre SIX : à l'ordre deux, la courbure de l'orbite
autour du Soleil, ~26 000 km sur 4 jours, noyait le ballant et rendait −0,45 sans rien réduire,
un nombre faux d'apparence plausible). Les fichiers livrés redonnent −0,22024, le témoin mesuré
d'abord sur Horizons ; Didymos donne −0,009 (Dimorphos pèse ~1 % du couple) sans rien réduire, et
la règle ne le publie pas. `pnpm ephemeris:reflex` l'écrit au manifeste, `--check` le confronte
aux binaires, et `reflexFactor.test.ts` tient l'égalité, falsifiée par un facteur de −0,25.

**Ce que la mesure donne** (`pnpm ephemeris:validate`, la validation compare désormais le parent
au primaire sur l'intervalle publié, et à la solution au sol ailleurs) : Menoetius composé 411 →
11 km au pire (7,6 → 0,2 rayon), Dimorphos composé 158 → 16 km. **Ce qui reste, et pourquoi** :
les 16 km de Dimorphos sont maintenant l'INTERPOLATION de Didymos, un géocroiseur échantillonné
tous les 4 jours ; descendre sous le diamètre de Dimorphos (160 m) demanderait un pas d'environ
un jour sur tout le fichier de Didymos, soit quatre fois ses octets. C'est une décision de budget,
écrite ici et non prise.
[SUPERSEDED le 2026-10-05 : décision prise, ci-dessous.]

**Dimorphos sous son diamètre (2026-10-05), décision de l'utilisateur qui accepte les octets.**
Didymos passe au pas d'un jour (880 992 → 3 523 920 octets). La validation tombe à 34 m en
moyenne, mais une mesure HEURE PAR HEURE autour de l'impact (le tirage de 48 dates ne l'avait
touché qu'une fois, à 328 m) montrait un autre défaut, qui n'était pas Didymos : le fichier
RELATIF de Dimorphos, au pas de 4 jours, fondait une orbite d'avant l'impact et une d'après sur
l'intervalle qui le contient, 44 heures au-dessus du diamètre (346 m au pire). Deux corrections,
et chacune a été mesurée seule :

- **Le saut de vitesse est PUBLIÉ, et lu chez Horizons.** L'en-tête de la cible `120065803` écrit
  « DART impact was on 26-Sep-2022 @ 23:14:24.183 UTC, equivalent to 2022-Sep-26 23:15:33.365
  TDB ». Le générateur y lit l'instant TDB (`readImpulses`, l'entrée ne déclare que la phrase
  qui l'ouvre) et le publie au manifeste (`impulses`) ; une phrase absente ou un instant hors du
  fichier font échouer la génération. Dans l'intervalle qui le contient, l'interpolation
  dynamique propage depuis le SEUL côté de la date (`impulseInInterval`) au lieu de fondre.
- **Dimorphos passe aussi au pas d'un jour** (135 840 → 543 216 octets). Le saut seul ne suffit
  pas : propagé d'un seul côté sur un arc de plusieurs jours, Dimorphos s'écarte encore de 265 m.

Mesuré heure par heure contre Horizons, impact compris : relatif 50 m au pire, composé 101 m.
Toutes les 12 h sur l'intervalle où Didymos est lu sur son primaire (17 903 dates) : composé
89 m au pire hors des cinq secondes intercalaires, où la RÉFÉRENCE elle-même est ambiguë d'une
seconde (15 à 34 km, à la vitesse de Didymos, exactement aux cinq instants de 2001-2025 ; un
piège de mesure, pas de l'application). Le relevé de validation donne 22 m en moyenne et 85 m au
pire, contre 2,54 et 15,85 km. Pour le reste de la couverture de Dimorphos (2000, 2025-2030),
Didymos est sa solution au sol, et l'écart de solution reste celui écrit plus haut.

`src/config/compositeReference.test.ts` tient l'écart sous le diamètre (deux fois le rayon de la
fiche) sur des vecteurs d'Horizons committés (`compositeReferenceVectors.json`, écrits par
`node scripts/capture-composite-reference.mjs`) : le jour de l'impact heure par heure, puis tous
les 60 jours. **Falsifié trois fois** : le saut ignoré par le service rend 220 m le jour de
l'impact ; l'ancien Didymos au pas de 4 jours, 15,2 km ; l'ancien Dimorphos sans saut publié,
351 m.

### Vague 3 : les modèles de forme des cibles (2026-10-04)

Neuf maillages étaient nommés après les vagues 1 et 2. **Quatre sont livrés**, par le pipeline des
autres corps (`decimate-shape-model.mjs`, puis `bake-shape-colour.mjs` à l'albédo publié, faute de
carte de couleur) : Gaspra et Mathilde (grilles de Thomas au PDS, longitudes ouest), Apophis
(modèle radar préliminaire de Brozović et al. 2018) et Lutetia (DAMIT 282, CC BY 4.0). Les
gardes de `shapeModels.test.ts` ont décidé deux choses : les pôles publiés de Gaspra et de
Mathilde sont à 11° et 30° de leur axe de plus grande inertie, donc ces deux maillages sont
tournés dans leurs axes principaux (`--principal`) [SUPERSEDED le 2026-10-05 pour Gaspra, rendu
à son repère mesuré pour y draper sa carte : § « Les petits corps modélisés »] ; et le rayon
équivalent-volume de Mathilde
(25,6 km) s'écarte de 3,2 % du rayon affiché, un écart déclaré (`radiusMismatch`).

**Cinq ne le sont pas, et chaque raison est une mesure du jour** :

- Didymos, Dimorphos et Arrokoth : leurs jeux sont sur `pdssbn.astro.umd.edu/holdings/`, qui a
  répondu 403 à toute requête ce jour-là (et à plusieurs agents), comme pour les trois comètes de
  la vague 1, alors qu'une page de mission du même hôte répond 200. Didymos et Dimorphos en sont
  sortis à la vague 4, ci-dessous.
- 67P : servi par la PSA, mais le jeu ne déclare aucune licence (lisez-moi, catalogue, guide), la
  PSA ne demande qu'un remerciement pour une publication, et l'avis général du site de l'ESA
  exclut les usages autres qu'éducatifs ou éditoriaux sans licence particulière. Rien n'est
  importé sur une licence supposée. [SUPERSEDED le 2026-10-06 : les conditions des archives
  scientifiques de l'ESA déclarent CC BY-NC 3.0 IGO, et l'utilisateur a accepté de livrer sous
  cette licence ; cf. § « L'outil de pose SPICE, versionné ». 67P est donc rouvert.]
- Leucus : DAMIT publie deux solutions convexes de qualité 1, aux pôles différents, sans taille
  étalonnée. En importer une serait présenter un choix comme une mesure, et son échelle viendrait
  du catalogue, ce qui rendrait la garde du volume tautologique.

### Vague 4 : Didymos, Dimorphos, Arrokoth et Donaldjohanson lus en DSK (2026-10-04)

Les modèles SPC de DART que l'UMD refusait sont aussi servis par l'archive SPICE PDS4 de DART
chez NAIF, en DSK, un format binaire que rien ne lisait ici. `scripts/dsk-to-obj.mjs` le lit sans
dépendance, couche par couche (DAS, DLA, DSK de type 2, indices de `dsk02.inc`) et refuse ce qu'il
ne sait pas lire (autre format binaire que LTL-IEEE, plusieurs segments, autre type). Ce qui l'a
validé : 49 152 plaques pour le fichier de 9 309 mm, exactement 6 × 64² × 2, la grille de la SPC,
puis les gardes de `shapeModels.test.ts` sur les fichiers produits (volume, pôle, faces sortantes).
Les rayons équivalents (0,365 et 0,075 km) sont 6,4 % sous ceux des fiches, un écart publié de part
et d'autre et DÉCLARÉ : Daly et al. 2023 donnent 151 ± 5 m de diamètre équivalent pour Dimorphos.
La couleur cuite est l'albédo du système, 0,15 ± 0,02 (Daly et al. 2023), la SBDB n'en publiant
aucun pour Didymos.

La même source a rendu deux formes de plus : celle d'Arrokoth (Porter et al. 2024, celle que l'UMD
refusait), dans l'archive SPICE de New Horizons, et celle de **Donaldjohanson**, dans l'archive de
Lucy, que la recherche de la vague 1 n'avait pas trouvée (elle était notée « introuvable »). Le
fichier d'Arrokoth est gros-boutiste (« BIG-IEEE ») : le lecteur lit les deux ordres d'octets que
l'en-tête déclare, et le fichier petit-boutiste de Didymos sert de témoin (mêmes octets avant et
après). Leurs écarts de rayon sont déclarés : 3,9 % pour Arrokoth contre un rayon de travail, 23 %
pour Donaldjohanson, dont le diamètre de la SBDB est une mesure thermique d'avant le survol. Les
archives SPICE de Deep Impact, EPOXI, Stardust et DS1 précèdent le format DSK : rien pour les comètes.

### Vague 5 : Tempel 1 et Šteins, dans l'archive SPICE de Rosetta (2026-10-04)

La phrase précédente était vraie et incomplète : la forme de Tempel 1 n'est pas dans l'archive de
la mission qui l'a vue, mais dans celle de **Rosetta** (`ro_rl-e_m_a_c-spice-6-v1.0`, archive PDS3
chez NAIF), où l'ESA SPICE Service l'a convertie en DSK depuis le modèle de Farnham et Thomas que
l'UMD refuse de servir. La même archive porte **Šteins** (Farnham et Jorda, OSIRIS), notée
« introuvable » à la vague 1. Le commentaire de chaque DSK nomme le jeu du PDS d'origine : ce sont
deux jeux de la NASA, distribués sans restriction, ce qui n'est PAS le cas de 67P (jeu de la PSA
sans licence déclarée), même si l'archive de Rosetta en porte aussi des DSK. La décision sur 67P
reste celle de l'utilisateur.

Rien de neuf dans la chaîne : deux entrées de recette, un bloc `model` par fiche, deux niveaux
(les sources ont 32 040 et 20 480 plaques, sous le budget du 4k). Les gardes ont tout tenu sans
`--principal`. Un seul écart déclaré : le rayon équivalent-volume de Tempel 1, 2,83 km, est celui
que publie le jeu (2,83 ± 0,1), à 5,6 % des 3,0 km de la SBDB (A'Hearn et al. 2005, Deep Impact
seul). Šteins tombe à 1,9 % de sa fiche. Albédos lus à la SBDB : 0,05 et 0,300.

Ce qui reste a été cherché ce jour-là dans les DSK génériques de NAIF (`generic_kernels/dsk/`, qui
renvoient vers l'archive de Rosetta pour Šteins), dans l'archive de Lucy (Donaldjohanson seul) et
dans les collections non-mission du miroir du PSI : aucune comète de plus.

### Une ligne d'orbite n'est payée que si elle est tracée

Une ligne coûte une période ENTIÈRE d'éphéméride. Le démarrage la demandait pour tous les corps,
ligne affichée ou non : Halley seule y coûtait **332 832 octets**, pour une ligne masquée par défaut.
Avec les 23 cibles, la première vue du 2015-06-15 demandait **2 037 696 octets** pour un budget de
1 800 000, et la garde du budget nommait déjà la piste.

La règle « quelles lignes sont tracées au départ » a désormais un propriétaire,
`core/orbitLineDefaults.ts` (les planètes), lu par l'application avant que l'interface existe et par
`ui/defaultDisplay.ts`. `SolarSystemApp` ne demande et ne calcule que les lignes tracées ; la scène
prévient quand une ligne s'allume (`SceneSystem.onOrbitLineShown`), et l'application fait venir sa
période PUIS la trace, en regroupant les allumages d'une même tâche. L'horloge, qui attend les
octets des lignes avant d'avancer, ne compte elle aussi que les lignes tracées.

Gardes : `src/config/startupBudget.test.ts` (la demande EXACTE du démarrage, désormais la règle
par défaut) et `e2e/orbitLinesOnDemand.spec.ts`, qui le voit au réseau : Halley ne demande que sa
position au démarrage, puis plus de 100 Ko quand on allume son orbite. Falsifié en rendant au
démarrage toutes les périodes : 332 832 octets pour Halley, rouge.

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
