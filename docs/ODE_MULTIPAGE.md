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
| `metadonnees-base-1` | offset logique | 0 pour la fenêtre 0, offset logique + 1 sinon |

Mesure (GAL-A003-11C-02 et 11C-03) sur `Mercury|MESSENGER|MASCS|UVVDDR`, frontière 0/5000 seulement : les métadonnées
demandées à `offset=5000` répètent le dernier produit de la fenêtre 0 (ODEId 13720006), demandées à `offset=5001` elles
commencent au produit suivant (13720007) et correspondent à la coverage `offset=5000`. Seul ce jeu est déclaré en
`metadonnees-base-1` (`DATASET_PAGINATION`) ; pour tout autre jeu le profil est exigé explicitement (`--pagination`),
sans valeur par défaut. Le mode `identique` ne convient qu'aux jeux où cette égalité est démontrée.

L'offset de chaque source est vérifié dans les DEUX champs de sa provenance (`offset` de la capture et paramètre `offset`
de `query`) contre l'offset réel exigé par le profil. Les captures sont rangées par leur offset RÉEL déclaré : une
capture demandée à un autre offset que celui du profil (par exemple des métadonnées à `offset=5000` alors que le profil
exige 5001) n'est jamais sélectionnée. Elle est signalée comme capture diagnostique (`capturesDiagnostiques` du résumé de
`build`), conservée telle quelle, jamais renommée ni supprimée. Toute autre capture inattendue, ou deux captures pour un
même emplacement, est un refus.

## Le manifeste `reconciliation-multipage` (version 2)

La version 1 supposait en silence le même offset pour les deux sources, ce qui est faux pour UVVDDR. La version 2 porte
`pagination.profile` et, pour chaque source, `requestOffset` ; un manifeste de version 1 est refusé (aucun n'a jamais été
écrit dans le cache réel), sans être lu avec l'ancienne hypothèse. Chaque fenêtre consigne aussi la plage d'ODEId du
catalogue en ordre de réponse (`catalogueRange`), à titre d'information : la continuité numérique n'est pas exigée.

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
deux fenêtres, aucun ProductId contradictoire, aucun produit exclu ici et géolocalisé là, catalogué = empreintes +
exclusions démontrées pour chaque fenêtre et pour le jeu, sources de toutes les fenêtres revérifiées (SHA-256, taille,
somme annexe, jeu, offset, limite, gel, requête). Les captures sont lues une fenêtre à la fois.

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

## Limites

Les enregistrements `_gl` à plusieurs parties dans un même enregistrement ne sont pas pris en charge (traces). Les
captures d'un jeu doivent avoir une provenance moderne (`*.raw` et `*.raw.json`). Les métadonnées d'une fenêtre sont
une seule réponse de 5 000 produits.

Le profil `metadonnees-base-1` est mesuré sur une seule frontière (0/5000) de UVVDDR ; chaque fenêtre suivante le confirme ou le réfute par la correspondance des identifiants et l'absence de doublon entre fenêtres (la fenêtre finale compte 2 146 produits attendus à `offset=25001`, non encore observée).
