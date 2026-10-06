"""
LA POSE D'UN CORPS DANS SES IMAGES, retrouvée depuis les noyaux SPICE (2026-10-06).

Les noyaux d'une mission placent la sonde, le corps et la caméra ; ils ne donnent presque jamais
l'ORIENTATION d'un petit corps (le PCK générique n'en connaît que les rayons). Cette orientation
s'AJUSTE : une rotation J2000 -> repère du modèle livré, propagée d'image en image par la seule
période de rotation de la fiche du corps. Le critère est la ressemblance des CONTOURS (laplacien
de gaussienne : limbe et bords d'ombre) entre l'image et le rendu du modèle sous l'éclairage du
moment, ombres portées comprises ; la recherche va du grossier (grille de pôles et d'angles,
luminosité brute) au fin (Nelder-Mead sur les contours, depuis les meilleurs départs distincts).

Ce module porte en script la sonde validée hors dépôt le 2026-10-06 (`.cache/eros-msi/probe`,
`.cache/mathilde-msi/probe`), avec trois changements, tous re-mesurés par la garde d'Éros :
 - le modèle est le maillage LIVRÉ (`public/assets/models/{corps}/*.glb`, le plus fin), lu dans
   son propre repère, et non une grille ré-échantillonnée : la pose trouvée est donc celle du
   maillage sur lequel une carte serait drapée ;
 - les points du rendu sont tirés sur les triangles, à un pas DÉRIVÉ du pixel au sol, et les
   tolérances (profondeur, ombre) en dérivent aussi, au lieu de kilomètres écrits pour un corps ;
 - l'échelle de la caméra vient du champ de vue du noyau d'instrument (`getfov`).

Pourquoi Python et spiceypy, et pas un lecteur SPK/CK en Node : la géométrie est ce que la garde
JUGE. Un lecteur maison des noyaux (SPK de types 1, 2, 13, CK de type 3, PCK binaire, chaînes de
repères TK, horloges, corrections de temps de lumière) serait une seconde source d'erreur qu'il
faudrait valider... contre la boîte à outils de NAIF elle-même. spiceypy EST cette boîte à
outils (CSPICE). L'outil tourne hors ligne, comme les mosaïques : il ne touche ni le bundle ni
la CI ; `scripts/spice-pose.mjs` crée son environnement aux versions de `requirements.txt`.
"""
import json
import math
import os
import re
import struct
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from scipy.ndimage import gaussian_laplace

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


# ---------------------------------------------------------------- rotations


def bmat(ra, dec, w):
    """J2000 -> repère du corps, pour un pôle (ra, dec) et un méridien w, en degrés (UAI)."""

    def rz(a):
        c, s = math.cos(a), math.sin(a)
        return np.array([[c, s, 0], [-s, c, 0], [0, 0, 1]])

    def rx(a):
        c, s = math.cos(a), math.sin(a)
        return np.array([[1, 0, 0], [0, c, s], [0, -s, c]])

    return rz(math.radians(w)) @ rx(math.radians(90 - dec)) @ rz(math.radians(90 + ra))


def rz_deg(d):
    a = math.radians(d)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, s, 0], [-s, c, 0], [0, 0, 1]])


def angle_between(a, b):
    """Angle de la rotation qui mène a sur b, en degrés."""
    return math.degrees(math.acos(max(-1.0, min(1.0, (np.trace(a @ b.T) - 1) / 2))))


def fibonacci_poles(n):
    i = np.arange(n) + 0.5
    dec = np.degrees(np.arcsin(1 - 2 * i / n))
    ra = np.degrees(np.pi * (1 + 5**0.5) * i) % 360
    return ra, dec


# ---------------------------------------------------------------- modèle livré


def read_glb(path):
    """Positions (km) et triangles d'un glTF binaire livré, ramenés pôle sur Z.

    `decimate-shape-model.mjs --z-up` écrit (x, y, z)_glb = (x, z, -y)_source ; on l'inverse
    pour retrouver le repère lié au corps des produits PDS (pôle sur +Z)."""
    with open(path, "rb") as f:
        b = f.read()
    magic, _, _ = struct.unpack_from("<4sII", b, 0)
    if magic != b"glTF":
        raise ValueError(f"{path} : pas un glTF binaire")
    jlen, jtype = struct.unpack_from("<I4s", b, 12)
    if jtype != b"JSON":
        raise ValueError(f"{path} : premier bloc non JSON")
    meta = json.loads(b[20 : 20 + jlen])
    off = 20 + jlen
    blen, btype = struct.unpack_from("<I4s", b, off)
    if btype != b"BIN\x00":
        raise ValueError(f"{path} : second bloc non binaire")
    binary = b[off + 8 : off + 8 + blen]
    if meta.get("extensionsRequired"):
        raise ValueError(f"{path} : extensions requises {meta['extensionsRequired']}")
    prim = meta["meshes"][0]["primitives"][0]
    dtypes = {5126: "<f4", 5125: "<u4", 5123: "<u2"}
    sizes = {"VEC3": 3, "VEC2": 2, "SCALAR": 1}

    def accessor(i):
        a = meta["accessors"][i]
        v = meta["bufferViews"][a["bufferView"]]
        dt = np.dtype(dtypes[a["componentType"]])
        start = v.get("byteOffset", 0) + a.get("byteOffset", 0)
        n = a["count"] * sizes[a["type"]]
        arr = np.frombuffer(binary, dtype=dt, count=n, offset=start)
        return arr.reshape(a["count"], -1) if sizes[a["type"]] > 1 else arr

    pos = accessor(prim["attributes"]["POSITION"]).astype(np.float64)
    nor = accessor(prim["attributes"]["NORMAL"]).astype(np.float64)
    tri = accessor(prim["indices"]).astype(np.int64).reshape(-1, 3)
    # Coordonnées d'ATLAS quand le modèle en porte (`unwrap-shape-model.mjs`), origine en bas.
    uv = accessor(prim["attributes"]["TEXCOORD_0"]).astype(np.float64) if "TEXCOORD_0" in prim["attributes"] else None
    back = lambda a: np.stack([a[:, 0], -a[:, 2], a[:, 1]], 1)
    return back(pos), back(nor), tri, meta.get("asset", {}).get("copyright", ""), uv


def shipped_model(body):
    """Le niveau le plus fin livré pour ce corps."""
    d = os.path.join(ROOT, "public", "assets", "models", body)
    order = ["8k", "4k", "2k", "1k"]
    files = {re.sub(r".*_shape_(\w+)\.glb$", r"\1", f): f for f in os.listdir(d) if f.endswith(".glb")}
    for q in order:
        if q in files:
            return os.path.join(d, files[q])
    raise FileNotFoundError(f"aucun modèle livré pour {body}")


@dataclass
class Mesh:
    pos: np.ndarray
    nor: np.ndarray
    tri: np.ndarray
    name: str
    uv: Optional[np.ndarray] = None

    def volume_radius(self):
        a, b, c = (self.pos[self.tri[:, k]] for k in range(3))
        vol = np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6
        return (3 * abs(vol) / (4 * math.pi)) ** (1 / 3), vol

    def scaled(self, radius):
        r, _ = self.volume_radius()
        return Mesh(self.pos * (radius / r), self.nor, self.tri, self.name, self.uv)

    def sample(self, spacing, seed=0, with_uv=False):
        """Points tirés sur les triangles, à peu près un par carré de côté `spacing`, avec la
        normale interpolée des sommets (et la coordonnée d'atlas avec `with_uv`). Déterministe."""
        a, b, c = (self.pos[self.tri[:, k]] for k in range(3))
        area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
        n = np.maximum(1, np.round(area / spacing**2)).astype(np.int64)
        t = np.repeat(np.arange(len(self.tri)), n)
        rng = np.random.default_rng(seed)
        r1 = np.sqrt(rng.random(len(t)))
        r2 = rng.random(len(t))
        w = np.stack([1 - r1, r1 * (1 - r2), r1 * r2], 1)
        idx = self.tri[t]
        p = np.einsum("ij,ijk->ik", w, self.pos[idx])
        nn = np.einsum("ij,ijk->ik", w, self.nor[idx])
        nn /= np.linalg.norm(nn, axis=1, keepdims=True)
        if with_uv:
            if self.uv is None:
                raise ValueError(f"{self.name} : le modèle ne porte pas d'atlas (TEXCOORD_0)")
            return p, nn, np.einsum("ij,ijk->ik", w, self.uv[idx])
        return p, nn


def load_model(body, radius=None):
    pos, nor, tri, credit, uv = read_glb(shipped_model(body))
    m = Mesh(pos, nor, tri, body, uv)
    _, vol = m.volume_radius()
    if vol <= 0:
        raise ValueError(f"{body} : volume signé négatif, faces retournées")
    return m.scaled(radius) if radius else m


# ---------------------------------------------------------------- images


def read_fits(path):
    """Image 2D d'un FITS primaire (BITPIX -32, 16 ou 8), en lignes x échantillons."""
    with open(path, "rb") as f:
        b = f.read()
    cards = {}
    o = 0
    while True:
        card = b[o : o + 80].decode("latin1")
        o += 80
        if card.startswith("END"):
            break
        if "=" in card[:10]:
            k, v = card[:8].strip(), card[10:].split("/")[0].strip().strip("'").strip()
            cards[k] = v
    o = math.ceil(o / 2880) * 2880
    bitpix, w, h = int(cards["BITPIX"]), int(cards["NAXIS1"]), int(cards["NAXIS2"])
    dt = {-32: ">f4", -64: ">f8", 16: ">i2", 32: ">i4", 8: "u1"}[bitpix]
    a = np.frombuffer(b, dtype=dt, count=w * h, offset=o).reshape(h, w).astype(np.float64)
    return a * float(cards.get("BSCALE", 1)) + float(cards.get("BZERO", 0))


def read_label(path):
    """Les mots-clés de premier niveau d'une étiquette PDS3 détachée."""
    out = {}
    for line in open(path, encoding="latin1"):
        m = re.match(r"\s*([A-Z0-9_^:]+)\s*=\s*\"?([^\"\r\n]*?)\"?\s*(<[^>]*>)?\s*$", line)
        if m and m.group(1) not in out:
            out[m.group(1)] = m.group(2).strip()
    return out


def read_pds3(path):
    """Image d'un produit PDS3 à étiquette EMBARQUÉE (OSIRIS) : le tableau, la fenêtre du capteur
    qu'elle couvre (première ligne et premier échantillon, comptés depuis 0), et l'étiquette."""
    with open(path, "rb") as f:
        b = f.read()
    end = re.search(rb"\r?\nEND\s*\r?\n", b)
    text = b[: end.start()].decode("latin1")
    top = {}
    for m in re.finditer(r"(?m)^\s*([A-Z0-9_^:]+)\s*=\s*\"?([^\"\r\n]*?)\"?\s*$", text):
        top.setdefault(m.group(1), m.group(2).strip())
    obj = re.search(r"(?s)OBJECT\s*=\s*IMAGE(?![A-Z_])(.*?)END_OBJECT\s*=\s*IMAGE", text)
    if not obj:
        raise ValueError(f"{path} : pas d'objet IMAGE")
    im = dict(re.findall(r"(?m)^\s*([A-Z_]+)\s*=\s*\"?([^\"\r\n]*?)\"?\s*$", obj.group(1)))
    h, w = int(im["LINES"]), int(im["LINE_SAMPLES"])
    dt = {
        ("PC_REAL", "32"): "<f4",
        ("IEEE_REAL", "32"): ">f4",
        ("LSB_INTEGER", "16"): "<i2",
        ("MSB_INTEGER", "16"): ">i2",
        ("LSB_UNSIGNED_INTEGER", "16"): "<u2",
        ("MSB_UNSIGNED_INTEGER", "16"): ">u2",
    }[(im["SAMPLE_TYPE"], im["SAMPLE_BITS"])]
    off = (int(top["^IMAGE"].split()[0]) - 1) * int(top["RECORD_BYTES"])
    a = np.frombuffer(b, dtype=dt, count=w * h, offset=off).reshape(h, w).astype(np.float64)
    window = (int(im.get("FIRST_LINE", 1)) - 1, int(im.get("FIRST_LINE_SAMPLE", 1)) - 1)
    return a, window, top


def exposure_seconds(value):
    """`EXPOSURE_DURATION` d'une étiquette, avec son unité (NEAR en ms, OSIRIS en s)."""
    m = re.match(r"\s*([0-9.eE+-]+)\s*(<\s*(\w+)\s*>)?", value)
    unit = (m.group(3) or "s").lower()
    return float(m.group(1)) * {"s": 1, "ms": 1e-3}[unit]


def load_frame(target, name):
    """Une image de la recette : (tableau, fenêtre, étiquette)."""
    d = image_dir(target)
    if target["imageFormat"] == "fits":
        a = read_fits(os.path.join(d, name + target["imageSuffix"]))
        return a, (0, 0), read_label(os.path.join(d, name + target["labelSuffix"]))
    if target["imageFormat"] == "pds3":
        return read_pds3(os.path.join(d, name + target["imageSuffix"]))
    raise ValueError(f"format d'image non pris en charge : {target['imageFormat']}")


def binimg(a, b):
    bl, bs = b
    h, w = a.shape[0] // bl, a.shape[1] // bs
    return a[: h * bl, : w * bs].reshape(h, bl, w, bs).mean((1, 3))


# ---------------------------------------------------------------- géométrie SPICE


@dataclass
class Camera:
    lines: int
    samples: int
    kl: float  # pixels par unité de tangente, le long des lignes
    ks: float
    line_axis: np.ndarray  # axe du repère d'instrument vers lequel croissent les lignes
    sample_axis: np.ndarray
    boresight: np.ndarray


AXES = {"+X": [1, 0, 0], "-X": [-1, 0, 0], "+Y": [0, 1, 0], "-Y": [0, -1, 0], "+Z": [0, 0, 1], "-Z": [0, 0, -1]}


def camera(sp, target):
    cam = target["camera"]
    shape, frame, bsight, _, bounds = sp.getfov(sp.bods2c(cam["instrument"]), 10)
    la, sa = np.array(AXES[cam["lineAxis"]], float), np.array(AXES[cam["sampleAxis"]], float)
    bs = np.array(bsight) / np.linalg.norm(bsight)
    tl = max(abs(v @ la) / (v @ bs) for v in bounds)
    ts = max(abs(v @ sa) / (v @ bs) for v in bounds)
    kl, ks = cam["lines"] / (2 * tl), cam["samples"] / (2 * ts)
    if cam.get("pixelScaleRad"):
        # Images corrigées de leur distorsion (OSIRIS) : l'étiquette donne une échelle CARRÉE
        # (`ROSETTA:HORIZONTAL_RESOLUTION`), qui n'est plus celle du champ de vue de l'IK.
        kl = ks = 1 / cam["pixelScaleRad"]
    return Camera(cam["lines"], cam["samples"], kl, ks, la, sa, bs), frame


def kernel_dir(target):
    return os.path.join(ROOT, ".cache", "spice-pose", target["id"], "kernels")


def image_dir(target):
    return os.path.join(ROOT, ".cache", "spice-pose", target["id"], "images")


def furnish(sp, target):
    sp.kclear()
    for k in target["kernels"]:
        sp.furnsh(os.path.join(kernel_dir(target), os.path.basename(k)))


def geometry(sp, target):
    """Position du corps vue de la sonde, matrice J2000 -> instrument, direction du Soleil vue du
    corps, et (si la recette déclare un repère de VÉRITÉ) l'orientation vraie, qui ne sert qu'à juger."""
    furnish(sp, target)
    cam, frame = camera(sp, target)
    out = []
    frames = []
    for name in target["images"]:
        a, window, lbl = load_frame(target, name)
        frames.append(a)
        et = sp.str2et(lbl["START_TIME"]) + exposure_seconds(lbl["EXPOSURE_DURATION"]) / 2
        p, lt = sp.spkpos(target["naifBody"], et, "J2000", "LT+S", target["spacecraft"])
        r = sp.pxform("J2000", frame, et)
        s, _ = sp.spkpos("SUN", et - lt, "J2000", "LT+S", target["naifBody"])
        g = dict(name=name, et=et, p=np.array(p), R=np.array(r), sun=np.array(s), d=float(np.linalg.norm(p)),
                 window=window, shape=a.shape)
        if target.get("truthFrame"):
            g["truth"] = np.array(sp.pxform("J2000", target["truthFrame"], et - lt))
        out.append(g)
    return cam, out, frames


# ---------------------------------------------------------------- rendu


def shadow_mask(P, N, s, cell):
    """Vrai pour un point éclairé : face au Soleil et non masqué, sur une grille perpendiculaire
    au Soleil de pas `cell`, par un point plus haut vers le Soleil."""
    s = s / np.linalg.norm(s)
    a = np.cross(s, [0, 0, 1.0])
    if np.linalg.norm(a) < 1e-6:
        a = np.cross(s, [1.0, 0, 0])
    a /= np.linalg.norm(a)
    b = np.cross(s, a)
    u, v, dep = P @ a, P @ b, P @ s
    iu = np.floor(u / cell).astype(np.int64)
    iv = np.floor(v / cell).astype(np.int64)
    iu -= iu.min()
    iv -= iv.min()
    key = iu * (iv.max() + 1) + iv
    best = np.full(key.max() + 1, -1e18)
    np.maximum.at(best, key, dep)
    return (dep >= best[key] - 1.5 * cell) & ((N @ s) > 0.0)


@dataclass
class Scene:
    """Un modèle échantillonné pour une résolution d'image donnée."""

    P: np.ndarray
    N: np.ndarray
    spacing: float
    pixel_km: float


def make_scene(mesh, pixel_km, per_pixel=6):
    spacing = pixel_km / per_pixel
    P, N = mesh.sample(spacing)
    return Scene(P, N, spacing, pixel_km)


def project(scene, cam, B, g, b):
    """Indices de pixel (images regroupées par `b`) des points visibles, et ces points."""
    bl, bs = b
    X = (g["R"] @ (g["p"][:, None] + B.T @ scene.P.T)).T
    x = X @ cam.boresight
    ok = x > 0
    # Coordonnées sur le capteur entier, puis dans la fenêtre lue (OSIRIS lit des sous-images).
    line = (cam.lines / 2) + cam.kl * (X @ cam.line_axis) / np.where(ok, x, 1) - g["window"][0]
    samp = (cam.samples / 2) + cam.ks * (X @ cam.sample_axis) / np.where(ok, x, 1) - g["window"][1]
    H, W = g["shape"][0] // bl, g["shape"][1] // bs
    il = np.floor(line / bl).astype(np.int64)
    js = np.floor(samp / bs).astype(np.int64)
    ok &= (il >= 0) & (il < H) & (js >= 0) & (js < W)
    Nc = (g["R"] @ (B.T @ scene.N.T)).T
    mu = -(Nc * X).sum(1) / np.linalg.norm(X, axis=1)
    ok &= mu > 0
    k = il[ok] * W + js[ok]
    dep = x[ok]
    zb = np.full(H * W, np.inf)
    np.minimum.at(zb, k, dep)
    vis = dep <= zb[k] + 1.2 * scene.pixel_km
    idx = np.nonzero(ok)[0][vis]
    return k[vis], idx, mu[idx], H, W


def predict(scene, cam, B, g, b, lit=None, mu0=None):
    """Image de Lommel-Seeliger du modèle, ombres portées comprises."""
    if lit is None:
        sb = B @ g["sun"]
        sb /= np.linalg.norm(sb)
        lit = shadow_mask(scene.P, scene.N, sb, scene.pixel_km / 2)
        mu0 = scene.N @ sb
    k, idx, mu, H, W = project(scene, cam, B, g, b)
    m0 = np.clip(mu0[idx], 0, 1) * lit[idx]
    ls = np.where(m0 > 0, m0 / (m0 + np.clip(mu, 0, 1) + 1e-9), 0)
    num = np.bincount(k, weights=ls, minlength=H * W)
    den = np.bincount(k, minlength=H * W)
    return np.where(den > 0, num / np.maximum(den, 1), 0).reshape(H, W)


def xcorr(pred, obs, maxs):
    """Corrélation normalisée au meilleur décalage entier (borné par `maxs`), et ce décalage."""
    a = pred - pred.mean()
    o = obs - obs.mean()
    H, W = a.shape
    F = np.fft.rfft2(o, (2 * H, 2 * W)) * np.conj(np.fft.rfft2(a, (2 * H, 2 * W)))
    c = np.fft.irfft2(F, (2 * H, 2 * W))
    c = np.roll(np.roll(c, maxs[0], 0), maxs[1], 1)[: 2 * maxs[0] + 1, : 2 * maxs[1] + 1]
    i, j = np.unravel_index(np.argmax(c), c.shape)
    return c[i, j] / (np.linalg.norm(a) * np.linalg.norm(o) + 1e-12), (i - maxs[0], j - maxs[1])


# ---------------------------------------------------------------- critère


@dataclass
class Scorer:
    """Ressemblance d'une orientation à un jeu d'images, à un regroupement de pixels donné."""

    mesh: Mesh
    cam: Camera
    geo: list
    images: list
    b: tuple
    sigma: float
    rate: float  # degrés par jour autour du +Z du modèle
    maxshift_px: tuple  # décalage de pointage toléré, en pixels bruts (lignes, échantillons)
    obs: list = field(init=False)
    obsL: list = field(init=False)
    scene: Scene = field(init=False)

    def __post_init__(self):
        self.obs = [binimg(a, self.b) for a in self.images]
        self.obsL = [gaussian_laplace(o / max(o.max(), 1e-12), self.sigma) for o in self.obs]
        # Le pixel au sol (regroupé) fixe le pas des points et les tolérances du rendu.
        d = float(min(g["d"] for g in self.geo))
        self.scene = make_scene(self.mesh, d * max(self.b[0] / self.cam.kl, self.b[1] / self.cam.ks))
        self.et0 = self.geo[0]["et"]
        self.maxs = (self.maxshift_px[0] // self.b[0], self.maxshift_px[1] // self.b[1])

    def at(self, B0, g):
        return rz_deg(self.rate * (g["et"] - self.et0) / 86400) @ B0

    def predictions(self, B0):
        return [predict(self.scene, self.cam, self.at(B0, g), g, self.b) for g in self.geo]

    def score(self, B0, edge=True):
        out = []
        for pr, ob, oL in zip(self.predictions(B0), self.obs, self.obsL):
            out.append(xcorr(gaussian_laplace(pr, self.sigma), oL, self.maxs)[0] if edge else xcorr(pr, ob, self.maxs)[0])
        return np.array(out)


_WORKER = {}


def _init_worker(coarse, fine):
    _WORKER["coarse"], _WORKER["fine"] = coarse, fine


def _grid_chunk(args):
    poles, wstep = args
    c = _WORKER["coarse"]
    return [
        (float(c.score(bmat(ra, dec, w), edge=False).mean()), ra, dec, w)
        for ra, dec in poles
        for w in range(0, 360, wstep)
    ]


def _refine(x0):
    from scipy.optimize import minimize

    fine = _WORKER["fine"]
    x0 = np.array(x0, float)
    m = minimize(
        lambda x: -fine.score(bmat(*x)).mean(),
        x0,
        method="Nelder-Mead",
        options=dict(initial_simplex=np.vstack([x0, x0 + 5 * np.eye(3)]), xatol=0.2, fatol=2e-4, maxiter=150),
    )
    return dict(score=float(-m.fun), x=[float(v) for v in m.x], start=[float(v) for v in x0])


def blind_search(coarse, fine, poles=400, wstep=10, keep=8, jobs=1, log=print):
    """Grille de pôles x méridiens sur la luminosité au grossier, puis Nelder-Mead sur les
    contours au fin depuis les `keep` meilleurs départs distants d'au moins 20°. Les départs sont
    choisis AVANT tout affinement, donc le résultat ne dépend pas de `jobs`."""
    from concurrent.futures import ProcessPoolExecutor

    ra, dec = fibonacci_poles(poles)
    pairs = list(zip(ra.tolist(), dec.tolist()))
    chunks = [(pairs[k::jobs * 4], wstep) for k in range(jobs * 4)]
    if jobs > 1:
        with ProcessPoolExecutor(jobs, initializer=_init_worker, initargs=(coarse, fine)) as ex:
            grid = [g for part in ex.map(_grid_chunk, chunks) for g in part]
    else:
        _init_worker(coarse, fine)
        grid = [g for part in map(_grid_chunk, chunks) for g in part]
    grid.sort(reverse=True)
    log(f"grille : meilleur {grid[0][0]:.3f}, médiane {np.median([g[0] for g in grid]):.3f}")
    seen, starts = [], []
    for r in grid:
        B = bmat(*r[1:])
        if any(angle_between(B, q) < 20 for q in seen):
            continue
        seen.append(B)
        starts.append(list(r[1:]))
        if len(starts) >= keep:
            break
    if jobs > 1:
        with ProcessPoolExecutor(min(jobs, keep), initializer=_init_worker, initargs=(coarse, fine)) as ex:
            out = list(ex.map(_refine, starts))
    else:
        out = list(map(_refine, starts))
    for k, o in enumerate(out):
        log(f"  départ {k + 1} : contours {o['score']:.4f} à {np.round(o['x'], 1).tolist()}")
    out.sort(key=lambda o: -o["score"])
    return out


# ---------------------------------------------------------------- carte


def pointing_shift(scene, cam, B, g, image, b, maxshift_px):
    """Décalage de pointage (pixels bruts, lignes puis échantillons) qui superpose le rendu à
    l'image : la visée des noyaux n'est pas celle des images corrigées (Šteins : ~130 px)."""
    pr = predict(scene, cam, B, g, b)
    ob = np.nan_to_num(binimg(image, b))
    _, s = xcorr(pr, ob, (maxshift_px[0] // b[0], maxshift_px[1] // b[1]))
    return s[0] * b[0], s[1] * b[1]


def reflectance_samples(P, N, cam, B, g, image, shift, max_angle=70.0, spacing=0.1, limb_px=0):
    """Pour chaque point du modèle vu ET éclairé dans cette image, sa latitude et sa longitude
    (repère du fichier, longitude Est), la réflectance corrigée de Lommel-Seeliger et le poids
    cos i · cos e. Le rendu de visibilité est celui de la recherche, au pixel brut."""
    pixel_km = g["d"] / cam.ks
    scene = Scene(P, N, spacing, max(pixel_km, spacing))
    sb = B @ g["sun"]
    sb /= np.linalg.norm(sb)
    lit = shadow_mask(P, N, sb, scene.pixel_km / 2)
    mu0 = N @ sb
    k, idx, mu, H, W = project(scene, cam, B, g, (1, 1))
    il, js = np.divmod(k, W)
    il = il + shift[0]
    js = js + shift[1]
    ok = (il >= 0) & (il < image.shape[0]) & (js >= 0) & (js < image.shape[1])
    il, js, idx, mu = il[ok], js[ok], idx[ok], mu[ok]
    m0 = np.clip(mu0[idx], 0, 1)
    cosmax = math.cos(math.radians(max_angle))
    keep = lit[idx] & (m0 > cosmax) & (mu > cosmax)
    il, js, idx, mu, m0 = il[keep], js[keep], idx[keep], mu[keep], m0[keep]
    iof = image[il, js]
    good = np.isfinite(iof) & (iof > 0)
    if limb_px:
        # Un pixel au bord du disque, dans l'IMAGE, mêle le corps et le ciel : il sort en frange
        # sombre tout le long de la couverture (Lutetia, 2026-10-06). On n'échantillonne que
        # l'intérieur du disque observé, érodé de `limb_px` pixels.
        from scipy.ndimage import binary_erosion

        img = np.nan_to_num(image)
        # Seuil sur le HAUT de l'histogramme : la médiane des pixels positifs inclut le bruit du
        # fond et prenait 39 à 52 % du cadre pour le disque (mesuré), si bien que rien n'était érodé.
        disc = img > 0.2 * np.percentile(img, 99)
        good &= binary_erosion(disc, iterations=limb_px)[il, js]
    idx, mu, m0, iof = idx[good], mu[good], m0[good], iof[good]
    ls = m0 / (m0 + mu)
    refl = iof / ls
    p = P[idx]
    r = np.linalg.norm(p, axis=1)
    lat = np.degrees(np.arcsin(p[:, 2] / r))
    lon = np.degrees(np.arctan2(p[:, 1], p[:, 0]))
    return lat, lon, refl, m0 * mu, iof, idx


class MapGrid:
    """Carte équirectangulaire, longitude Est, bord gauche à −180° (`src/core/modelUv.ts`)."""

    def __init__(self, step):
        self.step = step
        self.nx, self.ny = round(360 / step), round(180 / step)
        self.sum = np.zeros(self.nx * self.ny)
        self.w = np.zeros(self.nx * self.ny)

    def add(self, lat, lon, value, weight):
        x = np.clip(((lon + 180) / self.step).astype(np.int64), 0, self.nx - 1)
        y = np.clip(((90 - lat) / self.step).astype(np.int64), 0, self.ny - 1)
        k = y * self.nx + x
        np.add.at(self.sum, k, value * weight)
        np.add.at(self.w, k, weight)

    def mean(self):
        return np.where(self.w > 0, self.sum / np.maximum(self.w, 1e-30), 0).reshape(self.ny, self.nx)


def block_agreement(a, b, block, step):
    """Corrélation de deux cartes par blocs de `block` degrés, là où les deux mesurent, brute puis
    sans la moyenne de chaque bande de latitude (comme pour Ryugu)."""
    n = max(1, round(block / step))
    ny, nx = a.shape
    ya, yb, xa = ny // n, ny // n, nx // n
    def blocks(m):
        v = m[: ya * n, : xa * n].reshape(ya, n, xa, n)
        c = (v > 0).sum((1, 3))
        s = np.where(v > 0, v, 0).sum((1, 3))
        return np.where(c >= n * n // 2, s / np.maximum(c, 1), np.nan)
    A, Bm = blocks(a), blocks(b)
    both = np.isfinite(A) & np.isfinite(Bm)
    if both.sum() < 10:
        return dict(blocks=int(both.sum()), r=float("nan"), r_lat=float("nan"))
    r = float(np.corrcoef(A[both], Bm[both])[0, 1])
    Ad = A - np.nanmean(np.where(both, A, np.nan), axis=1, keepdims=True)
    Bd = Bm - np.nanmean(np.where(both, Bm, np.nan), axis=1, keepdims=True)
    r_lat = float(np.corrcoef(Ad[both], Bd[both])[0, 1])
    return dict(blocks=int(both.sum()), r=r, r_lat=r_lat)


def fill_small_gaps(m, size=5, min_fraction=0.4):
    """Comble une case vide entourée de mesures (le resserrement des méridiens vers les pôles en
    laisse au pas des points) par la moyenne de ses voisines mesurées. Ne s'étend pas au-delà."""
    from scipy.ndimage import uniform_filter

    valid = (m > 0).astype(float)
    s = uniform_filter(np.where(m > 0, m, 0), size)
    c = uniform_filter(valid, size)
    return np.where(m > 0, m, np.where(c > min_fraction, s / np.maximum(c, 1e-9), 0))


def shape_registration(a, b, step, shifts_deg=(1, 2, 3), sigma=3):
    """Les FORMES de deux cartes indépendantes se superposent-elles ? Corrélation de leurs
    laplaciens de gaussienne au décalage nul, contre le maximum aux décalages de 1 à 3°. Pour une
    carte drapée, c'est le recalage qui compte ; l'accord radiométrique dépend de l'ombrage du
    relief non résolu, qui change avec la phase (Lutetia, 2026-10-06)."""
    from scipy.ndimage import gaussian_laplace

    a, b = fill_small_gaps(a), fill_small_gaps(b)
    both = (a > 0) & (b > 0)
    la, lb = gaussian_laplace(a, sigma), gaussian_laplace(b, sigma)

    def r(dy, dx):
        bs = np.roll(np.roll(lb, dy, 0), dx, 1)
        ms = np.roll(np.roll(both, dy, 0), dx, 1) & both
        return float(np.corrcoef(la[ms], bs[ms])[0, 1])

    others = []
    for d in shifts_deg:
        n = round(d / step)
        for dy, dx in ((n, 0), (-n, 0), (0, n), (0, -n), (n, n), (-n, -n), (n, -n), (-n, n)):
            others.append(r(dy, dx))
    return dict(at_zero=r(0, 0), max_shifted=max(others), mean_shifted=float(np.mean(others)), cells=int(both.sum()))


def texture_fill(m, feather_cells):
    """La carte d'une texture : lacunes isolées comblées localement, surface NON VUE au gris moyen
    de ce qui est mesuré, raccordée par un fondu de `feather_cells` cases. Aucun détail inventé."""
    from scipy.ndimage import distance_transform_edt

    m = fill_small_gaps(m)
    measured = m > 0
    mean = float(m[measured].mean())
    d = distance_transform_edt(~measured)
    w = np.clip(1 - d / feather_cells, 0, 1)
    # Prolonge la dernière valeur mesurée sur la bande de fondu, puis glisse vers la moyenne.
    _, (iy, ix) = distance_transform_edt(~measured, return_indices=True)
    edge = m[iy, ix]
    return np.where(measured, m, w * edge + (1 - w) * mean)


def detail_texture(albedo, mosaic, step, sigma_deg=1.5, feather_deg=2.0, clip=(0.6, 1.4)):
    """Texture par TRANSFERT DE DÉTAIL (2026-10-06) : la carte d'albédo à faible phase (plate)
    multipliée par le relief FIN de la photomosaïque, c'est-à-dire la mosaïque divisée par sa
    version floutée sur `sigma_deg`. L'ombrage à grande échelle, celui de l'éclairage du survol,
    part (l'application ombre déjà le modèle) ; les cratères et leurs bords restent. Hors de la
    mosaïque, le détail vaut 1."""
    from scipy.ndimage import gaussian_filter

    m = fill_small_gaps(mosaic)
    valid = m > 0
    sig = sigma_deg / step
    num = gaussian_filter(np.where(valid, m, 0), sig)
    den = gaussian_filter(valid.astype(float), sig)
    large = np.where(den > 0.3, num / np.maximum(den, 1e-9), 0)
    detail = np.where(valid & (large > 0), m / np.maximum(large, 1e-9), 1.0)
    base = texture_fill(albedo, round(feather_deg / step))
    return base * np.clip(detail, *clip)


# ---------------------------------------------------------------- atlas (2026-10-06)
#
# Un corps que la DIRECTION ne décrit pas (67P : 13,5 % de sa surface partage sa direction avec une
# autre) se cartographie dans l'ATLAS de son modèle (`scripts/unwrap-shape-model.mjs`) : chaque point
# de surface a son texel. Les filtres y restent DANS une île de l'atlas : une île voisine dans l'image
# est un autre morceau du corps, et un flou qui la traverserait y mêlerait sa lumière.


class AtlasGrid:
    """Accumulateur dans l'atlas, ligne 0 en HAUT (ligne = (1 − v) × taille)."""

    def __init__(self, size):
        self.nx = self.ny = size
        self.sum = np.zeros(size * size)
        self.w = np.zeros(size * size)

    def cells(self, uv):
        x = np.clip((uv[:, 0] * self.nx).astype(np.int64), 0, self.nx - 1)
        y = np.clip(((1 - uv[:, 1]) * self.ny).astype(np.int64), 0, self.ny - 1)
        return y * self.nx + x

    def add_cells(self, k, value, weight):
        np.add.at(self.sum, k, value * weight)
        np.add.at(self.w, k, weight)

    def mean(self):
        return np.where(self.w > 0, self.sum / np.maximum(self.w, 1e-30), 0).reshape(self.ny, self.nx)


def atlas_charts(mesh, size):
    """Les ÎLES de l'atlas à cette taille : chaque texel dont le centre tombe dans un triangle
    reçoit le numéro de son île (composante connexe), 0 hors de toute île. Rend aussi l'aire de
    surface (km²) que couvre un texel en moyenne."""
    from scipy.ndimage import label

    inside = np.zeros((size, size), bool)
    uv = mesh.uv * [size, size]
    uv[:, 1] = size - uv[:, 1]  # ligne depuis le haut
    for a, b, c in mesh.tri:
        pa, pb, pc = uv[a], uv[b], uv[c]
        x0, x1 = int(np.floor(min(pa[0], pb[0], pc[0]))), int(np.ceil(max(pa[0], pb[0], pc[0])))
        y0, y1 = int(np.floor(min(pa[1], pb[1], pc[1]))), int(np.ceil(max(pa[1], pb[1], pc[1])))
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, size), min(y1, size)
        if x1 <= x0 or y1 <= y0:
            continue
        d = (pb[1] - pc[1]) * (pa[0] - pc[0]) + (pc[0] - pb[0]) * (pa[1] - pc[1])
        if abs(d) < 1e-12:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
        l1 = ((pb[1] - pc[1]) * (xs - pc[0]) + (pc[0] - pb[0]) * (ys - pc[1])) / d
        l2 = ((pc[1] - pa[1]) * (xs - pc[0]) + (pa[0] - pc[0]) * (ys - pc[1])) / d
        hit = (l1 >= -1e-9) & (l2 >= -1e-9) & (1 - l1 - l2 >= -1e-9)
        inside[y0:y1, x0:x1] |= hit
    labels, count = label(inside)
    a, b, c = (mesh.pos[mesh.tri[:, k]] for k in range(3))
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1).sum()
    return labels, count, area / max(int(inside.sum()), 1)


def chart_blur(values, valid, labels, sigma):
    """Moyenne gaussienne NORMALISÉE île par île : `values` là où `valid`, floutées sans jamais
    franchir le bord d'une île. Rend la moyenne (0 là où rien n'est mesuré à portée)."""
    from scipy.ndimage import find_objects, gaussian_filter

    out = np.zeros(values.shape, dtype=float)
    pad = int(np.ceil(3 * sigma))
    for i, box in enumerate(find_objects(labels), start=1):
        if box is None:
            continue
        ys = slice(max(box[0].start - pad, 0), min(box[0].stop + pad, labels.shape[0]))
        xs = slice(max(box[1].start - pad, 0), min(box[1].stop + pad, labels.shape[1]))
        mine = labels[ys, xs] == i
        m = mine & valid[ys, xs]
        if not m.any():
            continue
        num = gaussian_filter(np.where(m, values[ys, xs], 0.0), sigma)
        den = gaussian_filter(m.astype(float), sigma)
        blurred = np.where(den > 0.3, num / np.maximum(den, 1e-12), 0)
        out[ys, xs] = np.where(mine, blurred, out[ys, xs])
    return out


ATLAS_CHART_TOP = 0.98  # = ATLAS_CHART_TOP de src/core/modelUv.ts, croisé par spicePose.test.ts


def atlas_texture(albedo, mosaic, labels, sigma_px, feather_px, clip=(0.6, 1.4)):
    """La texture d'atlas par TRANSFERT DE DÉTAIL, comme `detail_texture`, mais île par île :
    albédo d'approche (lacunes isolées comblées dans leur île) multiplié par le relief fin de la
    photomosaïque (la mosaïque divisée par sa version floutée sur `sigma_px`). Hors mesure, le gris
    moyen mesuré, raccordé par un fondu ; les marges entre îles prennent la valeur du texel d'île
    le plus proche, pour que le filtrage bilinéaire et les mipmaps n'y lisent jamais du noir."""
    from scipy.ndimage import distance_transform_edt

    charts = labels > 0
    measured = (albedo > 0) & charts
    gaps = chart_blur(albedo, measured, labels, 2.0)
    base = np.where(measured, albedo, np.where(charts, gaps, 0))
    known = base > 0
    mean = float(albedo[measured].mean())
    d, (iy, ix) = distance_transform_edt(~known, return_indices=True)
    w = np.clip(1 - d / feather_px, 0, 1)
    base = np.where(known, base, w * base[iy, ix] + (1 - w) * mean)
    valid = (mosaic > 0) & charts
    large = chart_blur(mosaic, valid, labels, sigma_px)
    detail = np.where(valid & (large > 0), mosaic / np.maximum(large, 1e-9), 1.0)
    tex = np.where(charts, base * np.clip(detail, *clip), 0)
    gap, (iy, ix) = distance_transform_edt(~charts, return_indices=True)
    # Les marges prolongent leur île sur 8 texels (le filtrage et les premiers niveaux de mipmap y
    # lisent), puis la moyenne : prolongées jusqu'au bout, elles striaient tout l'atlas.
    mean_tex = float(tex[charts].mean())
    tex = np.where(gap <= 8, tex[iy, ix], mean_tex)
    # La PASTILLE : la bande au-dessus des îles, à la moyenne de la surface, que lit la sphère de
    # repli (`ATLAS_SWATCH_UV`). Le prolongement des îles ci-dessus l'avait remplie de leurs bords.
    tex[: int(np.ceil((1 - ATLAS_CHART_TOP) * tex.shape[0]))] = mean_tex
    return tex
