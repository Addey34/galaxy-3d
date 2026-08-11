# Déploiement du kernel SAT441

Le kernel officiel utilisé par le chemin SPK est `sat441l.bsp`, distribué par JPL/NAIF. Il pèse environ 609 MiB : il reste un artefact de déploiement et n’est pas versionné dans Git.

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
