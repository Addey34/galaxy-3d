# Contribuer

Merci de vouloir contribuer à ce projet. Ce guide couvre le cas le plus fréquent —
**ajouter un corps céleste** — puis le workflow général et la licence.

## Avant de commencer

- Lisez `README.md` (vue d'ensemble, architecture, commandes).
- Le code et les commentaires sont en **français** ; gardez cette convention dans vos changements.
- Le code est sous [PolyForm Noncommercial License 1.0.0](LICENSE.md) : consultation, étude et
  usage non commercial sont autorisés, l'usage commercial est réservé à l'auteur du projet.
  En contribuant, vous acceptez que votre contribution soit distribuée sous la même licence.

```bash
pnpm install
pnpm dev       # http://localhost:5173, hot reload
pnpm verify    # tsc --noEmit && eslint . && vitest run — à faire passer avant toute PR
```

`pnpm verify:all` (ajoute `pnpm build` + `pnpm test:e2e`) est le gate complet ; lancez-le si vous
touchez au rendu, à la caméra ou à une surface UI.

## Ajouter un corps céleste

Le catalogue est la **source unique de vérité**, et depuis le lot 7 (phase 4) c'est de la
donnée : chaque corps est une fiche `src/registry/entities/{nom}.json`, l'ordre de premier niveau
vit dans `src/registry/entities/order.json`, et `src/registry/load.ts` reconstruit le
`CelestialConfig` que lit toute l'application. `src/config/bodies.ts` ne contient plus que du
code (dérivation des chemins de texture, contrôles structurels). Boutons de navigation,
préchargement des textures, éphéméride et hiérarchie de scène en dérivent tous automatiquement ;
il n'y a **aucune autre édition à faire** — pas de `index.html`, pas de `EphemerisService`, pas de
distance caméra codée en dur ailleurs. Corps d'épreuve réel : 16 Psyché, ajoutée avec zéro `.ts`
touché — fiche JSON, ordre, vecteurs de référence et artefacts régénérés par script.

### 1. Choisir la source de position

| Le corps a...                                                         | Utiliser                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| une éphéméride `astronomy-engine` (planètes, Lune, lunes galiléennes) | champ `astroBody` (enum `Body` en chaîne) dans la fiche             |
| une orbite bien connue mais pas d'éphéméride native                   | `HorizonsEphemerisService` — générer un binaire (voir plus bas)     |
| aucun des deux (petit corps, astéroïde, comète, TNO)                  | fiche `"source": "small-body"` — éléments képlériens (`kepler.ts`)  |
| une trajectoire ouverte (objet interstellaire, e > 1)                 | fiche `src/registry/interstellar/{nom}.json` — `pnpm ephemeris:interstellar` (overlay hors `CelestialConfig`) |

**N'inventez jamais de position.** Toute donnée orbitale doit venir de JPL Horizons ou d'une
source publiée équivalente, vérifiée à l'époque exacte utilisée. Le projet a déjà eu plusieurs
bugs réels de ce type (positions décalées silencieusement, aucune erreur, aucun log — cherchez
« Horizons » dans l'historique git pour le détail). La leçon : toujours comparer la position
calculée à un vecteur d'état JPL réel avant de committer.

Une trajectoire hyperbolique ajoute deux pièges : son anomalie moyenne ne se réduit **jamais**
modulo 360° (Horizons donne 818° pour 3I/ATLAS, et c'est juste), et elle n'a pas de période, donc
sa ligne doit être bornée par une fenêtre et répartie en anomalie hyperbolique, pas dans le temps.
Les deux sont tenus par `src/config/interstellar.test.ts`.

#### Cas particulier : une lune

Une lune reçoit sa position du binaire Horizons de son parent, mais elle a **aussi** besoin d'un
jeu de secours `relativeOrbitalElements` — utilisé si le binaire manque, sort de sa couverture ou
échoue au contrôle de plausibilité, y compris quand les assets ne se chargent pas, cas où il
travaille aux dates courantes sous les yeux de l'utilisateur.

Deux pièges, tous deux déjà livrés en production :

1. **Les angles doivent être ÉCLIPTIQUES.** Les valeurs publiées (fiches JPL, articles) sont le
   plus souvent données par rapport à l'ÉQUATEUR de la planète, et rien ne distingue les deux
   dans un fichier de config. 8 jeux sur 20 étaient dans le mauvais repère : Charon était à i = 0°
   au lieu de 112,9°, soit 145° d'écart de position dès que le repli prenait la main.
2. **`realData.orbitPeriodDays` est obligatoire.** `kepler.ts` s'en sert comme mouvement moyen ;
   sans elle il le déduit de la constante de Gauss, c'est-à-dire du μ du SOLEIL, et la lune tourne
   de 32× à 11 661× trop vite selon la planète.

Ne saisissez donc pas ces éléments à la main :

```bash
pnpm ephemeris:elements        # les dérive des états exacts des binaires committés
```

Le script les sort déjà formatés pour le catalogue, dans le bon repère par construction.
`src/core/relativeElements.test.ts` compare ensuite le repli au binaire et échouera si l'un des
deux dérive. Exception assumée : un satellite qui n'orbite pas le centre de sa planète mais un
barycentre déporté (les quatre petites lunes de Pluton) n'a pas d'éléments osculateurs
exploitables — mieux vaut aucun repli qu'un repli faux.

### 2. Ajouter les textures

Déposer les fichiers dans `public/assets/textures/{nom}/` au format
`{nom}_{couche}_{résolution}.jpg` (snake_case). Couches possibles : `surface`, `clouds`,
`atmosphere`, `lights`, `normal_map`, `spec`, `ring`. Résolutions : `1k`/`2k`/`4k`/`8k` (mettez
la meilleure résolution **réellement disponible dans la source** — jamais une image upscalée
présentée comme native, `pnpm textures:audit` le détecte).

**Recherche de licence obligatoire avant tout import** : documentez la source dans
`src/registry/products/textures/` (une fiche par couche : provenance, licence, lien). Si aucune mosaïque photo réelle
n'existe pour ce corps (fréquent pour les petites lunes/astéroïdes), deux options honnêtes :

- `fallbackColor` (une couleur unie, pas d'invention de relief) ; ou
- une texture **procédurale** générée par `scripts/generate-procedural-textures.mjs` (bruit +
  cratères + éventuelles taches de givre), à condition de **sourcer chaque paramètre** dans un
  commentaire (article scientifique, mission spatiale) plutôt que de deviner un aspect plausible.

Dans les deux cas, ajoutez le nom du corps à `ILLUSTRATIVE_SURFACES` dans `src/config/catalog.ts`
— c'est ce qui affiche le badge « surface fictive » sur sa fiche d'info. C'est un piège connu du
projet : les tests passent sans lui, seule une vérification visuelle de la fiche le révèle.

### 3. Ajouter la fiche au registre

Une fiche `src/registry/entities/{nom}.json` (le schéma Zod est la seule déclaration,
`src/registry/schema/entity.ts`), plus l'id dans `order.json` (et dans la liste `satellites` de la
fiche parent pour une lune). Trois blocs :

- `config` : ce que le catalogue portait — `kind`, `astroBody` si applicable (étape 1),
  `cameraDistance` se déclare `{"$cameraFromRadiusKm": …}` (dérivé comme le littéral d'origine,
  égalité de bits garantie), `realData.orbitPeriodDays` pour la ligne d'orbite, `frame:
  'parentRelative'` pour une lune, `textureResolutions` (le chemin reste **dérivé de la clé**, ne
  l'écrivez jamais à la main). Un calcul ne s'écrit PAS : il se déclare par une forme nommée sur
  l'ensemble fermé de `src/registry/load.ts` (`{"$deg": …}`, `{"$gm": …}`, `{"$rotationHours":
  …}`…) — une forme inconnue est une erreur au chargement, jamais un repli.
- `elements` (petits corps, `"source": "small-body"`) : les éléments publiés en degrés/UA à leur
  époque exacte, relevés par `node scripts/derive-small-body-elements.mjs "16;" "16 Psyche (A852
  FA)" --epoch …` — jamais saisis ni recopiés ; le script imprime aussi le vecteur d'état à
  l'époque, à reporter dans `src/config/smallBodyReferenceVectors.json` (la garde refuse un corps
  sans vecteur).
- `facts` : un seul objet par fait — `value` (ou une forme dérivée), `source` (id du registre
  `src/registry/providers/`, jamais Wikipédia), `method` (`measured`/`derived`), `asOf` pour le
  nombre de lunes, `uncertainty`, `citation` — ou `published: false` + `reason` pour une valeur que
  la simulation utilise sans pouvoir la publier. `src/config/factProvenance.test.ts` refuse une
  valeur affichable sans source et compare chaque valeur citée à sa source telle que
  `pnpm facts:snapshot` l'a relevée (`src/config/factSources.snapshot.json`) : ajoutez la
  désignation SBDB du corps à `scripts/fact-source-targets.json` puis relancez le relevé, n'importez
  jamais un chiffre de mémoire.

Puis régénérez les artefacts dérivés, jamais édités à la main : `pnpm facts:snapshot`,
`pnpm ephemeris:validate` (désignation Horizons du corps dans
`scripts/validation-targets.json` au préalable — avec `expect`, la vérification de cible attrape un
numéro résolvant le mauvais corps), `pnpm build` puis `pnpm fingerprint:generated --write` (une
page et une vignette s'ajoutent : l'empreinte est la preuve que rien d'autre n'a bougé).

`assertUniqueBodyNames` rejette tout doublon de nom au chargement, et le chargeur refuse une fiche
que l'arbre (`order.json` + listes `satellites`) n'atteint pas.

**Pages d'éclipse.** Le build émet aussi une page par éclipse de 2024 à 2035
(`/eclipse/2026-08-12/`), calculée par `findUpcomingAstronomicalEvents` : il n'y a rien à saisir.
Leur titre vient des clés `title.eclipse.*` de `src/i18n/locales.ts` — une nouvelle combinaison
type × astre exige sa clé dans les deux langues, et `src/core/eclipsePages.test.ts` le vérifie.

**Ce que l'entrée déclenche ailleurs.** Le build en dérive aussi une page d'atterrissage
indexable (`dist/<nom>/index.html`), son entrée de sitemap et sa vignette de partage
(`dist/social/<nom>.jpg`). Deux conséquences concrètes :

- Le nom de catalogue devient un SEGMENT D'URL. Il doit rester en `[a-z0-9-]` : un accent, un
  espace ou un point produirait une URL encodée que l'application ne saurait plus relire, et la
  page s'ouvrirait sur la vue d'ensemble au lieu du corps. Un test le vérifie.
- Le corps doit avoir une texture de surface OU un `fallbackColor`. Sans l'un des deux, sa
  vignette est une boule grise anonyme qui prétend le montrer. Un test le vérifie aussi.

### 3 bis. Un modèle de forme (astéroïde, noyau cométaire)

Uniquement un **vrai modèle de forme scientifique** (PDS, archive de mission) à la licence
vérifiée — un maillage « publié par une agence » peut être une sphère bosselée. Passez-le par
`scripts/decimate-shape-model.mjs <source> public/assets/models/<nom>/<nom>_shape_<niveau>.glb --z-up --target <triangles>`,
une fois par niveau : `1k` = 4000, `2k` = 15000, `4k` = 60000 triangles (il lit GLB, OBJ et les
formats PDS ; `--z-up` ramène sur +Y le pôle des produits PDS, qui le portent sur Z). Le script
REFUSE un niveau que la source ne peut pas atteindre : ne livrez alors que les niveaux obtenus,
et déclarez-les dans `model.resolutions` (du plus fin au plus léger). Puis donnez-lui sa vraie
couleur : `node scripts/bake-shape-colour.mjs <nom> --albedo <pV publié> [--map carte.tif |
--rgb rouge,vert,bleu] [--lon0 <longitude du bord gauche>]`, en déclarant `model.albedo`,
`albedoSource` et `colourSource` (une carte de mission, ou `null` s'il n'en existe pas : couleur
uniforme, rien d'inventé). Lisez la longitude du bord gauche dans les métadonnées de la carte —
elle vaut 0° pour Bennu et Ryugu mais −180° pour Éros. `shapeModels.test.ts` vérifie que la
luminance cuite correspond à l'albédo déclaré. Le chemin n'est jamais écrit
à la main — `catalog.modelPath` le dérive, comme pour les textures, et l'application charge
d'abord le niveau léger puis monte selon la distance et le palier de qualité. Le script imprime les statistiques de forme pondérées par l'aire et le rayon
équivalent-volume avant/après : elles ne doivent pas bouger. `src/config/shapeModels.test.ts`
refuse ensuite un modèle dont l'axe de plus grande inertie n'est pas Y ou dont le volume ne
retrouve pas `radiusKm`. Déclarez aussi `model.extentRatio` : le rayon MAXIMAL du maillage
rapporté à son rayon équivalent-volume (Éros 2,10 ; Bennu 1,18). C'est lui qui arrête la caméra,
et le même test le compare au fichier — sous-estimé, l'objectif entre dans le maillage et l'écran
devient noir sans aucune erreur. Pour un corps sans binaire Horizons, les éléments viennent de
`scripts/derive-small-body-elements.mjs`, jamais d'une saisie.

### 4. Vérifier

```bash
pnpm verify              # types + lint + tests unitaires
pnpm textures:audit      # LOD présents sur disque, dimensions/projection cohérentes
pnpm dev                 # vérification visuelle réelle : ?body=<nom> en educ ET explo
```

Une vérification purement automatisée ne suffit pas ici : un mauvais `maDeg`/une mauvaise
`center` Horizons ne fait planter aucun test si vous ne comparez pas visuellement à la
littérature. Naviguez vers le corps dans les deux modes avant d'ouvrir la PR.

### Éphémérides Horizons (étape 1, cas binaire)

```bash
pnpm ephemeris:generate
```

Piège déjà rencontré sur ce projet, corrigé et regression-testé (`src/core/
ephemerisPlausibility.test.ts`) : ne jamais terminer un `COMMAND` Horizons par `;` pour un corps
majeur ou un satellite numéroté (dans `scripts/generate-horizons-ephemerides.mjs`) — ce suffixe
redirige vers la base des petits corps et peut matcher silencieusement un astéroïde sans rapport.
Seuls les vrais numéros de petit corps (Cérès, Éris, Hauméa, Makémaké...) en ont besoin.
`fetchBody()` vérifie déjà le nom de cible retourné par Horizons et lève une erreur en cas
d'écart — ne retirez pas ce garde-fou.

## Autres contributions

- **Bugs / suggestions** : ouvrez une issue avec le gabarit approprié
  (`.github/ISSUE_TEMPLATE/`).
- **UI/UX** : toute nouvelle surface vit dans `src/ui/` (un module par concern),
  `SolarSystemApp` reste headless (aucun accès DOM) — voir la structure de `src/` et
  `docs/ARCHITECTURE.md` dans le dépôt.
- **Invariant Exploration, non négociable** : le mode Exploration respecte les rayons, distances
  et tailles angulaires réels. N'ajoutez jamais de taille apparente minimale, de sprite proxy ou
  de mise à l'échelle visuelle dépendant de la distance — un corps lointain peut légitimement
  être invisible. Les aides de navigation vont dans la couche instrument (HUD/labels), jamais
  dans la géométrie du corps.
- **i18n** : toute chaîne d'interface visible passe par `t()`/`data-i18n*` (`src/i18n/`), en
  anglais et en français.

### Ajouter une couche visuelle sur un corps

Une couche se déclare dans `src/components/celestial/celestialLayers.ts` (mesh) et
`src/config/layerConfig.ts` (géométrie, matériau, rayon dans `LAYER_RADIUS_SCALE`). Avant
d'écrire la moindre ligne, trancher **ce que la couche est** — c'est cette question, longtemps
implicite, qui a laissé passer un défaut livré :

- **une apparence physique** (nuages, précipitations) : un objet qu'on verrait depuis l'orbite,
  donc éclairé par le Soleil, donc éteint la nuit. Lui donner une entrée dans
  `LAYER_TERMINATOR_WRAP`, choisie par son **altitude réelle** — un sommet d'orage reste au
  soleil après le coucher au sol, et c'est ce que la largeur encode ;
- **une couche d'instrument** (température, pression, humidité, vent) : un champ de données
  colorié, l'apparence de rien. Pas d'entrée : l'assombrir la nuit ne la rendrait pas plus
  réaliste, cela rendrait illisible une information. Même famille que le HUD et les labels.

La largeur est une propriété de la **couche**, jamais de la **source** de la donnée : une couche
satellite et sa jumelle « modèle » représentent la même chose sur le même mesh et doivent
traverser la nuit ensemble. Toute décision jour/nuit passe par `src/core/terminator.ts` —
jamais une formule maison, jamais une constante réglée à l'œil.

### Ajouter une donnée datée (couche, source de position, futur fournisseur)

Toute donnée affichée qui dépend de la date de la scène déclare DEUX choses, et le reste se
déduit (`src/core/temporal.ts`, contrat dans `docs/ARCHITECTURE.md` § « Modèle temporel ») :

1. **sa nature** (`ProductKind`) — une mesure, une réanalyse, un run de prévision, un calcul de
   position. C'est elle qui décide « observé » ou « reconstruit », et non la date : une réanalyse
   passée est un MODÈLE, l'appeler une observation était un défaut livré ;
2. **l'intervalle qu'elle décrit** (`validTime`) — le jour d'une tuile, le mois de MERRA-2,
   l'instant d'une position. L'écart entre cet intervalle et la date de la scène est calculé et
   AFFICHÉ dès qu'il dépasse le pas de la source.

Deux règles qui vont avec, chacune payée par un défaut : une source qui répond à n'importe quelle
date déclare la fenêtre où son écart a été MESURÉ, hors de laquelle elle est « extrapolée » ; et
hors de sa plage, une couche n'affiche RIEN plutôt que la donnée d'une autre date (elle masquait
la précédente sous l'étiquette de la date demandée). L'exactitude, elle, s'affiche à côté de la
catégorie, jamais fondue dedans.

### Faire briller un élément (halo lumineux)

Le halo ne choisit pas ses sources par luminance : il ne fait briller que ce qu'on lui
DÉCLARE (`src/components/systems/glowSelection.ts`). Pour un nouvel élément lumineux :

1. une entrée dans `GLOW_GAINS` (`src/config/engine.ts`), 1 étant la référence ;
2. `markGlowSource(objet, GLOW_GAINS.votreEntree)` là où l'objet est créé ;
3. `markGlowOccluder(objet)` sur tout nouvel objet OPAQUE qui doit pouvoir cacher un halo
   (une surface, un modèle de forme) — sinon le halo passe à travers lui.

Rien d'autre à toucher. Réglez le gain en MESURANT l'image (énergie d'une zone, avant/après),
pas à l'œil, et ajoutez l'objet au test `GlowPass.test.ts` qui vérifie le marquage des vraies
couches. Détails et chiffres : `docs/ARCHITECTURE.md` § « Halo lumineux ».

## Style de code

- TypeScript strict, alias `@/` → `src/` pour les imports cross-module.
- Pas de commentaire qui répète ce que fait le code : uniquement le **pourquoi** quand ce n'est
  pas évident (contrainte cachée, invariant, contournement d'un bug précis).
- Pas d'abstraction ni de gestion d'erreur pour un cas qui ne peut pas se produire.
- `pnpm format` avant de committer (Prettier).

## Écrire un test qui protège vraiment

Ce projet livre des bugs qui ne lèvent **aucune erreur** : une position fausse reste une
position, une planète qui tourne à l'envers tourne quand même. D'où deux exigences, apprises ici
et pas théoriques :

- **Falsifiez votre garde-fou.** Réintroduisez le défaut, vérifiez que le test tombe, restaurez.
  Deux minutes. Un test de ce dépôt a passé pendant des mois en ne prouvant rien : il vérifiait
  que deux rampes étaient `> 0` sur un intervalle, ce qui est toujours vrai — et `0,5 % + 0,5 %`
  passait l'assertion sur un écran noir.
- **Vérifiez l'unité de votre garantie.** Le même test, corrigé, affirmait ensuite « la somme ne
  descend jamais sous sa valeur au terminateur » : vrai, et l'écran toujours noir, parce que cette
  valeur de référence est elle-même sous le plancher d'affichage. Une propriété qui se juge à
  l'œil se mesure en pixels (`?debug-terminator`), pas en ratios d'une grandeur invisible.

## Écrire un texte public (docs, pages, crédits)

**Tout texte publié est une affirmation à confronter au code.** Une phrase publiée engage le
projet autant qu'un calcul. Avant de la proposer :

- **Vérifiez-la dans le code qui l'implémente**, pas dans une autre doc : l'ordre des sources de
  position, une valeur par défaut, ce qui est chargé au démarrage. La première version de la
  page `/methodology` affirmait l'inverse du code sur l'ordre SPK / Horizons.
- **Ne recopiez ni nombre ni liste** : dans les pages générées, lisez-les dans la source
  (constante exportée, manifest, catalogue, résumé de mesure) ; dans le Markdown, renvoyez vers
  la page dérivée (`/methodology`, `/sources`) plutôt que de figer une liste.
- **Lisez les licences à la source**, datez la lecture, et vérifiez que l'attribution exigée
  s'affiche réellement dans l'application.
- **Relisez le rendu dans les deux langues**, sans tiret cadratin (« — ») ni demi-cadratin
  entouré d'espaces : deux-points, virgule, parenthèses ou point. `src/seo/publishedText.test.ts`
  le vérifie sur les chaînes de l'application, les pages HTML et les fichiers publics du dépôt.
- **Pour un changement visible**, lancez axe (`pnpm test:a11y`), regardez la page à 390 px de
  large, et lancez la suite e2e complète (`pnpm test:e2e`).

## Pull requests

1. Une branche par changement, `pnpm verify` (au minimum) vert avant d'ouvrir la PR.
2. Décrivez le **pourquoi**, pas seulement le quoi — surtout pour un ajout de corps céleste
   (source des données, licence des textures, vérification visuelle effectuée).
3. Pour un changement de rendu/caméra/UI, une capture d'écran ou un permalien
   (`?body=…&mode=…&date=…`) vers l'état concerné accélère la review — voir
   [`docs/PERMALINK_GALLERY.md`](docs/PERMALINK_GALLERY.md) pour le format et des exemples.
