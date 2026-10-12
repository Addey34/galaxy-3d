# Service de données de Galaxy

Récupère le modèle **GFS de la NOAA** (grille de 1°, domaine public) une fois par cycle, et le
sert en fichiers statiques à tous les visiteurs. Il remplace, pour les dix derniers jours et les
seize prochains, les requêtes que chaque navigateur adressait à Open-Meteo : l'API gratuite
d'Open-Meteo compte son quota par adresse IP, et une grille mondiale l'épuisait (lot 46,
2026-10-12). Contrat : `docs/ARCHITECTURE.md` § « Le service de données de Galaxy ».

## Ce qui tourne

| Conteneur | Rôle |
|---|---|
| `galaxy-data-ingest` | `ingest.py --loop` : toutes les 30 min, publie le dernier cycle complet (f000 à f384, pas de 3 h), rattrape les analyses manquantes des dix derniers jours, élague, réécrit le manifeste |
| `galaxy-data-web` | Caddy interne, lecture seule : CORS limité à Galaxy et à `localhost`, cache court pour le manifeste, long et immuable pour les champs, aucun journal d'accès |

Le Caddy partagé de la VM relaie `galaxy-data.adrianguichard.dev` vers `galaxy-data-web:80` et
pose le TLS.

## Déployer

Sur la VM (`ubuntu@82.70.233.45`), dans `/home/ubuntu/services/galaxy-data/` :

```bash
# depuis le dépôt
scp services/galaxy-data/{Dockerfile,compose.yaml,Caddyfile,ingest.py} ubuntu@82.70.233.45:/home/ubuntu/services/galaxy-data/
ssh ubuntu@82.70.233.45 'cd /home/ubuntu/services/galaxy-data && docker compose up -d --build'
```

L'image vérifie le format au build (`ingest.py --self-test`) : une image qui le casserait ne se
construit pas.

## Vérifier

```bash
ssh ubuntu@82.70.233.45 'docker logs --tail 20 galaxy-data-ingest'
curl -s https://galaxy-data.adrianguichard.dev/gfs/manifest.json | head -c 300
pnpm sources:health --only galaxy-data   # vivant ET frais : dernière analyse de moins de 24 h
```

## Le format (`GXF1`)

Signature `GXF1`, longueur de l'en-tête (uint32 LE), en-tête JSON, puis int16 LE bande après
bande. Valeur = brut × `scale` + `offset` ; −32768 = absente. Le décodeur du client
(`src/core/galaxyData.ts`) est testé sur un fichier écrit par cet encodeur
(`python ingest.py --fixture src/core/galaxyData.fixture.bin`) : les deux ne peuvent pas
dériver l'un de l'autre.

## Budget

Mesuré le 2026-10-12 : environ 0,9 Mo pour les sept champs d'un instant. La fenêtre pleine
(129 instants de prévision, deux cycles gardés au plus, et dix jours d'analyses) est ESTIMÉE sous
300 Mo ; la relire avec `du -sh /srv/galaxy-data` une fois remplie. Le
conteneur d'ingestion est plafonné à un demi-cœur et 512 Mo : la VM sert une vingtaine d'autres
projets.
