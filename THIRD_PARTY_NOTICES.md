# Third-party notices

The application source code is distributed under the PolyForm Noncommercial License 1.0.0;
see [`LICENSE.md`](LICENSE.md). The following components are not relicensed by that file.

## Planet textures and social imagery

The visual assets under `public/assets/textures/` are third-party or derived assets and must
retain their original attribution and usage terms. They fall into three groups; the machine-readable
provenance (source URL, resolution, licence) is in [`scripts/texture-sources.json`](scripts/texture-sources.json).

1. **Public domain — USGS Astrogeology / NASA-JPL / ESA spacecraft mosaics.** Derived from
   official global mosaics, no copyright restriction. Bodies: `io`, `europa`, `ganymede`,
   `callisto`, `titan`, `enceladus`, `rhea`, `iapetus`, `triton`, `charon`, `phobos`, `deimos`,
   `vesta`, `pluto`, `tethys`, `dione` (USGS Astrogeology Cassini/Voyager global mosaics, 293m
   and 154m/pixel respectively), `earth` (Blue Marble / Black Marble, NASA Earth Observatory /
   Visible Earth — all layers). Attribution is courteous but not legally required.

2. **CC BY 4.0 — Solar System Scope.** Requires attribution; compatible with non-commercial and
   donation-supported use. Bodies (surface / cloud / normal / spec / lights / ring layers, incl.
   8k variants): `mercury`, `venus`, `mars`, `moon`, `jupiter`, `saturn`, `uranus`, `neptune`,
   `sun`, `stars`. Keep the "Solar System Scope (CC BY 4.0)" credit in the app. **Note: `earth` is
   NASA public domain (group 1 above), not Solar System Scope** — despite otherwise sharing this
   provider with the rest of the planet set. `saturn/saturn_ring_8k.jpg` was regenerated on
   2026-09-16 from the same Solar System Scope file (`8k_saturn_ring_alpha.png`): the previous
   export had leaked white pixels from under the transparent inner edge.

3. **Confirmed licence, explicitly illustrative.** The licence and source are known and recorded,
   but the map itself is not a validated scientific global mosaic (either no spacecraft imaged the
   body, or — for `halley` — flyby images were never assembled into one): `ceres`, `eris`,
   `haumea`, `makemake` (CC BY 4.0, Solar System Scope — illustrative per `texture-sources.json`),
   `halley` (public domain, Philip Stooke / NASA PDS Giotto/Vega — credit required per its entry).
   The app's own credits list (`index.html`) already discloses these as illustrative, not
   scientific maps. No action required beyond keeping that disclosure current.

4. **Generated — original, no third-party rights.** Procedurally generated textures
   (`scripts/generate-procedural-textures.mjs` — seeded fractal noise, synthetic craters/basins/
   ice-patches parameterized from each body's real published data, no external image involved)
   for bodies that have never been imaged well enough for a global mosaic to exist: `orcus`,
   `quaoar`, `gonggong`, `sedna` (never visited by any spacecraft, not covered by Solar System
   Scope's illustrative set), `mimas`, `hyperion`, `miranda`, `ariel`, `umbriel`, `titania`,
   `oberon`, `amalthea`, `proteus`, `nereid`, `styx`, `nix`, `kerberos`, `hydra` (imaged by
   Voyager 2 / Galileo / New Horizons, but only partially or at too low a resolution for a
   controlled global mosaic — see each body's entry in `texture-sources.json` for the specific
   coverage limit), plus `pallas` and `hygiea` (2026-08-27: replaced their previous asset, whose
   community-sourced licence was unconfirmed and likely CC BY-NC-SA — incompatible with
   commercial use — with this generated one). Fully covered by this project's own `LICENSE.md`;
   no attribution, no third-party licence, and no commercial restriction beyond the project's own
   license terms.

The social preview image is a project asset and should be replaced only with material whose
redistribution rights are known.

Before adding or replacing an asset, record its source, license and attribution in
`texture-sources.json` (and here if it introduces a new licence class). Do not assume that the
PolyForm license covers images, textures or fonts.

## 3D shape models

`public/assets/models/bennu/bennu.glb` — asteroid (101955) Bennu.

- **Source**: NASA/Goddard Scientific Visualization Studio, *Global Bennu 3D Model — OLA v20 PTM*
  (<https://svs.gsfc.nasa.gov/5069>).
- **Data credit**: NASA / University of Arizona / CSA / York University / MDA, from the
  OSIRIS-REx laser altimeter (OLA). Public domain, as NASA-produced work.
- **Modification**: reduced from 3,366,134 to 22,811 triangles by vertex clustering with
  `scripts/decimate-shape-model.mjs`, so it can be served on the web (60.6 MB → 400 KiB). No
  geometry was invented: the script reports the shape statistics before and after, and the two
  that characterise the body are unchanged (radius standard deviation 6.00 % → 6.03 %, equator
  to pole ratio 1.118 → 1.119). The credit above is also embedded in the file's glTF `asset.copyright`.
  The file was later re-exported with its pole on +Y instead of Z (the scene spins bodies about
  their local Y axis); geometry and triangle count are unchanged.

The four wave-A models below follow the same pipeline: decimated by
`scripts/decimate-shape-model.mjs` (deterministic vertex clustering, no geometry invented), pole
brought onto +Y where the source carried it on Z, and the credit embedded in each file's glTF
`asset.copyright`. Each file's volume-equivalent radius is checked against the published mean
radius, and its maximum-inertia axis against +Y, by `src/config/shapeModels.test.ts`.

`public/assets/models/eros/eros.glb` — asteroid (433) Eros. 29,135 triangles, 512 KiB.

- **Source**: NASA PDS Small Bodies Node, `NEAR-A-MSI-5-EROSSHAPE-V1.0` (q = 128).
- **Data credit**: NASA / JHU-APL NEAR Shoemaker, Multi-Spectral Imager; shape model by
  R. Gaskell. Public domain (NASA-funded archive product, no restriction).
- **Modification**: decimated for the web.

`public/assets/models/itokawa/itokawa.glb` — asteroid (25143) Itokawa. 29,568 triangles, 520 KiB.

- **Source**: NASA PDS Small Bodies Node, `HAY-A-AMICA-5-ITOKAWASHAPE-V1.0` (q = 128).
- **Data credit**: JAXA Hayabusa AMICA images; shape model by R. Gaskell (PSI). Distributed by
  NASA PDS without restriction.
- **Modification**: decimated for the web.

`public/assets/models/ryugu/ryugu.glb` — asteroid (162173) Ryugu. 26,503 triangles, 467 KiB.

- **Source**: JAXA DARTS, Hayabusa2 SfM shape model `SHAPE_SFM_200k_v20180804`
  (Watanabe et al. 2019, *Science* 364).
- **Data credit**: **ISAS/JAXA**. The ISAS data policy allows use, including commercial use,
  provided the source is credited and **modifications are stated**.
- **Modification (stated as required)**: decimated for the web and re-oriented so that the
  rotation pole lies on +Y.

`public/assets/models/ida/ida.glb` — asteroid (243) Ida. 27,197 triangles, 479 KiB.

- **Source**: NASA PDS Small Bodies Node, `EAR-A-5-DDR-SHAPE-MODELS-V2.1`.
- **Data credit**: NASA Galileo Solid-State Imaging; shape model by P. Thomas et al. (1996).
  Public domain.
- **Modification**: converted from a latitude/longitude radius grid to a triangle mesh, then
  decimated for the web.

**Skipped on purpose, not forgotten**: (99942) Apophis has no published measured shape model;
67P/Churyumov-Gerasimenko's archived models carry a non-commercial licence whose compatibility
with the site's donation link is being asked to ESA before any use.

A mesh may not enter this repository without a source and a credit — `ModelConfig.credit` is
required by the type, and a test rejects an empty or unattributed one. Note that "NASA-published"
is not by itself a guarantee of scientific content: the only small-body mesh in the
`nasa/NASA-3D-Resources` repository is a decorative sphere, not a shape model. Measure before
trusting a file (see `docs/UNIVERSE_CATALOG.md` § "Corps irreguliers").

## Ephemerides and external data

The binary ephemerides under `public/assets/ephemerides/` are generated from NASA/JPL Horizons.
The source metadata and generation range are recorded in `manifest.json`; regenerated files must
preserve that provenance.

The optional small-body lookup uses the public JPL Small-Body Database API at runtime. It is an
external service and is not bundled as application data.

Orbital elements in `src/config/smallBodies.ts` and `src/config/interstellar.ts` (including
1I/ʻOumuamua, 2I/Borisov and 3I/ATLAS) are derived from the live NASA/JPL Horizons API at a
stated epoch by the scripts in `scripts/`; they are data values, not copied from a third-party
compilation.

**Reference photographs used for calibration only, not redistributed**: the copper tint of the
Earth's shadow during a lunar eclipse was measured on NASA/Michael DeMocker's photograph of the
total lunar eclipse of 3 March 2026 and on ISS image ISS073-E-611649 (7 September 2025). Only
derived numbers (colour ratios) enter the code; no image is shipped.

## JavaScript dependencies

Dependencies listed in `package.json` and resolved by `pnpm-lock.yaml` retain their own licenses.
Their licenses are not replaced by the project license. Review dependency notices before creating a
redistribution bundle.
