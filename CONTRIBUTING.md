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

## Style de code

- TypeScript strict, alias `@/` → `src/` pour les imports cross-module.
- Pas de commentaire qui répète ce que fait le code : uniquement le **pourquoi** quand ce n'est
  pas évident (contrainte cachée, invariant, contournement d'un bug précis).
- Pas d'abstraction ni de gestion d'erreur pour un cas qui ne peut pas se produire.
- `pnpm format` avant de committer (Prettier).

## Pull requests

1. Une branche par changement, `pnpm verify` (au minimum) vert avant d'ouvrir la PR.
2. Décrivez le **pourquoi**, pas seulement le quoi — surtout pour un ajout de corps céleste
   (source des données, licence des textures, vérification visuelle effectuée).
3. Pour un changement de rendu/caméra/UI, une capture d'écran ou un permalien
   (`?body=…&mode=…&date=…`) vers l'état concerné accélère la review — voir
   [`docs/PERMALINK_GALLERY.md`](docs/PERMALINK_GALLERY.md) pour le format et des exemples.
