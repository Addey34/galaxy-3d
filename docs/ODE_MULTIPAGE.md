# Jeux ODE de plusieurs pages : manifeste et publication

Outil hors ligne (`scripts/ode-multipage.mjs`), sans requête réseau. Il prépare la collecte des jeux de plus de 5 000
produits du cache scientifique, lus par fenêtres (`offset`, `limit` = 5 000). Le manifeste historique à une page
(`reconciliation-empreintes`) n'est pas modifié ; ce format est distinct.

## Principe

On ne suppose jamais qu'un offset de `coveragetargz` et le même offset de `results=m` désignent les mêmes produits.
Pour chaque fenêtre, la correspondance se démontre par les identifiants (ODEId) et les ProductId. Un produit présent
d'un seul côté est un refus, sauf une exclusion démontrée : géométrie absente des métadonnées ET absent de toutes les
variantes de shapefile. Si la correspondance ne se démontre pas, la fenêtre est refusée, sans correction.

## Offsets : logique et réels (profil de pagination)

L'**offset logique** d'une fenêtre est son début scientifique à base zéro (0, 5000, 10000, …). Les offsets **réels** sont
ceux envoyés aux deux requêtes, et ils peuvent différer : `coveragetargz` et `results=m` ne comptent pas forcément de la
même façon. Le **profil de pagination** du jeu, consigné au manifeste, donne la relation ; il n'est jamais déduit.

| Profil | Offset `coveragetargz` | Offset `results=m` |
|---|---|---|
| `identique` | offset logique | offset logique |
| `base-1-commun` | 0 pour la fenêtre 0, offset logique + 1 sinon | idem |
| `metadonnees-base-1` (v2, réfuté) | offset logique | 0 pour la fenêtre 0, offset logique + 1 sinon |

Mesures sur `Mercury|MESSENGER|MASCS|UVVDDR` : les métadonnées demandées à `offset=5000` répètent le dernier produit de la
fenêtre 0 (ODEId 13720006), à `offset=5001` elles commencent au suivant (13720007). La coverage suit la même règle, ce que
la frontière @10000 a révélé : la coverage d'`offset=10000` perdait le dernier produit géolocalisé de la fenêtre
(13742444), qu'une sonde (`offset=14998`, `limit=4`) puis la coverage d'`offset=10001` ont livré, avec 1 379 empreintes
concordant exactement avec les 1 379 produits géolocalisés des métadonnées d'`offset=10001`. Le profil du jeu est donc
`base-1-commun` ; `metadonnees-base-1` (profil de la version 2) est refusé pour ce jeu. Seul UVVDDR est déclaré
(`DATASET_PAGINATION`) ; pour tout autre jeu le profil est exigé explicitement (`--pagination`), sans valeur par défaut.
Le mode `identique` ne convient qu'aux jeux où cette égalité est démontrée.

L'offset de chaque source est vérifié dans les DEUX champs de sa provenance (`offset` de la capture et paramètre `offset`
de `query`) contre l'offset réel exigé par le profil. Les captures sont rangées par leur offset RÉEL déclaré : une
capture demandée à un autre offset que celui du profil (par exemple des métadonnées à `offset=5000` alors que le profil
exige 5001) n'est jamais sélectionnée. Une capture dont la limite n'est pas la page (une sonde `limit=4`) est de même une sonde. Elles sont signalées comme
captures diagnostiques (`capturesDiagnostiques` du résumé de `build`), conservée telle quelle, jamais renommée ni supprimée. Toute autre capture inattendue, ou deux captures pour un
même emplacement, est un refus.

## Le manifeste `reconciliation-multipage` (version 3)

La version 1 supposait en silence le même offset pour les deux sources, la version 2 une coverage à base 0 pour UVVDDR :
toutes deux sont fausses. La version 3 porte `pagination.profile` et, pour chaque source, `requestOffset`. Les manifestes de
version 1 et 2 sont refusés, jamais migrés (aucun n'a été écrit dans le cache réel). Chaque fenêtre consigne aussi la plage
d'ODEId du catalogue en ordre de réponse (`catalogueRange`), à titre d'information : la continuité numérique n'est pas
exigée.

Fichier `<cache>/reconciliation/<jeu>.multipage.json`, créé une seule fois, jamais remplacé. Au niveau du jeu : clé,
gel, taille de page, compte gelé de référence, DatasetId autorisés (lus dans `iipt.json`), comptes globaux, statut
`qualifie`. Pour chaque fenêtre :

- offset (logique), limite, comptes (catalogués, empreintes, exclus) ;
- les deux sources (fichier, offset réel de la requête, SHA-256, taille, date, statut HTTP) ;
- `footprintIds` et `productIds` (même ordre), `excluded` (ODEId, ProductId, motif, preuve d'absence par variante) ;
- nature de géométrie, variantes observées, nombre de formes, DatasetId et cible observés ;
- SHA-256 et taille prévus de la page.

Le manifeste est déterministe, à l'exception de `builtAt` et des dates de lecture des sources.

## Validation du jeu entier

Avant toute publication : toutes les fenêtres attendues (ni manquante, ni répétée, ni surnuméraire), aucun ODEId dans
deux fenêtres, aucun ProductId contradictoire, aucun ProductId porté par deux ODEId distincts (empreintes comme
exclusions, avec les deux ODEId et leurs fenêtres dans l'erreur), aucun produit exclu ici et géolocalisé là, catalogué = empreintes +
exclusions démontrées pour chaque fenêtre et pour le jeu, sources de toutes les fenêtres revérifiées (SHA-256, taille,
somme annexe, jeu, offset, limite, gel, requête). Les captures sont lues une fenêtre à la fois.

Unicité du ProductId : elle est mesurée (27 146 produits d'UVVDDR, 13 721 produits des pages historiques, aucune
répétition) mais le modèle ODE ne la garantit pas ; le manifeste multipage la refuse donc explicitement, car la page
publie `pid` et une répétition rendrait ambiguë la correspondance métadonnées / shapefile. Un futur jeu qui la violerait
légitimement s'arrêterait sur cette erreur : c'est alors une décision à prendre, jamais un contournement silencieux.

Écriture du manifeste : temporaire exclusif, écriture contrôlée octet par octet (écriture partielle poursuivie, nulle ou
incohérente refusée), fsync, lien dur, relecture exacte. Le retour arrière ne retire le manifeste que s'il est celui que
l'appel a lié (même inode et même contenu) ; sinon il est laissé et l'état partiel annoncé.

Requalification : à chaque chargement du manifeste pour publier, les affirmations de chaque fenêtre sont recalculées
depuis les captures brutes (même code que la qualification, une fenêtre à la fois) et le manifeste doit être identique
au recalcul. Aucun champ déclaratif (`status`, `metadataGeometry`, `inShapefiles`, comptes, identifiants) n'est cru sur
parole, et rien n'est écrit avant que toutes les fenêtres aient été requalifiées.

Preuves de source : le statut HTTP 200 doit figurer explicitement dans la provenance des deux captures (son absence est
un refus). Les DatasetId autorisés se lisent dans `iipt.json` avec l'égalité sur la base ODE (`ODEMetaDB`), l'instrument
(IHID, IID) et le type de produit (PT).

## Processus

```bash
node scripts/ode-multipage.mjs build --cache-dir <abs> --dataset "<clé>" [--pagination <profil>]          # qualification, sec
node scripts/ode-multipage.mjs build --cache-dir <abs> --dataset "<clé>" [--pagination <profil>] --write  # écrit le manifeste
node scripts/ode-multipage.mjs materialize --cache-dir <abs> --dataset "<clé>" --offset 5000   # sec
node scripts/ode-multipage.mjs materialize --cache-dir <abs> --dataset "<clé>" --offset all --write
```

La publication réutilise `commitPage` du matérialiseur strict : lien dur exclusif, aucun remplacement, aucune copie de
repli, relecture des octets, taille, SHA-256 et `nlink`. Une page déjà présente n'est reprise que si elle est identique
au manifeste ; une page divergente, un temporaire ou un fichier inattendu arrêtent tout, sans correction. Reprise après
interruption : relancer la même commande, les pages valides sont laissées en place.

Retour arrière de `commitPage` : si un contrôle échoue après le lien, la page n'est retirée que si elle est encore celle
que cet appel a liée (même inode ET mêmes octets que le plan). Une page remplacée par autrui, recréée avec les mêmes
octets sous un autre inode ou modifiée sur place est LAISSÉE et l'état partiel est annoncé (« ÉTAT PARTIEL, intervention
manuelle »), la cause d'origine restant la première information ; une cible disparue n'entraîne le retrait d'aucun autre
fichier. Garantie pratique, pas une atomicité face à tout accès concurrent (un inode libéré peut être réattribué).

## Limites

Les enregistrements `_gl` à plusieurs parties dans un même enregistrement ne sont pas pris en charge (traces). Les
captures d'un jeu doivent avoir une provenance moderne (`*.raw` et `*.raw.json`). Les métadonnées d'une fenêtre sont
une seule réponse de 5 000 produits.

Limite de vérifiabilité : un décalage d'une position est invisible dans les shapefiles lorsque le produit situé à la
frontière n'a pas de géométrie (c'était le cas à @0 et @5000). Le contrôle repose alors sur le contrat de requête (offsets
réels du profil, vérifiés dans la provenance), pas sur une preuve tirée des empreintes : une coverage dont la frontière est
invisible ne doit pas être tenue pour prouvée. Le profil `base-1-commun` est mesuré sur la frontière @10000 ; la fenêtre
finale (2 146 produits attendus à `offset=25001`) n'est pas encore observée.
