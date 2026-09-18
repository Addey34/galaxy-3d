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
(`pnpm facts:snapshot`, `pnpm ephemeris:validate`) ; la preuve est la phase 5 de
`docs/private/REGISTRES_LOT7.md` § 10 (16 Psyché ajoutée sans toucher une ligne de TypeScript).

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
| Binaire Horizons (`HorizonsEphemerisService`) | planètes (dont Jupiter et Uranus depuis le lot 2b), naines, satellites, sondes | états exacts tous les 4 jours, 1 jour pour 5 sondes |
| Noyau SPK (optionnel, `VITE_SPK_KERNEL_URL`) | lunes de Saturne de SAT441 | prime sur les binaires quand il est actif |
| `JupiterMoons()` d'astronomy-engine | Io, Europe, Ganymède, Callisto | vecteurs jovicentriques directs |
| Éphéméride astronomy-engine (`astroBody`) | planètes, Lune, Soleil | théorie planétaire |
| Éléments képlériens du catalogue | petits corps, et **repli** de tout satellite | cf. « le repli » ci-dessous |

Une position issue d'un binaire passe d'abord `isPlausibleRelativePosition` /
`isPlausibleHeliocentricPosition`, qui bornent la distance **des deux côtés**. La borne basse
n'est pas décorative : c'est son absence qui a laissé Encelade osciller d'un facteur 11,4 en
distance à Saturne pendant des mois, sous un garde-fou censé attraper exactement ça.

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

### Tests qui verrouillent tout ça

| Fichier | Ce qu'il garde |
| --- | --- |
| `core/horizonsSatelliteOrbits.test.ts` | chaque satellite boucle un tour sur sa période, sur les binaires **réellement committés** |
| `core/relativeElements.test.ts` | le repli décrit la même orbite que le binaire (deux sources sans code commun) |
| `core/satelliteOrbitRate.test.ts` | la cadence du repli, sur la sortie observable |
| `core/twoBodyPropagation.test.ts` | la propagation, jusqu'à 40 révolutions |
| `core/orbitLineSampling.test.ts` | amplitude **et** régularité de la ligne, dans les deux modes |
| `core/kepler.test.ts` | solveur hyperbolique (résidu, M non réduite, vis-viva, asymptote ν∞) |
| `config/interstellar.test.ts` | 21 vecteurs Horizons de −20 à +20 ans, Tp dérivé, ligne répartie en F |
| `core/ephemerisPlausibility.test.ts` | les deux bornes, sur 400 dates par fichier |
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

Deux retenues, énoncées ici parce qu'elles ont été incohérentes entre elles pendant longtemps et
que c'est le genre de défaut qu'on ne voit plus à force de le regarder.

- **Les ORBITES ne couvrent que les planètes** au démarrage ; lunes, naines et petits corps sont
  en opt-in dans le tableau de `#orbit-options`.
- **Les LIBELLÉS suivent la même liste** (`MAJOR_BODIES` dans `ui/exploHud` : l'étoile, les huit
  planètes, la Lune). Ils ne l'ont reçue que le 2026-09-11 : le catalogue compte plus de
  cinquante entrées et toutes les afficher donnait vingt-quatre étiquettes empilées sur la vue
  initiale, Phobos, Hygie, Orcus et Bennu comprises. Les orbites appliquaient déjà cette
  retenue, les libellés non — deux défauts par défaut divergents dans le même panneau, sur la
  même liste de corps. Tenu par `ui/defaultDisplay.test.ts`.

Deux exceptions qui ne se devinent pas :

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
défaut, les trois se lisaient comme des orbites cassées en travers de la vue d'ensemble. Marqueurs
et noms restent affichés, le tracé est une case des Réglages (conservée).

## Couches d'instrument pendant le morph Éduc↔Explo

Les corps 3D n'sautent pas d'un mode à l'autre : `OrbitalMechanics` interpole leur position
pendant 1,2 s (`scaleMorph`). Une couche 2D qui dessine à l'échelle Explo pendant ce temps part
aussitôt à sa position finale et se décolle des corps qu'elle annonce — c'est ce que faisaient
les marqueurs de sondes et de petits corps. `core/overlayScale.ts` porte la règle
(`morphedSceneRadius`, `scaleToScene`) : les positions Éduc et Explo étant colinéaires,
interpoler le rayon revient exactement à interpoler la position.

Leur VISIBILITÉ suit le morph elle aussi, pas le mode : elles apparaissent dès que la transition
démarre et ne disparaissent qu'une fois revenu à l'Éducatif. Tenu par `core/overlayScale.test.ts`,
qui compare les deux extrémités à `ScaleService` — la source d'échelle de la scène — plutôt qu'à
une formule recopiée.

**Ce que les tests ne voient pas** : la suite e2e tourne en `reducedMotion: 'reduce'`, donc le
morph y est INSTANTANÉ ; aucun scénario ne peut observer un état intermédiaire. La vérification
est la comparaison à l'écran, faite à 450 ms de transition : sans la correction, le marqueur de
Juno quitte le champ pendant que Jupiter glisse encore ; avec, il reste collé à la planète.

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
autrement se verrait dans une galerie de partages.

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
à côté, jamais fondu dans l'étiquette. « Mesuré » ne veut pas dire « exact » : Hygiea est mesurée
sur 1900-2100, à 6e7 km.

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
  (`ModelConfig`), éléments orbitaux (`smallBodies.ts`, `interstellar.ts`), versions et licences
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
  ligne du tableau (4 823 km en moyenne) ;
- « contacté seulement quand la couche est utilisée » était faux : SBDB est interrogé au
  démarrage, et la couche de nuages satellite (active par défaut sur ordinateur) comble ses
  trous avec Open-Meteo.

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

## Architecture météo

Trois frontières simples (résumées ici ; le plan directeur complet avec l'historique des décisions
et des tranches T1–T6 est dans `docs/private/WEATHER_ARCHITECTURE.md`) :

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
`unavailable`) affiché dans son badge. Voir `docs/private/METEOROLOGY_CODE_MAP.md` pour la carte
de repérage fichier par fichier utile en debug.
