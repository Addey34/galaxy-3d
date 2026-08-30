# Galerie de permaliens remarquables

Chaque état de l'application (corps sélectionné, mode, date de simulation, et éventuellement le
cadrage caméra exact) est encodable dans l'URL — voir `src/core/permalink.ts` pour le format et
`src/ui/permalink.ts` pour l'application au démarrage. Cette page rassemble quelques vues qui
valent le détour, pour donner des raisons de revenir et pour illustrer le format aux
contributeurs.

Les liens ci-dessous sont relatifs à l'URL du déploiement (préfixez-les avec l'adresse du site).
Format général :

```
?body=<corps>&mode=<educ|explo>&date=<ISO 8601, optionnel>
```

`body=overview` revient à la vue d'ensemble. `date` est optionnelle : sans elle, la simulation
part de l'heure réelle actuelle. `mode` par défaut est `educ`.

## Vues intemporelles (pas de date nécessaire)

- **Anneaux de Saturne, vraie échelle** — `?body=saturn&mode=explo`
  La différence entre l'apparence pédagogique et la vraie proportion Saturne/anneaux/distance
  d'observation est la plus flagrante des huit planètes.
- **Système galiléen de Jupiter** — `?body=jupiter&mode=explo`
  Io, Europe, Ganymède et Callisto suivent leur vraie éphéméride `astronomy-engine` — leur
  configuration change réellement d'un jour à l'autre.
- **Système plutonien complet** — `?body=pluto&mode=explo`
  Charon plus les quatre petites lunes découvertes par Hubble/New Horizons (Styx, Nix, Cerbère,
  Hydre), positionnées par éphéméride binaire JPL Horizons, pas par approximation.
- **Un objet transneptunien avec surface procédurale** — `?body=orcus&mode=explo`
  Glace d'eau cristalline détectée par spectroscopie (Barucci et al. 2008), texture procédurale
  sourcée en commentaire dans `scripts/generate-procedural-textures.mjs` — un bon exemple du
  standard « pas d'invention de relief » attendu pour tout nouvel ajout (voir
  [`CONTRIBUTING.md`](../CONTRIBUTING.md)).

## Vues datées (événement astronomique réel)

Calculées avec la même bibliothèque (`astronomy-engine`) que celle utilisée par l'application en
direct dans son panneau « Prochains événements » (`core/astronomicalEvents.ts`) — pas des dates
choisies au hasard.

- **Éclipse solaire annulaire du 6 février 2027** —
  `?body=earth&mode=explo&date=2027-02-06T15:59:32Z`
- **Éclipse lunaire totale du 26 juin 2029** —
  `?body=moon&mode=explo&date=2029-06-26T03:22:06Z`

## Ajouter une vue à cette galerie

Une vue mérite d'y figurer si elle illustre soit une donnée réelle intéressante (une
configuration orbitale, un événement), soit un aspect pédagogique du projet (contraste
éducatif/exploration, invariant de réalisme). Pour la générer vous-même : sélectionnez le corps
et le mode voulus dans l'application, copiez l'URL depuis la barre d'adresse (elle se met à jour
automatiquement — `history.replaceState`, pas de rechargement), puis ajoutez-la ici avec une
phrase expliquant ce qui la rend notable.
