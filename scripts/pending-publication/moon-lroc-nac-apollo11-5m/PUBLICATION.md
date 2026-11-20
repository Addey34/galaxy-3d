# Publication de `moon-lroc-nac-apollo11-5m` (préparée, non exécutée)

Statut : **cuit en local, non téléversé, non activé.** Rien dans ce dossier n'est lu par l'application.

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
- Origine indisponible : une tuile en erreur retombe sur la base (404 ou 5xx) sans bloquer la scène (garde `PlanetarySurfaceEngine.provenance.test.ts`) ; les échecs sont redemandés après 8 s.
