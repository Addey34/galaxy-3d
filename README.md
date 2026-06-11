# Solar System 3D

Visualisateur interactif du système solaire en temps réel, développé en TypeScript avec Three.js. Deux modes d'affichage : **Explo** (distances compressées, tout visible d'un coup) et **Simu** (vraie échelle astronomique, positions Kepler calculées par éphéméride).

## Aperçu

- Positions planétaires calculées via la bibliothèque `astronomy-engine` (éphéméride J2000)
- Time travel : naviguer librement dans le temps passé et futur
- Planètes multi-couches : surface PBR, nuages, atmosphère, lueurs nocturnes (shader GLSL)
- LOD automatique : résolution de texture adaptée à la distance caméra (1k → 8k)
- Sprite LOD en mode Simu pour les planètes lointaines
- Responsive mobile avec qualité adaptative

## Stack

| Lib | Version | Rôle |
|-----|---------|------|
| [Three.js](https://threejs.org/) | 0.176 | Rendu WebGL 3D |
| [astronomy-engine](https://github.com/cosinekitty/astronomy) | 2.1.19 | Éphéméride — positions planétaires réelles |
| [@tweenjs/tween.js](https://github.com/tweenjs/tween.js/) | 25.0 | Animations caméra fluides |
| [Vite](https://vitejs.dev/) | 6.3 | Bundler + dev server |
| TypeScript | 6.0 | Typage strict |

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
pnpm build      # Build de production → dist/
pnpm preview    # Servir le build de production localement
```

## Textures

Les textures ne sont pas incluses dans le dépôt (trop volumineuses). Les déposer dans `public/assets/textures/` en respectant la structure suivante :

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
Résolutions disponibles : `1k`, `2k`, `4k`, `8k` (selon le corps, voir `src/config/settings.ts`).

## Fonctionnalités

### Modes d'affichage

| Mode | Distances | Tailles | Orbites |
|------|-----------|---------|---------|
| **Explo** | Compressées (`√AU × 35`) | Visuelles | Circulaires |
| **Simu** | Réelles (`AU × 35`) | Physiques (km) | Ellipses Kepler |

Basculer avec les boutons **Explo / Simu** dans l'interface.

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
├── MainSolarSystemApp.ts     # Point d'entrée — branche les contrôles DOM sur l'API
├── SolarSystemApp.ts         # Façade — coordonne l'initialisation dans l'ordre
├── types.ts                  # Interfaces TypeScript partagées
│
├── core/
│   ├── EphemerisService.ts   # Wrapper astronomy-engine → positions en UA (repère Three.js)
│   ├── SimulationClock.ts    # Horloge simulée avec time travel et vitesse variable
│   ├── ScaleService.ts       # Conversion UA → unités Three.js (modes explo/simu)
│   └── OrbitalMechanics.ts  # Pilote les positions planétaires chaque frame
│
├── components/
│   ├── systems/
│   │   ├── AnimationSystem.ts  # Boucle requestAnimationFrame, frustum culling, LOD
│   │   ├── CameraSystem.ts     # OrbitControls + suivi de cible + tweens
│   │   ├── SceneSystem.ts      # Scène Three.js, renderer, lignes d'orbite
│   │   ├── LightingSystem.ts   # AmbientLight + PointLight solaire
│   │   └── TextureSystem.ts    # Cache singleton + LOD textures
│   └── celestial/
│       ├── CelestialObject.ts        # Une planète (meshes, shader, sprite LOD)
│       ├── CelestialObjectFactory.ts # Crée tous les corps depuis la config
│       └── Starfield.ts              # Skybox étoilée
│
├── config/
│   ├── settings.ts    # Source de vérité : toutes les constantes de l'app
│   └── layerConfig.ts # Géométries et matériaux Three.js
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
  └── MainSolarSystemApp.ts (IIFE async)
        └── SolarSystemApp.init(progressCallback)
              ├── TextureSystem.preloadCriticalTextures()   0 → 40%
              ├── SceneSystem.init()                        45%
              ├── LightingSystem.setup()                    60%
              ├── CelestialObjectFactory.createAll()        75%
              ├── SceneSystem.setupCelestialBodies()        85%
              ├── CameraSystem.init()
              ├── EphemerisService + SimulationClock
              ├── OrbitalMechanics (onSimuStateChanged hook)
              ├── _recomputeSimuOrbits()                    95%
              └── AnimationSystem.run()         /clear
                          → boucle infinie
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
  │     ├── Sprite ↔ mesh transition (mode Simu)
  │     ├── Rotation du mesh + nuages
  │     └── Shader uniforms (position du soleil)
  ├── CameraSystem.update()            Suivi de la planète cible
  └── renderer.render(scene, camera)
```

### Système d'échelle

```
Mode Explo : position = √(distanceAU) × 35   (compression visuelle)
Mode Simu  : position = distanceAU × 35       (vraie proportionnalité)

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

1. Déposer les textures dans `public/assets/textures/{nom}/`
2. Ajouter une entrée dans `CELESTIAL_CONFIG.bodies` dans `src/config/settings.ts`
   - Inclure `realData.orbitPeriodDays` pour que les lignes d'orbite Kepler soient calculées
3. Ajouter les distances dans `CAMERA_SETTINGS.bodyDistances` et `simuBodyDistances`
4. Ajouter à `TEXTURE_SETTINGS.loadPriority` si préchargement souhaité
5. Ajouter le bouton dans `index.html` avec `id="orbit-{nom}"`
6. Mapper le nom vers l'enum `Body` dans `EphemerisService.ts` (BODY_MAP)

## Configuration

Tout se configure dans `src/config/settings.ts` :

| Constante | Rôle |
|-----------|------|
| `APP_SETTINGS.performance.targetFPS` | FPS cible (défaut 60) |
| `APP_SETTINGS.performance.textureQuality` | Seuils de distance LOD par qualité |
| `LIGHTING_SETTINGS` | Intensité lumière ambiante et solaire |
| `SHADER_SETTINGS.nightLights` | Intensité / seuil / douceur des lueurs nocturnes |
| `CAMERA_SETTINGS.bodyDistances` | Distance caméra par planète en mode Explo |
| `CAMERA_SETTINGS.simuBodyDistances` | Idem en mode Simu |
| `SIMU_SCALES` (MainSolarSystemApp) | Vitesses disponibles : `[1, 3600, 10800, 21600]` |

## Dépendances de développement

- **TypeScript strict** (`tsconfig.json`) — Vite compile via esbuild, pas de `tsc --emit`
- **Prettier** — formatage automatique (`.prettierrc`)
- Aucun test runner ni linter configuré
