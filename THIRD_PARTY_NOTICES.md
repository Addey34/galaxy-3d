# Third-party notices

The application source code is distributed under the PolyForm Noncommercial License 1.0.0;
see [`LICENSE.md`](LICENSE.md). The following components are not relicensed by that file.

## Planet textures and social imagery

The visual assets under `public/assets/textures/` are third-party or derived assets and must
retain their original attribution and usage terms. They fall into four groups; the machine-readable
provenance (source URL, resolution, licence) is in one file per texture layer under
[`src/registry/products/textures/`](src/registry/products/textures/).

1. **Public domain: USGS Astrogeology / NASA-JPL / ESA spacecraft mosaics, NASA and NOAA Earth data.** Derived from
   official global mosaics, no copyright restriction. Bodies: `io`, `europa`, `ganymede`,
   `callisto`, `titan`, `enceladus`, `rhea`, `iapetus`, `triton`, `charon`, `phobos`, `deimos`,
   `vesta`, `pluto`, `tethys`, `dione`, `ceres`, `bennu` (USGS Astrogeology Cassini/Voyager global mosaics, 293m
   and 154m/pixel respectively; `deimos` is NASA's Viking-derived map from NASA 3D Resources),
   `earth` (surface, clouds, night lights and land/ocean mask from NASA Earth Observatory /
   Visible Earth Blue Marble and Black Marble; relief normal and height maps derived from the
   NOAA NCEI ETOPO 2022 global relief model). `ceres` joined this group in lot 16, leaving the
   illustrative group below: it carried a procedural surface although the published Dawn
   Framing Camera mosaic exists. `bennu` had no surface texture at all before lot 16 and now
   carries the OSIRIS-REx OCAMS global mosaic (Golish et al. 2021), draped on its OLA shape
   model. Attribution is courteous but not legally required.

2. **CC BY 4.0: Solar System Scope.** Requires attribution; compatible with non-commercial and
   donation-supported use. Bodies (surface / cloud / normal / spec / lights / ring layers, incl.
   8k variants): `mercury`, `venus`, `mars`, `moon`, `jupiter`, `saturn`, `uranus`, `neptune`,
   `sun`, `stars`. Keep the "Solar System Scope (CC BY 4.0)" credit in the app. **Note: `earth` is
   NASA and NOAA public domain (group 1 above), not Solar System Scope**, despite otherwise sharing this
   provider with the rest of the planet set. `saturn/saturn_ring_8k.jpg` was regenerated on
   2026-09-16 from the same Solar System Scope file (`8k_saturn_ring_alpha.png`): the previous
   export had leaked white pixels from under the transparent inner edge.

3. **Confirmed licence, explicitly illustrative.** The licence and source are known and recorded,
   but the map itself is not a validated scientific global mosaic (either no spacecraft imaged the
   body, or, for `halley`, flyby images were never assembled into one): `eris`,
   `haumea`, `makemake` (CC BY 4.0, Solar System Scope, illustrative per their provenance files),
   `halley` (public domain, Philip Stooke / NASA PDS Giotto/Vega, credited).
   The app's own credits list (`index.html`) already discloses these as illustrative, not
   scientific maps. No action required beyond keeping that disclosure current.

4. **Generated: original, no third-party rights.** Procedurally generated textures
   (`scripts/generate-procedural-textures.mjs`: seeded fractal noise, synthetic craters/basins/
   ice-patches parameterized from each body's real published data, no external image involved)
   for bodies that have never been imaged well enough for a global mosaic to exist: `orcus`,
   `quaoar`, `gonggong`, `sedna` (never visited by any spacecraft, not covered by Solar System
   Scope's illustrative set), `mimas`, `hyperion`, `miranda`, `ariel`, `umbriel`, `titania`,
   `oberon`, `amalthea`, `proteus`, `nereid`, `styx`, `nix`, `kerberos`, `hydra` (imaged by
   Voyager 2 / Galileo / New Horizons, but only partially or at too low a resolution for a
   controlled global mosaic; see each body's provenance file for the specific
   coverage limit), plus `pallas` and `hygiea` (2026-08-27: replaced their previous asset, whose
   community-sourced licence was unconfirmed and likely CC BY-NC-SA, incompatible with
   commercial use, with this generated one). Fully covered by this project's own `LICENSE.md`;
   no attribution, no third-party licence, and no commercial restriction beyond the project's own
   license terms.

The social preview image is a project asset and should be replaced only with material whose
redistribution rights are known.

Before adding or replacing an asset, record its source, license and attribution in
its file under `src/registry/products/textures/` (and here if it introduces a new licence class). Do not assume that the
PolyForm license covers images, textures or fonts.

## 3D shape models

Every model below is shipped as **levels of detail**, `public/assets/models/{body}/{body}_shape_{1k,2k,4k}.glb`
(budgets of ~4,000 / ~15,000 / ~60,000 triangles, produced from the original scientific product by
`scripts/decimate-shape-model.mjs --target`). A level is only shipped if the source holds enough
detail for it: Ida has no 4k level. The app loads the lightest level first and a finer one only
when the camera comes close, capped by the graphics quality tier.

`public/assets/models/bennu/bennu_shape_{1k,2k,4k}.glb`: asteroid (101955) Bennu. 4,113 / 15,633 /
62,833 triangles (73 KiB / 274 KiB / 1.1 MiB).

- **Source**: NASA/Goddard Scientific Visualization Studio, *Global Bennu 3D Model, OLA v20 PTM*
  (<https://svs.gsfc.nasa.gov/5069>).
- **Data credit**: NASA / University of Arizona / CSA / York University / MDA, from the
  OSIRIS-REx laser altimeter (OLA). Public domain, as NASA-produced work.
- **Modification**: reduced from 3,366,134 triangles by vertex clustering with
  `scripts/decimate-shape-model.mjs`, so it can be served on the web (60.6 MB source). No
  geometry was invented: the script reports the shape statistics before and after, and the two
  that characterise the body are unchanged (radius standard deviation 6.00 % → 6.03 %, equator
  to pole ratio 1.118 → 1.119). The credit above is also embedded in the file's glTF `asset.copyright`.
  The file was later re-exported with its pole on +Y instead of Z (the scene spins bodies about
  their local Y axis); geometry and triangle count are unchanged.

The four wave-A models below follow the same pipeline: decimated by
`scripts/decimate-shape-model.mjs` (deterministic vertex clustering, no geometry invented), pole
brought onto +Y where the source carried it on Z, and the credit embedded in each file's glTF
`asset.copyright`. Each file's volume-equivalent radius is checked against the published mean
radius, and its orientation by `src/config/shapeModels.test.ts`: the maximum-inertia axis
within 10° of +Y when the largest moment clearly dominates, otherwise +Y perpendicular to the
body's long axis. Every level must also have its faces pointing outwards.

`public/assets/models/eros/eros_shape_{1k,2k,4k}.glb`: asteroid (433) Eros. 3,751 / 15,499 / 61,652 triangles.

- **Source**: NASA PDS Small Bodies Node, `NEAR-A-MSI-5-EROSSHAPE-V1.0` (q = 128).
- **Data credit**: NASA / JHU-APL NEAR Shoemaker, Multi-Spectral Imager; shape model by
  R. Gaskell. Public domain (NASA-funded archive product, no restriction).
- **Modification**: decimated for the web.

`public/assets/models/itokawa/itokawa_shape_{1k,2k,4k}.glb`: asteroid (25143) Itokawa. 3,918 / 15,114 / 62,781 triangles.

- **Source**: NASA PDS Small Bodies Node, `HAY-A-AMICA-5-ITOKAWASHAPE-V1.0` (q = 128).
- **Data credit**: JAXA Hayabusa AMICA images; shape model by R. Gaskell (PSI). Distributed by
  NASA PDS without restriction.
- **Modification**: decimated for the web.

`public/assets/models/ryugu/ryugu_shape_{1k,2k,4k}.glb`: asteroid (162173) Ryugu. 4,196 / 15,368 / 62,727 triangles.

- **Source**: JAXA DARTS, Hayabusa2 SfM shape model `SHAPE_SFM_200k_v20180804`
  (Watanabe et al. 2019, *Science* 364).
- **Data credit**: **ISAS/JAXA**. The ISAS data policy allows use, including commercial use,
  provided the source is credited and **modifications are stated**.
- **Modification (stated as required)**: decimated for the web and re-oriented so that the
  rotation pole lies on +Y.

`public/assets/models/ida/ida_shape_{1k,2k}.glb`: asteroid (243) Ida. 4,115 / 15,744 triangles. No 4k level: the 2° source grid holds ~32,400 triangles of real information, and a 60,000-triangle level would interpolate, not measure.

- **Source**: NASA PDS Small Bodies Node, `EAR-A-5-DDR-SHAPE-MODELS-V2.1`.
- **Data credit**: NASA Galileo Solid-State Imaging; shape model by P. Thomas et al. (1996).
  Public domain.
- **Modification**: converted from a latitude/longitude radius grid to a triangle mesh, then
  decimated for the web.

**Skipped on purpose, not forgotten**: (99942) Apophis has no published measured shape model;
67P/Churyumov-Gerasimenko is not in the catalogue, and its archived models carry a
non-commercial licence.

### Moons, a comet and main-belt asteroids (parity pass, 2026-09-22)

Same pipeline. Where a body already has a real surface texture, the model carries no baked colour:
the app **drapes the body's own texture** on it (`src/core/modelUv.ts`), so the texture credit
below in this file applies unchanged. Longitudes are read as each source label states them: the
Thomas and Stooke satellite models count longitudes **west**, which was checked on Thomas's Phobos
(the Stickney crater falls at 50 for a published 49.7° W) and converted to east before meshing.

`public/assets/models/phobos/phobos_shape_{1k,2k,4k}.glb`: Phobos. 3,934 / 15,029 / 62,078 triangles.

- **Source**: NASA PDS Small Bodies Node, *Gaskell Phobos Shape Model V1.0* (q = 512,
  doi:10.26033/xzv5-bw95).
- **Data credit**: Viking Orbiter 1 and Phobos 2 images; shape model by R. W. Gaskell. Distributed by NASA PDS without restriction.
- **Modification**: decimated for the web. Its deepest local depression lies at the published
  position of the Stickney crater, which a test holds on the shipped file.

`public/assets/models/deimos/deimos_shape_1k.glb`: Deimos. 4,188 triangles.

- **Source**: NASA PDS Small Bodies Node, `EAR-A-5-DDR-SHAPE-MODELS-V2.1` (P. C. Thomas).
- **Data credit**: Viking Orbiter images; shape model by P. C. Thomas. Distributed by NASA PDS without restriction.
- **Modification**: 5° latitude/longitude grid converted to a mesh, longitudes turned from west to
  east. One level only: the grid holds no more.

`public/assets/models/amalthea/amalthea_shape_1k.glb` (4,196 triangles) and
`public/assets/models/proteus/proteus_shape_1k.glb` (4,128 triangles): Amalthea and Proteus.

- **Source**: NASA PDS Small Bodies Node, `EAR-A-5-DDR-STOOKE-SHAPE-MODELS-V2.0` (P. Stooke).
- **Data credit**: Voyager 1 and 2 images (Amalthea), Voyager 2 images (Proteus); shape models by
  P. Stooke. Distributed by NASA PDS without restriction.
- **Modification**: 5° grids converted to meshes, longitudes turned from west to east. Proteus,
  nearly round and without a usable rotation frame in its source, is also rotated into its
  principal axes of inertia.

`public/assets/models/hyperion/hyperion_shape_{1k,2k}.glb`: Hyperion. 3,992 / 15,503 triangles.

- **Source**: NASA PDS, *Saturn Small Moon Shape Models V1.0* (P. Thomas, J. Joseph and T. Ansty,
  2018, doi:10.26033/ewy3-jy61).
- **Data credit**: Cassini ISS images. Distributed by NASA PDS without restriction.
- **Modification**: rotated into its principal axes of inertia (Hyperion rotates chaotically, and
  its file's Z axis is its long axis), then decimated. No 4k level: the source has 29,268 facets.

`public/assets/models/halley/halley_shape_1k.glb`: comet 1P/Halley. 4,196 triangles.

- **Source**: NASA PDS Small Bodies Node, `EAR-A-5-DDR-STOOKE-SHAPE-MODELS-V2.0`.
- **Data credit**: Giotto and Vega images; shape model by P. Stooke, with pointing by A. Abergel,
  as the label asks both to be credited. Its author calls the model extremely uncertain (500 to
  1,000 m). Distributed by NASA PDS without restriction.
- **Modification**: 5° grid converted to a mesh and rotated into its principal axes of inertia
  (the model's "north" runs along the long axis).

`public/assets/models/vesta/vesta_shape_{1k,2k,4k}.glb`: asteroid (4) Vesta. 3,945 / 15,588 / 62,456 triangles.

- **Source**: NASA PDS, `DAWN-A-FC2-5-VESTADTMSPG-V1.0` (Preusker, Scholten, Matz, Roatsch,
  Jaumann, Raymond and Russell, DLR, 2016).
- **Data credit**: Dawn Framing Camera. Distributed by NASA PDS without restriction.
- **Modification**: the global 64 pixel-per-degree terrain model resampled to a 0.5° grid, then
  meshed and decimated. Same Claudia double-prime longitude system as the USGS mosaic the shipped
  texture comes from.

`public/assets/models/pallas/pallas_shape_1k.glb` (3,200 triangles), `public/assets/models/hygiea/hygiea_shape_1k.glb`
(3,200 triangles) and `public/assets/models/psyche/psyche_shape_1k.glb` (1,352 triangles): asteroids
(2) Pallas, (10) Hygiea and (16) Psyche.

- **Source**: DAMIT, Database of Asteroid Models from Inversion Techniques (Charles University,
  Prague), models 4395, 4392 and 1806. **Licence: CC BY 4.0**, with the attribution displayed in
  the app's info card.
- **Data credit**: Pallas, Marsset et al. 2020, *Nature Astronomy* 4, 569 (ESO VLT/SPHERE);
  Hygiea, Vernazza et al. 2020, *Nature Astronomy* 4, 136 (ESO VLT/SPHERE); Psyche,
  Viikinkoski et al. 2018, *A&A* 619, L3.
- **Modification**: converted to glTF at their full resolution, with the pole brought onto +Y;
  nothing decimated, since each holds fewer triangles than the lightest level's budget. Psyche,
  which has no texture, carries a uniform colour at its published albedo, 0.1203 (IRAS, JPL SBDB).

**Surface colour baked into the models** (`scripts/bake-shape-colour.mjs`, per-vertex colour, no
texture shipped). Mean brightness = the published geometric albedo converted to the app's display
convention measured on the Moon texture; contrasts and colour ratios come from mission maps:

- Bennu: NASA/USGS *Bennu OSIRIS-REx OCAMS Global Albedo Mosaic* (Golish et al. 2021), public
  domain; albedo 0.044 (Hergenrother et al. 2019).
- Eros: NASA/USGS *Eros NEAR MSI Global Albedo Mosaics* at 760, 550 and 450 nm (Golish et al.
  2023, doi:10.17189/sv8w-5125), public domain; albedo 0.25 (Veverka et al. 2000).
- Ryugu: ISAS/JAXA v-band normal albedo map from Hayabusa2 ONC (JAXA DARTS); **modification
  stated as required**: resampled per vertex. Albedo 0.045 (Sugita et al. 2019).
- Itokawa (albedo 0.27, Hayabusa AMICA), Ida (albedo 0.262, NEOWISE) and Psyche (albedo 0.1203,
  IRAS): no global map is published, so the colour is uniform at the published albedo; nothing is
  painted in. Bodies that have a real surface texture carry no baked colour: the app drapes the
  texture on the model instead.

The source maps (hundreds of MB each) are not redistributed; only the sampled colours are.

A mesh may not enter this repository without a source and a credit: `ModelConfig.credit` is
required by the type, and a test rejects an empty or unattributed one. Note that "NASA-published"
is not by itself a guarantee of scientific content: the only small-body mesh in the
`nasa/NASA-3D-Resources` repository is a decorative sphere, not a shape model. Measure before
trusting a file (see `docs/UNIVERSE_CATALOG.md` § "Corps irreguliers").

## Ephemerides and external data

The binary ephemerides under `public/assets/ephemerides/` are generated from NASA/JPL Horizons.
The source metadata and generation range are recorded in `manifest.json`; regenerated files must
preserve that provenance.

The optional small-body layer reads `public/assets/small-bodies/dataset.json`, a dated snapshot
of four category queries to the public JPL Small-Body Database, taken at build time by
`scripts/generate-small-body-dataset.mjs`. It IS bundled as application data, and the layer
names its source and the date of the snapshot. The application makes no request to that service
at runtime: it answers a browser without the cross-origin header a browser needs to accept the
reply, so the layer was empty in production for as long as it queried the service directly.

**Earth weather layers** are fetched at runtime and are not bundled either:

- NASA GIBS (EOSDIS): VIIRS and MODIS cloud imagery, IMERG precipitation, MERRA-2 surface air
  temperature. NASA EOSDIS data carry no restriction on use; NASA is acknowledged as the source.
- Open-Meteo (<https://open-meteo.com/>): model weather data licensed under CC BY 4.0
  (<https://creativecommons.org/licenses/by/4.0/>). The values are resampled into map textures.
  The free API is used under Open-Meteo's non-commercial terms. The attribution is shown in the
  weather panel and in the app's credits.
- ERA5 through the Open-Meteo Historical Weather API: Hersbach, H. et al. (2023), *ERA5 hourly
  data on single levels from 1940 to present*, ECMWF, doi:10.24381/cds.adbb2d47. Generated using
  Copernicus Climate Change Service information.

Orbital elements in the entity registry (`src/registry/entities/`) and interstellar registry (`src/registry/interstellar/`) (including
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
