# Déploiement du kernel SAT441

Le kernel officiel utilisé par le chemin SPK est `sat441l.bsp`, distribué par JPL/NAIF. Il pèse environ 609 MiB : il reste un artefact de déploiement et n’est pas versionné dans Git.

> **Il est EXCLU des déploiements par défaut** (`firebase.json`, `hosting.ignore`), et la
> procédure ci-dessous ne le publie donc plus telle quelle. Ce n’est pas une précaution
> théorique : Firebase Hosting facture le stockage sur la somme des versions RETENUES, pas sur
> la dernière. Un `firebase deploy` local emporte tout `public/`, donc 638 Mo par version — le
> quota de 10 Go du plan gratuit a fini par sauter, avec un `HTTP 429` qui ne nomme pas le
> fichier fautif. Le site en ligne n’y perdait rien : sans `VITE_SPK_KERNEL_URL`,
> `SPK_SETTINGS.url` vaut `null` et l’application ne demande jamais ce fichier. Les positions
> de satellites viennent des binaires Horizons locaux, qui sont le chemin testé et livré.
>
> Pour le publier délibérément, retirer `assets/kernels/**` de `hosting.ignore`, déployer, puis
> le remettre — et prévoir le plan Blaze, parce que quelques versions retenues suffisent à
> dépasser 10 Go. Un test (`src/config/hostingPayload.test.ts`) échoue si l’exclusion disparaît
> sans qu’on l’ait voulu.

1. Stager le fichier officiel dans `public/assets/kernels/sat441l.bsp` :

   ```powershell
   pnpm spk:stage
   ```
2. Définir `VITE_SPK_KERNEL_URL=/assets/kernels/sat441l.bsp` pour activer le provider Worker.
3. Déployer avec Firebase :

   ```powershell
   pnpm build
   firebase deploy --only hosting:galaxy
   ```

4. Vérifier l’URL réellement publiée, sans télécharger le fichier complet :

   ```powershell
   $env:SPK_URL='https://galaxy.example/assets/kernels/sat441l.bsp'
   pnpm spk:verify
   ```

Le contrôle exige la taille attendue, `Accept-Ranges: bytes`, une réponse `206 Partial Content` et le mot d’identification `DAF/SPK`. Firebase doit donc servir le fichier sans réécriture HTML et conserver les requêtes Range.
