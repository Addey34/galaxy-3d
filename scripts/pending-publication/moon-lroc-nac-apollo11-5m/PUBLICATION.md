# Publication de `moon-lroc-nac-apollo11-5m` (préparée, non exécutée)

Statut (2026-11-21) : **tuiles hébergées (334 objets, vérifiés en volume et en HTTP), code d'activation PRÉPARÉ dans une PR Draft non fusionnée, fonctionnalité NON visible en production.** La fiche est sous `src/registry/products/tilesets/` et le manifeste sous `public/assets/imagery/` dans cette PR ; fusionner celle-ci l'active publiquement par le déploiement automatique de `main`. Ce dossier ne garde que l'inventaire `objects.json` (lu par `e2e/regionalImageryMoon.spec.ts` et `pdsRegionGeoreference.test.ts`) et ce contrat.

## Objets à publier

- Inventaire exact : `objects.json` (334 objets JPEG : niveau 11 x 10, niveau 12 x 50, niveau 13 x 274 ; 5 063 008 o ; SHA-256 par objet).
- Source locale : `.cache/galaxy-data/assets/imagery/moon-lroc-nac-apollo11-5m/2a218dbaa134/` (hors Git).
- Destination : volume `galaxy-data_galaxy_data` de la VM, chemin `assets/imagery/moon-lroc-nac-apollo11-5m/2a218dbaa134/default/galaxy-eq2x1/<niveau>/<ligne>/<colonne>.jpg`, servi sous `https://galaxy-data.adrianguichard.dev/`. Nom haché immuable : rien d'existant n'est écrasé.
- Procédure : celle de `services/galaxy-data/README.md` (tar relatif, `scp`, `docker run … tar xf`), une commande à la fois. Aucun nouveau serveur.

## Vérification après téléversement (avant toute activation)

1. Pour chacun des 334 chemins de `objects.json` : `curl -s` sur l'origine, 200, `content-type: image/jpeg`, taille et SHA-256 égaux à l'inventaire, `access-control-allow-origin` de la page, `cache-control` immuable.
2. Un chemin fantôme (hachage `000000000000`) répond 404 (témoin).
3. Une tuile voisine hors emprise (ex. niveau 11, colonne voisine non listée) répond 404 : le repli sur la base est voulu.

## Activation (une seule PR, après 1 à 3)

1. `git mv scripts/pending-publication/moon-lroc-nac-apollo11-5m/fiche.json src/registry/products/tilesets/moon-lroc-nac-apollo11-5m.json` (corriger le `$schema` en `../../schema/product.schema.json`).
2. `git mv …/manifest.json public/assets/imagery/moon-lroc-nac-apollo11-5m/manifest.json`.
3. Retirer `"pending": true` de la cible dans `scripts/imagery-tile-targets.json` ; supprimer `objects.json` du dossier en attente si désiré.
4. `pnpm build`, puis `pnpm fingerprint:generated --write` ; `pnpm budget:startup` ; `pnpm verify`.
5. Test public limité : ouvrir `?body=moon` près de 0,674 N, 23,473 E (base Tranquillité), descendre sous 2 km : le bandeau annonce la NAC PDS, le crédit NASA/GSFC/Arizona State University ; s'éloigner : retour à la WAC.

## Retour arrière

- Avant activation : rien à faire (rien n'est servi).
- Après activation : revert de la PR d'activation. La fiche disparaît, l'application ne demande plus de tuile NAC ; les objets hachés restent inertes sur la VM (suppression facultative, sur accord).
- Deux cas distincts côté moteur (`PlanetarySurfaceEngine`) :
  - **404** (tuile absente, ou tuile à trou) : le carreau est marqué non servi par la région et montre aussitôt un morceau de la base WAC (repli explicite). Garde : `PlanetarySurfaceEngine.provenance.test.ts`.
  - **5xx, 429 ou coupure** (origine indisponible) : ce n'est PAS un repli. L'échec est retenu pour ne pas redemander la tuile à chaque image, puis redemandé selon `isTileRetryPending` (au plus après `FAILED_RETRY_MS`, 8 s, avec décompte d'échecs). Dans l'intervalle le carreau garde ce qui est déjà à l'écran (la base ou un niveau plus grossier) ; la continuité visuelle exacte sous 5xx n'a pas été démontrée par un test dédié pour cette région.
