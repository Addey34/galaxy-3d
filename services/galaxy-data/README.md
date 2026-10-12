# Service de données de Galaxy

Sert aux couches météo de modèle, à tous les visiteurs et en fichiers statiques :

- le modèle **GFS de la NOAA** (grille de 1°, domaine public), récupéré une fois par cycle,
  pour les derniers jours et les seize prochains ;
- la réanalyse **ERA5** (Copernicus, CC BY 4.0), de 1940 à environ une semaine avant
  aujourd'hui, construite À LA DEMANDE depuis la copie publique ARCO-ERA5 de Google, une fois
  par heure demandée, puis gardée.

Il remplace les requêtes que chaque navigateur adressait à Open-Meteo, qui ne sert plus que de
repli : l'API gratuite d'Open-Meteo compte son quota par adresse IP, environ un appel par point
de grille, et une grille mondiale l'épuisait (lot 46, 2026-10-12). Contrat :
`docs/ARCHITECTURE.md` § « Le service de données de Galaxy ».

## Ce qui tourne

| Conteneur | Rôle |
|---|---|
| `galaxy-data-ingest` | `ingest.py --loop` : toutes les 30 min, publie le dernier cycle complet (f000 à f384, pas de 3 h), rattrape les analyses manquantes des dix derniers jours, lit la couverture d'ARCO-ERA5, élague (une analyse reste tant qu'ERA5T ne la couvre pas), réécrit le manifeste |
| `galaxy-data-era5` | `era5.py --serve` : construit un champ d'archive MANQUANT (`era5/` ou `era5t/`), l'écrit, le rend. Plafonné : 600 morceaux lus par heure, trois à la fois (au-delà, 503), 4 Gio de cache |
| `galaxy-data-web` | Caddy interne : sert les fichiers, envoie les champs d'archive manquants à `galaxy-data-era5`, CORS limité à Galaxy et à `localhost`, cache court pour le manifeste, long et immuable pour les champs, aucun journal d'accès |

Le Caddy partagé de la VM relaie `galaxy-data.adrianguichard.dev` vers `galaxy-data-web:80` et
pose le TLS. `galaxy-data-era5` n'est que sur le réseau interne `galaxy_data_internal`.

## Déployer

Sur la VM (`ubuntu@82.70.233.45`), dans `/home/ubuntu/services/galaxy-data/` :

```bash
# depuis le dépôt
scp services/galaxy-data/{Dockerfile,compose.yaml,Caddyfile,ingest.py,era5.py} ubuntu@82.70.233.45:/home/ubuntu/services/galaxy-data/
ssh ubuntu@82.70.233.45 'cd /home/ubuntu/services/galaxy-data && docker compose up -d --build'
```

L'image joue les deux contrôles hors réseau au build (`ingest.py --self-test`,
`era5.py --self-test`) : une image qui casserait le format, l'origine du temps d'ERA5 ou le pont
des analyses ne se construit pas.

## Vérifier

```bash
ssh ubuntu@82.70.233.45 'docker logs --tail 20 galaxy-data-ingest; docker logs --tail 20 galaxy-data-era5'
curl -s https://galaxy-data.adrianguichard.dev/gfs/manifest.json | head -c 300
curl -s -o /dev/null -w '%{http_code} %{time_total}\n' https://galaxy-data.adrianguichard.dev/era5/1990011512/t2m.bin
python era5.py --coverage   # la couverture déclarée par ARCO-ERA5, lue à la source
pnpm sources:health --only galaxy-data   # vivant ET frais : analyse de moins de 24 h, archive déclarée et suivie
```

## Le format (`GXF1`)

Signature `GXF1`, longueur de l'en-tête (uint32 LE), en-tête JSON, puis int16 LE bande après
bande. Valeur = brut × `scale` + `offset` ; −32768 = absente. Le décodeur du client
(`src/core/galaxyData.ts`) est testé sur un fichier écrit par cet encodeur
(`python ingest.py --fixture src/core/galaxyData.fixture.bin`) : les deux ne peuvent pas
dériver l'un de l'autre. L'archive écrit les MÊMES champs, unités et quantifications que GFS ;
son en-tête dit `"kind": "reanalysis"` et `"product": "era5"` ou `"era5t"`.

## Budget

Mesuré le 2026-10-12 : environ 0,9 Mo pour les sept champs d'un instant GFS, **195 Mo** pour la
fenêtre pleine. L'archive est plafonnée à 4 Gio (`ERA5_CACHE_MAX_BYTES`) et à 600 morceaux lus
par heure (`ERA5_UPSTREAM_PER_HOUR`), environ 1,5 Go entrants au pire. Mémoire mesurée au repos :
34 Mio pour l'archive, 14 pour l'ingestion, 11 pour Caddy. Les conteneurs sont plafonnés (un
demi-cœur chacun pour l'ingestion et l'archive) : la VM sert une vingtaine d'autres projets.
