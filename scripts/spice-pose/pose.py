"""
Ligne de commande de l'outil de pose (cf. `posekit.py` pour la méthode). Lancé par
`node scripts/spice-pose.mjs`, qui prépare l'environnement Python ; jamais à la main.

  fetch  <cible>                  noyaux et images dans .cache/spice-pose/<cible>/
  search <cible> [--model corps]  recherche à l'aveugle ; écart à la vérité si la recette en a une
  guard  <cible>                  la GARDE : le bon modèle à moins de maxErrorDeg de la vérité, et
                                  chaque témoin sous maxWitnessRatio de son score ; code 1 sinon
  truth  <cible>                  score des contours à l'orientation vraie, contre des tirages au hasard
"""
import argparse
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402

import posekit as pk  # noqa: E402

RECIPE = os.path.join(pk.ROOT, "scripts", "spice-pose-targets.json")


def target(name, recipe=RECIPE):
    t = json.load(open(recipe, encoding="utf-8"))["targets"][name]
    t["id"] = name
    return t


def rotation_rate(body):
    """Degrés par jour, depuis la période de la fiche (heures)."""
    f = json.load(open(os.path.join(pk.ROOT, "src", "registry", "entities", body + ".json"), encoding="utf-8"))

    def find(o):
        if isinstance(o, dict):
            if "rotationPeriod" in o and isinstance(o["rotationPeriod"], dict) and "value" in o["rotationPeriod"]:
                return o["rotationPeriod"]["value"]
            for v in o.values():
                r = find(v)
                if r is not None:
                    return r
        return None

    hours = find(f)
    if not hours:
        raise ValueError(f"{body} : pas de période de rotation dans la fiche")
    return 360 * 24 / hours


def download(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "galaxy-spice-pose"})
    with urllib.request.urlopen(req, timeout=300) as r:
        data = r.read()
    if data[:15].lower().startswith(b"<!doctype html") or data[:6].lower() == b"<html>":
        raise RuntimeError(f"{url} : page HTML au lieu d'un fichier")
    open(path + ".part", "wb").write(data)
    os.replace(path + ".part", path)
    print(f"  téléchargé {url}")


def cmd_fetch(t, _):
    for k in t["kernels"]:
        download(t["kernelBase"] + k, os.path.join(pk.kernel_dir(t), os.path.basename(k)))
    for n in t["images"]:
        for suf in (t["imageSuffix"], t.get("labelSuffix")) if t.get("labelSuffix") else (t["imageSuffix"],):
            download(t["imageBase"] + n + suf, os.path.join(pk.image_dir(t), n + suf))
    print("noyaux et images en cache")


def scorers(t, model_body, sp):
    cam, geo, imgs = pk.geometry(sp, t)
    own = pk.load_model(t["body"])
    radius, _ = own.volume_radius()
    mesh = own if model_body == t["body"] else pk.load_model(model_body, radius)
    s = t["search"]
    rate = rotation_rate(t["body"])
    mk = lambda b, sig: pk.Scorer(mesh, cam, geo, imgs, tuple(b), sig, rate, tuple(s["maxShiftPx"]))
    return mk(s["coarseBin"], s["coarseSigma"]), mk(s["fineBin"], s["fineSigma"]), geo


def run_search(t, model, poles, jobs):
    import spiceypy as sp

    t0 = time.time()
    coarse, fine, geo = scorers(t, model, sp)
    print(f"{t['id']} / modèle {model} : {len(geo)} images, pixel fin {fine.scene.pixel_km:.3f} km, "
          f"{len(fine.scene.P)} points ; rotation {coarse.rate:.3f} °/j", flush=True)
    res = pk.blind_search(coarse, fine, poles=poles, jobs=jobs, log=lambda m: print(m, flush=True))
    truth = geo[0].get("truth")
    for r in res:
        if truth is not None:
            r["errorDeg"] = pk.angle_between(pk.bmat(*r["x"]), truth)
    best = res[0]
    msg = f"MEILLEUR {model} : contours {best['score']:.4f}"
    if truth is not None:
        msg += f", écart à la vérité {best['errorDeg']:.2f}°"
    print(msg + f" ({time.time() - t0:.0f} s)", flush=True)
    out = os.path.join(pk.ROOT, ".cache", "spice-pose", t["id"], f"search_{model}.json")
    json.dump(dict(model=model, results=res), open(out, "w"), indent=1)
    return best


def cmd_search(t, a):
    run_search(t, a.model or t["body"], a.poles, a.jobs)


def cmd_guard(t, a):
    g = t["guard"]
    own = run_search(t, t["body"], a.poles, a.jobs)
    witnesses = {w: run_search(t, w, a.poles, a.jobs)["score"] for w in g["witnesses"]}
    ok = own["errorDeg"] <= g["maxErrorDeg"]
    print(f"\n{t['body']} : écart {own['errorDeg']:.2f}° (borne {g['maxErrorDeg']}°), contours {own['score']:.4f}")
    for w, s in witnesses.items():
        ratio = s / own["score"]
        good = ratio <= g["maxWitnessRatio"]
        ok &= good
        print(f"  témoin {w} : {s:.4f}, soit {ratio:.2f} du bon modèle (borne {g['maxWitnessRatio']}) {'' if good else 'ÉCHEC'}")
    print("GARDE TENUE" if ok else "GARDE ROMPUE")
    sys.exit(0 if ok else 1)


def cmd_truth(t, a):
    import spiceypy as sp

    _, fine, geo = scorers(t, a.model or t["body"], sp)
    T = geo[0]["truth"]
    print("vérité : contours", fine.score(T).round(3), "luminosité", fine.score(T, edge=False).round(3))
    rng = np.random.default_rng(0)
    for _ in range(5):
        q = rng.normal(size=4)
        q /= np.linalg.norm(q)
        w, x, y, z = q
        R = np.array([
            [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
            [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
            [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
        ])
        print(f"hasard : contours {fine.score(R).mean():.3f}, luminosité {fine.score(R, edge=False).mean():.3f}")


def cmd_witness(t, _):
    """Les témoins d'étiquette, AVANT toute recherche (2026-10-06). Une étiquette OSIRIS porte ce
    que le pipeline de l'équipe a calculé avec les mêmes noyaux : le point sous la sonde dans le
    repère qu'elle nomme, et l'azimut du nord CÉLESTE, compté dans le repère d'AFFICHAGE qu'elle
    déclare (`LINE_DISPLAY_DIRECTION`, `SAMPLE_DISPLAY_DIRECTION` : la NAC affiche ses échantillons
    vers la GAUCHE, la WAC vers la droite). Les recalculer valide la géométrie et la caméra (axes,
    rotation autour de la visée) sans rien supposer de l'orientation du corps. Code 1 si un écart
    dépasse 0,5°.

    Piège payé le 2026-10-06 : un premier témoin supposait un affichage standard et AJUSTAIT un
    décalage constant (« 90° de convention ») ; il validait ainsi des axes tournés de 90°, et la
    pose vraie de Lutetia ne reproduisait pas ses images. Un témoin ne s'ajuste pas."""
    import math
    import spiceypy as sp

    cam, geo, _ = pk.geometry(sp, t)
    _, frame, _, _, _ = sp.getfov(sp.bods2c(t["camera"]["instrument"]), 10)
    worst = 0.0
    for g in geo:
        _, _, lbl = pk.load_frame(t, g["name"])
        need = ("SUB_SPACECRAFT_LATITUDE", "SUB_SPACECRAFT_LONGITUDE", "NORTH_AZIMUTH", "ROSETTA:COORDINATE_SYSTEM")
        if not all(k in lbl for k in need):
            raise SystemExit(f"{g['name']} : étiquette sans témoins ({', '.join(k for k in need if k not in lbl)})")
        num = lambda k: float(lbl[k].split()[0])
        body_frame = lbl["ROSETTA:COORDINATE_SYSTEM"]
        lt = g["d"] / 299792.458
        p, _ = sp.spkpos(t["spacecraft"], g["et"], body_frame, "LT+S", t["naifBody"])
        _, lon, lat = sp.reclat(np.array(p))
        dlat = math.degrees(lat) - num("SUB_SPACECRAFT_LATITUDE")
        dlon = (math.degrees(lon) - num("SUB_SPACECRAFT_LONGITUDE") + 180) % 360 - 180
        down = cam.line_axis if lbl.get("LINE_DISPLAY_DIRECTION", "DOWN") == "DOWN" else -cam.line_axis
        right = cam.sample_axis if lbl.get("SAMPLE_DISPLAY_DIRECTION", "RIGHT") == "RIGHT" else -cam.sample_axis
        z = np.array(sp.pxform("J2000", frame, g["et"])) @ np.array([0, 0, 1.0])
        az = math.degrees(math.atan2(z @ down, z @ right)) % 360
        daz = (az - num("NORTH_AZIMUTH") + 180) % 360 - 180
        worst = max(worst, abs(dlat), abs(dlon * math.cos(lat)), abs(daz))
        print(f"{g['name']} : sous la sonde {dlat:+.3f}° / {dlon:+.3f}° ({body_frame}), nord {daz:+.2f}°")
    print(f"écart maximal {worst:.3f}° : " + ("TÉMOINS TENUS" if worst <= 0.5 else "TÉMOINS ROMPUS"))
    sys.exit(0 if worst <= 0.5 else 1)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("command", choices=["fetch", "search", "guard", "truth", "witness"])
    p.add_argument("target")
    p.add_argument("--model")
    p.add_argument("--poles", type=int, default=400)
    p.add_argument("--recipe", default=RECIPE, help="autre recette, pour falsifier une garde")
    p.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    a = p.parse_args()
    t = target(a.target, a.recipe)
    {"fetch": cmd_fetch, "search": cmd_search, "guard": cmd_guard, "truth": cmd_truth, "witness": cmd_witness}[a.command](t, a)


if __name__ == "__main__":
    main()
