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

Le catalogue est la **source unique de vérité** : boutons de navigation, préchargement des
textures, éphéméride et hiérarchie de scène en dérivent tous automatiquement. Il n'y a **aucune
autre édition à faire** — pas de `index.html`, pas de `EphemerisService`, pas de distance caméra
codée en dur ailleurs.

### 1. Choisir la source de position

| Le corps a...                                                         | Utiliser                                                        |
| --------------------------------------------------------------------- | --------------------------------------------------------------- |
| une éphéméride `astronomy-engine` (planètes, Lune, lunes galiléennes) | `astroBody` (enum `Body`) directement                           |
| une orbite bien connue mais pas d'éphéméride native                   | `HorizonsEphemerisService` — générer un binaire (voir plus bas) |
| aucun des deux (petit corps, astéroïde, comète, TNO)                  | `config/smallBodies.ts` — éléments képlériens (`kepler.ts`)     |

**N'inventez jamais de position.** Toute donnée orbitale doit venir de JPL Horizons ou d'une
source publiée équivalente, vérifiée à l'époque exacte utilisée. Le projet a déjà eu plusieurs
bugs réels de ce type (positions décalées silencieusement, aucune erreur, aucun log — cherchez
« Horizons » dans l'historique git pour le détail). La leçon : toujours comparer la position
calculée à un vecteur d'état JPL réel avant de committer.

#### Cas particulier : une lune

Une lune reçoit sa position du binaire Horizons de son parent, mais elle a **aussi** besoin d'un
jeu de secours `relativeOrbitalElements` — utilisé si le binaire manque, sort de sa couverture ou
échoue au contrôle de plausibilité, y compris quand les assets ne se chargent pas, cas où il
travaille aux dates courantes sous les yeux de l'utilisateur.

Deux pièges, tous deux déjà livrés en production :

1. **Les angles doivent être ÉCLIPTIQUES.** Les valeurs publiées (Wikipédia, fiches JPL) sont le
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
`scripts/texture-sources.json` (provenance, licence, lien). Si aucune mosaïque photo réelle
n'existe pour ce corps (fréquent pour les petites lunes/astéroïdes), deux options honnêtes :

- `fallbackColor` (une couleur unie, pas d'invention de relief) ; ou
- une texture **procédurale** générée par `scripts/generate-procedural-textures.mjs` (bruit +
  cratères + éventuelles taches de givre), à condition de **sourcer chaque paramètre** dans un
  commentaire (article scientifique, mission spatiale) plutôt que de deviner un aspect plausible.

Dans les deux cas, ajoutez le nom du corps à `ILLUSTRATIVE_SURFACES` dans `src/config/catalog.ts`
— c'est ce qui affiche le badge « surface fictive » sur sa fiche d'info. C'est un piège connu du
projet : les tests passent sans lui, seule une vérification visuelle de la fiche le révèle.

### 3. Ajouter l'entrée au catalogue

Une seule entrée dans `CELESTIAL_CONFIG.bodies` (`src/config/bodies.ts`) :

- `kind` : `'planet'` / `'moon'` / `'star'` / `'skybox'`
- `astroBody` si applicable (étape 1)
- `cameraDistance: { educ, explo }` : distances de visite caméra dans les deux modes
- `loadPriority` (optionnel) : rang de préchargement
- `realData.orbitPeriodDays` : période orbitale, pour tracer la ligne d'orbite
- `textureResolutions` : couches/résolutions disponibles — le chemin est **dérivé de la clé**,
  ne l'écrivez jamais à la main
- Pour une lune : `frame: 'parentRelative'`, imbriquée dans `satellites` du parent

`assertUniqueBodyNames` rejette tout doublon de nom au chargement.

**Ce que l'entrée déclenche ailleurs.** Le build en dérive aussi une page d'atterrissage
indexable (`dist/<nom>/index.html`), son entrée de sitemap et sa vignette de partage
(`dist/social/<nom>.jpg`). Deux conséquences concrètes :

- Le nom de catalogue devient un SEGMENT D'URL. Il doit rester en `[a-z0-9-]` : un accent, un
  espace ou un point produirait une URL encodée que l'application ne saurait plus relire, et la
  page s'ouvrirait sur la vue d'ensemble au lieu du corps. Un test le vérifie.
- Le corps doit avoir une texture de surface OU un `fallbackColor`. Sans l'un des deux, sa
  vignette est une boule grise anonyme qui prétend le montrer. Un test le vérifie aussi.

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

## Pull requests

1. Une branche par changement, `pnpm verify` (au minimum) vert avant d'ouvrir la PR.
2. Décrivez le **pourquoi**, pas seulement le quoi — surtout pour un ajout de corps céleste
   (source des données, licence des textures, vérification visuelle effectuée).
3. Pour un changement de rendu/caméra/UI, une capture d'écran ou un permalien
   (`?body=…&mode=…&date=…`) vers l'état concerné accélère la review — voir
   [`docs/PERMALINK_GALLERY.md`](docs/PERMALINK_GALLERY.md) pour le format et des exemples.
