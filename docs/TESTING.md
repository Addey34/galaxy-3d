# Validation et tests

## Niveaux

| Commande          | Portée                                  | Coût              |
| ----------------- | --------------------------------------- | ----------------- |
| `pnpm typecheck`  | TypeScript strict, sans émission        | court             |
| `pnpm lint`       | ESLint flat config                      | court             |
| `pnpm test`       | Vitest, logique et services              | court             |
| `pnpm verify`     | typecheck + lint + `format:check` + Vitest | gate local rapide |
| `pnpm build`      | typecheck + bundle Vite production      | moyen             |
| `pnpm test:e2e`   | scénarios Playwright Chromium/WebGL     | long              |
| `pnpm verify:all` | verify + build + e2e                    | gate complet      |
| `pnpm budget:startup` | budget du démarrage, famille JavaScript (exige un build) | court |
| `pnpm budget:measure` | le démarrage mesuré par famille dans un vrai navigateur | moyen |
| `pnpm inventory:gaps` | l'inventaire des manques, dérivé du dépôt corps par corps (`--json` pour la sortie machine) | court |

**Après un `pnpm build`**, `pnpm fingerprint:generated` compare les documents produits
(pages par corps, pages d'éclipse, pages documentaires, vignettes, sitemap) à la référence
commitée `src/seo/generated-fingerprint.json` ; il imprime leur nombre, qui n'est donc pas recopié
ici (cette ligne en annonçait 171 pour 173 produits, corrigé le 2026-09-26). Il répond à une question que `pnpm verify` ne pose
pas : le build publie-t-il encore exactement les mêmes documents ? `--write` réécrit la référence
(à commiter à part), `--portable` exclut les vignettes, qui ne sont pas comparables d'une machine
à l'autre parce que leur texte dépend des polices du système.

**Toujours après un `pnpm build`** également, `pnpm budget:startup` confronte au plafond ce que le
démarrage exécute de JavaScript. C'est la seule des quatre familles du budget de démarrage qui
n'existe pas avant un build ; les trois autres (fenêtre d'éphémérides, textures, maillages) se
comptent sur les artefacts committés et vivent dans `src/config/startupBudget.test.ts`, donc dans
`pnpm verify`. **Il n'y a volontairement PAS de total unique** : un budget global créerait une
pression permanente à dégrader les textures pour financer autre chose. Contrat et nombres dans
`docs/ARCHITECTURE.md` § « Le budget du démarrage, famille par famille » ; la méthode de mesure est
`pnpm budget:measure`, jamais un paragraphe.

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
- **Un test unitaire ne parle À PERSONNE.** Une fabrique qui accepte un `fetch` injectable a
  presque toujours le vrai `fetch` par défaut : l'appeler sans argument dans un test le branche
  sur le réseau. Cas réel : `src/core/earthEventLayers.test.ts` construisait ses deux couches
  sans injecter de double, donc `pnpm verify` interrogeait réellement l'USGS et NASA EONET et
  tombait en dépassement de délai environ une fois sur trois (mesuré sur huit exécutions) ;
  2,4 s de suite contre 0,24 s une fois la réponse simulée. Un test rouge par intermittence use
  la confiance dans la porte bien plus vite qu'il ne protège de quoi que ce soit. Les scénarios
  e2e, eux, coupent l'extérieur par `e2e/netBlock.ts`.
- **Falsifier chaque garde avant de le croire.** Remettre le défaut et vérifier que le test échoue
  vraiment, avec le bon message. Un test qui ne casse pas quand on réintroduit le bug ne garde rien
  — c'est la seule façon de distinguer un garde d'une décoration.
- **Un garde qui balaie une clé INEXISTANTE est vert en ne vérifiant rien.** « Aucun fait affiché ne
  tient sa date d'une reprise » parcourait `fiche.sources`, quand une fiche de sonde porte `facts` :
  l'objet était vide, la boucle ne tournait pas, le test passait. Il compte désormais ce qu'il a
  balayé (`expect(Object.keys(...).length).toBeGreaterThan(0)`), et c'est la falsification qui l'a
  trouvé, pas la relecture. **Un garde qui itère doit affirmer qu'il a itéré.**
- **Un garde qui lit le TEXTE d'un fichier accuse aussi ses commentaires.** « Le script du relevé ne
  lit pas l'horloge » comptait `new Date()` dans l'en-tête qui EXPLIQUE le défaut : il rougissait sur
  une phrase, pas sur du code. Retirer les commentaires avant de compter, et falsifier les deux sens :
  une lecture d'horloge ajoutée doit rougir, un commentaire qui la cite ne doit pas.
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

- **UN TEST VERT AU RÉESSAI N'EST PAS UN TEST VERT, et la CI ne le dit pas toute seule.**
  `playwright.config.ts` donne deux reprises en CI : un test qui échoue puis passe rend le job
  VERT et ne laisse qu'un mot dans un journal que personne n'ouvre. Mesuré au lot 24 sur les huit
  derniers runs de `main` : **dix scénarios distincts** ne sont passés qu'au réessai, et le run
  annoncé « vert en entier » au lot 23 en contenait **quatre**. `pnpm ci:health` lit cela dans un
  run donné (par défaut le dernier de `main`) et sort en code 1 ; le workflow
  `.github/workflows/main-ci-watch.yml` le fait tourner après chaque run de `main` et ouvre une
  issue. Un test qui échoue trois fois sur trois n'est pas « instable » : il est faux ou mal
  isolé. Un test qui échoue une fois sur trois ne l'est pas davantage — il dépend de son
  environnement, et la cause se MESURE (frein CPU du protocole DevTools, `--repeat-each`).

`tsconfig.json` inclut `e2e` : les scénarios Playwright sont **typés par `pnpm typecheck`**, pas
seulement lintés. Sans cela une erreur de type dans un spec n'apparaissait qu'à l'exécution — donc
après vingt minutes de suite, ou jamais si la branche fautive n'était pas empruntée.

## Diagnostic d’un échec e2e

1. Lancer le fichier concerné : `pnpm exec playwright test e2e/smoke.spec.ts --reporter=line`.
2. Vérifier `test-results/` et la console navigateur.
3. Distinguer un conflit de couche UI d’un vrai échec WebGL : un overlay cliquable peut recouvrir le canvas.
4. Ne pas augmenter les timeouts avant d’avoir reproduit le scénario isolé.
5. Un clic qui expire sur un élément déjà « visible, enabled and stable » n'est pas un timeout
   à rallonger : c'est presque toujours un clic lancé PENDANT le boot. Le dock est dans
   `index.html` dès le premier octet, donc `toBeVisible()` est vrai avant que l'application
   existe, et sous GPU logiciel le décodage des textures bloque le thread principal par
   à-coups. **Tout scénario attend `#loader` caché avant sa première interaction** ; le lot 8
   a coûté un shard de CI rouge, trois tentatives sur trois, pour l'avoir oublié dans un seul
   fichier sur quarante.

   **ET CE N'EST PAS SUFFISANT** (corrigé le 2026-09-28, lot 24 ; la phrase ci-dessus était vraie
   et incomplète). `#loader` caché ne veut pas dire « l'application accepte un clic ». Mesuré
   sous frein CPU × 8, page `?debug-meteo&body=earth` : juste après le masquage du chargeur, un
   aller-retour `requestAnimationFrame` met **13,43 s**, puis 2,25, 1,12 et 2,98 s, et seulement
   ensuite 0,15 s. Vingt secondes de thread saturé après le signal. Un clic de Playwright a
   besoin de ce thread : son journal s'arrête alors à « done scrolling » ou à « performing click
   action », sans jamais dire pourquoi. Un scénario qui clique juste après un démarrage, après un
   saut de date ou pendant une visite guidée appelle donc `waitForCalmMainThread` /
   `clickWhenCalm` de `e2e/mainThread.ts`, où la mesure est écrite. Preuve du correctif : le même
   clic sur `#weather-trigger` passe de **14,6 s** (pour un `actionTimeout` de 15 s) à **1,9 s**.
6. **Un glisser qui part du CENTRE de l'écran ne tourne pas la caméra.** Quand un corps est
   suivi, son point d'étiquette Explo occupe ce centre, et il garde ses gestes de pointeur par
   conception (seule la molette est réémise vers le canevas). Un scénario qui veut tourner
   autour d'un corps part donc d'un point dont `document.elementFromPoint` rend bien le
   `CANVAS`. Et un glisser de moins d'une dizaine de pixels est lu comme un CLIC : il
   resélectionne le corps et RECADRE la caméra à sept rayons, ce qui ressemble à un zoom qui
   part à l'envers. Les deux ont coûté une heure de mesures fausses au lot 9, phase 9D.
7. **Une route qui coupe un asset ne coupe rien quand un service worker est actif.** Sur le
   BUILD (`vite preview`, `dist`), le service worker intercepte la requête et en émet une
   autre, que `page.route` ne voit pas : mesuré au lot 15 en coupant les 64 binaires
   d'éphémérides, 6 coupures vues sur 64 et un chargement en réalité COMPLET, donc une garde
   verte pour la mauvaise raison. Ouvrir le contexte avec `serviceWorkers: 'block'` dès qu'un
   scénario coupe ou substitue un asset servi depuis `/assets/`. La suite `pnpm test:e2e`
   tourne sur le serveur de dev, où le service worker n'est pas enregistré : le piège ne se
   manifeste que dans une mesure faite à la main sur `dist`.

8. **« Execution context was destroyed, most likely because of a navigation » accuse presque
   toujours l'OUTILLAGE, pas le produit.** Le serveur de dev recharge la page par HMR dès qu'un
   fichier de `src/` change, et un rechargement tombé en plein `locator.evaluate` donne cette
   erreur sur un test qui n'a rien à voir avec ce qui a été édité. Mesuré au lot 40 :
   `earthEvents.spec.ts` rouge à 52/222 pendant une correction de COMMENTAIRES dans
   `core/eclipsePages.ts`, puis **16 sur 16** en rejouant le même fichier sur un arbre gelé, la
   date fautive comprise. `pnpm format` est pire encore, puisqu'il réécrit tout l'arbre. **Une
   suite complète se lance donc sur un arbre GELÉ** : `docs/` reste libre, `src/`, `e2e/`,
   `index.html` et `public/` non. Avant de soupçonner le produit, regarder l'heure de
   modification des fichiers.

## Couverture actuelle

La suite Vitest couvre les transformations de repères, Kepler, éphémérides, horloge, échelles,
catalogue, éclipses, texture LOD, permaliens, événements astronomiques et câblage de certaines UI.

**Invariants physiques du mouvement** (cf. `docs/ARCHITECTURE.md` § « Position d'un corps ») :
sens de rotation des corps du catalogue dans les deux sens du temps, cadence de révolution des satellites,
répartition des points d'une ligne d'orbite, propagation deux-corps, et deux tests qui lisent les
binaires Horizons **réellement committés** plutôt qu'une donnée de test. Cette famille garde des
défauts qui ne lèvent aucune erreur — une position fausse reste une position — et chaque garde
y a été vérifiée falsifiable : on réintroduit le défaut, on confirme que le test tombe.
Playwright couvre le boot, loader, navigation, sélection 3D, modes, labels, i18n, mobile, petits
corps, permaliens, événements astronomiques, zoom optique, visite guidée et accessibilité.

**Visites guidées devenues des fiches** (lot 21) : rien n'écrit le NOMBRE de visites. Le compte et
les titres viennent d'`src/registry/tours/order.json` et des fiches, en unitaire
(`config/tourScripts.test.ts`) comme en e2e (`tourPlayer.spec.ts`), et la garde mobile mesure la
plus LONGUE légende du registre plutôt que la première visite venue. C'est ce qui rend vraie la
promesse du lot : ajouter une visite ne touche aucun `.ts`, pas même un test. Trois pièges de garde
y sont nommés : une assertion sur « étape 1 » est une COURSE quand les premières étapes sont
instantanées (on affirme sur le total, qui vient de la fiche) ; `resolveEventDate` est résolue
depuis DIX dates de référence étalées sur une décennie, parce qu'un seul échantillon ne dirait rien
d'une opposition de 780 jours de période ; et la seule garde qui prouve la chaîne entière (fiche →
schéma → chargeur → moteur → horloge) est celle qui vérifie que la visite de l'éclipse déplace
vraiment la date, avec un délai explicite parce que l'horloge est retenue jusqu'à l'arrivée des
octets.

**Le texte du registre, dans les deux sens** (lot 21) : `config/catalogueText.test.ts` DÉCOUVRE les
dossiers de `src/registry/` au lieu de les lister — une liste recopiée aurait exactement le trou
qu'on cherche — puis confronte la carte de langue livrée aux fiches du disque, et les fiches aux
racines d'exécution. C'est cette garde qui a trouvé un défaut livré : `Object.values` d'une `Map`
rend un tableau vide, donc les 14 objets d'instrument lisaient l'anglais dans les trois autres
langues. Une exception est déclarée avec sa raison (`providers`, prose lue au build seulement) et un
second contrôle vérifie que cette exception est VRAIE.

**Chargement dégradé des éphémérides** (lot 15) : `core/HorizonsEphemerisService.test.ts` simule
des `fetch` qui échouent (le manifeste et les binaires sont fabriqués, pas lus sur le disque,
pour pouvoir choisir qui tombe) et garde la tolérance fichier par fichier, la raison écrite de
chaque absence, le calendrier de reprise par PASSAGE, et le refus de reprendre un 404 ou des
octets à la mauvaise taille. `ui/ephemerisNotice.test.ts` tient, sans DOM, la distinction qui
porte tout le message : un corps du catalogue a un repli, donc une position moins précise, une
sonde n'en a aucun et reste sans position. `e2e/ephemerisDegraded.spec.ts` coupe une partie des
`.bin` par `page.route` et vérifie CE QUI EST DIT à l'écran : un corps dont le fichier est arrivé
reste sur Horizons, le bandeau compte les reçues sur les déclarées, la reprise répare sans
recharger, et un chargement complet ne crée aucun bandeau. Cette dernière moitié compte : sans
elle, un bandeau affiché en permanence passerait toutes les autres.

**Fenêtres d'éphémérides (lot 17C)** : `core/ephemerisWindowLoad.test.ts` fait tourner le chemin
de production — `load`, son `fetch`, son en-tête `Range`, son interprétation de la réponse —
contre les BINAIRES RÉELLEMENT LIVRÉS, découpés par un serveur simulé comme un hôte le ferait.
Il tient la seule chose qui compte vraiment : **une fenêtre place chaque corps au bit près comme
le fichier entier**, familles du ballant comprises. Fabriquer des échantillons n'aurait rien dit
du risque réel, qui est de lire un autre instant. `core/ephemerisClockGate.test.ts` tient
l'horloge : elle se fige quand les octets manquent, repart exactement où elle s'était arrêtée,
et n'est JAMAIS prise en otage par un lien mort. `e2e/ephemerisWindow.spec.ts` vérifie dans un
vrai navigateur que chaque demande porte un `Range`, que la fiche dit toujours « JPL Horizons »
après un saut de cinquante ans, et qu'une fenêtre qui échoue EN COURS DE SESSION fait apparaître
le bandeau — un cas qui n'existait pas quand tout était chargé au démarrage.

**Le magasin de l'appareil (lot 17E)** : `core/ephemerisStore.test.ts` vise les BORDS, parce que
ce module décide de NE PAS demander des octets : une erreur d'inclusion placerait un corps à un
autre instant, en silence. Il tient l'inclusion à un échantillon près, le refus d'une clé
étrangère ou d'une tranche inversée, l'entrée tronquée SUPPRIMÉE au lieu d'être lue, et la règle
qui empêche une fenêtre de 96 octets d'écraser un fichier entier. Une de ses gardes était
TAUTOLOGIQUE (le refus d'une tranche inversée était vérifié sur un nom qui n'était pas celui
d'un fichier du manifeste, donc le refus venait du nom), et c'est sa propre falsification qui
l'a dit. `core/ephemerisOffline.test.ts` mesure la seule chose que l'utilisateur constate :
**aucune requête ne part**. Il vérifie aussi qu'une lecture locale n'entre PAS dans le débit
observé, avec une horloge INJECTÉE : sous une horloge réelle, 62 lectures locales occupent
quelques millisecondes et le compteur se tairait par son seuil de bruit, donc pour la mauvaise
raison. `e2e/ephemerisOffline.spec.ts` le refait dans un vrai navigateur, avec le vrai `Cache`,
et coupe TOUT `/assets/ephemerides/**` sur une date jamais visitée.

**Objets interstellaires** : `config/interstellar.test.ts` compare les positions à 21 vecteurs
d'état Horizons relevés en direct, avant, au et après chaque périhélie, jusqu'aux bords de la
fenêtre affichée. `e2e/interstellar.spec.ts` lit ce qu'une couche canvas a peint via deux
attributs, `data-markers` et `data-tracks`. Le second existe pour une raison apprise en
falsifiant : hors fenêtre les objets sont à plus de 116 UA, donc hors champ, et « zéro marqueur »
restait vrai **sans** la borne. Un compte qui peut valoir zéro pour une autre raison que celle
qu'on teste ne prouve rien ; il faut compter la chose elle-même.

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

**Pages documentaires** (`src/seo/docPages.test.ts`) : `/methodology` et `/sources` publient
des chiffres, des crédits et des phrases sur le comportement de l'application. Le test tient les
trois : chaque valeur vient de sa source (la changer change la page), chaque couche livrée a sa
provenance, la liste des services en direct est égale aux hôtes `connect-src` de la CSP, les
groupes de licence de `THIRD_PARTY_NOTICES.md` concordent avec le registre `src/registry/products/`, et les
affirmations sur le comportement sont confrontées au code qui l'implémente (ordre SPK / Horizons,
obliquité, tailles en Éducatif, lunes écartées, Terre au barycentre). Voir la règle « Tout texte
publié est une affirmation à confronter au code », détaillée dans `CONTRIBUTING.md` § « Écrire un texte public ».

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

**Modèles de forme** (`src/config/shapeModels.test.ts`) : chaque GLB livré est relu octet par
octet — son axe de plus grande inertie doit être Y (à 5° près ; mesuré 0,1 à 1,0°) et son volume
doit retrouver le rayon moyen du catalogue à 3 % près. Les deux ont été falsifiés : l'ancien
Bennu, pôle sur Z, fait échouer le premier (89,9°) ; un rayon saisi comme un diamètre, le second.
Ces contrôles tournent sur CHAQUE niveau de détail, avec en plus le budget de triangles, un détail
croissant d'un niveau à l'autre, et la luminance cuite comparée à l'albédo déclaré (un niveau de
Bennu non cuit lit 0,334 pour 0,114 attendu ; une carte déclarée impose des couleurs par sommet —
falsifiés). `e2e/modelLod.spec.ts` compte les `.glb` réellement demandés : que des `_shape_1k`
en vue d'ensemble, jamais de 4k en qualité moyenne même collé à Bennu (falsifié trois façons).
`smallBodies.test.ts` compare Éros, Itokawa, Ryugu, Ida et Bennu à des vecteurs Horizons de −10 à
+10 ans. Bennu y est depuis le 2026-09-16 : il n'était tenu que par une DISTANCE au dixième d'UA à
l'époque J2000 de ses éléments, test vert pendant qu'il dérivait de 0,47 UA à la date du jour.
Un test qui ne regarde qu'à l'époque des éléments ne voit aucune dérive.

**Pages d'éclipse** : `src/core/eclipsePages.test.ts` tient la fenêtre (53 éclipses, un jour UTC
chacune) et l'accord build/application sur les 53 (à la seconde — écart mesuré 1 ms, un premier
test à la milliseconde l'a trouvé), plus les chemins refusés, dont `2026-02-31`, que `Date.parse`
normalise sur un vrai jour d'éclipse. `e2e/eclipseLanding.spec.ts` ouvre `/eclipse/2026-08-12/` :
arrivée au pic, en pause, sur la Terre, adresse et titre gardés, puis permalien daté dès qu'on
regarde ailleurs. Chaque garde a été falsifié.

**Éclipse de Lune cuivrée** : `core/eclipse.test.ts` tient la teinte contre les cinq quintiles
mesurés sur une photographie de totalité, sa normalisation en luminance et la profondeur
géométrique ; `OrbitalMechanics.test.ts` vérifie qu'au 3 mars 2026 la Lune reçoit bien ce niveau
et cette teinte en Éducatif ; `viewAngles.test.ts` fait l'aller-retour des angles de caméra.
`e2e/eclipseLanding.spec.ts` lit les pixels de la page : il est le seul à traverser teinte,
matériau ET cadrage. Onze mutations tombées — dont une qui, sur une éclipse partielle, passait :
la totale a été choisie parce qu'elle seule discrimine (rouge/bleu 4,1 contre 1,5).

**Niveaux de texture** (`src/config/textureLevels.test.ts`) : chaque palier de qualité charge un
fichier différent du même corps, donc un niveau faux ne se voit QUE sur la machine qui le charge.
Le test réduit le niveau le plus fin et le plus grossier de chaque texture à la même taille et
exige un écart moyen sous 8/255 (mesuré : 4,56 au plus sur les 34 textures, la normal map de la
Terre). Il existe parce que le 8k de l'anneau de Saturne portait un bord intérieur blanc opaque,
visible uniquement en qualité haute comme une ellipse lumineuse — il mesurait 17,05. Falsifié en
remettant ce fichier.

**Halo lumineux** (`src/components/systems/GlowPass.test.ts`) : aucun test ne peut juger qu'un
halo est « rond » sous le rendu logiciel des runners, donc la suite tient ce qui le rend rond
PAR CONSTRUCTION et ce qui casserait en silence. Uniformes employés = déclarés = fournis pour les
quatre shaders de la passe (un uniforme oublié rend noir sans erreur, déjà payé sur la Terre) ;
les VRAIES couches de `buildLayers` portent le bon marquage (lumières de ville et Soleil sources,
avec leur gain de `GLOW_GAINS` ; surfaces occultantes ; nuages et atmosphère ni l'un ni l'autre) ;
un faux renderer enregistre chaque rendu — occulteurs en noir d'abord, puis une classe
d'intensité par calque, jamais le fond de ciel (c'est lui qui dessinait les carrés), état de la
scène restauré à l'identique, et **produit des remises à l'échelle égal au gain de chaque
classe**, sans quoi une source brille trop ou pas assez sans rien lever. Douze mutations, toutes
tombées. La forme du halo, elle, a été regardée à l'écran en Éduc et en Explo et mesurée (énergie
de la face nuit, anneau solaire : `docs/ARCHITECTURE.md` § « Halo lumineux »).

### Pas de seuil de couverture chiffré, et c’est une DÉCISION (2026-09-29)

Cette ligne disait « pas ENCORE de seuil chiffré », ce qui promettait un chantier que personne
n’avait ouvert. Elle est tranchée, dans le sens du refus, et voici ce qui le motive.

- **Un pourcentage de couverture est un nombre qu’on entretient, pas une garde.** Le lot 29 a
  retiré trois valeurs tenues à la main pour cette raison exacte, et un seuil de couverture est
  la même chose en plus visible : il monte quand on exécute des lignes, y compris sans rien
  affirmer sur elles. Ce dépôt mesure autre chose — une garde vaut par sa FALSIFICATION, et la
  question posée à chaque ajout est « qu’est-ce qui rougit si je casse ça ? », jamais « quel
  pourcentage ai-je touché ? ».
- **Le coût est réel** : aucun `@vitest/coverage-*` n’est installé, donc l’activer ajoute une
  dépendance de développement et du temps à chaque exécution de la porte, pour un chiffre dont
  ce document dit par ailleurs de ne jamais le figer (§ « Compter les tests »).
- **Ce qui tient lieu de couverture ici** est écrit et vérifiable : la couverture comportementale
  des invariants physiques et des frontières d’architecture, plus les inventaires DÉRIVÉS du
  dépôt (`pnpm inventory:gaps`) qui disent corps par corps ce qui manque.

**Ce qui rouvrirait la question** : une régression livrée dont l’analyse montrerait qu’un simple
relevé de lignes non exécutées l’aurait désignée. Ce n’est arrivé sur aucun des défauts consignés
dans `docs/private/HANDOFF_ARCHIVE.md` — ils se répartissent entre erreurs de MESURE, conventions
publiées mal lues et contrats sans garde, dont aucun ne se voit dans un pourcentage.

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

- `e2e/a11y-screenreader.spec.ts` (lot 19) vérifie des **parcours** : où va le focus, et ce que
  l'application DIT quand elle change d'état. Quatorze propriétés, chacune née d'un énoncé
  réellement entendu ou d'un silence réellement mesuré : le titre de l'onglet et le titre de
  niveau 1 sont traduits ; la scène est un repère principal nommé ; choisir un corps laisse le
  focus dans la fiche et jamais sur le `body` ; ouvrir une surface y emmène le focus, ce qui rend
  du même coup son Échap opérant ; la fin du chargement, le changement de date et le nombre de
  résultats sont annoncés dans l'unique région live ; aucun dialogue ouvert n'est anonyme ; la
  visite guidée retient le focus ; et la recherche masque réellement ce qui ne correspond pas.

**CE QUI A CHANGÉ LE 2026-09-27, et cette page disait le contraire.** Il était écrit ici
qu'« aucune API ne permet de capturer » ce qu'un lecteur d'écran annonce, « donc l'automatiser
produirait un test qui ment ». C'est FAUX, et le lot 19 l'a montré : **NVDA journalise chaque
énoncé**, au niveau IO de son journal, et `scripts/capture-screenreader.mjs` pilote une copie
portable muette pour les relever dans l'ordre, appariés à l'élément qui a réellement le focus.
Le point qui décide de tout : NVDA pose un crochet clavier au niveau du SYSTÈME, donc les frappes
injectées par CDP lui sont invisibles et les touches doivent partir en `SendInput`.

Ce banc demande Windows et NVDA : il ne tourne pas en intégration continue, et le relevé qu'il
produit vit dans `docs/private/LECTEUR_ECRAN_LOT19.md`. **Ce qui reste manuel** est plus étroit
qu'écrit jusqu'ici : le ressenti, la verbosité supportable, la prononciation, et le comportement
d'un AUTRE lecteur d'écran (VoiceOver, JAWS).

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
