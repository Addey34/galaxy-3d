#!/usr/bin/env python3
"""
L'ARCHIVE DU SERVICE DE DONNÉES : ERA5, à la demande (lot 46, 2026-10-12).

POURQUOI. Au-delà des analyses GFS que l'ingestion garde, les couches de modèle interrogeaient
l'archive ERA5 d'Open-Meteo depuis le navigateur, et son quota se compte par adresse IP, à
raison d'environ UN APPEL PAR POINT de grille (mesuré le 2026-10-12 : deux requêtes de 1 000
points passent, la troisième reçoit 429). Un relais par la VM ne suffirait pas : 10 000 appels
par jour pour TOUS les visiteurs. Il fallait la source primaire, côté serveur.

LA SOURCE, MESURÉE le 2026-10-12. ARCO-ERA5, copie Zarr publique d'ERA5 par Google
(`gcp-public-data-arco-era5`), lisible sans clé :
  - un morceau = UNE heure, globe entier, 721 × 1440 à 0,25°, float32 Blosc lz4, 1,8 à 3,3 Mo ;
  - latitude de 90 à −90, longitude de 0 à 359,75 : un point sur quatre donne EXACTEMENT la
    grille GFS de l'ingestion (181 × 360, 90 puis 0), donc le même format et le même décodeur ;
  - l'axe du temps compte en heures depuis 1900-01-01 (`time[0] = 0`), PAS depuis 1940 : compté
    depuis 1940, l'index tombait 40 ans plus tard et rendait des valeurs plausibles partout ;
  - hors couverture, un 404 franc (1939-12-31 et 2026-10-08 mesurés), jamais un remplissage NaN.
Licence : ERA5 est sous CC-BY 4.0 (catalogue du Copernicus Climate Data Store, DOI
10.24381/cds.adbb2d47). Les fichiers publiés sont MODIFIÉS (sous-échantillonnés à 1°,
quantifiés) et le disent dans leur en-tête.

DEUX VERSIONS, DEUX CHEMINS. ERA5 définitif (`era5/`) et ERA5T préliminaire (`era5t/`, environ
une semaine de délai, remplacé par le définitif environ trois mois plus tard). Un chemin ne sert
donc jamais deux contenus : un champ publié reste immuable, et le passage au définitif change
d'adresse au lieu de réécrire un fichier qu'un navigateur garde un an.

CE QUI EST SERVI :
    GET /era5/{AAAAMMJJHH}/{champ}.bin     /era5t/{AAAAMMJJHH}/{champ}.bin
Un champ déjà construit est servi par Caddy, directement depuis le volume ; ce serveur ne voit
que les MANQUANTS, les construit, les écrit, puis les rend.

BORNÉ, PAR ÉCRIT :
  - débit : au plus UPSTREAM_PER_HOUR morceaux lus chez Google par heure glissante, au plus
    UPSTREAM_PARALLEL à la fois ; au-delà, 503 + `Retry-After`, et le client passe à son repli ;
  - disque : CACHE_MAX_BYTES ; au-delà, les plus ANCIENNEMENT écrits partent (Caddy sert les
    lectures sans que ce serveur les voie, donc l'ordre est celui de l'écriture, pas de l'usage).

Usage :
    python era5.py --serve          le serveur (port 8080)
    python era5.py --self-test      contrôles hors réseau
    python era5.py --coverage       imprime la couverture lue chez Google
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import http.server
import json
import math
import os
import re
import socketserver
import sys
import threading
import time
import urllib.error
import urllib.request

from ingest import ROOT, USER_AGENT, encode_field, iso, log, write_atomic

ARCO = "https://storage.googleapis.com/gcp-public-data-arco-era5/ar/full_37-1h-0p25deg-chunk-1.zarr-v3"
TIME_ORIGIN = dt.datetime(1900, 1, 1, tzinfo=dt.timezone.utc)
SUBSAMPLE = 4  # 0,25° → 1°, mesuré : retombe sur la grille GFS
NATIVE = (721, 1440)
UPSTREAM_PER_HOUR = int(os.environ.get("ERA5_UPSTREAM_PER_HOUR", "600"))
UPSTREAM_PARALLEL = 3
CACHE_MAX_BYTES = int(os.environ.get("ERA5_CACHE_MAX_BYTES", str(4 * 1024**3)))
PORT = 8080

SOURCES = {
    "era5": "ECMWF ERA5 reanalysis (Copernicus C3S, CC-BY 4.0, doi:10.24381/cds.adbb2d47), via ARCO-ERA5, subsampled to 1.0°",
    "era5t": "ECMWF ERA5T preliminary reanalysis (Copernicus C3S, CC-BY 4.0, doi:10.24381/cds.adbb2d47), via ARCO-ERA5, subsampled to 1.0°",
}

# Les MÊMES champs, unités et quantifications que l'ingestion GFS : le client ne sait pas, et n'a
# pas à savoir, quelle source a écrit un fichier. `derive` dit comment passer des variables ERA5
# à la grandeur publiée.
FIELDS = {
    "wind10m": {"vars": ["10m_u_component_of_wind", "10m_v_component_of_wind"], "unit": "m/s",
                "scale": 0.01, "offset": 0.0, "derive": "bands"},
    "t2m": {"vars": ["2m_temperature"], "unit": "K", "scale": 0.01, "offset": 250.0, "derive": "bands"},
    # ERA5 ne publie pas l'humidité relative à 2 m : elle se DÉRIVE de la température et du point
    # de rosée (formule de Magnus, coefficients d'Alduchov et Eskridge 1996), comme le font les
    # services qui la rendent.
    "rh2m": {"vars": ["2m_temperature", "2m_dewpoint_temperature"], "unit": "%",
             "scale": 0.01, "offset": 0.0, "derive": "magnus"},
    "prmsl": {"vars": ["mean_sea_level_pressure"], "unit": "Pa", "scale": 1.0, "offset": 100000.0,
              "derive": "bands"},
    # Fraction 0-1 chez ERA5, pourcentage publié.
    "tcc": {"vars": ["total_cloud_cover"], "unit": "%", "scale": 0.01, "offset": 0.0, "derive": "percent"},
    # Cumul de l'heure qui FINIT à l'instant, en mètres d'eau : × 1 000 = mm sur une heure, donc
    # mm/h, la même unité que le taux de GFS.
    "prate": {"vars": ["total_precipitation"], "unit": "mm/h", "scale": 0.01, "offset": 0.0,
              "derive": "metres-per-hour"},
}

STAMP = re.compile(r"^/(era5|era5t)/(\d{10})/([a-z0-9]+)\.bin$")


# ─────────────────────────── couverture ───────────────────────────


def time_index(moment: dt.datetime) -> int:
    return int((moment - TIME_ORIGIN).total_seconds() // 3600)


def end_of_day(date: str) -> str:
    return date.replace("-", "") + "23"


def read_coverage() -> dict | None:
    """
    La couverture DÉCLARÉE par ARCO-ERA5 (attributs du Zarr), rendue en instants inclusifs. Le
    jour déclaré est pris jusqu'à 23 h, mesuré présent (ERA5T va même un peu au-delà). None si
    la source ne répond pas : le manifeste ne promet alors aucune archive.
    """
    try:
        request = urllib.request.Request(ARCO + "/.zattrs", headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=60) as response:
            attrs = json.loads(response.read())
        start = attrs["valid_time_start"].replace("-", "") + "00"
        final = end_of_day(attrs["valid_time_stop"])
        preliminary = end_of_day(attrs["valid_time_stop_era5t"])
    except (urllib.error.URLError, TimeoutError, KeyError, ValueError):
        return None
    return coverage_block(start, final, preliminary)


def coverage_block(start: str, final: str, preliminary: str) -> dict:
    after_final = stamp_of(parse_stamp(final) + dt.timedelta(hours=1))
    return {
        "era5": {"from": start, "to": final, "path": "era5/{time}/{field}.bin"},
        "era5t": {"from": after_final, "to": preliminary, "path": "era5t/{time}/{field}.bin"},
        "stepHours": 1,
        "fields": sorted(FIELDS),
    }


def parse_stamp(value: str) -> dt.datetime:
    return dt.datetime.strptime(value, "%Y%m%d%H").replace(tzinfo=dt.timezone.utc)


def stamp_of(moment: dt.datetime) -> str:
    return moment.strftime("%Y%m%d%H")


# ─────────────────────────── construction d'un champ ───────────────────────────


class Saturated(Exception):
    """Le plafond de débit vers Google est atteint ; le client passe à son repli."""


class Upstream:
    """Le plafond de débit : une fenêtre glissante d'une heure, et un nombre de lectures simultanées."""

    def __init__(self, per_hour: int, parallel: int) -> None:
        self.per_hour = per_hour
        self.recent: collections.deque[float] = collections.deque()
        self.lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(parallel)

    def reserve(self, count: int) -> None:
        with self.lock:
            now = time.monotonic()
            while self.recent and now - self.recent[0] > 3600:
                self.recent.popleft()
            if len(self.recent) + count > self.per_hour:
                raise Saturated()
            self.recent.extend([now] * count)


UPSTREAM = Upstream(UPSTREAM_PER_HOUR, UPSTREAM_PARALLEL)


def fetch_chunk(variable: str, index: int) -> bytes | None:
    url = f"{ARCO}/{variable}/{index}.0.0"
    for attempt in range(3):
        try:
            with UPSTREAM.slots:
                request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(request, timeout=60) as response:
                    return response.read()
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            time.sleep(2 * 2**attempt)
        except (urllib.error.URLError, TimeoutError):
            time.sleep(2 * 2**attempt)
    raise RuntimeError(f"ARCO-ERA5 injoignable : {url}")


def subsample(raw: bytes):
    """Un morceau Blosc → la grille de 1°, nord en haut, longitude 0 en premier."""
    import numcodecs
    import numpy as np

    values = np.frombuffer(numcodecs.Blosc().decode(raw), dtype="<f4").reshape(NATIVE)
    return values[::SUBSAMPLE, ::SUBSAMPLE].astype("float64")


def magnus_rh(temperature_k, dewpoint_k):
    import numpy as np

    t = temperature_k - 273.15
    d = dewpoint_k - 273.15
    rh = 100.0 * np.exp(17.625 * d / (243.04 + d)) / np.exp(17.625 * t / (243.04 + t))
    return np.clip(rh, 0.0, 100.0)


def derive(name: str, grids: list):
    spec = FIELDS[name]
    rule = spec["derive"]
    if rule == "bands":
        return grids
    if rule == "magnus":
        return [magnus_rh(grids[0], grids[1])]
    if rule == "percent":
        return [grids[0] * 100.0]
    if rule == "metres-per-hour":
        return [grids[0] * 1000.0]
    raise ValueError(rule)


def build_field(version: str, moment: dt.datetime, name: str) -> bytes | None:
    """Les octets GXF1 d'un champ, ou None si ARCO-ERA5 ne publie pas cet instant."""
    spec = FIELDS[name]
    index = time_index(moment)
    UPSTREAM.reserve(len(spec["vars"]))
    grids = []
    for variable in spec["vars"]:
        raw = fetch_chunk(variable, index)
        if raw is None:
            return None
        grids.append(subsample(raw))
    bands = [list(band.ravel()) for band in derive(name, grids)]
    header = {
        "field": name,
        "bands": len(bands),
        "unit": spec["unit"],
        "scale": spec["scale"],
        "offset": spec["offset"],
        "nLon": NATIVE[1] // SUBSAMPLE,
        "nLat": NATIVE[0] // SUBSAMPLE + 1,
        "lat0": 90.0,
        "lon0": 0.0,
        "dLat": -1.0,
        "dLon": 1.0,
        "validTime": iso(moment),
        "kind": "reanalysis",
        "product": version,
        "source": SOURCES[version],
    }
    return encode_field(header, bands)


# ─────────────────────────── cache borné ───────────────────────────


def prune_cache(limit: int = CACHE_MAX_BYTES) -> int:
    """Retire les champs les plus anciennement écrits tant que l'archive dépasse `limit`."""
    files = []
    for version in ("era5", "era5t"):
        base = os.path.join(ROOT, version)
        for folder, _, names in os.walk(base):
            for name in names:
                if name.endswith(".bin"):
                    path = os.path.join(folder, name)
                    stat = os.stat(path)
                    files.append((stat.st_mtime, stat.st_size, path))
    total = sum(size for _, size, _ in files)
    removed = 0
    for _, size, path in sorted(files):
        if total <= limit:
            break
        os.remove(path)
        total -= size
        removed += 1
    return removed


def prune_superseded(coverage: dict) -> int:
    """Un champ ERA5T que le définitif couvre désormais part : il ne serait plus jamais demandé."""
    base = os.path.join(ROOT, "era5t")
    if not os.path.isdir(base):
        return 0
    removed = 0
    for name in os.listdir(base):
        if name.isdigit() and len(name) == 10 and name <= coverage["era5"]["to"]:
            folder = os.path.join(base, name)
            for leaf in os.listdir(folder):
                os.remove(os.path.join(folder, leaf))
            os.rmdir(folder)
            removed += 1
    return removed


# ─────────────────────────── serveur ───────────────────────────

COVERAGE: dict = {"value": None, "at": 0.0}
COVERAGE_LOCK = threading.Lock()
BUILDING: dict[str, threading.Lock] = {}
BUILDING_LOCK = threading.Lock()
WRITES = {"count": 0}


def coverage() -> dict | None:
    with COVERAGE_LOCK:
        if COVERAGE["value"] is None or time.monotonic() - COVERAGE["at"] > 3600:
            fresh = read_coverage()
            if fresh is not None:
                COVERAGE["value"] = fresh
                prune_superseded(fresh)
            COVERAGE["at"] = time.monotonic()
        return COVERAGE["value"]


def resolve(path: str) -> tuple[str, dt.datetime, str] | None:
    """Le chemin demandé, validé contre la couverture ; None s'il ne désigne aucun champ servable."""
    match = STAMP.match(path)
    if not match:
        return None
    version, value, name = match.groups()
    if name not in FIELDS:
        return None
    window = coverage()
    if window is None or not (window[version]["from"] <= value <= window[version]["to"]):
        return None
    return version, parse_stamp(value), name


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "galaxy-data-era5/1"
    sys_version = ""  # sans la version de Python dans `Server`

    def log_message(self, *_args) -> None:  # aucun journal d'accès, comme les deux Caddy
        pass

    def reply(self, status: int, body: bytes = b"", headers: dict | None = None) -> None:
        self.send_response(status)
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        target = resolve(self.path.split("?", 1)[0])
        if target is None:
            self.reply(404, b"", {"Cache-Control": "public, max-age=3600"})
            return
        version, moment, name = target
        path = os.path.join(ROOT, version, stamp_of(moment), f"{name}.bin")
        # Deux visiteurs qui demandent le même champ au même moment ne le construisent qu'une fois.
        with BUILDING_LOCK:
            lock = BUILDING.setdefault(path, threading.Lock())
        try:
            with lock:
                if not os.path.exists(path):
                    blob = build_field(version, moment, name)
                    if blob is None:
                        self.reply(404, b"", {"Cache-Control": "public, max-age=3600"})
                        return
                    write_atomic(path, blob)
                    WRITES["count"] += 1
                    if WRITES["count"] % 50 == 0:
                        prune_cache()
                with open(path, "rb") as handle:
                    blob = handle.read()
        except Saturated:
            self.reply(503, b"", {"Retry-After": "600", "Cache-Control": "no-store"})
            return
        except Exception as error:  # le serveur ne meurt pas sur un champ raté : il le DIT
            log("ÉCHEC", self.path, repr(error))
            self.reply(502, b"", {"Cache-Control": "no-store"})
            return
        finally:
            with BUILDING_LOCK:
                if BUILDING.get(path) is lock and not lock.locked():
                    BUILDING.pop(path, None)
        self.reply(200, blob, {
            "Content-Type": "application/octet-stream",
            "Cache-Control": "public, max-age=31536000, immutable",
        })


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


def serve() -> None:
    log("archive ERA5 : port", PORT, "; plafond", UPSTREAM_PER_HOUR, "morceaux/h ;",
        CACHE_MAX_BYTES // 1024**2, "Mo de cache")
    Server(("", PORT), Handler).serve_forever()


# ─────────────────────────── contrôles ───────────────────────────


def self_test() -> None:
    import numpy as np

    # L'origine de l'axe du temps : 1900, pas 1940 (le piège mesuré).
    assert time_index(dt.datetime(1900, 1, 1, tzinfo=dt.timezone.utc)) == 0
    assert time_index(dt.datetime(1940, 1, 1, tzinfo=dt.timezone.utc)) == 350616
    assert time_index(dt.datetime(2026, 10, 3, 23, tzinfo=dt.timezone.utc)) == 1111127

    block = coverage_block("1940010100", "2026063023", "2026100323")
    assert block["era5t"]["from"] == "2026070100", block

    # Le sous-échantillonnage retombe sur la grille GFS : le point (i, j) natif d'indice
    # (4 × ligne, 4 × colonne), latitude 90 − ligne, longitude colonne.
    native = np.arange(NATIVE[0] * NATIVE[1], dtype="<f4").reshape(NATIVE)
    import numcodecs

    grid = subsample(numcodecs.Blosc().encode(native.tobytes()))
    assert grid.shape == (181, 360), grid.shape
    assert grid[1, 2] == native[4, 8]
    assert grid[180, 359] == native[720, 1436]

    rh = magnus_rh(np.array([293.15, 293.15]), np.array([293.15, 283.15]))
    assert abs(rh[0] - 100.0) < 1e-9 and 52.0 < rh[1] < 54.0, rh  # 20 °C, rosée 10 °C ≈ 52,6 %
    assert derive("tcc", [np.array([0.5])])[0][0] == 50.0
    assert derive("prate", [np.array([0.0012])])[0][0] == 1.2

    # Le plafond refuse au-delà et laisse passer en deçà.
    gate = Upstream(per_hour=3, parallel=1)
    gate.reserve(2)
    try:
        gate.reserve(2)
        raise AssertionError("plafond dépassé accepté")
    except Saturated:
        pass
    gate.reserve(1)

    # Le cache borné retire les plus anciennement écrits, et ne touche à rien sous la borne.
    import tempfile

    global ROOT
    saved = ROOT
    with tempfile.TemporaryDirectory() as scratch:
        ROOT = scratch
        for i, stamp_value in enumerate(["1990010100", "1990010101", "1990010102"]):
            path = os.path.join(scratch, "era5", stamp_value, "t2m.bin")
            write_atomic(path, b"x" * 100)
            os.utime(path, (1000 + i, 1000 + i))
        assert prune_cache(limit=1000) == 0
        assert prune_cache(limit=150) == 2
        assert os.listdir(os.path.join(scratch, "era5", "1990010102")) == ["t2m.bin"]
        write_atomic(os.path.join(scratch, "era5t", "2026063012", "t2m.bin"), b"x")
        write_atomic(os.path.join(scratch, "era5t", "2026070112", "t2m.bin"), b"x")
        assert prune_superseded(block) == 1
        assert os.listdir(os.path.join(scratch, "era5t")) == ["2026070112"]
    ROOT = saved

    # Le routage refuse ce qui n'est pas un champ connu, avant toute couverture.
    assert resolve("/era5/1990010100/inconnu.bin") is None
    assert resolve("/era5/19900101/t2m.bin") is None
    assert resolve("/gfs/1990010100/t2m.bin") is None
    assert not math.isnan(float(rh[1]))
    print("self-test : OK")


def main() -> None:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--serve", action="store_true")
    mode.add_argument("--self-test", action="store_true")
    mode.add_argument("--coverage", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    elif args.coverage:
        print(json.dumps(read_coverage(), indent=1))
    else:
        serve()


if __name__ == "__main__":
    sys.exit(main())
