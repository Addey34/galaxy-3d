# Architecture — Solar System 3D

## Vue d’ensemble

L’application est un viewer Three.js/Vite composé de trois frontières :

```text
index.html
  -> MainSolarSystemApp        racine de composition DOM
      -> SolarSystemApp        façade headless d’initialisation
          -> systèmes Three.js (Scene, Camera, Lighting, Texture, Animation)
          -> moteur domaine (Clock, Ephemeris, OrbitalMechanics, Scale)
      -> modules UI             commandes DOM et overlays projetés
```

`SolarSystemApp` ne connaît pas le DOM. Il retourne une `PublicAPI` minimale à la racine UI :
les systèmes de scène, caméra, animation, mécanique orbitale et une fonction `cleanup`.

## Source de vérité

- `src/config/bodies.ts` : catalogue des corps célestes, hiérarchie et données physiques.
- `src/config/smallBodies.ts` : dataset képlérien des petits corps.
- `src/config/engine.ts` : réglages de rendu, caméra, qualité et éclairage.
- `src/config/catalog.ts` : itération et aplatissement du catalogue.

Les comportements doivent dépendre de `kind`, `frame` ou des capacités de configuration, jamais
faire de branchement par nom de planète dans les systèmes génériques.

## Flux de démarrage

1. `TextureSystem` précharge les textures critiques et déduplique les chargements.
2. `HorizonsEphemerisService` charge les assets locaux ; en cas d’échec, le fallback képlérien reste disponible.
   Le contrat `PreciseEphemerisProvider` decouple le moteur du format numerique ; `SpiceEphemerisService` formalise le lecteur SPK synchrone ; avec `VITE_SPK_KERNEL_URL`, `SolarSystemApp` demarre aussi le Worker SPK optionnel, puis `FallbackPreciseEphemerisProvider` conserve Horizons ou Kepler pendant les cache misses.
3. `SceneSystem` crée renderer, caméra, fond étoilé et lignes d’orbite.
4. `CelestialObjectFactory` construit les meshes depuis le catalogue.
5. `CameraSystem` et `AnimationSystem` sont initialisés.
6. `OrbitalMechanics` synchronise date, positions, axes et mode d’échelle.
7. `MainSolarSystemApp` monte les contrôles et les overlays UI.

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

Les modules de calcul dans `src/core/` restent purs ou faiblement stateful et sont testés par
Vitest. Le DOM vit dans `src/ui/`; les systèmes Three.js ne sélectionnent jamais d’élément DOM.

## Propriété des ressources

- `SceneSystem` possède scène, renderer, lignes d’orbite et corps construits.
- `TextureSystem` possède le cache de textures GPU et les promesses de chargement.
- `CelestialObject` possède géométries et matériaux et se désinscrit d’`AnimationSystem` lors de `dispose()`.
- `AnimationSystem` annule le RAF, vide ses callbacks et son cache d’updatables.
- `SolarSystemApp.dispose()` orchestre le nettoyage dans l’ordre inverse de l’initialisation.

Toute nouvelle ressource doit avoir un propriétaire unique et un chemin de libération explicite.

## Invariants métier

- Éducatif : distances compressées par `sqrt(AU)`, rayons pédagogiques.
- Pour un groupe de satellites parentRelative, un facteur commun garantit une séparation visuelle minimale sans changer leur ordre relatif.
- Les satellites synchrones peuvent déclarer rotationBody pour orienter leur axe sur le pôle réel de leur parent.
- Exploration : distances, rayons et tailles angulaires physiques ; aucune taille minimale ou sprite proxy.
- Les labels et le champ de petits corps sont des instruments de navigation, pas des modifications du rendu physique.
- Les deux modes utilisent la même position astronomique instantanée.
- Les orbites restent disponibles dans les deux modes et pendant le morph animé.

## Ajouter une fonctionnalité

1. Définir ou étendre la configuration/catalogue.
2. Implémenter la logique pure dans `src/core/` si elle est calculable sans DOM/WebGL.
3. Ajouter le système ou composant Three.js dans sa frontière existante.
4. Ajouter un module UI dédié dans `src/ui/`.
5. Écrire les tests unitaires puis le scénario Playwright de câblage si nécessaire.
6. Mettre à jour README et cette page si le flux ou un invariant change.

Voir aussi [`TESTING.md`](./TESTING.md).

## Contrat de contenu et extension de l'univers

Le catalogue est organise en trois niveaux :

1. Donnees : position, epoque, referentiel, rayon, orientation, source et incertitude.
2. Representation : sphere, couche texturee, anneau, particules ou futur modele 3D.
3. Presentation : labels, fiche, couleur, filtres et aides de navigation.

Les corps naturels sont ajoutes dans le catalogue avant leurs assets. Les textures JPEG
suivent le schema public/assets/textures/{body}/{body}_{layer}_{quality}.jpg (snake_case ;
le chemin est derive de la cle du corps par catalog.texturePath, pas ecrit a la main). Les modeles
GLB, les missions, les populations et le ciel profond attendent une capacite de rendu
typee, un proprietaire GPU, une politique LOD et un fallback.

Le mode Educatif compresse les distances avec la racine carree mais conserve la distance
radiale instantanee et l'excentricite.
Pour les satellites parent-relative, le facteur de groupe est identique pour la position et la ligne d'orbite afin d’eviter qu’un parent masque ses lunes. Le mode Exploration conserve la proportion lineaire,
les rayons et les tailles angulaires physiques. Les orbites sont disponibles dans les deux
modes. Pendant un morph, une cible selectionnee conserve son offset camera-cible.

Les systemes stellaires, les galaxies et les vues cosmologiques doivent introduire un
referentiel explicite : ils ne sont pas des corps heliocentriques ajoutes par exception.
La matrice des familles, des assets et des candidats se trouve dans
docs/UNIVERSE_CATALOG.md.

## Flux UI recents

- src/core/permalink.ts encode et decode l'etat partageable sans dependre du DOM.
- src/core/astronomicalEvents.ts calcule les prochains evenements a partir de la date simulee.
- src/ui/guidedTour.ts orchestre la visite clavier et souris avec focus et fermeture Escape.
- src/ui/overlayCoordinator.ts impose un seul panneau contextuel ouvert parmi la fiche,
  les paramètres, les événements et l'aide. La navigation et le deck temporel restent les
  deux seuls ancrages permanents; sur mobile, ouvrir un panneau contextuel simplifie le deck.

Les overlays restent dans src/ui/; SolarSystemApp reste headless et ne connait ni les permaliens,
ni les panneaux facultatifs.

## Architecture meteo

La meteorologie suit trois frontieres simples :

- src/core/ decide la source, la date, le fallback, la grille et la conversion en donnees
  testables sans DOM ni Three.js.
- src/ui/ orchestre le cycle date -> chargement -> cache -> badge et expose un
  WeatherLayerHandle uniforme au panneau.
- CelestialObject et src/config/layerConfig.ts possedent le rendu Three.js, les materiaux,
  les UV, l alpha et l eclairage.

Les couches satellite reutilisent ui/observedTextureLayer.ts. Les couches Open-Meteo reutilisent
ui/meteoModelLayer.ts ; leurs fichiers specifiques ne contiennent que leur variable, palette,
grille et configuration. ui/weatherLayers.ts ne connait pas le type de source : il construit le
panneau et applique les groupes exclusifs. Les groupes qui partagent un mesh sont declares dans
MainSolarSystemApp.ts, et l ordre d activation desactive les concurrents avant d afficher la
couche choisie.

Le mesh surface reste la base opaque de la Terre. Les donnees meteorologiques transparentes sont
des overlays sur les meshes dedies ; un changement de source restaure le materiau precedent avant
de masquer ou d activer la couche suivante. Cela evite de melanger un shader satellite avec une
texture RGBA deja palettee et rend le diagnostic localisable par famille.

### Contrat de couverture des nuages

Le rendu NASA est la source officielle par défaut : True Color fournit la couleur et les masques MODIS Cloud Fraction Day/Night fournissent l'alpha lorsqu'une observation couvre le pixel. Le remplissage Open-Meteo `cloud_cover` et la texture statique historique sont des replis explicitement optionnels ; ils ne doivent pas rendre le mesh visible en l'absence de leur propre donnée. `cloudStaticTextureFallbackEnabled` reste donc désactivé par défaut.

Le diagnostic `?debug-meteo` expose l'état de chaque source, la date réelle, la grille, la texture, le mesh cible et la couverture géographique. Le scénario `e2e/weather.spec.ts` vérifie notamment qu'une coupure réseau ne révèle pas un ancien rendu statique et que les couches modèle restent cachées tant que leur propre grille n'est pas disponible.

### Contrat Terre temps réel : réel par défaut

La règle produit est : une donnée absente, en attente ou hors couverture reste absente à l'écran. Aucun modèle ou remplissage synthétique ne doit être présenté comme une observation officielle.

| Couche                                                | Source par défaut  | Visibilité par défaut                     | Politique de couverture                                                           |
| ----------------------------------------------------- | ------------------ | ----------------------------------------- | --------------------------------------------------------------------------------- |
| Nuages                                                | NASA VIIRS / MODIS | active selon qualité et appareil          | alpha natif des masques ; replis Open-Meteo/statique désactivés par défaut        |
| Précipitations                                        | NASA IMERG         | active sur desktop, désactivée sur mobile | alpha natif du produit ; aucune valeur polaire inventée                           |
| Température                                           | MERRA-2            | cachée                                    | réanalyse officielle disponible dans le panneau                                   |
| Nuages, pluie, température, pression, humidité modèle | Open-Meteo         | cachées                                   | activation manuelle uniquement ; mesh caché jusqu'à réception de sa propre grille |
| Vent                                                  | Open-Meteo         | désactivé                                 | modèle facultatif, sans substitution silencieuse                                  |

Les couches Open-Meteo partagent parfois un mesh technique (par exemple `thermal`), mais les groupes exclusifs et la visibilité sont séparés par couche. Une couche modèle ne peut donc pas révéler par erreur l'ancienne texture d'une observation MERRA-2 ou IMERG.

Les panneaux et diagnostics conservent le statut `observed`, `analysis`, `forecast`, `forecast_uncertain`, `climatology` ou `unavailable`, ainsi que la date réelle et la source. Les délais de publication d'une réanalyse sont signalés comme approximation temporelle ; ils ne sont pas maquillés en observation instantanée.

Le client partagé `src/core/meteoClient.ts` déduplique les requêtes identiques en vol, conserve les réponses réussies cinq minutes et réessaie uniquement les erreurs transitoires 429/5xx avec un délai borné et prise en compte de `Retry-After`. Cela protège le temps réel contre les limites de service Open-Meteo sans activer les modèles par défaut ni inventer de données.

Les textures de surface, le relief et les lumières nocturnes de la Terre restent des assets scientifiques documentés, non des observations météo instantanées. Le relief dérivé d'ETOPO est une représentation statique ; la météo et les nuages sont les seules familles temps réel décrites ici.
