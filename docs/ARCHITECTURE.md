# Architecture — Solar System 3D

> Vue d'ensemble, invariants et liste des modules : voir `CLAUDE.md` à la racine, qui est la
> source unique tenue à jour à chaque session. Cette page ne documente que ce que `CLAUDE.md`
> ne couvre pas : l'ordre exact de la boucle par frame, la propriété des ressources, la carte CSS,
> le contrat de sécurité et le pipeline de contenu. Ne pas dupliquer ici la liste des modules ou
> des invariants métier — la mettre à jour uniquement dans `CLAUDE.md`.

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
| `src/seo`                   | Pages d'atterrissage par corps, sitemap, vignettes de partage   | Catalogue seulement — **jamais chargé par l'application** |
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

## Pipeline de contenu et d'assets

Le catalogue est organisé en trois niveaux : données (position, époque, référentiel, rayon,
orientation, source, incertitude), représentation (sphère, couche texturée, anneau, particules ou
futur modèle 3D), présentation (labels, fiche, couleur, filtres, aides de navigation).

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
| Binaire Horizons (`HorizonsEphemerisService`) | planètes, naines, satellites, sondes | états exacts tous les 4 jours |
| `JupiterMoons()` d'astronomy-engine | Io, Europe, Ganymède, Callisto | vecteurs jovicentriques directs |
| Éphéméride astronomy-engine (`astroBody`) | planètes, Lune, Soleil | théorie planétaire |
| Éléments képlériens du catalogue | petits corps, et **repli** de tout satellite | cf. « le repli » ci-dessous |

Une position issue d'un binaire passe d'abord `isPlausibleRelativePosition` /
`isPlausibleHeliocentricPosition`, qui bornent la distance **des deux côtés**. La borne basse
n'est pas décorative : c'est son absence qui a laissé Encelade osciller d'un facteur 11,4 en
distance à Saturne pendant des mois, sous un garde-fou censé attraper exactement ça.

### Interpolation entre deux échantillons : jamais une cubique seule

Un fichier Horizons est échantillonné à pas fixe. L'interpolation de Hermite entre deux états
suppose un mouvement **lisse sur l'intervalle** — hypothèse fausse dès que le corps y fait
plusieurs tours. Avec le pas de 4 jours livré, 22 des 24 satellites du catalogue ont une période
plus courte que ce pas, et la cubique ne reconstruisait alors plus rien : Phobos balayait 2° au
lieu de 360° sur une période.

`HorizonsEphemerisService` choisit donc son interpolation d'après le nombre d'échantillons par
révolution, calculé sur la période **catalogue** (stable) et non sur la période osculatrice de
l'état courant (erratique dès que le mouvement n'est pas à deux corps) :

- **≥ 5 échantillons/orbite** → Hermite cubique, comme avant.
- **< 5** → `twoBodyPropagation.ts` : les deux états qui encadrent la date sont propagés le long
  de leur conique, l'un vers l'avant l'autre vers l'arrière, puis fondus en smoothstep. Chaque
  ancre reste exacte à l'échantillon (poids 0 puis 1, dérivée nulle aux deux bouts → raccord C¹),
  donc les perturbations réelles restent portées par les données. **On ne remplace pas les
  données par un modèle, on les relie par la bonne courbe.**

Le seuil de 5 vient d'une mesure des deux branches corps par corps, pas d'une règle du pouce : la
dynamique domine tant que la cubique n'a pas de quoi décrire un tour, puis passe *derrière* elle
(les petites lunes de Pluton n'ont pas de mouvement à deux corps autour du centre de Pluton —
elles orbitent le barycentre Pluton-Charon, que la cubique suit et qu'une conique ignore).

La propagation a besoin d'un μ : `config/gravity.ts` le dérive des masses du catalogue, avec la
règle du problème à deux corps relatif — **la masse du parent plus tout ce qui orbite à
l'intérieur de l'orbite du corps, lui compris**. Charon pèse 12,2 % de Pluton : l'ignorer donnait
13° d'erreur de phase par pas.

### Le repli képlérien

Il sert quand un binaire manque, sort de sa couverture ou échoue au test de plausibilité —
notamment si les assets ne se chargent pas, auquel cas il travaille **aux dates courantes**.
Deux règles :

- **Le corps central n'est pas le Soleil.** `kepler.ts` déduit sinon le mouvement moyen de la
  constante de Gauss, soit μ☉ : un satellite tournait de 32× à 11 661× trop vite. Passer
  `periodDays` (la période publiée du catalogue) est obligatoire pour tout `relativeOrbitalElements`.
- **Les angles sont ÉCLIPTIQUES.** Les valeurs publiées le sont souvent par rapport à l'équateur
  de la planète, et rien ne distingue les deux dans un fichier de config — 8 jeux sur 20 étaient
  dans le mauvais repère. Ne pas les saisir à la main : `scripts/derive-relative-elements.mjs`
  (`pnpm ephemeris:elements`) les dérive des états exacts des binaires, donc du bon repère par
  construction.

### Ligne d'orbite : répartir les points, pas le temps

`computeOrbitPoints` échantillonne une période. Uniformément **dans le temps**, la deuxième loi
de Kepler place presque tous les points près de l'aphélie : Halley (e = 0,967) se retrouvait avec
une corde droite de 130° en travers du périhélie, et la courbe n'atteignait jamais sa distance
minimale. Les points sont donc répartis uniformément en **anomalie excentrique** dès que
e ≥ 0,2 — seule la répartition change, jamais la courbe.

### Tests qui verrouillent tout ça

| Fichier | Ce qu'il garde |
| --- | --- |
| `core/horizonsSatelliteOrbits.test.ts` | chaque satellite boucle un tour sur sa période, sur les binaires **réellement committés** |
| `core/relativeElements.test.ts` | le repli décrit la même orbite que le binaire (deux sources sans code commun) |
| `core/satelliteOrbitRate.test.ts` | la cadence du repli, sur la sortie observable |
| `core/twoBodyPropagation.test.ts` | la propagation, jusqu'à 40 révolutions |
| `core/orbitLineSampling.test.ts` | amplitude **et** régularité de la ligne, dans les deux modes |
| `core/ephemerisPlausibility.test.ts` | les deux bornes, sur 400 dates par fichier |
| `components/celestial/spinDirection.test.ts` | sens de rotation des 52 corps, dans les deux sens du temps |

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
   - `× (1 − terminatorDay(raw, wrap))` — nul **exactement** en `+wrap` : le côté éclairé garde
     son rendu à l'identique, la lueur n'existe que là où le sol a cessé d'être éclairé.

   Amplitude posée par **continuité**, pas à l'œil : le maximum vaut l'éclairement du sol au
   haut de la bande (`wrap × I × albédo / π`, albédo de Bond publié 0,306), donc la courbe
   rendue prolonge la rampe du jour au lieu de tomber d'une falaise. La teinte vient de
   `atmosphereColor` du catalogue, **normalisée en luminance** — elle choisit la couleur, jamais
   la luminosité. Après correction, mesuré au même endroit : 100 % des pixels au-dessus du
   plancher de +3,4° à −4,0°, 0 % dès −5,2° (les villes reprennent, contraste intact).

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

**Limites connues.** Saturne est rendue sans ses anneaux, alors que c'est à eux qu'on la
reconnaît : les projeter demande une ellipse, l'occultation par la sphère et son ombre portée.
Et les octets produits ne sont identiques d'une machine à l'autre que si les polices le sont —
le runner rend le texte en DejaVu Sans, un poste Windows en Segoe UI. La mise en page et les
chiffres suscrits tiennent dans les deux cas (vérifié à l'écran sur l'artefact déployé), mais ne
pas s'attendre à une comparaison d'empreinte entre local et production.

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
