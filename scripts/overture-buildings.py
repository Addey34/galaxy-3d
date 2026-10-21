"""
Lit les bâtiments d'Overture Maps pour UNE boîte et les écrit en GeoJSON (lot 63, étape C.6).

Appelé par `scripts/bake-building-tiles.mjs` (source `overture-parquet`), jamais à la main :

    uv run --with duckdb python scripts/overture-buildings.py --release 2026-09-23.1 \
        --bbox 36.80,-1.30,36.84,-1.27 --out .cache/building-bake/overture-....json

Le Parquet d'Overture est lu à distance (S3 public) et filtré sur `bbox`, ce qui pousse le filtre
dans le fichier. Une requête prend de l'ordre de deux minutes pour une boîte de 4 km : le cuiseur
garde le résultat en cache.

Ce que le script décide, et pourquoi :
- `lidar` : une `height` dont la première source est « USGS Lidar » (une mesure) ;
- `tagged` : toute autre `height` (saisie par un contributeur ou issue d'un jeu dont on ne connaît
  pas la méthode), jamais rangée sous « mesurée » ;
- `floors` : pas de `height` mais un `num_floors`, multiplié par le facteur MESURÉ dans la boîte
  (médiane de `height / num_floors` sur les bâtiments qui portent les deux), à condition d'avoir au
  moins MIN_PAIRS bâtiments pour le mesurer ; sinon la hauteur reste absente et on le dit ;
- `none` : ni l'un ni l'autre, emprise à plat.
Le facteur par étage n'est jamais écrit à la main : il est publié avec le nombre de bâtiments qui
l'ont fixé.
"""
import argparse
import json
import statistics
from datetime import datetime, timezone

import duckdb

MIN_PAIRS = 30
PARQUET = "s3://overturemaps-us-west-2/release/{release}/theme=buildings/type=building/*"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", required=True)
    ap.add_argument("--bbox", required=True, help="xmin,ymin,xmax,ymax en degrés")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    xmin, ymin, xmax, ymax = (float(v) for v in args.bbox.split(","))

    con = duckdb.connect()
    con.sql("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial")
    con.sql("SET s3_region='us-west-2'")
    rows = con.execute(
        f"""
        SELECT id, height, num_floors, sources[1].dataset AS dataset,
               ST_AsGeoJSON(geometry) AS geometry
        FROM read_parquet('{PARQUET.format(release=args.release)}', hive_partitioning=1)
        WHERE bbox.xmin >= ? AND bbox.xmax <= ? AND bbox.ymin >= ? AND bbox.ymax <= ?
        ORDER BY id
        """,
        [xmin, xmax, ymin, ymax],
    ).fetchall()

    ratios = [
        h / n for (_id, h, n, _ds, _g) in rows if h is not None and h > 0 and n is not None and n > 0
    ]
    factor = statistics.median(ratios) if len(ratios) >= MIN_PAIRS else None

    features = []
    counts = {"lidar": 0, "tagged": 0, "floors": 0, "none": 0}
    for bid, height, floors, dataset, geometry in rows:
        if height is not None and height > 0:
            method = "lidar" if dataset == "USGS Lidar" else "tagged"
            value = float(height)
        elif floors is not None and floors > 0 and factor is not None:
            method = "floors"
            value = float(floors) * factor
        else:
            method = "none"
            value = None
        counts[method] += 1
        features.append(
            {
                "type": "Feature",
                "id": bid,
                "geometry": json.loads(geometry),
                "properties": {"hauteur": value, "methode": method},
            }
        )

    out = {
        "type": "FeatureCollection",
        "release": args.release,
        "readAt": datetime.now(timezone.utc).isoformat(),
        "floorsFactor": None if factor is None else {"metresPerFloor": factor, "pairs": len(ratios)},
        "counts": counts,
        "features": features,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"{len(features)} bâtiments, facteur par étage {out['floorsFactor']}, méthodes {counts}")


if __name__ == "__main__":
    main()
