# Validation et tests

## Niveaux

| Commande          | Portée                                  | Coût              |
| ----------------- | --------------------------------------- | ----------------- |
| `pnpm typecheck`  | TypeScript strict, sans émission        | court             |
| `pnpm lint`       | ESLint flat config                      | court             |
| `pnpm test`       | 26 fichiers Vitest, logique et services | court             |
| `pnpm verify`     | typecheck + lint + Vitest               | gate local rapide |
| `pnpm build`      | typecheck + bundle Vite production      | moyen             |
| `pnpm test:e2e`   | 28 scénarios Playwright Chromium/WebGL  | long              |
| `pnpm verify:all` | verify + build + e2e                    | gate complet      |

## Règles

- Toute logique mathématique, catalogue, horloge ou état déterministe reçoit un test Vitest voisin.
- Toute interaction DOM, navigation, boot WebGL ou régression de mode reçoit un scénario dans `e2e/`.
- Les tests e2e testent le câblage et les contrats accessibles ; ils ne valident pas les pixels.
- Les textures haute résolution ne doivent pas bloquer le boot : le test de démarrage vérifie ce contrat.
- Les tests doivent éviter les délais arbitraires ; utiliser des assertions Playwright et des états DOM observables.
- Après une modification visuelle, lancer au minimum `pnpm verify:all` et joindre une capture dans la PR.

## Diagnostic d’un échec e2e

1. Lancer le fichier concerné : `pnpm exec playwright test e2e/smoke.spec.ts --reporter=line`.
2. Vérifier `test-results/` et la console navigateur.
3. Distinguer un conflit de couche UI d’un vrai échec WebGL : un overlay cliquable peut recouvrir le canvas.
4. Ne pas augmenter les timeouts avant d’avoir reproduit le scénario isolé.

## Couverture actuelle

La suite Vitest couvre les transformations de repères, Kepler, éphémérides, horloge, échelles,
catalogue, éclipses, texture LOD, permaliens, événements astronomiques et câblage de certaines UI.
Playwright couvre le boot, loader, navigation, sélection 3D, modes, labels, i18n, mobile, petits
corps, permaliens, événements astronomiques, zoom optique, visite guidée et accessibilité.

Il n’y a pas encore de seuil de couverture chiffré : la priorité est la couverture comportementale
des invariants physiques et des frontières d’architecture.

## Snapshot actuel

La suite compte actuellement 26 fichiers Vitest et 103 tests unitaires. La suite Playwright
compte 28 scenarios Chromium/WebGL. Ces chiffres sont un instantane documentaire : la
commande fait foi si un fichier de test est ajoute.

Tout ajout de contenu doit verifier le chemin catalogue-asset, la resolution effectivement
presente, le fallback si une donnee manque et la propriete des ressources Three.js. Pour un
modele 3D ou une mission, ajouter en plus un test de referentiel et de liberation GPU avant
de rendre l'objet navigable.

### Audit des assets visuels

`pnpm textures:audit` verifie le lien catalogue -> fichiers JPEG, les LOD declares, la lisibilite des images et leur projection. Cette commande est requise apres tout ajout de planete, lune, couche nuageuse, anneau, relief ou lumiere nocturne.
