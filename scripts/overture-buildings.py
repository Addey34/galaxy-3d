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

MIN_PAIRS = 30
PARQUET = "s3://overturemaps-us-west-2/release/{release}/theme=buildings/type=building/*"


def classify(rows):
    """Range chaque ligne `(id, height, num_floors, dataset, geometry)` : renvoie les objets GeoJSON,
    le facteur par étage mesuré (ou None) avec son nombre de paires, et le compte par méthode."""
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
    return features, factor, len(ratios), counts


def count_datasets(lists):
    """Combien de bâtiments portent chaque jeu source (un bâtiment peut en cumuler plusieurs : OSM et
    Microsoft, par exemple). Sert à vérifier que l'attribution cite les sources PRÉSENTES, pas celles du thème."""
    counts = {}
    for names in lists:
        for name in set(names or []):
            counts[name] = counts.get(name, 0) + 1
    return dict(sorted(counts.items()))


def self_test() -> None:
    """Sans réseau ni DuckDB : les trois branches et le seuil de paires."""
    assert MIN_PAIRS == 30, "le seuil de paires est une règle publiée, pas un réglage"
    sq = '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}'
    pairs = [(f"p{i}", 9.0, 2, "OpenStreetMap", sq) for i in range(MIN_PAIRS)]
    others = [
        ("lidar", 20.0, None, "USGS Lidar", sq),
        ("tagged", 12.0, None, "OpenStreetMap", sq),
        ("floors", None, 4, "OpenStreetMap", sq),
        ("none", None, None, "OpenStreetMap", sq),
    ]
    features, factor, n, counts = classify(pairs + others)
    by_id = {f["id"]: f["properties"] for f in features}
    assert factor == 4.5 and n == MIN_PAIRS, (factor, n)
    assert by_id["lidar"] == {"hauteur": 20.0, "methode": "lidar"}, by_id["lidar"]
    assert by_id["tagged"]["methode"] == "tagged", by_id["tagged"]
    assert by_id["floors"] == {"hauteur": 18.0, "methode": "floors"}, by_id["floors"]
    assert by_id["none"] == {"hauteur": None, "methode": "none"}, by_id["none"]
    assert counts == {"lidar": 1, "tagged": MIN_PAIRS + 1, "floors": 1, "none": 1}, counts
    # Sous le seuil de paires, rien n'est déduit : la hauteur reste absente.
    features, factor, n, counts = classify(pairs[: MIN_PAIRS - 1] + others)
    assert factor is None and counts["floors"] == 0 and counts["none"] == 2, (factor, counts)
    # Un bâtiment compte une fois par jeu, même cité deux fois ; les listes vides ou absentes ne comptent pas.
    assert count_datasets([["A", "B", "A"], ["B"], None, []]) == {"A": 1, "B": 2}
    print("auto-contrôle ok")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--release")
    ap.add_argument("--bbox", help="xmin,ymin,xmax,ymax en degrés")
    ap.add_argument("--out")
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    if not (args.release and args.bbox and args.out):
        ap.error("--release, --bbox et --out sont obligatoires")
    import duckdb  # importé ici : l'auto-contrôle n'en a pas besoin

    xmin, ymin, xmax, ymax = (float(v) for v in args.bbox.split(","))

    con = duckdb.connect()
    con.sql("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial")
    con.sql("SET s3_region='us-west-2'")
    rows = con.execute(
        f"""
        SELECT id, height, num_floors, sources[1].dataset AS dataset,
               ST_AsGeoJSON(geometry) AS geometry,
               list_transform(sources, lambda x: x.dataset) AS datasets
        FROM read_parquet('{PARQUET.format(release=args.release)}', hive_partitioning=1)
        WHERE bbox.xmin >= ? AND bbox.xmax <= ? AND bbox.ymin >= ? AND bbox.ymax <= ?
        ORDER BY id
        """,
        [xmin, xmax, ymin, ymax],
    ).fetchall()

    features, factor, pairs, counts = classify([r[:5] for r in rows])
    datasets = count_datasets([r[5] for r in rows])

    out = {
        "type": "FeatureCollection",
        "release": args.release,
        "readAt": datetime.now(timezone.utc).isoformat(),
        "floorsFactor": None if factor is None else {"metresPerFloor": factor, "pairs": pairs},
        "counts": counts,
        "datasets": datasets,
        "features": features,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"{len(features)} bâtiments, facteur par étage {out['floorsFactor']}, méthodes {counts}, jeux {datasets}")


if __name__ == "__main__":
    main()
