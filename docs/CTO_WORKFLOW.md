# GAL-BATCH-V1.1 : protocole de travail Galaxy

Source unique du protocole entre le superviseur (CTO) et l'agent. CLAUDE.md pointe ici sans recopier les règles.

## Principe
Un lot = un objectif produit ou technique vérifiable.
Le CTO définit QUOI et les critères avant exécution.
L'agent choisit COMMENT, les commits et les tests internes.

## Exécution
- Lire ce fichier au début de chaque lot.
- `git fetch` puis lecture de `origin/main` avant chaque mission ; consigner le SHA de base. Ne jamais déduire l'état distant de la branche locale.
- Conserver les conventions techniques du dépôt.
- Ne pas refaire un audit déjà validé sans signal nouveau.
- Corriger de façon autonome les défauts du périmètre.
- Ne pas multiplier les PR ou checkpoints sans raison.
- Un lot se conclut par un seul compte rendu consolidé.

## Risques
- FAST : changements réversibles, vérifications ciblées.
- STANDARD : changement intégré, tests et CI applicables.
- STRICT : données réelles, publications, licences, migrations, production et actions difficilement annulables. Toute régénération ou publication de données de référence, de leurs empreintes, ou tout déploiement Cloudflare ou VM est STRICT. Une mission FAST qui touche l'un de ces points est reclassée STRICT par l'agent, qui le signale dans le rapport.

Stopper uniquement avant une frontière nécessitant un GO.
Ne jamais étendre une autorisation à une autre frontière.

Sans GO explicite, même au milieu d'un lot : suite e2e locale complète, déploiement manuel, suppression de branches ou de PR, transfert vers la VM. Les tests ciblés restent autonomes. L'opération en attente est listée dans AUTORISATION du rapport, le lot continue pour le reste.

## Qualité
- Critères d'acceptation écrits AVANT la mission.
- Tests, preuves scientifiques, budgets et garde-fous conservés.
- Échec ou preuve absente = pas de validation.
- Une découverte imprévue est signalée, pas masquée.
- Pas de réexécution complète sans justification.
- Le budget de démarrage (`pnpm budget:startup`) est un gate bloquant. Sa simple vérification ne rend pas une mission STRICT. L'écart Windows/Linux (environ 158 o) n'autorise pas à relever le plafond : une correction doit rester conforme sur l'environnement de référence de la CI, et tout dépassement exige une justification mesurée et une décision explicite si le plafond doit changer.

### Verdicts et limites de vérification
- Limites à déclarer dans NON VÉRIFIÉ : téléphone réel indisponible, job e2e complet réservé à `main`.
- PARTIAL est légitime quand une preuve obligatoire manque.
- Preuve impossible avant fusion : la PR peut être déclarée PREMERGE_READY, sous réserve des autorisations et gates applicables. Le contrôle de `main` (shards, `ci:health`) reste obligatoire après une fusion autorisée, et ne peut pas être déclaré réussi avant son exécution.
- Test qui aurait dû réussir et échoue : on ne contourne pas l'échec.

## Cadence
Par défaut : 2 lots visibles puis 1 lot de durcissement.
Priorité aux défauts critiques dès leur identification.
Suivre les indicateurs dans les PR GitHub. Objectif FAST ou STANDARD : 1 PR par lot et 0 aller-retour supplémentaire. Plusieurs PR restent possibles pour une séparation technique ou de risque justifiée.

## Rapport
Fait / Mesuré / Non vérifié / Reste / Risques / PR-SHA.
Le CTO valide sur les preuves ou formule un seul retour consolidé des écarts bloquants.

Format du rapport final :

```
GAL-[ID] RAPPORT FINAL

VERDICT : PASS / PARTIAL / BLOCKED
PR : #... | HEAD : ...

FAIT        Fonctionnalités réellement livrées
MESURÉ      AC1 à AC4 : PASS/FAIL + preuves ; tests réussis/total ;
            CI (run, shards, ci:health, réessais) ; budgets mesures/limites
NON VÉRIFIÉ Éléments non testés et raisons, ou "aucun"
RESTE       Défauts, risques, travaux hors périmètre
AUTORISATION Aucune nécessaire / opération en attente
COORDINATION Allers-retours supplémentaires : [nombre] ; PR du lot : [nombre]
```

## Source de vérité
Ce fichier est l'unique référence du protocole.
La mission courante définit son périmètre et ses critères.
