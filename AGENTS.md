# Repository Guidelines

## Projet et frontières d’architecture

Galaxy est un viewer du système solaire en Vite, TypeScript strict et Three.js.

- `src/MainSolarSystemApp.ts` est la racine de composition UI : elle démarre l’application et câble les modules DOM.
- `src/SolarSystemApp.ts` est une façade headless : aucun `document`, `window` ou sélecteur DOM ; elle orchestre les systèmes et expose `PublicAPI`.
- `src/core/` contient l’horloge, les repères, les éphémérides, Kepler, les échelles et la logique pure testable.
- `src/components/systems/` contient les systèmes Three.js ; `src/components/celestial/` construit les meshes et leurs couches.
- `src/config/` est la source de vérité du code : `engine.ts`, `layerConfig.ts`, `catalog.ts`. Depuis le lot 7 (phase 4), la DONNÉE du catalogue est le registre `src/registry/entities/` (une fiche JSON par corps, `order.json` pour l'ordre) : `src/registry/load.ts` reconstruit `CelestialConfig` à l'identique, `config/bodies.ts` ne garde que la dérivation des textures et les contrôles. Les sondes et objets interstellaires viennent de `src/registry/spacecraft/` et `src/registry/interstellar/` ; leurs modules `config/` exposent les interfaces et exports dérivés.
- `src/ui/` contient un module par préoccupation DOM : navigation, playback, dates, modes, HUD, i18n, overlays et panneaux.
- `src/seo/` produit au BUILD les pages d’atterrissage par corps, le sitemap et les vignettes de partage. Module pur, importé uniquement par `vite.config.ts` via `ssrLoadModule` — jamais par l’application, jamais dans le bundle client.
- `e2e/` contient les scénarios Playwright ; les tests unitaires sont colocalisés en `*.test.ts`.
- `docs/ARCHITECTURE.md` décrit les flux, invariants et responsabilités ; `docs/TESTING.md` décrit la validation.

Utiliser l’alias `@/` pour les imports depuis `src`, par exemple `@/config/engine`.

## Commandes

Utiliser pnpm et le lockfile existant.

- `pnpm install` : installer les dépendances.
- `pnpm dev` : lancer Vite en développement.
- `pnpm typecheck` : vérifier TypeScript sans émission.
- `pnpm lint` : lancer ESLint.
- `pnpm test` : lancer Vitest.
- `pnpm verify` : gate rapide, typecheck + lint + tests unitaires.
- `pnpm build` : typecheck et build Vite de production.
- `pnpm test:e2e` : lancer Playwright sur Chromium et WebGL.
- `pnpm verify:all` : validation exhaustive, à utiliser avant une release ou un changement UI important.
- `pnpm format` / `pnpm format:check` : formater ou contrôler Prettier.
- `pnpm ephemeris:generate` : régénérer les données Horizons locales.
- `pnpm facts:snapshot` : relire les sources primaires des faits affichés (NASA, JPL, articles) vers `src/config/factSources.snapshot.json` (`--offline` : cache seul).
- `pnpm textures:resize` : générer les résolutions dérivées avec Sharp.

## Règles de code

TypeScript strict, ES modules, ESLint flat config et Prettier. Utiliser PascalCase pour les classes,
camelCase pour fonctions/variables et UPPER_SNAKE_CASE pour les constantes partagées. Préfixer les
paramètres volontairement inutilisés par `_`.

Le catalogue est prioritaire : ajouter un corps dans la configuration avant de toucher aux systèmes.
Brancher sur `kind`, `frame` ou les capacités de configuration, jamais sur le nom d’un corps dans un
système générique. Conserver l’invariant Exploration : rayons, distances et tailles angulaires restent
physiques ; les labels et overlays sont des instruments de navigation.

Chaque ressource Three.js doit avoir un propriétaire et un `dispose()` explicite. `TextureSystem` possède
le cache de textures ; les objets célestes possèdent géométries/matériaux ; `AnimationSystem` possède la
boucle RAF et ses callbacks. Éviter de disposer une texture partagée depuis un mesh individuel.

## Tests

Ajouter des tests Vitest déterministes pour les maths, catalogues, horloges, échelles, parsers et états
purs. Ajouter un scénario Playwright pour le boot, le câblage DOM, l’accessibilité observable ou une
interaction WebGL. `tsconfig.json` inclut `e2e` : les scénarios sont typés par `pnpm typecheck`, pas
seulement lintés. Les tests de PIXELS sont l'exception — voir `e2e/terminator.spec.ts` et la règle
sur les unités vérifiables ci-dessous — jamais le réflexe par défaut. Ne pas utiliser de délai arbitraire pour masquer une course ; attendre un état DOM
ou un contrat visible. Pour une modification UI/WebGL, exécuter `pnpm verify:all`.

## Méthode — ce qui a réellement attrapé des défauts ici

Ce projet a livré plusieurs bugs qui ne lèvent **aucune erreur et n'écrivent aucun log** : une
position fausse reste une position, une planète qui tourne à l'envers tourne quand même. Les
règles ci-dessous ne sont pas des principes généraux, ce sont celles qui ont fait la différence.

**Mesurer avant de conclure.** Devant un symptôme, produire un chiffre avant d'écrire une ligne
de correctif. Le raccourci « ça doit venir de X » a coûté plusieurs fausses pistes ; à l'inverse,
mesurer l'angle réellement balayé par un satellite sur une période a désigné le défaut en une
commande. Un correctif sans mesure avant/après n'est pas vérifié.

**Un statut vert n'est pas une preuve.** 22 runs CI d'affilée affichaient « annulé » et étaient
lus comme de l'instabilité ; le journal complet montrait 69 tests sur 88 passés puis un timeout de
job. Lire le log, pas le résumé. De même : un test qui passe ne prouve rien tant qu'on n'a pas
vérifié qu'il peut échouer.

**Falsifier chaque garde.** Réintroduire le défaut, confirmer que le test tombe, restaurer. Un
test de ce dépôt a déjà passé pendant des mois en ne prouvant rien (`0.5 % + 0.5 % > 0` sur un
écran noir). Le coût est de deux minutes, le bénéfice est de savoir ce que la suite garde vraiment.

**Se méfier d'un test qui mock la source de données.** Injecter un fournisseur vide ou un double
« neutre » fait souvent basculer le code sur un chemin de repli — le test mesure alors un
comportement que personne n'exécute en production. Deux cas réels ici : une garde d'orbite qui
n'exerçait que le repli képlérien et sautait silencieusement la moitié du catalogue, et un service
d'éphémérides privé de sa table de dynamique, donc de son interpolation réelle. Utiliser
`src/core/horizonsTestFixture.ts`, qui charge les vrais binaires committés.

**Une garantie doit être exprimée dans une unité vérifiée contre un pixel.** Le piège le plus
coûteux de ce dépôt, rencontré deux fois. Un garde-fou affirmait « la somme sol + villes ne
descend jamais sous sa valeur au terminateur » : vrai, falsifiable, vert — et l'écran noir, parce
que la valeur de référence (`wrap/4`, soit 2,6 % du plein soleil) est elle-même sous le plancher
d'affichage une fois multipliée par l'albédo et compressée par le tone mapping. Normaliser par une
grandeur invisible rend la garantie vide. Quand une propriété se juge à l'œil, la mesurer en
pixels : `?debug-terminator` existe pour ça.

**Chercher plus large que le symptôme rapporté.** « La marche arrière ne marche pas » a mené à
quatre défauts indépendants, et « 4 jeux d'éléments sont faux » s'est révélé en être 8. Quand un
défaut est trouvé, balayer toute la famille avant de conclure.

**Tout texte publié est une affirmation à confronter au code.** Pages générées (`/methodology`,
`/sources`, pages de corps), README, `docs/`, crédits de l'aide, mentions tierces, notes de
version. La première version du lot 3 contenait cinq phrases fausses, écrites de mémoire ou
reprises d'une doc antérieure, et un premier `pnpm verify` vert n'en voyait aucune. Règles :

- **Chaque phrase qui décrit un comportement se vérifie dans le code qui l'implémente** (ordre
  des sources, valeurs par défaut, ce qui est chargé au démarrage), jamais dans une doc
  précédente, un handoff ou un souvenir. Exemples réels : le SPK passe AVANT les fichiers
  Horizons (`FallbackPreciseEphemerisProvider(spk, horizons)`), le mode Éducatif agrandit aussi
  les corps, SBDB est interrogé au démarrage.
- **Aucun nombre ni liste recopiés à la main.** Les lire dans ce qui fait foi (constante exportée
  du module qui l'applique, manifest, catalogue, résumé de mesure). Dans une doc Markdown où
  rien ne peut être lu au build, renvoyer vers la page ou le fichier dérivé plutôt que recopier
  une liste qui périmera.
- **Une affirmation qui compte est tenue par un test** qui la confronte au code, et ce test est
  falsifié. Deux sources qui décrivent la même chose (prose et JSON, CSP et liste de services)
  sont confrontées par un test.
- **Les licences et conditions d'un tiers se lisent à la source, et se datent.** Vérifier aussi
  que l'attribution exigée est réellement AFFICHÉE dans l'application : Open-Meteo (CC BY 4.0,
  lien exigé près des données) n'était cité nulle part alors que ses données s'affichaient par
  défaut.
- **Relire le texte RENDU, dans chaque langue**, pas le gabarit ; pas de tiret cadratin dans un
  texte publié.
- **Après un changement visible** : axe-core sur la page, largeur mobile 390 px, puis la suite
  e2e COMPLÈTE. C'est elle qui a attrapé la double zone de défilement introduite dans le panneau
  météo par l'ajout de l'attribution.
- **Une doc qui se révèle fausse se corrige ou se marque « SUPERSEDED » avec la date**, au lieu
  de laisser coexister deux versions.

## Outils de diagnostic disponibles

| Outil | Ce qu'il donne |
| --- | --- |
| `?debug-solar` | longitude/latitude subsolaire rendue vs vérité astronomique, en direct |
| `?debug-meteo` | source, grille, texture, mesh cible et largeur de crépuscule de chaque couche météo |
| `?debug-terminator` | part de pixels au-dessus du plancher d'affichage par tranche de hauteur solaire (`window.terminatorProbe`) |
| `?debug-earth` | densité de la géométrie, maps actives, bascules d'isolation au clavier |
| `src/core/horizonsTestFixture.ts` | le service Horizons sur les binaires réels, hors navigateur |
| `pnpm ephemeris:elements` | éléments képlériens dérivés des états exacts des binaires |
| `pnpm test:perf` | FPS réel sous throttling CPU — comparer deux commits, pas lire une valeur absolue |

Pour comparer un avant/après de performance : `git checkout <ref>`, mesurer trois fois, revenir.
Une mesure unique ne vaut rien, l'écart machine est de l'ordre de 25 %.

## Pièges rencontrés, à ne pas redécouvrir

- **Un chiffre affiché sans source n'est plus publié.** Toute valeur de la fiche d'un corps porte
  `realData.sources[champ]` (registre `src/registry/providers/`) ou se déclare
  `unknown: { champ: NOT_YET_SOURCED }`. Ne pas « compléter » une case avec une valeur de mémoire
  ou d'encyclopédie : `factProvenance.test.ts` la compare à la source relevée.
- **GNU sed `\u` et l'outil Edit** : écrire l'échappement `\u00a0` par sed donne `00a0` (le `\u`
  met en majuscule), et l'outil Edit peut le convertir en vrai caractère insécable. Un test qui
  répète la même chaîne passe quand même : falsifier en remettant une espace normale.

- **`git checkout -- <fichier>` détruit le travail non commité** d'un fichier suivi. Pour annuler
  une modification temporaire sur un fichier qui porte aussi du travail en cours, sauvegarder puis
  restaurer la copie, jamais `checkout`.
- **`pnpm test:e2e -- --flag` ne transmet pas les arguments.** Vérifié : la suite entière s'exécute
  en ignorant `--shard` et `--list`. Appeler `pnpm exec playwright test --flag` directement.
- **`playwright.config.ts` impose `workers: 1` délibérément** (contention GPU en rendu logiciel).
  Pour accélérer, répartir sur des MACHINES (`--shard`, cf. `ci.yml`), jamais sur des workers.
- **Le job e2e a un timeout de 30 min par shard.** Une suite qui grossit doit être re-shardée, pas
  vue comme instable.
- **`--list` de Playwright démarre quand même le serveur de dev** dans cette configuration : ne pas
  l'utiliser pour une vérification rapide, il bloque.
- **`page.accessibility.snapshot()` n'existe plus** dans Playwright : passer par CDP
  `Accessibility.getFullAXTree` (`e2e/axTree.ts`). Et dans cet arbre, `expanded` revient en
  BOOLÉEN quand `pressed` revient en CHAÎNE (`tristate` ARIA) — comparer à `true` réussit pour
  l'un et échoue pour l'autre. Le helper normalise ; ne pas relire les propriétés brutes.
- **Retirer un `aria-label` ne suffit pas à falsifier un test de nom accessible** : `data-i18n-aria`
  le réapplique à l'exécution, et `title` fournit encore un repli. Pour vraiment falsifier, retirer
  les trois. (Vécu : la première tentative de falsification est passée au vert et donnait
  l'illusion d'un test inutile.)
- **Un asset publié par une agence n'est pas forcément la donnée qu'il prétend être.** Le seul
  petit corps du dépôt `nasa/NASA-3D-Resources` est un « Bennu » qui est en réalité une sphère
  bosselée (écart-type du rayon 0,76 % contre 6,00 % pour le vrai modèle de forme, rapport
  équateur/pôles 0,999 contre 1,118), au maillage nommé « Fake ». Licence impeccable, taille
  idéale, contenu faux. Mesurer une propriété caractéristique du corps AVANT d'intégrer un
  maillage — `scripts/decimate-shape-model.mjs` imprime les deux nombres qui suffisent.
- **Un modèle de forme se met à l'échelle par son volume, et porte son pôle sur +Y.** Ajuster
  son rayon MAXIMAL sur le rayon catalogue (un rayon moyen) affichait Bennu 15 % trop petit et
  aurait affiché Éros deux fois trop petit ; et le fichier de Bennu portait son pôle sur Z, si
  bien qu'il tournait autour d'un axe équatorial. `config/shapeModels.test.ts` tient les deux.
- **`THREE.Box3.getBoundingSphere()` ne donne pas le rayon d'un corps** mais celui de la sphère
  circonscrite à la BOÎTE, soit la demi-diagonale : √3 fois trop pour un corps rond. Un modèle
  ainsi mis à l'échelle sort 42 % trop petit et a l'air correct tant qu'on ne le compare pas à
  la sphère qu'il remplace. Utiliser `core/modelFit.ts`.
- **Un backtick dans un commentaire GLSL casse le fichier.** Les shaders sont injectés via des
  gabarits (template literals) : `` `rgb` `` dans un commentaire termine la chaîne. Le typecheck
  le signale, mais l'erreur pointe des lignes plus bas et se lit mal.
- **Le rendu logiciel des runners ne monte pas les `DataTexture`.** Les couches météo modèle y
  sortent noir opaque, avec ou sans correction — une assertion en pixels y serait verte pour une
  mauvaise raison. Vérifier ces couches par le contrat (`twilight=` dans `?debug-meteo`), pas par
  l'image.
- **Un document généré n'est pas reproductible juste parce qu'il est généré.** Deux pièges
  mesurés le 2026-09-18 en construisant `scripts/fingerprint-generated.mjs` : les pages de corps
  sont rendues depuis `dist/index.html`, donc elles portent le nom HACHÉ des bundles et changent
  à chaque commit sans qu'aucun contenu ne bouge ; et `vite.config.ts` écrit `new Date()` dans le
  `<lastmod>` du sitemap et le `dateModified` du JSON-LD, si bien que deux builds encadrant
  MINUIT UTC produisent trois documents différents à source identique. Avant de comparer des
  sorties de build, isoler ce qui est un tampon de build de ce qui est du contenu.
- **Les vignettes de partage ne sont pas comparables entre machines.** Leur texte est un SVG
  rendu par sharp avec `Segoe UI, Helvetica, Arial, DejaVu Sans, sans-serif`
  (`seo/socialCard.ts`) : un runner Linux ne sert pas les mêmes octets que Windows. Le rendu de
  la sphère, lui, est déterministe et sans police. Toute comparaison d'octets de vignette est
  donc locale, jamais une garde de CI (`fingerprint-generated.mjs --portable` les exclut).
- **Deux passages e2e complets peuvent rater des scénarios DIFFÉRENTS** (mesuré : `perf-fps` seul,
  puis quatre autres et `perf-fps` vert), tous verts en isolation. 91 scénarios rebootant chacun une
  app WebGL en rendu logiciel : c'est un régime de contention. Le levier est `playwright.config.ts`,
  jamais le code du scénario.

## Ce que garde chaque famille de tests

Avant de modifier ou d'assouplir un test, lire son en-tête : chacun documente le défaut réel qu'il
a attrapé. Les familles à ne pas affaiblir sans raison mesurée :

| Fichier | Contrat |
| --- | --- |
| `config/factProvenance.test.ts` | aucun fait affiché sans source primaire ; chaque valeur citée égale sa source relevée |
| `core/horizonsSatelliteOrbits.test.ts` | orbites des satellites sur les binaires committés |
| `core/relativeElements.test.ts` | le repli décrit la même orbite que le binaire |
| `core/orbitLineSampling.test.ts` | amplitude et régularité des lignes d'orbite, repli ET production |
| `core/twoBodyPropagation.test.ts` | propagation d'un état, jusqu'à 40 révolutions |
| `core/ephemerisPlausibility.test.ts` | bornes haute ET basse, 400 dates par fichier |
| `components/celestial/spinDirection.test.ts` | sens de rotation des 52 corps, deux sens du temps |
| `e2e/subsolar.spec.ts` | phase de rotation terrestre rendue vs vérité |
| `e2e/terminator.spec.ts` | la bande de crépuscule rend des pixels, et une couche modèle porte la largeur de SA couche |
| `e2e/a11y-tree.spec.ts` | noms accessibles et ÉTATS réels (arbre CDP), là où axe ne voit que des règles |
| `i18n/staticLabels.test.ts` | tout `aria-label`/`title` du HTML est lié à une clé, et son texte en dur égale la valeur anglaise |
| `e2e/touch.spec.ts` | profil d'appareil mobile réel + un vrai geste tactile sur OrbitControls |
| `config/layerConfig.test.ts` | contrat des matériaux : terminateur partagé, amplitude ancrée, couches d'instrument non ombrées |
| `seo/bodyLandingPage.test.ts` | chaque page est distincte (titre, description, canonique, vignette) et un repère HTML disparu casse le build |
| `seo/socialCard.test.ts` | la vignette est une sphère éclairée et détourée, et son SVG survit à un nom hostile |
| `core/modelFit.test.ts` | le rayon d'un maillage est mesuré sur ses sommets, pas sur la diagonale de sa boîte |
| `config/shapeModels.test.ts` | tout corps à modèle 3D reste affichable SANS lui, et aucun maillage n'entre sans crédit |

Le contrat de la chaîne de position est écrit une fois dans `docs/ARCHITECTURE.md`
§ « Position d'un corps » — le lire avant d'y toucher.

## Git et documentation

Utiliser des sujets Conventional Commits (`feat(ui):`, `fix(camera):`, `refactor(core):`, `docs:`).
Garder les commits ciblés. Une PR décrit le comportement, les commandes de validation et fournit une
capture pour tout changement visuel. Mettre à jour README et `docs/` lorsqu’un flux, une commande ou un
invariant change, et appliquer à ce texte la règle « Tout texte publié est une affirmation à
confronter au code » (section Méthode) : une doc mise à jour de mémoire est une doc fausse.

## Sécurité et assets

Ne jamais committer secrets, credentials Firebase, rapports générés ou sorties temporaires. Les textures
restent sous `public/assets/` et leur nom ne change qu’avec la configuration et les loaders associés.
