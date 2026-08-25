# Validation et tests

## Niveaux

| Commande          | Portée                                  | Coût              |
| ----------------- | --------------------------------------- | ----------------- |
| `pnpm typecheck`  | TypeScript strict, sans émission        | court             |
| `pnpm lint`       | ESLint flat config                      | court             |
| `pnpm test`       | Vitest, logique et services              | court             |
| `pnpm verify`     | typecheck + lint + Vitest               | gate local rapide |
| `pnpm build`      | typecheck + bundle Vite production      | moyen             |
| `pnpm test:e2e`   | scénarios Playwright Chromium/WebGL     | long              |
| `pnpm verify:all` | verify + build + e2e                    | gate complet      |

## Règles

- Toute logique mathématique, catalogue, horloge ou état déterministe reçoit un test Vitest voisin.
- Toute interaction DOM, navigation, boot WebGL ou régression de mode reçoit un scénario dans `e2e/`.
- Les tests e2e valident le câblage, les contrats observables et les erreurs WebGL ; ils ne constituent pas une preuve scientifique pixel par pixel.
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

## Compter les tests

Ne pas figer de nombre de tests dans ce document : il devient faux au prochain commit et personne
ne pense à le corriger. Faire foi via les commandes elles-mêmes — `pnpm test` affiche le nombre de
fichiers/tests Vitest en fin d'exécution, `pnpm exec playwright test --list` liste les scénarios
Playwright actuels.

Tout ajout de contenu doit verifier le chemin catalogue-asset, la resolution effectivement
presente, le fallback si une donnee manque et la propriete des ressources Three.js. Pour un
modele 3D ou une mission, ajouter en plus un test de referentiel et de liberation GPU avant
de rendre l'objet navigable.

### Matrice Terre et météo

Après une modification de la Terre, exécuter au minimum :

- `pnpm typecheck`
- `pnpm lint`
- `pnpm exec vitest run --testTimeout=15000`
- `pnpm build`
- `pnpm textures:audit`
- `pnpm exec playwright test e2e/weather.spec.ts --reporter=line`
- `pnpm exec playwright test e2e/precip-visual.spec.ts --reporter=line`
- `pnpm exec playwright test e2e/earth-visual.spec.ts --reporter=line`

`weather.spec.ts` couvre le panneau, les groupes exclusifs, le diagnostic et l'invariant « modèle caché sans donnée propre ». `precip-visual.spec.ts` utilise un fixture déterministe IMERG pour vérifier l'alpha natif et l'absence d'extrapolation polaire. `earth-visual.spec.ts` vérifie le câblage du displacement et le retour LOD sans dépendre d'une réponse météo.

Le client Open-Meteo possède en plus des tests Vitest déterministes pour le retry 429/5xx, `Retry-After`, la déduplication en vol et le cache des réponses. Les tests de réseau ne valident pas la disponibilité du fournisseur en production ; une capture live et le diagnostic `?debug-meteo` sont requis pour qualifier une donnée réellement reçue.

`verify:all` reste le gate complet de release. Si son étape SPK/Playwright atteint la limite d'infrastructure sans assertion exploitable, conserver les résultats des commandes ciblées ci-dessus et signaler le timeout séparément.

### Audit des assets visuels

`pnpm textures:audit` verifie le lien catalogue -> fichiers JPEG, les LOD declares, la lisibilite des images et leur projection. Cette commande est requise apres tout ajout de planete, lune, couche nuageuse, anneau, relief ou lumiere nocturne.
