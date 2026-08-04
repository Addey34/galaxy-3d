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
suivent le schema public/assets/textures/{body}/{body}{layer}_{quality}.jpg. Les modeles
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
