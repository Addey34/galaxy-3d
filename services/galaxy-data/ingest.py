#!/usr/bin/env python3
"""
LE SERVICE DE DONNÉES DE GALAXY : ingestion du modèle GFS de la NOAA (lot 46, 2026-10-12).

POURQUOI. Les couches météo de modèle interrogeaient Open-Meteo depuis le navigateur de chaque
visiteur. L'API gratuite permet 5 000 appels par heure PAR ADRESSE IP, et une grille mondiale
de 4° en fait 4 140 points : un visiteur, ou une classe entière derrière une même connexion,
épuisait son quota en une ou deux grilles (mesuré : 429 « Hourly API request limit exceeded »).
Ce service récupère la donnée UNE fois, à la source primaire, et la publie en fichiers
statiques : la consommation ne dépend plus du nombre de visiteurs.

LA SOURCE. NOAA NCEP GFS, grille de 1° (360 × 181), servie par NOMADS
(`filter_gfs_1p00.pl`), sans clé, domaine public. Sept champs instantanés, présents dès
l'analyse (f000), mesuré le 2026-10-12 : vent à 10 m (u, v), température et humidité à 2 m,
pression au niveau de la mer, nébulosité totale, taux de précipitation.

CE QUI EST PUBLIÉ, par INSTANT VALIDE (pas par cycle) :
    {racine}/gfs/{AAAAMMJJHH}/{cycle}/{champ}.bin     immuable (le cycle est dans le chemin)
    {racine}/gfs/manifest.json                         court, réécrit à chaque passage
Pour chaque instant, la meilleure donnée disponible : l'ANALYSE (f000) d'un cycle quand elle
existe, sinon la prévision du cycle le plus récent. Le manifeste dit laquelle (`kind`).

FORMAT d'un champ (`.bin`) : « GXF1 », longueur de l'en-tête (uint32 LE), en-tête JSON UTF-8,
puis les valeurs en int16 LE, bande après bande, rangée après rangée. Valeur = brut × scale +
offset ; −32768 = absente. L'en-tête décrit la grille (premier point, pas), l'unité, l'instant,
le cycle, l'échéance et la source : le fichier se lit sans rien deviner.

RÉTENTION BORNÉE ET ÉCRITE (leçon du quota de Firebase) : les instants de la fenêtre
[maintenant − RETAIN_PAST_DAYS, dernier cycle + FORECAST_HOURS]. Au-delà dans le passé, le
client passe à l'archive (ERA5).

Usage :
    python ingest.py --once            un passage (le dernier cycle complet, s'il est nouveau)
    python ingest.py --loop            un passage toutes les CHECK_MINUTES
    python ingest.py --self-test       contrôles hors réseau du format
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import os
import shutil
import struct
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = os.environ.get("GALAXY_DATA_ROOT", "/srv/galaxy-data")
NOMADS = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_1p00.pl"
USER_AGENT = "galaxy-data/1 (+https://galaxy.adrianguichard.dev)"
# Une échéance toutes les 3 h jusqu'à J+16 : tout ce que le fichier 1° publie (f000 à f384), et
# l'horizon que le client demandait déjà à Open-Meteo. Plus court, les dates de J+7 à J+16
# retomberaient sur le quota par visiteur que ce service supprime.
FORECAST_HOURS = 384
STEP_HOURS = 3
RETAIN_PAST_DAYS = 10
CHECK_MINUTES = 30
# Entre deux requêtes à NOMADS : la NOAA bloque les clients trop pressés.
PAUSE_SECONDS = 1.5
MISSING = -32768

# Les champs publiés : nom GRIB (shortName, typeOfLevel, level) → nom publié, unité, et la
# quantification. Chaque échelle garde la valeur au centième de son unité ou mieux, dans
# l'intervalle d'un int16.
FIELDS = {
    "wind10m": {
        "bands": [("10u", "heightAboveGround", 10), ("10v", "heightAboveGround", 10)],
        "unit": "m/s",
        "scale": 0.01,
        "offset": 0.0,
    },
    "t2m": {"bands": [("2t", "heightAboveGround", 2)], "unit": "K", "scale": 0.01, "offset": 250.0},
    "rh2m": {"bands": [("2r", "heightAboveGround", 2)], "unit": "%", "scale": 0.01, "offset": 0.0},
    "prmsl": {"bands": [("prmsl", "meanSea", 0)], "unit": "Pa", "scale": 1.0, "offset": 100000.0},
    "tcc": {"bands": [("tcc", "atmosphere", 0)], "unit": "%", "scale": 0.01, "offset": 0.0},
    # Taux de précipitation, converti en mm/h (1 kg/m² = 1 mm d'eau, × 3 600 s).
    "prate": {
        "bands": [("prate", "surface", 0)],
        "unit": "mm/h",
        "scale": 0.01,
        "offset": 0.0,
        "factor": 3600.0,
    },
}
NOMADS_SELECTION = {
    "var_UGRD": "on",
    "var_VGRD": "on",
    "var_TMP": "on",
    "var_RH": "on",
    "var_PRMSL": "on",
    "var_TCDC": "on",
    "var_PRATE": "on",
    "lev_10_m_above_ground": "on",
    "lev_2_m_above_ground": "on",
    "lev_mean_sea_level": "on",
    "lev_entire_atmosphere": "on",
    "lev_surface": "on",
}
SOURCE = {
    "name": "NOAA NCEP Global Forecast System (GFS), 1.0°",
    "url": "https://www.nco.ncep.noaa.gov/pmb/products/gfs/",
    "licence": "U.S. Government work, public domain",
}


def log(*parts: object) -> None:
    print(dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), *parts, flush=True)


# ─────────────────────────── format ───────────────────────────


def encode_field(header: dict, bands: list[list[float]]) -> bytes:
    """En-tête JSON + int16 LE ; une valeur hors d'un int16 ou non finie devient MISSING."""
    scale, offset = header["scale"], header["offset"]
    out = io.BytesIO()
    head = json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8")
    out.write(b"GXF1")
    out.write(struct.pack("<I", len(head)))
    out.write(head)
    for band in bands:
        raw = []
        for value in band:
            if value is None or value != value:  # NaN
                raw.append(MISSING)
                continue
            q = round((value - offset) / scale)
            raw.append(q if -32767 <= q <= 32767 else MISSING)
        out.write(struct.pack(f"<{len(raw)}h", *raw))
    return out.getvalue()


def decode_field(blob: bytes) -> tuple[dict, list[list[float | None]]]:
    """L'inverse exact d'`encode_field` ; sert au contrôle et aux tests."""
    if blob[:4] != b"GXF1":
        raise ValueError("signature GXF1 absente")
    (length,) = struct.unpack_from("<I", blob, 4)
    header = json.loads(blob[8 : 8 + length].decode("utf-8"))
    count = header["nLon"] * header["nLat"]
    bands = []
    cursor = 8 + length
    for _ in range(header["bands"]):
        raw = struct.unpack_from(f"<{count}h", blob, cursor)
        cursor += 2 * count
        bands.append([None if q == MISSING else q * header["scale"] + header["offset"] for q in raw])
    if cursor != len(blob):
        raise ValueError(f"longueur incohérente : {cursor} lus sur {len(blob)}")
    return header, bands


# ─────────────────────────── NOAA ───────────────────────────


def nomads_url(cycle: dt.datetime, lead: int) -> str:
    day, hour = cycle.strftime("%Y%m%d"), cycle.strftime("%H")
    params = {
        "dir": f"/gfs.{day}/{hour}/atmos",
        "file": f"gfs.t{hour}z.pgrb2.1p00.f{lead:03d}",
        **NOMADS_SELECTION,
    }
    return NOMADS + "?" + "&".join(f"{k}={urllib.request.quote(v, safe='')}" for k, v in params.items())


def fetch(url: str) -> bytes | None:
    """Les octets, ou None si le fichier n'existe pas (encore). Une erreur serveur se retente."""
    for attempt in range(5):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=120) as response:
                data = response.read()
            # NOMADS sert parfois une page HTML d'erreur en 200 : un GRIB commence par « GRIB ».
            return data if data[:4] == b"GRIB" else None
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            time.sleep(10 * 2**attempt)
        except (urllib.error.URLError, TimeoutError):
            time.sleep(10 * 2**attempt)
    raise RuntimeError(f"NOMADS injoignable : {url}")


def decode_grib(blob: bytes) -> tuple[dict, dict]:
    """Les messages GRIB par (shortName, typeOfLevel, level), INSTANTANÉS seulement, et la grille."""
    import eccodes as ec  # importé ici : le self-test n'en a pas besoin

    messages: dict = {}
    grid: dict = {}
    with tempfile.NamedTemporaryFile(suffix=".grb2") as handle:
        handle.write(blob)
        handle.flush()
        with open(handle.name, "rb") as stream:
            while True:
                gid = ec.codes_grib_new_from_file(stream)
                if gid is None:
                    break
                try:
                    # « 0-3 » est une moyenne sur l'intervalle : on garde l'instantané.
                    if "-" in str(ec.codes_get(gid, "stepRange")):
                        continue
                    key = (
                        ec.codes_get(gid, "shortName"),
                        ec.codes_get(gid, "typeOfLevel"),
                        int(ec.codes_get(gid, "level")),
                    )
                    messages[key] = [float(v) for v in ec.codes_get_values(gid)]
                    grid = {
                        "nLon": int(ec.codes_get(gid, "Ni")),
                        "nLat": int(ec.codes_get(gid, "Nj")),
                        "lat0": float(ec.codes_get(gid, "latitudeOfFirstGridPointInDegrees")),
                        "lon0": float(ec.codes_get(gid, "longitudeOfFirstGridPointInDegrees")),
                        "dLat": -float(ec.codes_get(gid, "jDirectionIncrementInDegrees"))
                        if ec.codes_get(gid, "jScansPositively") == 0
                        else float(ec.codes_get(gid, "jDirectionIncrementInDegrees")),
                        "dLon": float(ec.codes_get(gid, "iDirectionIncrementInDegrees")),
                    }
                finally:
                    ec.codes_release(gid)
    return messages, grid


# ─────────────────────────── publication ───────────────────────────


def stamp(moment: dt.datetime) -> str:
    return moment.strftime("%Y%m%d%H")


def iso(moment: dt.datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def write_atomic(path: str, data: bytes) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temporary = path + ".part"
    with open(temporary, "wb") as handle:
        handle.write(data)
    os.replace(temporary, path)


def publish_step(cycle: dt.datetime, lead: int, blob: bytes) -> list[str]:
    """Écrit les champs d'une échéance ; rend les champs écrits. Un champ absent fait échouer."""
    messages, grid = decode_grib(blob)
    valid = cycle + dt.timedelta(hours=lead)
    written = []
    for name, spec in FIELDS.items():
        bands = []
        for key in spec["bands"]:
            if key not in messages:
                raise RuntimeError(f"{name} : message {key} absent de f{lead:03d} du cycle {stamp(cycle)}")
            factor = spec.get("factor", 1.0)
            bands.append([v * factor for v in messages[key]])
        header = {
            "field": name,
            "bands": len(bands),
            "unit": spec["unit"],
            "scale": spec["scale"],
            "offset": spec["offset"],
            **grid,
            "validTime": iso(valid),
            "cycle": iso(cycle),
            "lead": lead,
            "kind": "analysis" if lead == 0 else "forecast",
            "source": SOURCE["name"],
        }
        path = os.path.join(ROOT, "gfs", stamp(valid), stamp(cycle), f"{name}.bin")
        write_atomic(path, encode_field(header, bands))
        written.append(name)
    return written


def latest_cycle(now: dt.datetime) -> dt.datetime:
    hour = (now.hour // 6) * 6
    return now.replace(hour=hour, minute=0, second=0, microsecond=0)


def ingest_cycle(cycle: dt.datetime) -> bool:
    """Toutes les échéances d'un cycle ; False si le cycle n'est pas encore complet chez NOMADS."""
    marker = os.path.join(ROOT, "gfs", ".cycles", stamp(cycle))
    if os.path.exists(marker):
        return True
    # Le DERNIER fichier d'abord : s'il manque, le cycle n'est pas complet, et on ne publie rien.
    if fetch(nomads_url(cycle, FORECAST_HOURS)) is None:
        log("cycle incomplet chez NOMADS :", stamp(cycle))
        return False
    for lead in range(0, FORECAST_HOURS + 1, STEP_HOURS):
        blob = fetch(nomads_url(cycle, lead))
        if blob is None:
            raise RuntimeError(f"f{lead:03d} absente alors que f{FORECAST_HOURS:03d} existe ({stamp(cycle)})")
        publish_step(cycle, lead, blob)
        time.sleep(PAUSE_SECONDS)
    write_atomic(marker, iso(dt.datetime.now(dt.timezone.utc)).encode())
    log("cycle publié :", stamp(cycle))
    return True


def backfill_analyses(now: dt.datetime, limit: int = 8) -> int:
    """
    Les ANALYSES (f000) des cycles passés qui manquent dans la fenêtre de rétention, au plus
    `limit` par passage pour rester léger. NOMADS garde une dizaine de jours de cycles en ligne :
    sans ce rattrapage, le passé ne se remplirait qu'au fil des jours, et un service redémarré
    sur un volume vide laisserait dix jours de trou.
    """
    done = 0
    cycle = latest_cycle(now)
    oldest = now - dt.timedelta(days=RETAIN_PAST_DAYS)
    while cycle >= oldest and done < limit:
        folder = os.path.join(ROOT, "gfs", stamp(cycle), stamp(cycle))
        if not os.path.isdir(folder):
            blob = fetch(nomads_url(cycle, 0))
            if blob is not None:
                publish_step(cycle, 0, blob)
                done += 1
                time.sleep(PAUSE_SECONDS)
        cycle -= dt.timedelta(hours=6)
    if done:
        log("analyses rattrapées :", done)
    return done


def instant_folders(base: str) -> list[str]:
    """
    Les dossiers d'INSTANT de `gfs/` : dix chiffres, rien d'autre. Le dossier porte aussi le
    manifeste et les marqueurs de cycle ; les prendre pour des instants a fait échouer le second
    passage du service (NotADirectoryError sur `manifest.json`, 2026-10-12).
    """
    if not os.path.isdir(base):
        return []
    return sorted(
        name
        for name in os.listdir(base)
        if len(name) == 10 and name.isdigit() and os.path.isdir(os.path.join(base, name))
    )


def build_manifest(now: dt.datetime) -> dict:
    """Pour chaque instant gardé, la meilleure donnée : une analyse, sinon la prévision la plus récente."""
    base = os.path.join(ROOT, "gfs")
    times = {}
    for valid in instant_folders(base):
        cycles = sorted(c for c in os.listdir(os.path.join(base, valid)) if not c.startswith("."))
        if not cycles:
            continue
        analysis = [c for c in cycles if c == valid]
        best = analysis[0] if analysis else cycles[-1]
        fields = sorted(f[:-4] for f in os.listdir(os.path.join(base, valid, best)) if f.endswith(".bin"))
        times[valid] = {
            "cycle": best,
            "kind": "analysis" if analysis else "forecast",
            "fields": fields,
        }
    return {
        "format": "GXF1",
        "generated": iso(now),
        "source": SOURCE,
        "grid": "1.0 degree, 360 x 181",
        "stepHours": STEP_HOURS,
        "retainPastDays": RETAIN_PAST_DAYS,
        "path": "gfs/{validTime}/{cycle}/{field}.bin",
        "fields": {name: {"unit": spec["unit"], "bands": len(spec["bands"])} for name, spec in FIELDS.items()},
        "times": times,
    }


def prune(now: dt.datetime) -> int:
    """Retire les instants hors fenêtre, et les cycles qu'un cycle plus récent a remplacés."""
    base = os.path.join(ROOT, "gfs")
    if not os.path.isdir(base):
        return 0
    horizon = stamp(now - dt.timedelta(days=RETAIN_PAST_DAYS))
    removed = 0
    for valid in instant_folders(base):
        folder = os.path.join(base, valid)
        if valid < horizon:
            shutil.rmtree(folder)
            removed += 1
            continue
        cycles = sorted(c for c in os.listdir(folder) if not c.startswith("."))
        keep = {valid} if valid in cycles else set()
        if cycles:
            keep.add(cycles[-1])
        # On garde aussi l'avant-dernier : un client peut avoir lu le manifeste précédent.
        if len(cycles) > 1:
            keep.add(cycles[-2])
        for cycle in cycles:
            if cycle not in keep:
                shutil.rmtree(os.path.join(folder, cycle))
    markers = os.path.join(base, ".cycles")
    if os.path.isdir(markers):
        for name in os.listdir(markers):
            if name < horizon:
                os.remove(os.path.join(markers, name))
    return removed


def run_once() -> None:
    now = dt.datetime.now(dt.timezone.utc)
    cycle = latest_cycle(now)
    # Le cycle courant n'est souvent pas encore publié (3 h 30 à 5 h de délai) : on remonte.
    for back in range(0, 4):
        candidate = cycle - dt.timedelta(hours=6 * back)
        if ingest_cycle(candidate):
            break
    backfill_analyses(now)
    removed = prune(now)
    manifest = build_manifest(now)
    write_atomic(
        os.path.join(ROOT, "gfs", "manifest.json"),
        json.dumps(manifest, separators=(",", ":"), sort_keys=True).encode("utf-8"),
    )
    log("manifeste :", len(manifest["times"]), "instants ;", removed, "retirés")


# ─────────────────────────── contrôles ───────────────────────────


def self_test() -> None:
    header = {"field": "t", "bands": 2, "nLon": 3, "nLat": 2, "scale": 0.01, "offset": 250.0}
    bands = [[250.0, 251.234, float("nan"), 900.0, 249.99, 270.5], [0, 1, 2, 3, 4, 5]]
    back_header, back = decode_field(encode_field(header, bands))
    assert back_header == header
    assert back[0][0] == 250.0
    assert abs(back[0][1] - 251.23) < 1e-9, back[0][1]
    assert back[0][2] is None, "NaN → absente"
    assert back[0][3] is None, "hors int16 → absente, jamais tronquée"
    assert abs(back[1][5] - 5.0) < 1e-9
    try:
        decode_field(encode_field(header, bands) + b"x")
        raise AssertionError("longueur incohérente acceptée")
    except ValueError:
        pass
    assert latest_cycle(dt.datetime(2026, 10, 12, 17, 59, tzinfo=dt.timezone.utc)).hour == 12

    # Un passage complet de publication sur un dossier temporaire, MANIFESTE COMPRIS : le second
    # passage du service réel a échoué sur ce manifeste, que le premier n'avait pas encore écrit.
    global ROOT
    saved = ROOT
    with tempfile.TemporaryDirectory() as scratch:
        ROOT = scratch
        now = dt.datetime(2026, 10, 12, 12, tzinfo=dt.timezone.utc)
        for valid, cycle in [("2026101206", "2026101206"), ("2026101206", "2026101200"),
                             ("2026101212", "2026101200"), ("2026100100", "2026100100")]:
            write_atomic(os.path.join(scratch, "gfs", valid, cycle, "t2m.bin"), b"x")
        write_atomic(os.path.join(scratch, "gfs", ".cycles", "2026101200"), b"x")
        for _ in range(2):  # le second passage voit le manifeste du premier
            prune(now)
            manifest = build_manifest(now)
            write_atomic(os.path.join(scratch, "gfs", "manifest.json"), json.dumps(manifest).encode())
        assert set(manifest["times"]) == {"2026101206", "2026101212"}, manifest["times"]
        assert manifest["times"]["2026101206"] == {
            "cycle": "2026101206", "kind": "analysis", "fields": ["t2m"]}
        assert manifest["times"]["2026101212"]["kind"] == "forecast"
    ROOT = saved
    print("self-test : OK")


def write_fixture(path: str) -> None:
    """
    Un champ de vent minuscule (4 × 3, pas de 90°, grille du service : nord en haut, longitude 0
    en premier) aux valeurs CONNUES, pour `src/core/galaxyData.test.ts` : le décodeur du client
    lit le fichier que cet encodeur écrit, donc les deux ne peuvent pas dériver l'un de l'autre.
    Bande u = indice du point, bande v = −indice ; le point 5 est absent dans u.
    """
    header = {
        "field": "wind10m",
        "bands": 2,
        "unit": "m/s",
        "scale": 0.01,
        "offset": 0.0,
        "nLon": 4,
        "nLat": 3,
        "lat0": 90.0,
        "lon0": 0.0,
        "dLat": -90.0,
        "dLon": 90.0,
        "validTime": "2026-10-12T06:00:00Z",
        "cycle": "2026-10-12T00:00:00Z",
        "lead": 6,
        "kind": "forecast",
        "source": SOURCE["name"],
    }
    u = [float(i) for i in range(12)]
    u[5] = float("nan")
    v = [-float(i) for i in range(12)]
    with open(path, "wb") as handle:
        handle.write(encode_field(header, [u, v]))


def main() -> None:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--once", action="store_true")
    mode.add_argument("--loop", action="store_true")
    mode.add_argument("--self-test", action="store_true")
    mode.add_argument("--fixture", metavar="CHEMIN")
    args = parser.parse_args()
    if args.fixture:
        write_fixture(args.fixture)
        return
    if args.self_test:
        self_test()
        return
    if args.once:
        run_once()
        return
    while True:
        try:
            run_once()
        except Exception as error:  # le service ne meurt pas sur un cycle raté : il le DIT
            log("ÉCHEC :", repr(error))
        time.sleep(CHECK_MINUTES * 60)


if __name__ == "__main__":
    sys.exit(main())
