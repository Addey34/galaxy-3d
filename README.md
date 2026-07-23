# Solar System 3D

**🌍 [Démo en ligne → addey34.github.io/SolarSystem3D](https://addey34.github.io/SolarSystem3D/)**

Visualisateur interactif du système solaire en temps réel, développé en TypeScript avec Three.js. Deux modes d'affichage : **Éducatif** (distances compressées en √, tout visible d'un coup) et **Exploration** (vraie échelle astronomique, positions Kepler calculées par éphéméride). Le mode Exploration est actif avec l'expérience « Voyage spatial » : suivi caméra, distances réelles, temps-lumière et marqueurs projetés.

## Aperçu

- Positions planétaires calculées via `astronomy-engine`, complétées par des vecteurs NASA/JPL
  Horizons pour Cérès, Éris, Hauméa et Makémaké (1900–2100, interpolation position-vitesse)
- Time travel : naviguer librement dans le temps passé et futur
- Planètes multi-couches : surface PBR, nuages, atmosphère, lueurs nocturnes (shader GLSL)
- LOD automatique : résolution de texture adaptée à la distance caméra (1k → 8k)
- HUD Exploration avec cible suivie, distance UA/km, temps-lumière et labels de corps
- Responsive mobile avec qualité adaptative

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
pnpm format     # Formater les fichiers TypeScript/CSS avec Prettier
pnpm format:check # Vérifier le formatage sans réécrire
pnpm lint       # eslint . (flat config) ; pnpm lint:fix pour corriger
pnpm verify     # tsc --noEmit && eslint . && vitest run (à lancer avant de considérer une tâche finie)
```

## Textures

Les textures sont incluses dans le dépôt, sous `public/assets/textures/`, organisées par corps céleste :

```
public/assets/textures/
├── stars/
│   └── starsSurface_8k.jpg
├── sun/
│   └── sunSurface_4k.jpg          (+ _2k, _1k)
├── earth/
│   ├── earthSurface_8k.jpg        (+ _4k, _2k, _1k)
│   ├── earthNormalMap_8k.jpg
│   ├── earthClouds_8k.jpg
│   ├── earthSpec_8k.jpg
│   └── earthLights_8k.jpg         (lueurs nocturnes)
├── moon/
│   ├── moonSurface_8k.jpg
│   └── moonBump_4k.jpg
├── mars/
│   ├── marsSurface_8k.jpg
│   └── marsNormalMap_1k.jpg
├── mercury/
│   ├── mercurySurface_8k.jpg
│   └── mercuryBump_1k.jpg
├── venus/
│   ├── venusSurface_8k.jpg
│   ├── venusAtmosphere_4k.jpg
│   └── venusBump_1k.jpg
├── jupiter/
│   └── jupiterSurface_4k.jpg
├── saturn/
│   ├── saturnSurface_4k.jpg
│   └── saturnRing_8k.jpg
├── uranus/
│   └── uranusSurface_2k.jpg
└── neptune/
    └── neptuneSurface_2k.jpg
```

Pattern de nom : `{corps}/{corps}{Type}_{résolution}.jpg`
Résolutions disponibles : `1k`, `2k`, `4k`, `8k` (selon le corps, voir `src/config/engine.ts`).

## Fonctionnalités

### Modes d'affichage

| Mode                      | Distances                | Tailles        | Positions                               |
| ------------------------- | ------------------------ | -------------- | --------------------------------------- |
| **Éducatif** (`educ`)     | Compressées (`√AU × 35`) | Visuelles      | Angle réel, rayon visuellement comprimé |
| **Exploration** (`explo`) | Réelles (`AU × 35`)      | Physiques (km) | Vecteurs réels à l'échelle linéaire     |

Les lignes d'orbite sont visibles uniquement en Éducation, pour tous les corps et après chaque
changement de date. Elles servent de repère global ; l'Exploration n'en dessine aucune. Les deux
modes utilisent le même vecteur astronomique instantané ; seule la transformation d'échelle
diffère.

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

1. Déposer les textures dans `public/assets/textures/{nom}/`
2. Ajouter **une seule entrée** dans `CELESTIAL_CONFIG.bodies` (`src/config/bodies.ts`) :
   - `kind` : `'planet'` (ou `'moon'`, `'star'`, `'skybox'`)
   - `astroBody` : l'enum `Body` d'astronomy-engine (positions réelles)
   - `cameraDistance: { educ, explo }` : distances de visite caméra
   - `loadPriority` : rang de préchargement (croissant) — optionnel
   - `realData.orbitPeriodDays` : période orbitale documentaire
   - Pour une lune : `frame: 'parentRelative'` et l'imbriquer dans `satellites` du parent

Aucune édition de `index.html`, `EphemerisService` ni des distances caméra n'est nécessaire.

### Éphémérides précises Horizons

Les fichiers binaires de `public/assets/ephemerides/` contiennent les états héliocentriques
JPL en écliptique J2000, avec positions en UA et vitesses en UA/jour. Ils couvrent 1900–2100
avec un pas de quatre jours ; `HorizonsEphemerisService` interpole entre deux états par une
courbe cubique de Hermite. Hors couverture ou si les assets sont indisponibles, le moteur
revient automatiquement aux éléments képlériens du catalogue.

Pour actualiser les solutions orbitales après une mise à jour JPL :

```bash
pnpm ephemeris:generate
```

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
- **Playwright** — neuf scénarios navigateur dans `e2e/` (`smoke` + `explo`) ; le serveur Vite de test utilise le port réservé 5273
- Aucun seuil de couverture configuré

## Qualité et limites actuelles

- `pnpm verify` passe avec 59 tests répartis dans 12 fichiers ; Playwright complète cette couverture avec 9 scénarios DOM/WebGL.
- `pnpm build` passe sans avertissement de taille : `three`, `astronomy-engine` et `tween` sont séparés, et le chunk applicatif reste autour de 80 kB minifié.
- Le mode Exploration est actif. Les vols caméra concurrents sont annulés et la cible suivie reste centrée, y compris à vitesse accélérée.
- `IS_MOBILE` reste figé pour les réglages créés à l'initialisation (anticrénelage, ombres, textures) ; seul le plafond de pixel ratio est recalculé au resize.
- `frame: 'parentRelative'` calcule `helio(corps) − helio(parent)`. Astronomy Engine ne fournit toutefois une éphéméride naturelle que pour la Lune.
- `.gitattributes` normalise les fichiers texte en LF ; `pnpm format:check` passe sur tout l'arbre.

## Direction de développement

En résumé : d'abord rendre le projet visible (déploiement public, CI, SEO) et instructif
(fiches d'information par corps, i18n FR/EN, transition animée Éducatif→Exploration), puis
donner des raisons de revenir (permaliens, événements astronomiques, zoom optique FOV, lunes
majeures), et à terme en faire une référence (tours guidés, missions spatiales, WebXR).

## Licence

Code sous **PolyForm Noncommercial License 1.0.0** — consultation, étude et usage
non commercial autorisés ; l'usage commercial est réservé à l'auteur. Voir
[`LICENSE.md`](LICENSE.md). Les textures planétaires restent soumises à leurs
licences d'origine (Solar System Scope, NASA).
