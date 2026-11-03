#!/usr/bin/env python3
"""
LES SATELLITES DU SERVICE DE DONNÉES : les éléments orbitaux de CelesTrak, relayés (2026-11-03).

POURQUOI UN RELAIS. Des éléments à deux paramètres (TLE/OMM) ne valent que quelques jours autour de
leur époque : un instantané livré avec le site serait faux en une semaine. CelesTrak répond avec
CORS ouvert, mais demande de ne pas interroger un groupe plus d'une fois toutes les 2 heures (ses
éléments ne se renouvellent pas plus vite) : un navigateur par visiteur dépasserait cette limite dès
que le trafic grandit. Le service lit donc la source UNE fois par passage et sert à tous le même
fichier ; le navigateur de Galaxy ne contacte jamais CelesTrak.

LA SOURCE, MESURÉE le 2026-11-03 : `https://celestrak.org/NORAD/elements/gp.php?GROUP=<groupe>&FORMAT=json`,
des messages OMM (CCSDS 502.0-B-3) en JSON, un objet par satellite. Deux groupes, volontairement :
`stations` (ISS, Tiangong, ...) et `visual` (les ~160 plus brillants à l'oeil nu). Un objet présent
dans les deux est écrit une fois, sous son numéro NORAD.

CE QUI EST SERVI :
    GET /satellites/elements.json
        {"version": 1, "source": {...}, "fetchedAt": "...Z", "groups": {"stations": n, ...},
         "objects": [{"id": 25544, "name": "ISS (ZARYA)", "designator": "1998-067A",
                      "group": "stations", "epoch": "2026-11-02T18:09:49.393152", "meanMotion": 15.49154261, ...}]}
Les champs sont ceux de l'OMM, renommés en camelCase, sans ceux dont SGP4 n'a pas besoin. Le fichier
est réécrit ATOMIQUEMENT, et seulement si la lecture est complète : une réponse vide, illisible ou
qui n'est pas du JSON (CelesTrak répond « GP data has not updated since your last download » en
texte quand on l'interroge trop souvent) laisse l'ancien fichier en place.

Usage :
    python satellites.py --loop         le service (un passage toutes les REFRESH_HOURS)
    python satellites.py --once         un passage
    python satellites.py --self-test    contrôles hors réseau
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.request

from ingest import ROOT, USER_AGENT, log, write_atomic

GROUPS = ("stations", "visual")
URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP={group}&FORMAT=json"
# Au moins 2 h entre deux lectures d'un groupe (la limite de CelesTrak) ; 3 h laissent de la marge.
REFRESH_HOURS = float(os.environ.get("SATELLITES_REFRESH_HOURS", "3"))
OUTPUT = os.path.join(ROOT, "satellites", "elements.json")
PAUSE_BETWEEN_GROUPS_SECONDS = 5

SOURCE = {
    "name": "CelesTrak GP data (OMM), from 18th Space Defense Squadron / Space-Track",
    "url": "https://celestrak.org/NORAD/elements/",
}

# OMM (CCSDS 502.0-B-3) → champ publié. Ce que SGP4 lit, plus de quoi nommer l'objet.
FIELDS = {
    "NORAD_CAT_ID": "id",
    "OBJECT_NAME": "name",
    "OBJECT_ID": "designator",
    "EPOCH": "epoch",
    "MEAN_MOTION": "meanMotion",
    "ECCENTRICITY": "eccentricity",
    "INCLINATION": "inclination",
    "RA_OF_ASC_NODE": "raan",
    "ARG_OF_PERICENTER": "argPerigee",
    "MEAN_ANOMALY": "meanAnomaly",
    "BSTAR": "bstar",
    "MEAN_MOTION_DOT": "meanMotionDot",
    "MEAN_MOTION_DDOT": "meanMotionDdot",
    "EPHEMERIS_TYPE": "ephemerisType",
    "CLASSIFICATION_TYPE": "classification",
    "ELEMENT_SET_NO": "elementSet",
    "REV_AT_EPOCH": "revAtEpoch",
}
REQUIRED = ("id", "name", "epoch", "meanMotion", "eccentricity", "inclination", "raan",
            "argPerigee", "meanAnomaly", "bstar", "meanMotionDot", "meanMotionDdot")


def fetch_group(group: str) -> list[dict]:
    request = urllib.request.Request(URL.format(group=group), headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        body = response.read()
    try:
        rows = json.loads(body)
    except ValueError as error:
        raise ValueError(f"{group} : réponse qui n'est pas du JSON ({body[:80]!r})") from error
    if not isinstance(rows, list) or not rows:
        raise ValueError(f"{group} : liste vide ou de forme inattendue")
    return rows


def compact(row: dict) -> dict | None:
    """Un objet publié, ou None si un champ dont SGP4 a besoin manque (l'objet est écarté, dit)."""
    out = {FIELDS[key]: row[key] for key in FIELDS if key in row and row[key] is not None}
    if any(key not in out for key in REQUIRED):
        return None
    return out


def build(groups: dict[str, list[dict]], now: dt.datetime) -> dict:
    objects: dict[int, dict] = {}
    counts: dict[str, int] = {}
    dropped = 0
    for group, rows in groups.items():
        kept = 0
        for row in rows:
            item = compact(row)
            if item is None:
                dropped += 1
                continue
            # Le premier groupe qui nomme l'objet le garde : `stations` passe avant `visual`.
            if item["id"] not in objects:
                objects[item["id"]] = dict(item, group=group)
            kept += 1
        counts[group] = kept
    if not objects:
        raise ValueError("aucun objet exploitable")
    return {
        "version": 1,
        "source": SOURCE,
        "fetchedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "groups": counts,
        "dropped": dropped,
        "objects": sorted(objects.values(), key=lambda o: o["id"]),
    }


def run_once() -> bool:
    groups: dict[str, list[dict]] = {}
    for index, group in enumerate(GROUPS):
        if index:
            time.sleep(PAUSE_BETWEEN_GROUPS_SECONDS)
        groups[group] = fetch_group(group)
    document = build(groups, dt.datetime.now(dt.timezone.utc))
    write_atomic(OUTPUT, json.dumps(document, separators=(",", ":")).encode("utf-8"))
    log("satellites :", len(document["objects"]), "objets,", document["groups"],
        "écartés", document["dropped"])
    return True


def self_test() -> None:
    iss = {
        "OBJECT_NAME": "ISS (ZARYA)", "OBJECT_ID": "1998-067A", "EPOCH": "2026-11-02T18:09:49.393152",
        "MEAN_MOTION": 15.49154261, "ECCENTRICITY": 0.0007124, "INCLINATION": 51.6331,
        "RA_OF_ASC_NODE": 334.3796, "ARG_OF_PERICENTER": 340.7366, "MEAN_ANOMALY": 19.3352,
        "EPHEMERIS_TYPE": 0, "CLASSIFICATION_TYPE": "U", "NORAD_CAT_ID": 25544, "ELEMENT_SET_NO": 999,
        "REV_AT_EPOCH": 59323, "BSTAR": 0.0001062, "MEAN_MOTION_DOT": 5.437e-5, "MEAN_MOTION_DDOT": 0,
    }
    broken = dict(iss, NORAD_CAT_ID=99999)
    del broken["MEAN_MOTION"]
    now = dt.datetime(2026, 11, 3, 12, 0, tzinfo=dt.timezone.utc)
    doc = build({"stations": [iss, broken], "visual": [iss]}, now)
    # Un objet présent dans deux groupes est écrit une fois ; un objet incomplet est écarté, et compté.
    assert [o["id"] for o in doc["objects"]] == [25544], doc
    assert doc["dropped"] == 1 and doc["groups"] == {"stations": 1, "visual": 1}, doc
    assert doc["objects"][0]["group"] == "stations", "le premier groupe garde l'objet"
    assert doc["objects"][0]["meanMotionDdot"] == 0, "un zéro est une valeur, pas une absence"
    assert doc["fetchedAt"] == "2026-11-03T12:00:00Z"
    # Rien d'exploitable : on refuse d'écrire un fichier vide par-dessus l'ancien.
    try:
        build({"stations": [broken]}, now)
        raise AssertionError("fichier vide accepté")
    except ValueError:
        pass
    print("self-test : OK")


def main() -> None:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--once", action="store_true")
    mode.add_argument("--loop", action="store_true")
    mode.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    elif args.once:
        run_once()
    else:
        while True:
            try:
                run_once()
            except Exception as error:  # le service ne meurt pas sur un passage raté : il le DIT
                log("ÉCHEC satellites :", repr(error))
                # Un échec se retente plus tôt, mais jamais sous les 2 h de CelesTrak.
                time.sleep(2.5 * 3600)
                continue
            time.sleep(REFRESH_HOURS * 3600)


if __name__ == "__main__":
    sys.exit(main())
