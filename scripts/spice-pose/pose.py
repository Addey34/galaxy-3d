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
import math
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
    if not hours and f.get("facts", {}).get("rotationPeriod", {}).get("detail") == "synchronousRotation":
        # Rotation synchrone (les lunes d'Uranus) : la période est celle de l'orbite.
        hours = f["facts"]["orbitPeriodDays"]["value"] * 24
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
        # Une entrée peut être une adresse complète : les noyaux de Voyager viennent de trois
        # hôtes (NAIF générique, NAIF Voyager, nœud Ring-Moon du PDS).
        url = k if k.startswith("https://") else t["kernelBase"] + k
        download(url, os.path.join(pk.kernel_dir(t), os.path.basename(k)))
    for n in dict.fromkeys(t["images"] + t.get("map", {}).get("images", [])):
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


def cmd_map(t, a):
    """Carte d'albédo relatif depuis les images `mapImages` de la recette, à la pose `--pose`
    (`truth` : le repère de vérité ; `search` : le meilleur résultat de `search`). Deux groupes
    séparés par `mapSplitPhase` (degrés) sont cartographiés À PART et comparés par blocs de 2° :
    on ne livre que si deux vues indépendantes s'accordent. Écrit des TIFF flottants (NoData 0)."""
    import spiceypy as sp
    from PIL import Image

    m = t["map"]
    sub = dict(t, images=m["images"])
    cam, geo, imgs = pk.geometry(sp, sub)
    mesh = pk.load_model(t["body"])
    radius, _ = mesh.volume_radius()
    atlas = m.get("projection") == "atlas"
    if atlas:
        # Carte dans l'ATLAS du modèle (2026-10-06) : chaque point de surface a son texel, même
        # là où plusieurs surfaces partagent une direction (le cou de 67P).
        size = m["atlasSize"]
        labels, charts, texel_area = pk.atlas_charts(mesh, size)
        texel_km = math.sqrt(texel_area)
        grids = {k: pk.AtlasGrid(size) for k in ("all", "A", "B", "mosaic")}
        spacing = texel_km / 2
        P, N, UV = mesh.sample(spacing, with_uv=True)
        cells = grids["all"].cells(UV)
        print(f"{len(P)} points au pas de {spacing:.4f} km, atlas de {size} x {size}, {charts} îles, texel de {texel_km * 1000:.1f} m", flush=True)
    else:
        grids = {k: pk.MapGrid(a.step) for k in ("all", "A", "B", "mosaic")}
        spacing = math.radians(a.step) * radius / 2
        P, N = mesh.sample(spacing)
        print(f"{len(P)} points au pas de {spacing:.3f} km, carte de {grids['all'].nx} x {grids['all'].ny}", flush=True)
    def add(grid, lat, lon, idx, value, weight):
        if atlas:
            grid.add_cells(cells[idx], value, weight)
        else:
            grid.add(lat, lon, value, weight)
    if a.pose == "search":
        res = json.load(open(os.path.join(pk.ROOT, ".cache", "spice-pose", t["id"], f"search_{t['body']}.json")))
        B0 = pk.bmat(*res["results"][0]["x"])
        _, g0, _ = pk.geometry(sp, t)
        et0, rate = g0[0]["et"], rotation_rate(t["body"])
        pose_at = lambda g: pk.rz_deg(rate * (g["et"] - et0) / 86400) @ B0
    else:
        pose_at = lambda g: g["truth"]
    scene = pk.make_scene(mesh, min(g["d"] for g in geo) / cam.ks * 4)
    for g, image in zip(geo, imgs):
        B = pose_at(g)
        shift = pk.pointing_shift(
            scene, cam, B, g, image, (4, 4), tuple(t["search"]["maxShiftPx"]), m.get("maskNoData", False)
        )
        lat, lon, refl, w, iof, idx = pk.reflectance_samples(
            P, N, cam, B, g, image, shift, max_angle=m.get("maxAngle", 70.0), spacing=spacing,
            limb_px=m.get("limbPx", 0),
        )
        if len(refl) < 100:
            print(f"{g['name']} : {len(refl)} points, écartée", flush=True)
            continue
        refl = refl / np.median(refl)  # la phase change d'une image à l'autre : relatif à l'image
        if m.get("weightByResolution"):
            # Une image 4 fois plus fine pèse 16 fois plus (2026-10-06, Miranda) : sans cela, les
            # vues lointaines, quatre fois plus nombreuses en points, noyaient le détail des vues
            # rapprochées dans la moyenne. Pixel au sol pris à la distance du centre.
            w = w / (g["d"] / cam.ks) ** 2
        # Une ombre ou un bord rasant que le modèle ne résout pas sort à presque zéro, et la
        # division par Lommel-Seeliger le gonfle : franges noires vues sur Lutetia (2026-10-06).
        keep = (refl > 0.5) & (refl < 2.0)
        lat, lon, refl, w, iof, idx = lat[keep], lon[keep], refl[keep], w[keep], iof[keep], idx[keep]
        phase = math.degrees(math.acos(np.clip((-g["p"] / g["d"]) @ (g["sun"] / np.linalg.norm(g["sun"])), -1, 1)))
        # Deux groupes INDÉPENDANTS : par phase (un survol : approche, puis départ), ou par date
        # quand toutes les images ont la même phase (67P, été 2014 : deux journées distinctes).
        if "splitTime" in m:
            group = "A" if g["et"] < sp.str2et(m["splitTime"]) else "B"
        else:
            group = "A" if phase < m["splitPhase"] else "B"
        add(grids["all"], lat, lon, idx, refl, w)
        add(grids[group], lat, lon, idx, refl, w)
        # PHOTOMOSAÏQUE : l'I/F brut, ombrage du relief compris, des images de phase intermédiaire
        # (`mosaicPhase`). Pendant un survol le Soleil éclaire la surface sous presque le même angle
        # (Lutetia tourne de 22° en 30 min) : l'ombrage reste cohérent d'une image à l'autre.
        lo, hi = m.get("mosaicPhase", [None, None])
        if lo is not None and lo <= phase <= hi:
            add(grids["mosaic"], lat, lon, idx, iof / np.median(iof), w)
        print(f"{g['name']} : phase {phase:5.1f}°, groupe {group}, {len(refl)} points, décalage {shift}", flush=True)
    out = os.path.join(pk.ROOT, ".cache", "spice-pose", t["id"])
    maps = {k: v.mean() for k, v in grids.items()}
    for k, v in maps.items():
        Image.fromarray(v.astype(np.float32), mode="F").save(os.path.join(out, f"map_{k}.tif"))
    if atlas:
        # Dans l'atlas, un texel couvre partout à peu près la même aire (xatlas l'égalise) : la
        # couverture est la part des texels d'île qui ont une mesure. Les distances sont en texels,
        # l'équivalent de 2° et de 1 à 3° de grand cercle sur le rayon équivalent.
        area = (labels > 0).astype(float)
        px_per_deg = math.radians(1) * radius / texel_km
        block, step_unit, shifts = 2.0 * px_per_deg, 1.0, tuple(round(d * px_per_deg) for d in (1, 2, 3))
    else:
        lat_c = 90 - (np.arange(grids["all"].ny) + 0.5) * a.step
        area = np.cos(np.radians(lat_c))[:, None] * np.ones((1, grids["all"].nx))
        block, step_unit, shifts = 2.0, a.step, (1, 2, 3)
    cov = lambda v: float((area * (v > 0)).sum() / area.sum())
    print(f"couverture : tout {cov(maps['all']):.1%}, A {cov(maps['A']):.1%}, B {cov(maps['B']):.1%}")
    agree = pk.block_agreement(pk.fill_small_gaps(maps["A"]), pk.fill_small_gaps(maps["B"]), block, step_unit)
    print(f"accord radiométrique A/B par blocs de 2° : {agree['blocks']} blocs communs, r {agree['r']:.3f}, sans la moyenne de chaque latitude {agree['r_lat']:.3f}")
    reg = pk.shape_registration(maps["A"], maps["B"], step_unit, shifts)
    print(f"recalage des formes A/B : r {reg['at_zero']:.3f} au décalage nul, {reg['max_shifted']:.3f} au mieux décalé de 1 à 3° (moyenne {reg['mean_shifted']:.3f})")
    if not atlas and a.step > 0.25:
        # Mesuré le 2026-10-06 : au pas de 1°, un décalage de 1° ne vaut qu'une case, sous la largeur
        # du filtre, et le témoin rendait 0,83 au décalage nul contre 0,81 décalé.
        print("  témoin de recalage NON SIGNIFICATIF à ce pas : le relancer à 0,25° ou moins")
    if (maps["mosaic"] > 0).any():
        mreg = pk.shape_registration(maps["mosaic"], maps["A"], step_unit, shifts)
        print(f"photomosaïque : couverture {cov(maps['mosaic']):.1%}, recalage des formes contre A r {mreg['at_zero']:.3f} au décalage nul, {mreg['max_shifted']:.3f} au mieux décalée")
    write_texture(t, out, a.step)
    json.dump(dict(coverage={k: cov(v) for k, v in maps.items()}, agreement=agree, registration=reg, step=a.step, pose=a.pose,
                   **({"atlasSize": m["atlasSize"], "texelKm": texel_km} if atlas else {})),
              open(os.path.join(out, "map_report.json"), "w"), indent=1)


def write_texture(t, out, step):
    """`map_texture.tif` depuis les cartes sauvées : `texture: "detail"` transfère le relief fin de
    la photomosaïque sur la carte d'albédo A ; sinon la carte du groupe `textureGroup`, comblée."""
    from PIL import Image

    m = t["map"]
    load = lambda k: np.array(Image.open(os.path.join(out, f"map_{k}.tif"))).astype(float)
    if m.get("projection") == "atlas":
        # Mêmes réglages que la carte équirectangulaire, convertis en texels sur le rayon équivalent.
        mesh = pk.load_model(t["body"])
        radius, _ = mesh.volume_radius()
        labels, _, texel_area = pk.atlas_charts(mesh, m["atlasSize"])
        px_per_deg = math.radians(1) * radius / math.sqrt(texel_area)
        tex = pk.atlas_texture(load("A"), load("mosaic"), labels, 1.5 * px_per_deg, 2.0 * px_per_deg)
    elif m.get("texture") == "detail":
        tex = pk.detail_texture(load("A"), load("mosaic"), step)
    else:
        tex = pk.texture_fill(load(m.get("textureGroup", "A")), round(2.0 / step))
    Image.fromarray(tex.astype(np.float32), mode="F").save(os.path.join(out, "map_texture.tif"))
    print(f"texture écrite : {os.path.join(out, 'map_texture.tif')} ({tex.shape[1]} x {tex.shape[0]})")


def cmd_texture(t, a):
    """Reconstruit la texture depuis les cartes d'une précédente commande `map`, sans reprojeter."""
    out = os.path.join(pk.ROOT, ".cache", "spice-pose", t["id"])
    step = json.load(open(os.path.join(out, "map_report.json")))["step"]
    write_texture(t, out, step)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("command", choices=["fetch", "search", "guard", "truth", "witness", "map", "texture"])
    p.add_argument("target")
    p.add_argument("--model")
    p.add_argument("--poles", type=int, default=400)
    p.add_argument("--pose", choices=["truth", "search"], default="truth")
    p.add_argument("--step", type=float, default=0.25, help="pas de la carte, degrés")
    p.add_argument("--recipe", default=RECIPE, help="autre recette, pour falsifier une garde")
    p.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    a = p.parse_args()
    t = target(a.target, a.recipe)
    {"fetch": cmd_fetch, "search": cmd_search, "guard": cmd_guard, "truth": cmd_truth, "witness": cmd_witness, "map": cmd_map, "texture": cmd_texture}[a.command](t, a)


if __name__ == "__main__":
    main()
