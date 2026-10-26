# Déploiement du kernel SAT441

Le kernel officiel utilisé par le chemin SPK est `sat441l.bsp`, distribué par JPL/NAIF. Il pèse environ 609 MiB : il reste un artefact de déploiement et n’est pas versionné dans Git.

> **Il est EXCLU des déploiements** : `scripts/prepare-pages.mjs` retire `assets/kernels` de la
> sortie Cloudflare Pages, et `firebase.json` l'excluait déjà de Firebase Hosting (le site n'est
> plus servi par Firebase depuis le 2026-10-26). Ce n'est pas une précaution théorique : Pages
> refuse tout fichier de plus de 25 Mio, et ce noyau en pèse 609 MiB. Aucun hôte ne le sert
> aujourd'hui. Le site en ligne n'y perd rien : sans `VITE_SPK_KERNEL_URL`, `SPK_SETTINGS.url`
> vaut `null` et l'application ne demande jamais ce fichier. Les positions de satellites
> viennent des binaires Horizons locaux, qui sont le chemin testé et livré.
>
> Pour le publier, il faudrait un hôte qui accepte un fichier de cette taille et les requêtes
> Range, par exemple le service de données `galaxy-data` (non fait). L'étape 3 ci-dessous reste
> donc à décrire quand cet hôte existera. (Ancienne procédure Firebase : SUPERSEDED le 2026-10-26.)

1. Stager le fichier officiel dans `public/assets/kernels/sat441l.bsp` :

   ```powershell
   pnpm spk:stage
   ```
2. Définir `VITE_SPK_KERNEL_URL=/assets/kernels/sat441l.bsp` pour activer le provider Worker.
3. Copier le fichier sur l'hôte choisi (voir la note ci-dessus : aucun hôte n'est en place).

4. Vérifier l’URL réellement publiée, sans télécharger le fichier complet :

   ```powershell
   $env:SPK_URL='https://galaxy.example/assets/kernels/sat441l.bsp'
   pnpm spk:verify
   ```

Le contrôle exige la taille attendue, `Accept-Ranges: bytes`, une réponse `206 Partial Content` et le mot d’identification `DAF/SPK`. L'hôte doit donc servir le fichier sans réécriture HTML et conserver les requêtes Range.
