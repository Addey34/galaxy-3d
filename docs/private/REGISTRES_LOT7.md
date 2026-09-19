# Lot 7 : registres Entity / DataProduct / Provider (SUPERSEDED pour la conception, 2026-09-19)

Écrit le 2026-09-18 comme plan. Les sections de conception ci-dessous sont historiques ; le
journal du § 10 décrit les livraisons et `docs/ARCHITECTURE.md` porte le contrat actuel.

Lire d'abord : `docs/private/VISION.md` (lot 7, « Identité et graphe de connaissances »,
« Standards »), `docs/ARCHITECTURE.md` (§ « Position d'un corps », « Faits sourcés »,
« Modèle temporel »).

---

## 1. Ce que le lot doit produire, et ce qu'il n'a pas le droit de casser

**Produire** : trois registres validés, et la preuve qu'un nouvel objet est de la DONNÉE.

**Ne pas casser** : les documents générés par `src/seo/` dérivent du catalogue. Les pages de
corps, les pages d'éclipse, les quatre pages documentaires, les vignettes de partage et le
sitemap doivent rester **octet pour octet identiques**. C'est la contrainte qui pilote toute la
forme ci-dessous : le chargeur doit reproduire le catalogue actuel à l'identité de bits près, pas
« à peu près ».

---

## 2. Le problème, mesuré et non supposé

Relevé le 2026-09-18 sur l'arbre courant :

| Fichier | Lignes | Entités |
|---|---|---|
| `src/config/bodies.ts` | 2 043 | 34 (corps + satellites) |
| `src/config/smallBodies.ts` | 1 708 | 18 |
| `src/config/spacecraft.ts` | 136 avant 7D ; données migrées vers `registry/spacecraft/` | 11 |
| `src/config/interstellar.ts` | 136 avant 7D ; données migrées vers `registry/interstellar/` | 3 |

Total : 52 corps de catalogue (exactement les 52 pages par corps), 11 sondes, 3 objets
interstellaires, plus 53 éclipses déjà dérivées d'un calcul et non d'un fichier.

**Ces fichiers ne sont pas de la donnée, ce sont des programmes.** Comptage :

| Ce qui est du CODE dans le catalogue | `bodies.ts` | `smallBodies.ts` |
|---|---|---|
| Appels `measured()` / `derived()` | 220 | 106 |
| Multiplications `* D2R` | 141 | 22 |
| Dérivations (`massFromGM`, `gravityFromGM`, `massFromDensity`, `kmToAu`…) | 90 | 38 |
| Conversions de période `_R(heures)` | 33 | 0 |
| Références à l'enum `Body` d'astronomy-engine | 35 | quelques-unes |

Ajouter un corps aujourd'hui, c'est donc écrire du TypeScript : importer les bons helpers,
appeler les bonnes fonctions, connaître `D2R`. **C'est exactement ce que le lot doit supprimer.**

**Deuxième défaut, structurel** : un fait vit dans TROIS tables parallèles indexées par le même
champ : `realData.radiusKm` (la valeur), `realData.sources.radiusKm` (sa provenance) et
`realData.unknown.radiusKm` (sa raison de non-publication). Rien n'empêche par construction
qu'elles divergent : c'est `factProvenance.test.ts` qui les tient, a posteriori. Un objet unique
par fait rend la divergence impossible.

**Troisième défaut** : `Body` d'astronomy-engine est une enum de CHAÎNES (`Body.Earth === "Earth"`,
vérifié dans `node_modules/astronomy-engine/astronomy.d.ts`). Rien n'empêche donc le catalogue
d'être du JSON : c'est une bonne nouvelle, la seule valeur non sérialisable du catalogue n'en est
pas une.

---

## 3. Quel standard pour quoi (lu à la source le 2026-09-18)

On emprunte des VOCABULAIRES et des NOMS DE CHAMPS. On n'implémente aucun protocole : ni label
XML PDS4, ni service TAP, ni catalogue STAC statique servi. L'intérêt est qu'un export futur soit
un rendu, pas une réécriture.

### PDS4 pour l'IDENTITÉ et les RELATIONS

Lu dans le PDS4 Information Model (section 14, « Context Components ») : les classes de contexte
sont `Target`, `Instrument`, `Instrument_Host`, `Investigation`, `Facility`, `Telescope`,
`Airborne`, `Resource`, `Other`, regroupées sous `Product_Context`. Les relations entre elles
passent par `Internal_Reference` porteur d'un attribut `reference_type`.

C'est exactement notre besoin : une planète est un `Target`, une sonde est un `Instrument_Host`,
une mission est une `Investigation`, et « Voyager 2 a observé Neptune » est une référence typée.
On reprend : un identifiant logique stable par entité, et un tableau `relations` de
`{ type, target }` à vocabulaire FERMÉ.

**Non confirmé, à lire avant d'écrire une ligne publiée** : le format exact du LID/LIDVID
(`urn:nasa:pds:…`) n'est pas détaillé dans la page consultée. Si Galaxy publie un identifiant en
se réclamant du format PDS4, il faut d'abord le lire dans le Standards Reference. Tant que ce
n'est pas fait, nos identifiants sont NOS identifiants, et on le dit.

### EPNCore / EPN-TAP 2.0 pour la CLASSE et la COUVERTURE

Lu dans la recommandation IVOA EPN-TAP 2.0. Vocabulaire exact de `target_class` :
`asteroid, dwarf_planet, planet, satellite, comet, exoplanet, interplanetary_medium, sample, sky,
spacecraft, spacejunk, star, calibration`.

Il couvre tout notre catalogue, **sondes comprises**, ce que notre `BodyKind` maison
(`star | planet | moon | skybox | asteroid | comet | dwarf`) ne fait pas. Décision : garder
`BodyKind` comme ce qu'il est réellement, une clé de RENDU, et ajouter `targetClass` comme clé
scientifique. Les deux ne sont pas synonymes : `skybox` n'est pas une classe de cible, c'est un
décor.

**Point à trancher honnêtement** : il n'existe pas de classe `interstellar_object`. 1I/2I/3I
seront donc `comet` ou `asteroid` selon ce que le MPC dit de chacun, plus un champ maison
`population: 'interstellar'`. On ne force pas le vocabulaire d'un standard à dire ce qu'il ne dit
pas.

On reprend aussi de EPNCore : `time_min` / `time_max` (couverture temporelle),
`time_sampling_step_min/max` (cadence, en secondes), `processing_level` (CODMAC simplifié :
1 brut, 2 EDR, 3 calibré, 4 dérivé, `Ancillary`), `spatial_frame_type`
(`celestial, body, cartesian, spherical, cylindrical, none`).

### STAC 1.1.0 pour les PRODUITS et les FOURNISSEURS

Lu dans la spec Collection 1.1.0 :

- `extent.spatial.bbox` : tableau de tableaux ;
- `extent.temporal.interval` : tableau de paires `[début, fin]`, **`null` pour une borne
  ouverte**. C'est précisément ce qu'il nous faut : un binaire Horizons est borné des deux côtés,
  astronomy-engine ne l'est d'aucun ;
- `license` : identifiant **SPDX**, ou expression SPDX, ou la chaîne `other` ;
- `providers[]` : `name`, `description`, `roles`, `url`, avec les rôles `licensor`, `producer`,
  `processor`, `host` ;
- `links`, `assets`, `summaries`.

Gain immédiat et concret : `scripts/texture-sources.json` écrit aujourd'hui des licences en
vocabulaire maison (`"license": "public-domain"`). SPDX donne `CC-BY-4.0`, `CC-BY-SA-3.0-IGO`,
`CC0-1.0`, et pour le domaine public une expression correcte plutôt qu'une étiquette inventée.
`/sources` et `THIRD_PARTY_NOTICES.md` y gagnent une licence vérifiable.

**À lire à la source avant usage** : l'empreinte d'un asset (`file:checksum`) vient de
l'extension File de STAC, et la lignée (`processing:lineage`, `processing:software`) de
l'extension Processing. Ce sont des extensions, pas le coeur : vérifier leur version courante
avant de s'en réclamer.

### Tableau de décision

| Besoin | Standard suivi | Ce qu'on en prend |
|---|---|---|
| Identité d'une entité, relations | PDS4 | classes de contexte, référence typée |
| Classe scientifique d'une cible | EPNCore | vocabulaire `target_class` |
| Couverture temporelle, cadence, niveau | EPNCore + STAC | `time_min/max`, `time_sampling_step`, `processing_level`, `interval` à bornes nulles |
| Produit livré (texture, modèle, binaire) | STAC | `assets`, `license` SPDX, `roles`, empreinte, lignée |
| Fournisseur / service | STAC | `providers[].roles`, `extent` |

---

## 4. Forme des trois registres

```
src/registry/
  entities/            un fichier JSON par entité : earth.json, titan.json, bennu.json,
                       voyager1.json, oumuamua.json …
  products/            produits livrés : textures, modèles de forme, binaires d'éphémérides, SPK
  providers/           sources et services : horizons, astronomy-engine, sbdb, nssdca, open-meteo,
                       gibs, merra2, era5 …
  schema/              schémas Zod (source) + JSON Schema GÉNÉRÉ depuis eux (pour l'éditeur)
  load.ts              PUR : JSON → `CelestialConfig` d'aujourd'hui, unités et dérivations comprises
  index.ts             assemblage, ordre déclaré
```

### Une entité

```jsonc
{
  "$schema": "../schema/entity.schema.json",
  "id": "titan",
  "targetClass": "satellite",          // vocabulaire EPNCore
  "renderKind": "moon",                // BodyKind, clé de rendu
  "displayName": { "fr": "Titan" },
  "identifiers": {
    "naif": 606,
    "horizons": "606",                 // sans « ; » : cf. le piège du catalogue Horizons
    "iau": "Saturn VI"
  },
  "relations": [
    { "type": "satelliteOf", "target": "saturn" },
    { "type": "observedBy",  "target": "cassini" }
  ],
  "facts": {
    "radiusKm":  { "value": 2574.7, "source": "jpl-ssd-satellite-physical-parameters",
                   "method": "measured" },
    "massKg":    { "from": "GM", "gmKm3s2": 8978.14, "source": "…", "method": "derived" },
    "axialTilt": { "value": 0, "unit": "deg", "published": false, "reason": "not-yet-sourced" }
  },
  "dynamics": { … },                   // frame, éléments, périodes, époque
  "render":   { … }                    // radius éduc, couleurs, textures, cameraDistance, priorité
}
```

Les quatre blocs reprennent les trois niveaux que `docs/ARCHITECTURE.md` § « Pipeline de contenu »
nomme déjà (données / représentation / présentation), plus l'identité qui manquait.

### Un fait, un seul objet

C'est le coeur du gain. Aujourd'hui trois tables parallèles ; demain un objet qui porte à la fois
la valeur, son unité, sa provenance, sa méthode, sa date de validité, son incertitude, et le cas
« la simulation a besoin d'un nombre mais rien n'est publié » (`published: false` + `reason`).
Impossible de sourcer un champ qui n'existe pas, ou de laisser une valeur sans provenance : c'est
la même clé.

### Un produit, un fournisseur

`products/earth-surface-8k.json` : `href`, type MIME, `license` SPDX, `providers[]` avec rôles,
empreinte, `processing:lineage` (d'où vient le fichier source, quel script l'a transformé),
version. C'est la fusion de `texture-sources.json` (`imported` + `sources` + `reviews`) et du
manifeste des éphémérides.

`providers/horizons-binary.json` : `kind` (`ephemeris`, au sens de `core/temporal.ts`),
`extent.temporal.interval` (bornes réelles du binaire), cadence, `validationProviderId`
(la clé de jointure avec `horizons-validation-summary.json`), licence, limites d'usage.

---

## 5. Huit décisions, chacune avec son coût

**D1. Zod, en devDependency, jamais dans le bundle.**
Contre JSON Schema + Ajv : Zod donne le schéma ET le type TypeScript depuis une seule
déclaration (`z.infer`). Deux déclarations d'une même chose qui peuvent diverger, c'est
précisément le défaut que ce dépôt a payé plusieurs fois. Le JSON Schema est GÉNÉRÉ depuis Zod
et commité, pour que l'éditeur valide pendant la saisie ; un test le régénère et compare, donc
il ne peut pas dériver.
Coût : **zéro octet livré**, puisque la validation tourne en CI, dans les tests et au démarrage
du serveur de dev, jamais dans le navigateur. Garde à ajouter, de la même famille que
`buildOnly.test.ts` : un test qui échoue si `zod` apparaît dans `dist/assets/*.js`.
Ce qui reste au runtime : les asserts structurels déjà présents et déjà payés
(`assertUniqueBodyNames`, `assertValidCelestialCatalog`). On ne les remplace pas par une
validation de schéma complète : ce serait une seconde exécution, en production, d'un contrôle
déjà fait, sur des données livrées dans le même bundle.
**Perte honnête** : la saisie perd la vérification du compilateur au moment où l'on tape. Le
`$schema` dans chaque fichier la rend à l'éditeur, mais c'est une boucle différente. À dire, pas
à masquer.

**D2. Un fichier par entité, pas un gros fichier.**
Diff lisible, migration corps par corps réellement indépendante, aucun conflit de fusion.
Coût : un index à générer, et l'ORDRE des entités devient une donnée explicite (voir les pièges).

**D3. L'unité dans la clé pour la simulation, un objet pour un fait publié.**
`rotationPeriodHours`, `axialTiltDeg`, `semiMajorAxisAU` : c'est déjà la convention de
`smallBodies.ts`, elle est greppable et ne coûte pas d'emballage. Les faits PUBLIÉS, eux, ont
besoin d'un objet de toute façon (source, méthode, `asOf`, incertitude) : ils portent leur unité
dedans. On n'uniformise pas pour le plaisir d'uniformiser.

**D4. Les dérivations sont déclarées, pas écrites.**
`{ "from": "GM", "gmKm3s2": 8978.14 }` plutôt que `massFromGM(8978.14)`. L'ensemble des
dérivations est FERMÉ et connu du chargeur : `GM` → masse, `GM+R` → gravité, densité+rayon →
masse, masse+rayon → gravité, diamètre → rayon, demi-grand axe → période de Kepler, pôle publié →
obliquité. Ce sont exactement les sept que le catalogue utilise aujourd'hui (90 + 38 appels).
Conséquence directe : ajouter un corps ne demande aucune dérivation nouvelle, donc aucun
TypeScript. En demander une nouvelle est un acte délibéré, qui passe par une revue.

**D5. Le chargeur reproduit `CelestialConfig` à l'identique.**
Aucun consommateur ne change au lot 7 : ni `OrbitalMechanics`, ni `CelestialObject`, ni `src/seo`,
ni les 107 fichiers de tests. Le registre est une nouvelle FAÇADE de production du catalogue, pas
un nouveau modèle imposé à toute l'application. C'est ce qui rend la migration réversible et le
lot finissable.

**D6. Ordre des phases : Provider, puis DataProduct, puis Entity.**
Du moins couplé au plus couplé. Les fournisseurs n'ont presque aucun consommateur ; les produits
en ont quelques-uns (`/sources`, les tests d'assets) ; les entités les ont tous.

**D7. Hors périmètre, explicitement.**
Sortir les descriptions FR+EN du bundle pour les charger à la demande (vrai gain, mais cela
déplace le précache PWA, aujourd'hui à 27 entrées : c'est un lot à soi) ; publier un vrai
catalogue STAC ou des labels PDS4 ; la timeline du savoir humain ; les instruments et le
gazetteer. Le lot 7 range, il n'élargit pas.

**D8. Les éclipses ne deviennent PAS des fichiers.**
Elles sont calculées (`core/eclipsePages.ts`), et un calcul reproductible vaut mieux qu'une liste
recopiée. Elles reçoivent une identité d'entité au moment où elles sont générées, pas un JSON.

---

## 6. Absorber les trois choses qui existent déjà

Le prompt est explicite : absorber, pas dupliquer. Concrètement :

**`config/factSources.ts` (18 sources)** devient un sous-ensemble de `providers/`
(`kind: agency | database | article | preprint`). Pour ne rien casser, `FACT_SOURCES` reste
exporté, mais DÉRIVÉ du registre : `factProvenance.test.ts`, `FACT_SOURCE_HOSTS` et
`utils/safeUrl.ts` continuent de fonctionner sans être touchés. Les helpers `measured()` /
`derived()` disparaissent du catalogue (326 appels) et deviennent des champs.
`factSources.snapshot.json` ne bouge pas : c'est un relevé de test, pas un registre.

**La couverture temporelle du lot 6** (`core/temporal.ts`, `core/positionProvenance.ts`,
`SUMMARY_PROVIDER`) : `core/temporal.ts` reste PUR et sa logique ne change pas d'une ligne. Ce
qui change, c'est d'où vient son `DatedProduct` : aujourd'hui de littéraux dispersés dans les
couches, demain du registre `providers/`. `SUMMARY_PROVIDER`, qui est une table de correspondance
`PositionSource → nom dans le résumé de validation`, devient un champ `validationProviderId` sur
la fiche du fournisseur. Une seule table, deux lecteurs.

**`scripts/texture-sources.json`** (59 `imported`, 8 `sources`, 63 `reviews`) devient des
`products/`. Attention : ce fichier est lu par `src/seo/sourcesPage.ts`, `docPages.test.ts` et
`textureAssets.test.ts`. Sa migration est donc la plus risquée pour l'empreinte des pages, et
c'est la raison pour laquelle elle se fait en phase 2, seule, avec la vérification d'empreinte
juste après.

---

## 7. Migration réversible, par vagues

**Phase 0 : instrumentation, aucun changement de comportement.**
`scripts/fingerprint-generated.mjs` : SHA-256 de chaque fichier généré par le build (pages de
corps, pages d'éclipse, pages documentaires, vignettes, sitemap), écrit dans un fichier commité.
Mesurer aussi la taille du bundle. **Falsifier immédiatement** : changer un caractère dans une
description, vérifier que l'empreinte bouge et nomme le fichier. Une empreinte qu'on n'a pas vue
échouer ne prouve rien (règle payée plusieurs fois dans ce dépôt).

**Phase 1 : `providers/`**, absorption de `factSources.ts` et de `SUMMARY_PROVIDER`.
**Phase 2 : `products/`**, absorption de `texture-sources.json` et du manifeste d'éphémérides.
**Phase 3 : `entities/`**, par vagues : Soleil et planètes, puis lunes, puis naines et petits
corps, puis sondes, puis interstellaires.

Pendant toute la phase 3, **les deux sources coexistent** : le littéral TypeScript reste
autoritaire, et un test compare `loadCatalogue()` au `CELESTIAL_CONFIG` existant, corps par corps,
en égalité STRICTE. C'est ça, « réversible » : à n'importe quel commit, supprimer le JSON d'un
corps et garder son littéral est une opération locale qui ne touche rien d'autre.

**Phase 4 : bascule.** `CELESTIAL_CONFIG` devient `loadCatalogue()`, les littéraux sont
supprimés, le test d'égalité est remplacé par l'empreinte.

**Phase 5 : la preuve.** Ajouter une vraie entité nouvelle et montrer que `git diff --stat` ne
contient aucun `.ts`.
**Une honnêteté à ne pas escamoter** : « aucune ligne de TypeScript » ne veut pas dire « aucune
commande ». Un corps POSITIONNÉ doit figurer dans le résumé de validation, sinon `docPages.test.ts`
refuse le build (garde voulue, ajoutée au lot 3) : il faut relancer `pnpm ephemeris:validate`, qui
régénère un artefact dérivé. La formulation juste est : **de la donnée plus des artefacts
régénérés par script, jamais du code.** Choisir pour la démonstration une entité dont les assets
existent déjà, et dire laquelle.

---

## 8. Ce qui tient le lot

- **L'empreinte** des documents générés, falsifiée avant de servir.
- **L'égalité stricte** `loadCatalogue()` vs `CELESTIAL_CONFIG` pendant toute la migration.
- **Le schéma**, falsifié dans les deux sens : un JSON invalide doit échouer, et le JSON Schema
  généré doit différer si le schéma Zod change.
- **Le test d'absence de `zod` dans le bundle**, falsifié en l'important volontairement.
- **La taille du bundle** mesurée avant et après, pas supposée.
- `pnpm verify` puis la suite e2e COMPLÈTE : le catalogue alimente l'interface entière, et ce
  dépôt a trois fois vu la suite complète attraper ce que des specs ciblées laissaient passer.

---

## 9. Pièges identifiés d'avance

1. **L'ordre des clés est une donnée.** `Object.entries` sur le catalogue pilote l'ordre de la
   navigation, du sitemap et des pages. JSON conserve l'ordre d'insertion des clés chaînes, mais
   un fichier par entité impose de déclarer l'ordre explicitement dans l'index. L'empreinte
   l'attrapera ; autant le savoir avant.
2. **L'égalité des flottants doit être stricte.** `7.25 * D2R` exécuté par le chargeur donne le
   même double que le même produit écrit dans le littéral, à condition que l'ordre des opérations
   soit identique. Comparer avec une tolérance masquerait une différence qui, elle, déplacerait
   l'empreinte des pages. Comparer avec `Object.is`.
3. **`"699;"` contre `"699"`.** Le catalogue Horizons interprète le point-virgule final comme une
   recherche dans la base des petits corps : `699;` résout l'astéroïde « 699 Hela », pas Saturne.
   Ce défaut a déjà été livré une fois. Le champ `identifiers.horizons` doit être validé par le
   schéma, avec la règle : point-virgule autorisé seulement pour un vrai numéro de petit corps.
4. **Une valeur fausse ne produit aucune erreur.** Un `maDeg` faux à l'époque déclarée déplace un
   corps à toutes les dates, sans le moindre log. Le schéma valide la FORME, jamais la justesse :
   les gardes existantes (`smallBodies.test.ts` contre un vecteur Horizons à l'époque,
   `ephemerisPlausibility.test.ts`, `factProvenance.test.ts`) restent le seul contrôle du fond, et
   le registre ne doit surtout pas donner l'impression de les remplacer.
5. **`texture-sources.json` alimente une page publiée.** Sa migration change potentiellement
   `/sources`. Phase isolée, empreinte vérifiée juste après.
6. **Le bundle peut grossir.** Un littéral TypeScript et un JSON importé ne se minifient pas
   pareil. Mesurer, et si l'écart est réel, c'est un argument pour le chargement à la demande des
   descriptions (hors périmètre, D7), pas pour renoncer au registre.
7. **Ne pas inventer un identifiant PDS4.** Tant que le format LID n'est pas lu dans le Standards
   Reference, nos identifiants sont les nôtres et ne se réclament de rien.

---

## 10. Journal d'exécution

### Arbitrages tranchés (2026-09-18)

Périmètre COMPLET : 52 corps, 11 sondes, 3 interstellaires. `texture-sources.json` migré
maintenant, en phase isolée. Licences passées aux identifiants SPDX, relues une par une à la
source, et ce travail est compté dans le lot.

### Exécution en trois conversations (décidé le 2026-09-18)

Les phases 1 à 5 se font en **trois conversations dédiées**, prompts prêts à coller dans
`VISION.md` : **7A** (schéma + `providers/` + branchement CI de l'empreinte), **7B**
(`products/` + licences SPDX), **7C** (entités par vagues + bascule + preuve).

Ce n'est pas la convention « une conversation par lot » de `VISION.md`, et c'est délibéré : le
facteur limitant n'est pas la difficulté mais le remplissage du contexte. La phase 2 relit une
quinzaine de licences à leur source (beaucoup de texte, peu de code) et la phase 3 fait défiler
66 entités ; les mettre avec la pose du schéma garantirait d'arriver à la bascule, le moment le
plus exigeant, avec un contexte déjà compressé. Les coutures tombent aux trois seuls endroits où
l'arbre est vert, commité et réversible.

**Ce qui rend la découpe sûre** : chaque conversation termine par la mise à jour de ce § 10.
C'est ce fichier, pas le fil de discussion, qui porte l'état d'avancement.

### Phase 0 livrée (2026-09-18)

`scripts/fingerprint-generated.mjs` (`pnpm fingerprint:generated`, `--write` pour la référence),
référence commitée dans `src/seo/generated-fingerprint.json` : **171 documents** (114 pages,
56 vignettes, 1 sitemap) plus le poids des 13 morceaux livrés, dont
`SolarSystemApp.js` à 425 887 octets, le chunk qui porte le catalogue et le seul nombre à
surveiller quand il passera au JSON.

**Ce que la falsification a trouvé, et que la relecture n'aurait pas trouvé.** Première
falsification : un caractère changé dans la description de Jupiter. Le script a signalé
`jupiter/index.html`, et LUI SEUL, alors que le hash du bundle avait bougé (`hlgQ0VPF` →
`Cpkfo75e`) : la normalisation des noms hachés tient, sans quoi les 114 pages auraient été
signalées à chaque commit.

Puis, après restauration à l'identique de `bodies.ts` (`git diff` vide), trois documents ont
changé sans aucune modification de source : `sources/index.html`, `fr/sources/index.html` et
`sitemap.xml`. Deux builds supplémentaires ont montré que ce n'était pas du bruit (builds 3 et 4
identiques bit à bit). Cause : `vite.config.ts` écrit `new Date()` dans le `<lastmod>` du sitemap
et le `dateModified` du JSON-LD, et les builds avaient franchi **minuit UTC**. Une référence
commitée telle quelle aurait donc viré au rouge chaque matin, c'est-à-dire serait devenue un
signal qu'on cesse de lire, exactement ce que le dépôt a déjà payé avec les seuils de `perf-fps`.

Corrigé en normalisant ces deux contextes NOMMÉMENT (jamais la date partout dans le document :
une date de relevé du catalogue tombant le jour du build doit rester comparée), puis falsifié
dans les deux sens : tampon de build seul modifié → vert ; une URL du sitemap et un mot de
`/sources` modifiés → rouge, les deux fichiers nommés.

**Deuxième limite, trouvée en vérifiant avant de commiter plutôt qu'après.** Les 56 vignettes ne
sont pas comparables d'une machine à l'autre : leur texte est un SVG rendu par sharp avec la pile
`Segoe UI, Helvetica, Arial, DejaVu Sans, sans-serif` (`seo/socialCard.ts` ligne 370), donc un
runner Linux tombe sur DejaVu Sans là où Windows sert Segoe UI. `CLAUDE.md` l'avait déjà observé
sur les octets déployés ; c'est ici la même cause. Le rendu de la sphère, lui, est déterministe et
n'utilise aucune police.

Conséquence assumée : **la comparaison complète (171 documents) est un outil LOCAL**, avant et
après une migration sur la même machine, ce qui est exactement l'usage du lot 7. Un
`--portable` compare les 115 documents portables (pages, sitemap) en excluant les vignettes, et
c'est cette forme-là qui pourra devenir une étape de CI. Falsifié : une vignette modifiée d'un
octet est rouge en mode complet et verte en `--portable`.

Porte à ce point : `pnpm verify` vert, 1 914 tests / 107 fichiers, `pnpm build` propre.
**Pas encore branché sur la CI** : c'est la première chose à faire en phase 1, sinon ce contrôle
reste un geste qu'il faut penser à faire, et ce dépôt a déjà écrit qu'un contrôle qu'on doit se
rappeler de lancer n'est pas un contrôle.

### Phase 1 livrée (2026-09-18) : CI, schéma, `providers/`

**Les 171 documents générés sont identiques avant et après.** Vérifié sur la même machine, build
complet des deux côtés : c'est la seule chose qui prouve que l'absorption n'a rien déplacé de ce
qui est publié.

**(1) L'empreinte est branchée sur la CI**, étape bloquante `node scripts/fingerprint-generated.mjs
--portable` juste après `pnpm build` dans le job `verify` (donc avant le déploiement, qu'elle
conditionne). `--portable` parce que le runner est Linux et la référence a été écrite sous
Windows : les 56 vignettes ne sont pas comparables d'une machine à l'autre (polices), les 115
autres documents le sont. Falsifié avec la commande exacte de la CI : un mot changé dans
`dist/jupiter/index.html` sort en code 1 et nomme ce fichier, lui seul.
**Ce qui a été vérifié de la portabilité Windows → Linux**, plutôt que supposé :

- la chaîne de génération ne fait AUCUN `readdir` (seuls des tests en font) : l'ordre du système
  de fichiers n'entre donc pas dans les documents, ils dérivent du catalogue ;
- le seul vecteur de divergence trouvé était réel : `.gitattributes` impose LF, mais
  `THIRD_PARTY_NOTICES.md` est CRLF DANS CETTE COPIE DE TRAVAIL alors que le blob git est en LF,
  et `seo/sourcesPage.ts` rend son texte entier dans `/sources`. Une checkout Linux lit donc
  d'autres octets que cette machine. Mesuré en le convertissant en LF et en reconstruisant :
  **les 115 documents restent identiques** (le rendu Markdown normalise les fins de ligne).

**MESURÉ le 2026-09-18** : premier run de CI sur ce commit (run `35297282344`), étape
« Verify generated documents are unchanged » **verte sur un runner Ubuntu / Node 22**. Les 115
documents portables sont donc identiques entre cette machine Windows et Linux, données ICU
comprises. Le déploiement a suivi et « Verify production serves this build » a passé. L'étape
n'est plus une hypothèse : c'est un contrôle qui tourne.

**(2) Zod en devDependency (4.6.5), zéro octet livré.** Le schéma Zod
(`src/registry/schema/provider.ts`) est la seule déclaration : il donne le type TypeScript et le
JSON Schema commité (`provider.schema.json`), écrit par `pnpm schema:generate` et RÉGÉNÉRÉ puis
comparé octet pour octet par `provider.schema.test.ts`. Le générateur charge le TypeScript par le
`ssrLoadModule` de Vite, comme `vite.config.ts` le fait pour `src/seo` : pas de dépendance au
dépouillement de types de Node, dont la CI est en 22.
`src/registry/schema/bundleIsolation.test.ts` refuse un import de VALEUR de `zod` ou de
`registry/schema/` depuis `src/` (lecture de la source, comme `buildOnly.test.ts`) et, si un
`dist/` existe, la présence de `_zod`, `$ZodError` ou `toJSONSchema` dans les morceaux livrés.
Falsifié POUR DE VRAI : un `import { z } from 'zod'` ajouté à `core/positionProvenance.ts` rend
le premier contrôle rouge en nommant le fichier, et après un `pnpm build` le second rouge en
nommant les trois marques dans `SolarSystemApp-*.js`.

**(3) `src/registry/providers/` : 22 fiches JSON**, 18 sources de faits absorbées de
`config/factSources.ts` (extraites par script, jamais recopiées) et 4 sources de position qui
absorbent `SUMMARY_PROVIDER`. `FACT_SOURCES` reste exporté et DÉRIVÉ : `factProvenance.test.ts`,
`FACT_SOURCE_HOSTS`, `utils/safeUrl.ts`, `ui/bodyInfo.ts` et `seo/sourcesPage.ts` sont intacts.
`core/temporal.ts` n'a pas changé d'une ligne.

- **L'ordre est déclaré dans `providers/index.ts`**, comme le piège 1 l'annonçait, parce qu'il
  pilote le tableau publié de `/sources`. Un test compare le littéral au CONTENU DU DOSSIER :
  une fiche oubliée disparaîtrait de la page sans rien casser.
- **`SUMMARY_PROVIDER` devient `validationProviderId`** sur la fiche, et `computesAnyDate` ne
  teste plus deux noms en dur : il lit la couverture déclarée, où des bornes nulles des deux
  côtés valent « répond à toute date » (STAC). Comportement identique, vérifié : astronomy-engine
  et Kepler illimités, binaire borné, SPK sans couverture déclarée (ce n'est pas la même chose
  que « illimité », et la fiche le dit).
- **La couverture de `horizons-binary` est confrontée au manifeste**, pas recopiée : un test
  refuse une entrée de `manifest.json` hors de l'intervalle déclaré, et une cadence déclarée qui
  n'encadrerait plus les pas réels (1 et 4 jours).
- **Le TypeScript élargit les chaînes d'un import JSON** (`"role": "fact-source"` arrive `string`).
  Deux fonctions d'assertion rendent les littéraux, la contrainte générique vérifie tout le reste
  de la forme, et ce que le compilateur ne voit plus est vérifié à l'exécution sur CHAQUE fichier
  par le schéma Zod. C'est une conséquence directe de D1, à garder en tête pour les entités.

**Un défaut de MON test, trouvé en le falsifiant et pas en le relisant.** Le test qui comparait
`SUMMARY_PROVIDER[source]` au `validationProviderId` de la fiche était tautologique depuis
l'absorption : les deux côtés sortent du même fichier, et un identifiant changé en « keplerien »
restait vert. Remplacé par la vraie affirmation, confrontée au résumé de validation : cet
identifiant doit être un nom que `horizons-validation-summary.json` emploie, faute de quoi
`measuredWindows` ne filtrerait plus aucune ligne et la fiche d'un corps annoncerait « extrapolé »
partout, en silence. Rouge après correction, dans ce test ET dans les trois de
`core/positionProvenance.test.ts`.

**Le bundle grossit, mesuré des deux côtés sur la même machine** (le littéral TypeScript et le
JSON importé ne se minifient pas pareil, piège 6) : `SolarSystemApp.js` 425 887 → 431 797 octets
(+5 910, +1,4 %), et **128 485 → 130 699 octets gzip (+2 214, +1,7 %)**. Deux causes visibles
dans le morceau livré : Vite hisse chaque champ d'un JSON en constante puis réassemble l'objet
(surcoût par fichier), et les fiches embarquent du texte qui ne sert qu'à l'éditeur (`$schema` 22
fois, 4 `coverageNote`). Ce n'est pas un argument contre le registre ; c'en est un pour le
chargement à la demande (D7, hors périmètre), et **le chiffre à surveiller en 7C**, où 66 entités
arriveront par le même chemin. Si l'écart devient réel, l'option la moins chère est
`json: { namedExports: false, stringify: true }` dans `vite.config.ts` : à mesurer alors, pas à
supposer.

**Falsifications de la phase, toutes vues rouges** : 7 mutations sur le registre (fiche retirée de
l'index, fiche indexée sous la mauvaise clé, `validationProviderId` faux, couverture rétrécie,
cadence fausse, rôle hors vocabulaire, URL en http), 8 cas invalides dans le test de schéma plus
la fiche valide et les bornes nulles qui doivent rester légales, 2 falsifications de la garde zod,
1 de l'étape de CI. Plus une gratuite : le JSON Schema commité, laissé en retard d'une
modification du schéma Zod, a fait rougir sa comparaison avant que je pense à régénérer.

Porte : `pnpm verify` vert, **1 965 tests / 110 fichiers** (1 914 / 107 avant), `pnpm build`
propre, empreinte des 171 documents identique, **suite e2e COMPLÈTE 122/122 en 23,7 min**.
Commité et POUSSÉ (`eb25e2b`), CI verte, déployé.

### Phase 2 (7B) : lectures faites d'avance, le 2026-09-18

Travail préparatoire fait pendant que la porte de la phase 1 tournait. **Rien n'est implémenté.**

**Le vocabulaire de licences est plus petit qu'annoncé.** `scripts/texture-sources.json` n'emploie
que trois étiquettes sur ses 67 entrées `imported` + `sources` : `public-domain` (24 crédits
distincts), `CC BY 4.0` (1, Solar System Scope), `generated` (1, texture procédurale du dépôt).

**Décision structurante, et un piège évité de justesse.** Lu dans la spec STAC Collection :
les valeurs permises de `license` sont un identifiant SPDX, une expression SPDX, ou la chaîne
`other` ; `various` et `proprietary` sont DÉPRÉCIÉS. Et surtout, mot pour mot :
« If no link to a license is included and the `license` field is set to `other` (or one of the
deprecated values), the Collection is private, and consumers have not been granted any explicit
right to use the data. » Or la liste SPDX ne contient AUCUN identifiant générique de domaine
public : seulement des dédicaces (`CC0-1.0`, `Unlicense`) et des notices d'agences précises
(`NIST-PD`, `NTIA-PD`, `NCBI-PD`, `SAX-PD`), dont aucune ne s'applique à la NASA ni à l'USGS.
**Donc : `other` + un lien `rel="license"` OBLIGATOIRE sur chaque produit domaine public.** Écrire
`other` tout seul déclarerait le contraire de ce qui est vrai. Ne jamais traduire `public-domain`
par `CC0-1.0` : personne n'a appliqué CC0 à ces images.

**Termes lus à leur source (2026-09-18), à citer tels quels :**

- **USGS** (`usgs.gov/information-policies-and-instructions/copyrights-and-credits`) :
  « USGS-authored or produced data and information are considered to be in the U.S. Public
  Domain. » Avec une réserve explicite : « not all information, illustrations, or photographs on
  our site are », le matériel tiers étant « generally marked as being copyrighted ». Le crédit est
  DEMANDÉ : « we ask that proper credit be given ».
- **NASA** (`nasa.gov/nasa-brand-center/images-and-media/`) : « NASA content [...] generally are
  not subject to copyright in the United States » — ce n'est donc pas une licence, et des
  conditions subsistent : pas d'endossement implicite, autorisation requise pour des personnes
  identifiables, insigne NASA encadré, usage NFT/cryptomonnaie interdit, et le matériel de
  partenaires « are marked accordingly » avec renvoi au détenteur des droits.
- **Solar System Scope** (`solarsystemscope.com/textures/`, page servie derrière un défi anti-bot,
  lue au navigateur) : « Distributed under Attribution 4.0 International license: You may use,
  adapt, and share these textures for any purpose, even commercially. » SPDX **`CC-BY-4.0`**,
  attribution obligatoire ; l'auteur nommé sur la page est **INOVE** (« Invented and Developed by
  INOVE »), pas seulement « Solar System Scope ».
  **À vérifier en 7B** : cette même page classe Cérès, Haumea, Makemake et Éris sous
  « Fictional », et dit que les lacunes sont « filled with fictional terrain » et les couleurs
  « slightly more saturated ». Confronter à `ILLUSTRATIVE_SURFACES`.
- **NOAA NCEI ETOPO 2022** (`ncei.noaa.gov/products/etopo-global-relief-model`) : **aucune
  mention de licence ni de contraintes d'usage sur la page produit.** Citation recommandée et DOI
  `10.25921/fd45-gt74`. C'est un TROU, pas une licence : le lire dans la fiche de métadonnées NCEI
  (champ « Use Constraints ») avant d'écrire quoi que ce soit, ou écrire honnêtement qu'aucune
  licence n'est publiée et lier la page produit.

### CONFLIT DE PROVENANCE (2026-09-18) : TRANCHÉ PAR L'UTILISATEUR, le bloc `imported` fait foi

Décision de l'utilisateur, le 2026-09-18 : les crédits publiés ont été vérifiés par lui à
plusieurs reprises, la comparaison des fichiers est abandonnée. Le bloc `imported` est la
provenance ; `reviews` est un journal historique (le fichier le disait déjà dans son
`importedNote`). Le constat ci-dessous reste comme trace de ce qui a été regardé.

`scripts/texture-sources.json` **se contredit lui-même**, et c'est le bloc `imported` qui est
PUBLIÉ sur `/sources` :

| corps / couche | publié (bloc `imported`) | bloc `reviews` |
|---|---|---|
| eris, haumea, makemake / surface | `CC BY 4.0`, Solar System Scope | `license: unconfirmed`, `status: unresolved` |
| halley / surface | `public-domain`, Philip Stooke / NASA PDS | `unconfirmed`, « third-party crop » |
| ceres / surface | `CC BY 4.0`, Solar System Scope | `public-domain-if-usgs` (l'inverse) |
| vesta, pluto / surface | `public-domain`, USGS | `public-domain-if-usgs`, « otherwise treat as unconfirmed » |

La note d'audit d'eris/haumea/makemake dit : « Likely community source (e.g.
planet-texture-map.fandom.com, CC BY-NC-SA). Record exact author + licence or replace before
commercial reuse. » Si elle avait raison, une licence NON COMMERCIALE serait publiée comme
CC BY 4.0.

**Ce qui est ÉTABLI** (lu au navigateur le 2026-09-18) : Solar System Scope distribue bien Cérès,
Haumea, Makemake et Éris sous « Attribution 4.0 International », dans une section qu'elle nomme
« Fictional », en 4096×2048, soit exactement les dimensions livrées. L'audit ne disposait
visiblement pas de cette lecture. À l'inverse, pour Halley l'audit a raison sur les faits : le
fichier livré fait **3674×1837**, taille qu'aucune chaîne USGS ne produit.

**Ce qui n'est PAS établi** : que les fichiers livrés SOIENT ceux de Solar System Scope. Tentative
de comparaison faite et jugée non concluante : signature 16×8 en niveaux de gris, écart moyen 18,6
entre le Cérès livré et celui de SSS, contre 27 à 36 pour d'autres corps. Plus bas, donc suggestif,
mais très loin de ce que donneraient deux encodages de la même image (~2 à 5) : le rééchantillonnage
par deux moteurs différents (canvas du navigateur contre sharp) sur un JPEG réencodé perd trop.
**Ce n'est pas une preuve et ne doit pas être écrit comme telle.**

**Pourquoi c'est bloqué** : `solarsystemscope.com` sert un défi anti-bot. `curl` reçoit un 202 de
179 octets, PowerShell un 403, WebFetch une page vide ; seule la session du navigateur passe, et
elle a expiré (CDP, 45 s) sur le décodage puis sur l'encodage base64 d'un fichier de 2 à 5 Mo.
**La voie qui reste** : que l'utilisateur télécharge lui-même les quatre fichiers 4k
(`https://www.solarsystemscope.com/textures/download/4k_{ceres,haumea,makemake,eris}_fictional.jpg`)
dans un dossier local, et une comparaison pixel à pixel locale tranche en une minute.

**Restent à lire avant la phase 2** : ESA Mars Express / DLR (HRSC), NASA PDS (cartes de Philip
Stooke), NASA Visible Earth / Earth Observatory (Blue Marble, Black Marble), et les termes des
éphémérides (JPL Horizons, NAIF pour le SPK). Ainsi que la version courante des extensions STAC
File et Processing (§ 11), dont 7B emprunte `file:checksum` et `processing:lineage`.

### Phase 2 livrée (2026-09-18) : `products/`

**Seules les deux pages `/sources` ont changé, et c'était voulu** : leur texte des mentions tierces
(`THIRD_PARTY_NOTICES.md`, rendu intégralement) nommait `scripts/texture-sources.json`, qui
n'existe plus. Les 169 autres documents sont identiques, et le bundle aussi, à l'octet : le
registre des produits n'est lu que par le build et les tests. Référence d'empreinte réécrite dans
un commit à part.

- **64 fiches** : une par couche de texture (63 : 59 livrées, 4 relues non livrées) et la
  collection des binaires d'éphémérides. Extraites par script, jamais recopiées. Chaque couche
  fusionne les trois blocs de l'ancien fichier (`imported` → la fiche, `sources` → `lineage`,
  `reviews` → `review`), qui ne peuvent donc plus diverger. Avant suppression, la vue dérivée a
  été comparée à l'ancien fichier en `toStrictEqual` sur les trois blocs : identique.
- **Licences** : `CC-BY-4.0` (SPDX) pour Solar System Scope ; `other` + `rights` +
  lien `rel: "license"` OBLIGATOIRE pour le domaine public (USGS, NASA, NOAA : lien vers la page
  de termes lue à la source) et pour les textures générées (lien vers `LICENSE.md`). La règle STAC
  est tenue par le schéma et falsifiée : `other` sans lien, `other` sans `rights`, `rights` à côté
  d'un SPDX, `proprietary`, `various`, l'ancien libellé « public domain » comme licence : tous
  refusés. Le journal historique (`lineage`, `review`) garde son vocabulaire d'origine, non publié.
- **Éphémérides : `rights: "unreviewed"`**, sans lien de licence, et c'est délibéré : les termes
  de JPL Horizons n'ont pas été lus, et STAC lit « `other` sans lien » comme « aucun droit
  accordé », ce qui est exactement vrai tant qu'ils ne le sont pas. Le schéma refuse un lien de
  licence sur une collection non relue. Le détail fichier par fichier reste dans le manifeste
  généré, que la fiche pointe (un test vérifie qu'il existe, comme le fournisseur et le script).
- `/sources` affiche toujours les mêmes libellés (`licenseLabel` : `CC-BY-4.0` → « CC BY 4.0 »,
  `rights` sinon), testé : un nouveau libellé passerait sur la page sans traduction.
- Nouvelle garde dans `bundleIsolation.test.ts` : aucun module de l'application n'importe
  `registry/products` (il lit 63 fiches par glob), falsifiée par un exemple intégré.
- Générateur renommé `scripts/generate-registry-schemas.mjs` (`pnpm schema:generate`), qui écrit
  les deux JSON Schema.

Porte : `pnpm verify` 2 053 tests / 112 fichiers, `pnpm build` propre, précache toujours 27.

### Phase 3 livrée (2026-09-18) : `entities/` en coexistence stricte

57 fiches sous `src/registry/entities/` (corps, lunes, petits corps et leurs satellites), écrites
par `scripts/extract-entities.mjs` depuis l'AST de `bodies.ts`/`smallBodies.ts`, jamais à la main.
Le littéral TypeScript restait AUTORITAIRE : `entities.test.ts` comparait `loadCatalogue()` au
catalogue en `Object.is` sur chaque nombre et ordre des clés partout où il est lu (hors `realData`).
Falsifié (commits `1fc5b79`, `df10d47`) : un bit changé sur le rayon de Mars et Mercure/Vénus
inversés dans `order.json` rougissaient tous deux. Le deuxième commit répare un défaut du
générateur (`rmSync` du dossier entier, index et test compris) trouvé en comptant les tests
(213 au lieu de 216), pas en relisant le diff.

- Un calcul se déclare par une forme nommée (`{"$deg": …}`, `{"$gm": …}`) sur l'ensemble fermé de
  `registry/load.ts` ; une forme inconnue arrête le générateur comme le chargeur.
- Un fait = un objet unique (valeur, source, méthode, `asOf`, incertitude, ou `published: false` +
  raison) ; les 264 commentaires du catalogue sont rangés dans `notes`, retirés du bundle client à
  l'import par le plugin `stripRegistryNotes` de `vite.config.ts`.
- Schéma Zod des entités (la liste des formes est LUE dans le chargeur, jamais recopiée), JSON
  Schema généré, 13 cas invalides vus refusés.

**Périmètre réel, et dérive assumée du plan** : l'arbitrage « 52 corps, 11 sondes, 3
interstellaires » n'a pas été tenu pour les 14 derniers. Sondes et interstellaires vivent dans
`config/spacecraft.ts` / `config/interstellar.ts`, restés en littéral TypeScript : ce ne sont PAS
des `CelestialConfig` (overlays 2D, trajectoires hyperboliques, fenêtre ±20 ans), le chargeur et
le test d'égalité stricte ne les couvrent pas, et les faire entrer au registre est un type de
fiche nouveau, pas une vague de plus. Tranché avec l'utilisateur le 2026-09-18 : le lot 7 finit
sur le catalogue ; sondes/interstellaires = lot dédié, à prévoir.

### Phase 4 livrée (2026-09-18) : bascule, le catalogue devient le registre

`CELESTIAL_CONFIG` est désormais `loadEntityCatalogue()` ; `bodies.ts` (2 043 → 41 lignes) et
`smallBodies.ts` (1 708 → 42 lignes) ne gardent que du code : dérivation des chemins de texture,
contrôles structurels, dérivation des éléments des petits corps. Le générateur
`extract-entities.mjs` est supprimé (il ne lit plus rien). `vite.config.ts` ajoute
`json: { stringify: true }` : les fiches arrivent dans le bundle en une chaîne parsée au démarrage
plutôt qu'en autant de constantes réassemblées (l'option notée « à mesurer » en phase 1).

**L'égalité stricte n'a pas été supposée, elle a été refaite et refalsifiée par l'agent qui
prend le relais** (un statut vert rapporté n'est pas une preuve) : le littéral d'HEAD et l'ancien
test `Object.is` ont été restaurés temporairement — vert ; puis un bit changé sur le rayon de
Vénus — rouge, dans ce test et lui seul ; restauré, `git diff` vide. Le test d'égalité cède alors
la place à des gardes du chargeur (fiche orpheline, fiche placée deux fois, couleur invalide…),
chacune vue refuser, et à l'empreinte.

**L'empreinte, différence par différence.** Première passe : 110 documents « modifiés ». Mesuré
contre le déploiement en ligne (build de la phase 2) : page par page, la SEULE différence est
l'échange de deux lignes `<link rel="modulepreload">` adjacentes (astronomy change de rang) — la
graphe de modules a bougé, pas un octet de contenu. C'est du bruit de build, compris et nommé,
pas une dérive du catalogue : la référence est réécrite dans un commit à part, comme en phase 2.
Le bundle, mesuré sur la même machine : `SolarSystemApp.js` 425 887 → 431 797 (phase 1) →
**452 760 octets à la bascule** (gzip 136 370) → 454 561 avec Psyché (gzip 136 545), soit
+6,3 % depuis le début du lot pour 80 fiches dans le bundle (58 entités + 22 fournisseurs) ; le
gzip ne bouge que de ~2 %, les fiches JSON se compressent mieux que le littéral minifié. Le
chiffre à surveiller reste celui-ci, avant toute idée de chargement à la demande (D7).

### Phase 5 livrée (2026-09-18) : la preuve — 16 Psyché ajoutée sans toucher une ligne de TypeScript

La preuve exigeait d'abord que trois tables de données sortent du code, sinon « aucun .ts » serait
menti dès le deuxième fichier :

- les vecteurs de référence du test de régression (`WAVE_A_VECTORS`, `EPOCH_VECTORS`,
  `src/config/smallBodies.test.ts`) deviennent `src/config/smallBodyReferenceVectors.json`.
  Falsifié des deux côtés : un vecteur d'époque déplacé de 0,5 UA → rouge ; le vecteur de Vesta
  retiré → rouge (« no Horizons vector », la garde couvre tout le socle) ;
- la liste des cibles SBDB (`scripts/snapshot-fact-sources.mjs`) devient
  `scripts/fact-source-targets.json` ;
- les tables `TARGETS`/`CENTERS` de `scripts/validate-against-horizons.mjs` deviennent
  `scripts/validation-targets.json`. Falsifié : cible `15;` avec `expect: 'psyche'` → erreur
  explicite « Horizons a résolu « 15; » en « 15 Eunomia » » — la vérification de cible existe
  pour ça, la preuve l'emploie.

**Un vrai défaut trouvé en chemin** : la SBDB publie pour Psyché un diamètre à incertitude
ASYMÉTRIQUE (`222 -1/+4`, Shepard et al. 2021) qui cassait `number()` du script de relevé. Conservée
en chaîne telle quelle (la déparer mentirait), le type du test élargi ; falsifié par le succès du
relevé lui-même, qui échouait avant.

**L'ajout lui-même** : `psyche.json` (éléments Horizons exacts à l'époque, relevés par
`pnpm ephemeris:small-body` ; faits SBDB du relevé du 2026-09-18 : rayon dérivé du diamètre, masse
et gravité dérivées du GM de Farnocchia et al. 2024, rotation LCDB, 0 lune confirmée ; obliquité et
température NON publiées, la SBDB ne porte pas de pôle), `order.json` (après Hygie),
`smallBodyReferenceVectors.json` (époque + 5 dates), `fact-source-targets.json`,
`validation-targets.json`, `factSources.snapshot.json` (relevé régénéré), les `asOf` moonCount de
19 fiches au 2026-09-18 (relevé refait, exigé par `factProvenance.test.ts`) et les rapports
`reports/horizons-validation.*` + `horizons-validation-summary.json` régénérés.
**`git diff --stat` de l'ajout : zéro `.ts`, zéro `.mjs`.**

Ce que la preuve établit et n'établit pas, honnêtement : ajouter un corps positionné est de la
donnée plus des artefacts régénérés par script (`pnpm facts:snapshot`, `pnpm ephemeris:validate`,
`pnpm build` + empreinte) — jamais du code, mais pas « zéro commande » non plus : la garde de
`docPages.test.ts` exige le résumé de validation, c'est voulu. Et Psyché n'a ni texture ni modèle :
elle rend comme sphère de secours colorée, l'invariant Explo interdit de lui donner une taille
apparente plancher.

**Mesures.** Éléments à l'époque : écart ≤ 1e-8 UA (garde stricte). Validation complète : 328 cas,
Psyché moy 2,05e6 km à ±10 ans, 0 hors seuil (comparable à Hygiea, même régime de perturbations).
`pnpm verify` : 2 159 tests / 114 fichiers. Empreinte : **173 documents** (2 pages et 1 vignette
ajoutées, sitemap, méthodologie), référence réécrite séparément ; seuls swaps de preload par
ailleurs. Suite e2e complète : voir la porte ci-dessous.

Porte : `pnpm verify` vert (2 159 tests / 114 fichiers), empreinte verte (173 documents),
suite e2e COMPLÈTE 122/122 en 23,7 min, axe et 390 px sur la page Psyché à parité avec les
pages existantes (mêmes trois familles de violations du gabarit, aucune nouvelle, pas de
défilement horizontal).

### Lot 7D livré (2026-09-19) : sondes et interstellaires

Les 11 sondes et les 3 objets interstellaires ont chacun une fiche JSON dans leurs dossiers
`src/registry/spacecraft/` et `src/registry/interstellar/`. Les interfaces publiques et la
fenêtre temporelle restent dans `src/config/`; les overlays et les consommateurs SEO lisent les
exports dérivés sans changement. Les positions des sondes restent dans les binaires Horizons,
et les éléments interstellaires sont décodés avec les formes `$deg` et `$date` de `registry/load.ts`.
Les ordres des deux overlays sont déclarés dans leurs chargeurs. Les schémas Zod stricts produisent
les JSON Schema commités, sans Zod dans le bundle client.

Extraction ponctuelle depuis les littéraux d'origine, puis suppression du script. Les témoins
`legacyFixture.ts` en gardent une copie pour l'égalité stricte (`Object.is` sur les feuilles,
dates par millisecondes et ordre de chaque clé). Le manifeste Horizons fait foi pour les cibles
NAIF et les deux bornes des couvertures. Falsifications effectivement rouges puis restaurées :
bit d'excentricité de Borisov, deux clés inversées dans le chargeur, cible NAIF changée,
couverture rétrécie, fiche orpheline et JSON Schema périmé.

Porte rapide : `pnpm verify` vert, 2 195 tests / 118 fichiers contre 2 159 / 114 avant ;
`pnpm build` vert. `SolarSystemApp.js` : 454 561 → 458 594 octets, gzip 136 545 → 138 377.
Le précache compte toujours 27 entrées. L'empreinte vérifie 173 documents identiques après
normalisation du tampon « Data as of » / « Données au » de la page documentaire. Le passage
de minuit depuis l'empreinte de référence faisait apparaître deux pages `/sources` modifiées,
alors que le texte métier des trois interstellaires est identique au témoin figé ; cette date
de build est maintenant normalisée comme `<lastmod>` et `dateModified`. La référence a été
réécrite pour cette seule règle (quatre empreintes documentaires et la taille du bundle).

Suite e2e complète confirmée lors de la reprise du 2026-09-19 : **122/122 en 24,0 min**, résumé
Playwright et code de sortie 0. Les 5 scénarios sondes/interstellaires passent aussi seuls (5/5,
code 0). Pour ces passages, Vite a été démarré séparément sur le port de test 5273, puis
Playwright a réutilisé le serveur existant. Le blocage de fermeture observé lorsque Playwright
démarre lui-même Vite vient du bac à sable de cette session Windows : `taskkill /pid … /T /F`,
employé par Playwright pour arrêter l'arbre du serveur, y reçoit « Access denied ». Remplacer
`pnpm exec vite` par `node node_modules/vite/bin/vite.js` n'y change rien. Vérification ciblée
hors bac à sable, avec le serveur géré par Playwright : **5/5, code de sortie 0**. La
configuration du dépôt est conservée ; pour valider l'e2e depuis cet environnement, exécuter
Playwright hors de cette restriction ou lui fournir un serveur Vite déjà actif.

## 11. Ce qui reste à trancher

Les trois arbitrages ouverts à la rédaction (périmètre, moment de la migration des textures,
passage aux licences SPDX) ont été tranchés le 2026-09-18 : voir § 10.

Le périmètre de migration du lot 7 est livré : corps, sondes et interstellaires sont des fiches
JSON. Les sondes et interstellaires gardent leurs types de fiches propres, hors `CelestialConfig`.

Restent ouverts, et à lire à la source AVANT toute phrase publiée qui s'en réclame : le format
exact du LID PDS4 (§ 3), et la version courante des extensions STAC File et Processing dont on
emprunte `file:checksum` et `processing:lineage`.
