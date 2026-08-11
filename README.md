# Solar System 3D

**🌍 [Démo en ligne → galaxy-ag.web.app](https://galaxy-ag.web.app/)**

Visualisateur interactif du système solaire en temps réel, développé en TypeScript avec Three.js. Deux modes d'affichage : **Éducatif** (distances compressées en √, tout visible d'un coup) et **Exploration** (vraie échelle astronomique, positions Kepler calculées par éphéméride). Le mode Exploration est actif avec l'expérience « Voyage spatial » : suivi caméra, distances réelles, temps-lumière et marqueurs projetés.

## Aperçu

- Positions planetaires calculees via astronomy-engine, completees par des vecteurs NASA/JPL Horizons locaux pour Ceres, Eris, Haumea, Makemake, Saturne et ses lunes, Mars et ses lunes, Neptune/Triton et Pluto/Charon (1900-2100, interpolation position-vitesse)
- Time travel : naviguer librement dans le temps passé et futur
- Planètes multi-couches : surface PBR, nuages, atmosphère, lueurs nocturnes (shader GLSL)
- LOD automatique : résolution de texture adaptée à la distance caméra (1k → 8k)
- HUD Exploration avec cible suivie, distance UA/km, temps-lumière et labels de corps
- Responsive mobile avec qualité adaptative

Permaliens partageables, événements astronomiques, zoom optique et visite guidée au premier
démarrage complètent les contrôles de navigation, de temps et les deux modes d'échelle.

## Fonctionnalités d'exploration

- **Permalien** : rouvrir une sélection, un mode et une date depuis une URL.
- **Événements** : consulter les prochaines phases lunaires et éclipses.
- **Zoom optique** : ajuster le champ de vision en Exploration sans modifier la physique.
- **Visite guidée** : parcourir les commandes au clavier ou à la souris au premier démarrage.

## Stack

| Lib                                                          | Version | Rôle                                       |
| ------------------------------------------------------------ | ------- | ------------------------------------------ |
| [Three.js](https://threejs.org/)                             | 0.176   | Rendu WebGL 3D                             |
| [astronomy-engine](https://github.com/cosinekitty/astronomy) | 2.1.19  | Éphéméride — positions planétaires réelles |
| [@tweenjs/tween.js](https://github.com/tweenjs/tween.js/)    | 25.0    | Animations caméra fluides                  |
| [Vite](https://vitejs.dev/)                                  | 6.3     | Bundler + dev server                       |
| TypeScript                                                   | 6.0     | Typage strict                              |

## Installation

```bash
# Cloner le dépôt
git clone <url-du-repo>
cd SolarSystem3d

# Installer les dépendances (pnpm recommandé)
pnpm install

# Lancer le serveur de développement
pnpm dev
```

Ouvrir [http://localhost:5173](http://localhost:5173) dans le navigateur.

## Commandes

```bash
pnpm dev        # Serveur de dev avec hot reload
pnpm build      # tsc --noEmit (vérification de types) puis build de production → dist/
pnpm preview    # Servir le build de production localement
pnpm typecheck  # tsc --noEmit seul — vérification stricte des types, sans build
pnpm test       # vitest run — tests unitaires des modules mathématiques purs
pnpm test:e2e   # playwright test — tests navigateur sur le port dédié 5273
pnpm ephemeris:generate # régénérer les vecteurs précis depuis NASA/JPL Horizons
pnpm textures:resize    # generate missing derived texture resolutions
pnpm format     # Formater les fichiers TypeScript/CSS avec Prettier
pnpm format:check # Vérifier le formatage sans réécrire
pnpm lint       # eslint . (flat config) ; pnpm lint:fix pour corriger
pnpm verify     # tsc --noEmit && eslint . && vitest run (gate local rapide)
pnpm verify:all # verify + build + test:e2e (validation exhaustive)
```

## Textures

Les textures sont incluses dans le dépôt, sous `public/assets/textures/`, organisées par corps céleste :

```
public/assets/textures/
├── stars/
│   └── stars_surface_8k.jpg       (+ _4k, _2k, _1k)
├── sun/
│   └── sun_surface_4k.jpg         (+ _2k, _1k)
├── earth/
│   ├── earth_surface_8k.jpg       (+ _4k, _2k, _1k)
│   ├── earth_normal_map_8k.jpg
│   ├── earth_clouds_8k.jpg
│   ├── earth_spec_8k.jpg
│   └── earth_lights_8k.jpg        (lueurs nocturnes)
├── mars/
│   └── mars_surface_8k.jpg        (+ _4k, _2k, _1k)
├── venus/
│   ├── venus_surface_8k.jpg       (+ _4k, _2k, _1k)
│   └── venus_atmosphere_4k.jpg    (+ _2k, _1k)
├── saturn/
│   ├── saturn_surface_4k.jpg      (+ _2k, _1k)
│   └── saturn_ring_8k.jpg         (bande radiale, ratio conservé)
├── callisto/
│   └── callisto_surface_8k.jpg    (+ _4k, _2k, _1k)
└── …                              (un dossier par corps du catalogue)
```

Pattern de nom : `{corps}/{corps}_{couche}_{résolution}.jpg` (snake_case).
Le chemin est **dérivé de la clé du corps** (`src/config/catalog.ts` → `texturePath`) : aucun
chemin n'est écrit à la main dans le catalogue. Couches : `surface`, `clouds`, `atmosphere`,
`lights`, `normal_map`, `spec`, `ring`. Résolutions : `1k`, `2k`, `4k`, `8k` (la plus haute
selon le corps ; voir `src/config/engine.ts` pour les seuils de LOD).

## Fonctionnalités

### Modes d'affichage

| Mode                      | Distances                | Tailles        | Positions                               |
| ------------------------- | ------------------------ | -------------- | --------------------------------------- |
| **Éducatif** (`educ`)     | Compressées (`√AU × 35`) | Visuelles      | Angle réel, rayon visuellement comprimé |
| **Exploration** (`explo`) | Réelles (`AU × 35`)      | Physiques (km) | Vecteurs réels à l'échelle linéaire     |

Les lignes d'orbite sont disponibles dans les deux modes, pour tous les corps et après chaque
changement de date. Elles servent de repère global. Les deux modes utilisent le même vecteur
astronomique instantané ; seule la transformation d'échelle diffère.

Basculer avec les boutons **Éduc. / Explo.** dans l'interface. En Exploration, la caméra cible la Terre par défaut ; le HUD « Voyage spatial » affiche la cible, sa distance réelle et son temps-lumière. Les marqueurs projetés permettent de repérer les autres corps.

Le mode Exploration respecte strictement les rayons, distances et tailles angulaires physiques.
Un corps lointain peut donc être invisible à l'œil nu : les labels sont des instruments de
navigation, pas un agrandissement du rendu. Un éventuel zoom optique devra modifier le champ de
vision de la caméra, jamais l'échelle des objets.

### Contrôle du temps

- **Play / Pause** — figer la simulation
- **Réel / 1h/s / 3h/s / 6h/s** — vitesse de simulation
- **Champ date** — cliquer ou faire défiler la molette pour changer de jour
- **Champ heure** — idem pour naviguer heure par heure
- **Aujourd'hui** — revenir au présent
- Le point **LIVE** (vert) s'allume quand la simulation est à ±5 min du temps réel

### Navigation caméra

- **Clic + drag** — orbiter autour du point cible
- **Scroll** — zoom
- **Boutons de planète** — voler vers un corps céleste (animation 1.2 s)

### Couches visuelles (Terre)

1. **Surface** — `MeshStandardMaterial` PBR avec normal map et specular map
2. **Nuages** — sphère transparente légèrement plus grande (×1.01), rotation indépendante
3. **Lueurs nocturnes** — shader GLSL custom : les lumières de villes apparaissent uniquement côté nuit

## Architecture

```
src/
├── MainSolarSystemApp.ts     # Racine de composition — démarre l'app et les modules UI
├── SolarSystemApp.ts         # Façade — coordonne l'initialisation dans l'ordre
├── types.ts                  # Interfaces TypeScript partagées
│
├── core/
│   ├── EphemerisService.ts   # Wrapper astronomy-engine → positions en UA (prend des enums Body)
│   ├── frames.ts             # ⓟ Repères : équatorial J2000 → écliptique → Three.js
│   ├── orbitalGeometry.ts    # ⓟ Orbite éducative : position + projection inverse d'angle
│   ├── SimulationClock.ts    # Horloge simulée avec time travel et vitesse variable
│   ├── ScaleService.ts       # Conversion UA → unités Three.js (modes educ/explo)
│   └── OrbitalMechanics.ts   # Pilote les positions planétaires chaque frame
│   #  ⓟ = module pur sans état, testé unitairement (*.test.ts)
│
├── components/
│   ├── systems/
│   │   ├── AnimationSystem.ts  # Boucle requestAnimationFrame, frustum culling, LOD
│   │   ├── CameraSystem.ts     # OrbitControls + suivi de cible + tweens
│   │   ├── SceneSystem.ts      # Scène Three.js, renderer, hiérarchie des corps
│   │   ├── LightingSystem.ts   # AmbientLight + PointLight solaire
│   │   └── TextureSystem.ts    # Cache singleton + LOD textures
│   └── celestial/
│       ├── CelestialObject.ts        # Une planète (meshes, couches, shader, LOD textures)
│       ├── CelestialObjectFactory.ts # Crée tous les corps depuis la config
│       └── Starfield.ts              # Skybox étoilée
│
├── config/
│   ├── bodies.ts      # Catalogue des corps célestes (CELESTIAL_CONFIG) — SOURCE UNIQUE
│   ├── engine.ts      # Réglages moteur : rendu, perf/LOD, caméra, éclairage, shaders, textures
│   #  (imports via l'alias @/ → src/ ; ex. @/config/engine, @/core/frames)
│   ├── catalog.ts     # Itération/résolution du catalogue (forEachBody, flattenBodies)
│   └── layerConfig.ts # Géométries et matériaux Three.js
│
├── ui/
│   ├── planetNav.ts, modeSwitcher.ts # Navigation et modes
│   ├── playback.ts, timePanel.ts      # Lecture et voyage temporel
│   ├── exploHud.ts                    # HUD et labels « Voyage spatial »
│   └── loader.ts, fullscreen.ts       # Contrôles transverses
│
├── shaders/
│   └── NightLightsShader.ts  # GLSL vertex + fragment shader pour les lueurs nocturnes
│
└── utils/
    ├── Logger.ts      # Logs colorés (silencieux en production sauf erreurs)
    └── FPSCounter.ts  # Compteur FPS overlay
```

### Séquence de démarrage

```
index.html
  └── MainSolarSystemApp.ts (racine de composition async)
        ├── SolarSystemApp.init(progressCallback)
              ├── TextureSystem.preloadCriticalTextures()   0 → 40%
              ├── SceneSystem.init()                        45%
              ├── LightingSystem.setup()                    60%
              ├── CelestialObjectFactory.createAll()        75%
              ├── SceneSystem.setupCelestialBodies()        85%
              ├── CameraSystem.init()
              ├── EphemerisService + SimulationClock
              ├── OrbitalMechanics (hook onOrbitsChanged)
              ├── _recomputeOrbits()                        95%
        │     └── AnimationSystem.run()
        │                 → boucle infinie
        └── setup*Controls() + ExploHud
```

### Flux par frame

```
requestAnimationFrame
  ├── tweenGroup.update()              Animations caméra
  ├── OrbitalMechanics.update()
  │     ├── SimulationClock.syncToRealTime()
  │     └── EphemerisService → body.group.position  (positions Kepler)
  ├── Frustum culling (une passe pour tous les objets)
  ├── CelestialObject.update() × N
  │     ├── Rotation du mesh + nuages
  │     └── Shader uniforms (position du soleil)
  ├── CameraSystem.update()            Suivi de la planète cible
  ├── ExploHud.update()                HUD + labels projetés (si Explo)
  └── renderer.render(scene, camera)
```

### Système d'échelle

```
Mode Éducatif   : position = √(distanceAU) × 35   (compression visuelle)
Mode Exploration : position = distanceAU × 35      (vraie proportionnalité)

Pour un satellite parent-relative, le mode Éducatif applique en plus un facteur commun
au groupe de satellites afin de garder chaque lune hors du parent tout en conservant
l’ordre de distance réel. Le mode Exploration n’applique aucun facteur visuel.

Terre (1 AU) → 35 unités dans les deux modes (point de calibration commun)
```

### Conversion de coordonnées (EphemerisService)

```
astronomy-engine retourne des vecteurs en équatorial J2000 (UA)
         ↓
Rotation de 23.4394° (obliquité de l'écliptique)
         ↓
Repère écliptique → Three.js XZ-plane
  Three.X = equatorial X
  Three.Z = equatorial Y × cos(ε) + Z × sin(ε)   (plan écliptique)
  Three.Y = -equatorial Y × sin(ε) + Z × cos(ε)  (≈ 0 pour les planètes)
```

## Ajouter un corps céleste

Le catalogue (`src/config/bodies.ts`) est la **source unique** : boutons de navigation, préchargement des textures, éphéméride et hiérarchie de scène s'en dérivent automatiquement.

1. Déposer les textures dans `public/assets/textures/{nom}/` au format
   `{nom}_{couche}_{résolution}.jpg` (snake_case). Le pipeline `scripts/import-textures.mjs`
   génère les variantes de résolution depuis une source brute (TIF/JPG/PNG) sans jamais
   agrandir au-delà de la source.
2. Ajouter **une seule entrée** dans `CELESTIAL_CONFIG.bodies` (`src/config/bodies.ts`) :
   - `kind` : `'planet'` (ou `'moon'`, `'star'`, `'skybox'`)
   - `astroBody` : l'enum `Body` d'astronomy-engine (positions réelles)
   - `cameraDistance: { educ, explo }` : distances de visite caméra
   - `loadPriority` : rang de préchargement (croissant) — optionnel
   - `realData.orbitPeriodDays` : période orbitale documentaire
   - `textureResolutions` : les couches et résolutions disponibles (le **chemin** est
     dérivé de la clé, pas à écrire à la main)
   - Pour une lune : `frame: 'parentRelative'` et l'imbriquer dans `satellites` du parent

Aucune édition de `index.html`, `EphemerisService` ni des distances caméra n'est nécessaire.

### Éphémérides précises Horizons

Les fichiers binaires de `public/assets/ephemerides/` contiennent les états héliocentriques
JPL en écliptique J2000, avec positions en UA et vitesses en UA/jour. Ils couvrent 1900–2100
avec un pas de quatre jours ; `HorizonsEphemerisService` interpole entre deux états par une
courbe cubique de Hermite. Hors couverture ou si les assets sont indisponibles, le moteur
revient automatiquement aux éléments képlériens du catalogue.

SpkKernel lit les kernels DAF/SPK en types 2 et 3 (Chebyshev), SpkPositionReader convertit le J2000 equatorial en repere Galaxy, et SpkKernelWorkerClient deplace le chargement et le parsing hors du thread principal ; avec une URL configuree, le Worker lit d abord les tables DAF puis les segments requis par HTTP Range. L application continue d utiliser Horizons par defaut.

Pour activer le chemin SPK optionnel, definir `VITE_SPK_KERNEL_URL` vers un kernel same-origin avant le demarrage Vite. Le provider Worker se charge en tache de fond, utilise les vitesses pour une extrapolation courte et revient a Horizons ou Kepler en cas de manque.

Le mode de publication du gros kernel SAT441 et sa vérification HTTP Range sont détaillés dans [`docs/SPK_DEPLOYMENT.md`](docs/SPK_DEPLOYMENT.md).

Pour actualiser les solutions orbitales après une mise à jour JPL :

```bash
pnpm ephemeris:generate
```

Le moteur depend du contrat PreciseEphemerisProvider : Horizons reste la source embarquee par defaut, tandis que SpiceEphemerisService fournit le point d injection pour un lecteur SPK externe.

## Configuration

Réglages moteur dans `src/config/engine.ts`, catalogue des corps dans `src/config/bodies.ts` :

| Constante                                   | Fichier     | Rôle                                             |
| ------------------------------------------- | ----------- | ------------------------------------------------ |
| `APP_SETTINGS.performance.targetFPS`        | engine      | FPS cible (défaut 60)                            |
| `APP_SETTINGS.performance.textureQuality`   | engine      | Seuils de distance LOD par qualité               |
| `LIGHTING_SETTINGS`                         | engine      | Intensité lumière ambiante et solaire            |
| `SHADER_SETTINGS.nightLights`               | engine      | Intensité / seuil / douceur des lueurs nocturnes |
| `CAMERA_SETTINGS.defaultBodyDistance`       | engine      | Distance caméra fallback                         |
| `CELESTIAL_CONFIG.bodies[*].cameraDistance` | bodies      | Distance de visite par corps `{ educ, explo }`   |
| `SIMU_SCALES`                               | ui/playback | Vitesses disponibles : `[1, 3600, 10800, 21600]` |

## Dépendances de développement

- **TypeScript strict** (`tsconfig.json`) — Vite sert/compile le TS via esbuild (pas de vérification de types en dev) ; `pnpm typecheck` ou `pnpm build` (qui lance `tsc --noEmit`) valide réellement les types
- **Vitest** — tests unitaires des modules mathématiques purs (`src/**/*.test.ts`) ; `pnpm verify` = types + lint + tests
- **ESLint** — `eslint.config.js` (flat config, typescript-eslint recommended non-type-checked) ; `pnpm lint` / `pnpm lint:fix`, intégré à `pnpm verify`
- **Prettier** — règles dans `.prettierrc`, commandes `pnpm format` et `pnpm format:check` ; l'arbre entier est conforme
- **Playwright** — 18 scénarios navigateur dans `e2e/` (`smoke`, `modes`, `explo`, `i18n`, `guided-tour`) ; le serveur Vite de test utilise le port réservé 5273
- Aucun seuil de couverture configuré

## Qualité et limites actuelles

- pnpm verify passe avec 132 tests repartis dans 33 fichiers ;
- `pnpm build` passe sans avertissement de taille : `three`, `astronomy-engine` et `tween` sont séparés, et le chunk applicatif reste autour de 120 kB minifié.
- Le mode Exploration est actif. Les vols caméra concurrents sont annulés et la cible suivie reste centrée, y compris à vitesse accélérée.
- `IS_MOBILE` reste figé pour les réglages créés à l'initialisation (anticrénelage, ombres, textures) ; seul le plafond de pixel ratio est recalculé au resize.
- `frame: 'parentRelative'` calcule `helio(corps) − helio(parent)`. Les lunes joviennes viennent d'Astronomy Engine ; les lunes saturniennes utilisent les vecteurs locaux NASA/JPL Horizons issus de SAT441.
- `.gitattributes` normalise les fichiers texte en LF ; `pnpm format:check` passe sur tout l'arbre.

## Direction de développement

En résumé : d'abord rendre le projet visible (déploiement public, CI, SEO) et instructif
(fiches d'information par corps, i18n FR/EN, transition animée Éducatif→Exploration), ensuite
donner des raisons de revenir — permaliens, événements astronomiques, zoom optique FOV et visite
guidée sont désormais livrés ; restent les lunes majeures et le mode hors-ligne (PWA). À terme,
en faire une référence (missions spatiales, WebXR).

## Documentation technique

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — frontières, cycle de vie et invariants
- [`docs/TESTING.md`](docs/TESTING.md) — stratégie et commandes de validation
- [docs/UNIVERSE_CATALOG.md](docs/UNIVERSE_CATALOG.md) - catalogue, assets et feuille de route de l'univers
- [`AGENTS.md`](AGENTS.md) — règles de contribution pour les agents et développeurs

## Déploiement

Le site public est hébergé sur Firebase Hosting (`galaxy-ag`). La CI GitHub vérifie le projet ; le déploiement est réalisé sur Firebase Hosting.

```bash
pnpm build
firebase deploy --only hosting:galaxy
```

## Licence

Code sous **PolyForm Noncommercial License 1.0.0** — consultation, étude et usage
non commercial autorisés ; l'usage commercial est réservé à l'auteur. Voir
[`LICENSE.md`](LICENSE.md). Les textures planétaires restent soumises à leurs
licences d'origine (Solar System Scope, NASA).

## Catalogue de l'univers

Le catalogue actuel couvre le Soleil, les huit planetes, la Lune, Io, Europe, Ganymede et Callisto, cinq planetes naines et
les petits corps Ceres, Vesta, Pallas, Hygiea, Eris, Haumea, Makemake et Halley. Les
textures presentes suivent le schema public/assets/textures/{body}/{body}_{layer}_{quality}.jpg
(snake_case, chemin derive de la cle du corps). Le fallback colore reste disponible si un asset
manque au chargement.
Les lunes joviennes (Io couleur, Europe, Ganymede, Callisto) disposent de mosaiques USGS
haute resolution jusqu'a 8k. Titan, Encelade, Rhea et Japet sont disponibles autour de Saturne
avec des orbites relatives keplerienne et des mosaiques Cassini/Voyager validees par l'USGS.
Triton, Charon, Phobos et Deimos sont navigables avec des vecteurs locaux Horizons relatifs au
parent et des textures USGS/NASA. Les provenances et licences sont tracees dans
scripts/texture-sources.json (bloc `imported`).

La feuille de route complete distingue :

- les lunes et petits corps du Systeme solaire ;
- les ceintures, populations, missions et trajectoires artificielles ;
- les etoiles proches et les systemes exoplanetaires ;
- les nebuleuses, amas, galaxies et vues cosmologiques.

Les spheres naturelles utilisent les geometries Three.js et des couches texturees. Les modeles
GLB, les missions et le ciel profond attendent un contrat de referentiel, licence, LOD,
proprietaire GPU et fallback. Voir docs/UNIVERSE_CATALOG.md avant tout nouvel asset.

## Audit des textures

`pnpm textures:audit` verifie que chaque texture declaree dans le catalogue possede ses LOD sur disque et controle les dimensions/projections JPEG avec Sharp. Une resolution 8k generee par upscale n'est jamais consideree comme une source native : le catalogue est plafonne a la meilleure resolution reelle disponible.

Les avertissements de largeur non canonique sont conserves volontairement pour les sources historiques (par exemple Halley 3674 px et le bump lunaire 4000 px) ; ils signalent une approximation documentee, pas une texture manquante.
