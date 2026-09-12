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
- **Un test doit énoncer la propriété qui casserait, pas une propriété commodément vraie.** Cas
  réel : `leaves no dark gap between the shadow and the first lights` vérifiait que les deux rampes
  du terminateur sont `> 0` sur la bande. C'est toujours vrai pour deux smootherstep sur un
  intervalle ouvert — et `0,5 % + 0,5 %` passait l'assertion en s'affichant noir à l'écran. Le test
  existait, était vert, et n'a rien vu pendant que le défaut était visible. Il énonce désormais le
  vrai invariant : la somme normalisée des deux contributions ne redescend jamais sous 1.
- **Falsifier chaque garde avant de le croire.** Remettre le défaut et vérifier que le test échoue
  vraiment, avec le bon message. Un test qui ne casse pas quand on réintroduit le bug ne garde rien
  — c'est la seule façon de distinguer un garde d'une décoration.
- **Vérifier que la mutation s'est APPLIQUÉE avant de lire le résultat.** Une falsification qui
  n'a pas eu lieu ressemble exactement à un test qui passe. Cas réel : une substitution `perl`
  n'a rien matché (un `\n` dans une chaîne JavaScript est un antislash suivi d'un `n`, pas un
  saut de ligne), la suite est restée verte, et ce vert a failli être noté comme une preuve.
  Compter les occurrences après la mutation, pas seulement avant.
- **Vérifier l'UNITÉ dans laquelle le seuil est exprimé.** Une borne de contraste écrite sur des
  valeurs LINÉAIRES (1,47) échouait contre des pixels sRGB 8 bits (1,26) sur un rendu pourtant
  correct. Même famille que la garantie du terminateur qui était vraie dans une unité que
  personne n'avait comparée à un pixel.
- **La suite e2e COMPLÈTE attrape ce que les runs ciblés manquent** — trois fois en deux jours :
  deux tests météo rouges de façon déterministe depuis quatre jours, deux tests d'atterrissage
  qui figeaient l'ancien contrat d'URL, et une régression où masquer un libellé supprimait son
  élément DOM. Les 1000+ tests unitaires étaient verts pendant ce temps.
- **Ne JAMAIS éditer de fichier pendant qu'une suite e2e tourne en arrière-plan.** Le serveur de
  développement recharge à chaud et casse les tests en cours : un passage a rendu 24 échecs sans
  aucune valeur, dont le test de démarrage le plus basique, qui passe seul en 1,3 minute.
- **`uncheck()` sur une case INDÉTERMINÉE est un no-op silencieux.** Elle porte déjà
  `checked === false`, donc Playwright considère l'état atteint, ne clique pas, et aucun
  événement `change` ne part. L'échec tombe alors sur l'assertion SUIVANTE et désigne la
  mauvaise ligne. Depuis un état mixte, cocher puis décocher.
- **« Réaliste » se tranche contre une référence MESURÉE, pas contre un jugement.** Deux réglages
  de saturation successifs, validés par l'œil, n'ont rien réglé — et trois valeurs essayées
  rendaient des images mesurément indiscernables. Deux photographies NASA profilées pixel par
  pixel ont réglé la question en une passe, en montrant que le défaut était géométrique.
- **Un test ne doit pas mesurer son propre harnais.** La parité des titres ne peut pas se
  vérifier en e2e : le serveur de développement ne génère pas les pages par corps, donc une
  requête vers `/jupiter/` y renvoie l'app shell. Elle vit en unitaire. De même, le talon du
  test d'uniformes ne doit nommer aucun uniforme, sinon il signale un défaut qu'il a écrit.

`tsconfig.json` inclut `e2e` : les scénarios Playwright sont **typés par `pnpm typecheck`**, pas
seulement lintés. Sans cela une erreur de type dans un spec n'apparaissait qu'à l'exécution — donc
après vingt minutes de suite, ou jamais si la branche fautive n'était pas empruntée.

## Diagnostic d’un échec e2e

1. Lancer le fichier concerné : `pnpm exec playwright test e2e/smoke.spec.ts --reporter=line`.
2. Vérifier `test-results/` et la console navigateur.
3. Distinguer un conflit de couche UI d’un vrai échec WebGL : un overlay cliquable peut recouvrir le canvas.
4. Ne pas augmenter les timeouts avant d’avoir reproduit le scénario isolé.

## Couverture actuelle

La suite Vitest couvre les transformations de repères, Kepler, éphémérides, horloge, échelles,
catalogue, éclipses, texture LOD, permaliens, événements astronomiques et câblage de certaines UI.

**Invariants physiques du mouvement** (cf. `docs/ARCHITECTURE.md` § « Position d'un corps ») :
sens de rotation des 52 corps dans les deux sens du temps, cadence de révolution des satellites,
répartition des points d'une ligne d'orbite, propagation deux-corps, et deux tests qui lisent les
binaires Horizons **réellement committés** plutôt qu'une donnée de test. Cette famille garde des
défauts qui ne lèvent aucune erreur — une position fausse reste une position — et chaque garde
y a été vérifiée falsifiable : on réintroduit le défaut, on confirme que le test tombe.
Playwright couvre le boot, loader, navigation, sélection 3D, modes, labels, i18n, mobile, petits
corps, permaliens, événements astronomiques, zoom optique, visite guidée et accessibilité.

**Un cran au-dessus du câblage : `e2e/terminator.spec.ts` compte des PIXELS.** C'est la seule
partie de la suite qui juge l'image et non la plomberie, et elle existe pour une raison précise :
deux défauts de terminateur livrés de suite sont passés sous des tests unitaires verts. Les
courbes de `core/terminator.ts` étaient justes ; ce que l'écran en faisait ne l'était pas — une
garantie exprimée en relatif contre une référence elle-même invisible reste vraie pendant que la
bande rend zéro pixel. La sonde `?debug-terminator` (`src/ui/terminatorProbe.ts`) cadre le
terminateur au centre du disque et renvoie, par tranche de hauteur solaire, la part de pixels
au-dessus du plancher d'affichage. Quand une propriété se voit à l'écran et pas dans la donnée,
c'est le niveau à viser — mais seulement là : une assertion en pixels coûte cher et se casse pour
des raisons d'environnement (cf. la limite `DataTexture` documentée dans ce fichier même).

**Pages d'atterrissage et vignettes de partage** (`src/seo/*.test.ts`) : ces artefacts ne
naissent qu'au build et personne ne les regarde pendant le développement — une vignette ne
s'affiche que dans une conversation, chez quelqu'un d'autre, une fois déployée. Les tests tiennent
donc ce qui casserait en silence : chaque page a un titre, une description, un canonique et une
vignette DISTINCTS des cinquante autres ; un repère disparu du HTML lève une erreur au lieu de
produire cinquante et une copies de l'accueil ; la sphère est éclairée et détourée plutôt que
plate et carrée ; le SVG reste bien formé quand le catalogue contient un chevron ; et chaque
corps a soit une texture de surface, soit une couleur déclarée. Les chemins de texture sont
vérifiés EXISTANTS sur disque : sinon le défaut n'apparaîtrait qu'au build, vingt minutes plus
tard, sans nommer le corps en cause. Ce que ces tests ne voient pas, c'est l'application ouverte
sur un tel chemin — c'est le rôle d'`e2e/bodyLanding.spec.ts`.

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
- `pnpm exec playwright test e2e/terminator.spec.ts --reporter=line`
- `pnpm exec playwright test e2e/a11y-tree.spec.ts e2e/touch.spec.ts --reporter=line`

`weather.spec.ts` couvre le panneau, les groupes exclusifs, le diagnostic et l'invariant « modèle caché sans donnée propre ». `precip-visual.spec.ts` utilise un fixture déterministe IMERG pour vérifier l'alpha natif et l'absence d'extrapolation polaire. `earth-visual.spec.ts` vérifie le câblage du displacement et le retour LOD sans dépendre d'une réponse météo.

`terminator.spec.ts` mesure la bande de crépuscule en pixels et vérifie qu'une couche météo
MODÈLE porte la largeur de crépuscule de sa couche, pas la sienne. **Limite connue à ne pas
« corriger »** : sous le rendu logiciel des runners, la `DataTexture` des couches modèle ne
remonte pas — le calque sort noir opaque avec ou sans correction. C'est pourquoi ce second cas
lit la largeur annoncée par le matériau (`twilight=` dans `?debug-meteo`) au lieu de compter des
pixels ; une assertion en pixels y serait verte pour une mauvaise raison.

Le client Open-Meteo possède en plus des tests Vitest déterministes pour le retry 429/5xx, `Retry-After`, la déduplication en vol et le cache des réponses. Les tests de réseau ne valident pas la disponibilité du fournisseur en production ; une capture live et le diagnostic `?debug-meteo` sont requis pour qualifier une donnée réellement reçue.

`verify:all` reste le gate complet de release. Si son étape SPK/Playwright atteint la limite d'infrastructure sans assertion exploitable, conserver les résultats des commandes ciblées ci-dessus et signaler le timeout séparément.

### Accessibilité : deux niveaux, et ce qu'aucun des deux ne fait

- `pnpm test:a11y` (`e2e/a11y-audit.spec.ts`, axe-core) balaie neuf panneaux à la recherche de
  violations WCAG détectables automatiquement. Il vérifie des **règles**.
- `e2e/a11y-tree.spec.ts` lit l'**arbre d'accessibilité** calculé par Chromium (CDP
  `Accessibility.getFullAXTree`, via `e2e/axTree.ts`) : rôles, **noms accessibles**, états. Il
  vérifie des **valeurs**. C'est le complément d'axe, qui passerait sans broncher sur un bouton
  nommé « Button », une boîte de dialogue anonyme, ou un interrupteur dont `aria-pressed` ne suit
  jamais l'état réel. Quatre propriétés verrouillées : tout contrôle porte un nom utilisable ; un
  panneau annonce son ouverture (`aria-expanded`) et se nomme lui-même ; le bouton lecture/pause
  décrit l'action offerte et expose son état ; un seul mode d'échelle est `pressed` à la fois.

**Ce qu'aucun des deux ne fait, et qui reste manuel** : ce qu'un lecteur d'écran ANNONCE. Cela
dépend du lecteur, de sa version, de sa verbosité et du navigateur ; aucune API ne permet de le
capturer, donc l'automatiser produirait un test qui ment. L'ordre d'annonce, le ressenti du
parcours clavier et la pertinence des libellés se jugent avec NVDA ou VoiceOver, à la main.

**Piège CDP à connaître** : `expanded` revient en booléen, `pressed` en CHAÎNE
(« true »/« false »/« mixed » — le type `tristate` d'ARIA). `axTree.ts` normalise ; sans cela une
comparaison à `true` réussit pour l'un et échoue pour l'autre. Noter aussi que
`page.accessibility.snapshot()` a été retiré de Playwright : passer par CDP.

### Libellés statiques de `index.html`

`src/i18n/staticLabels.test.ts` est un contrôle purement STATIQUE (aucun navigateur, quelques
millisecondes dans `pnpm verify`) sur trois propriétés que rien ne signalait :

- tout `aria-label`/`title` du HTML est lié à une clé (`data-i18n-aria`/`data-i18n-title`) —
  sans quoi un francophone se fait annoncer un libellé anglais figé ;
- le texte en dur ÉGALE la valeur anglaise du dictionnaire. Ce texte est un repli légitime (il
  sert avant `applyStaticI18n` et si l'i18n échoue), mais devient un mensonge dès que le
  dictionnaire évolue sans lui. L'égalité transforme une redondance en garantie ;
- toute clé référencée par le HTML a bien une traduction française.

Aucun test de rendu ne pouvait attraper ça : la page s'affiche, axe-core est content (le nom
accessible EXISTE) et `a11y-tree.spec.ts` aussi (il vérifie qu'un nom existe, pas qu'il est
traduit).

### Mobile : viewport contre profil d'appareil

Les scénarios « mobile » de la suite ne changent que le **viewport** (390×844). Ce n'est pas
symbolique — vérifié : `isLowPowerDevice` a un filet « petit écran » (côté court < 768 et côté
long < 1024), donc `IS_MOBILE` bascule et le rendu allégé est bien exercé.

`e2e/touch.spec.ts` couvre ce qui leur échappe, avec un **descripteur d'appareil** Playwright
(`devices['Pixel 7']`) : `navigator.maxTouchPoints > 0` (la branche tactile de la détection
n'était couverte que par des tests unitaires purs), un `devicePixelRatio` réel, et surtout un
**geste tactile** — le glissement à un doigt sur OrbitControls, seul moyen de tourner la caméra
sur un téléphone, n'était joué nulle part. Le test met la simulation en pause, vérifie d'abord
que deux relevés d'image sont IDENTIQUES (sans quoi il passerait aussi bien si le geste ne
faisait rien), puis exige que l'image change après le glissement.

**Un émulateur Android complet a été écarté** : plusieurs gigaoctets, démarrage lent, pont ADB à
maintenir — et il ne donnerait toujours ni GPU réel ni comportement thermique, donc il n'ajoute
rien aux deux points ci-dessus. Le vrai téléphone reste un passage manuel.

### Audit des assets visuels

`pnpm textures:audit` verifie le lien catalogue -> fichiers JPEG, les LOD declares, la lisibilite des images et leur projection. Cette commande est requise apres tout ajout de planete, lune, couche nuageuse, anneau, relief ou lumiere nocturne.
