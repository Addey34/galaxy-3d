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

Every model below is shipped as **levels of detail**, `public/assets/models/{body}/{body}_shape_{1k,2k,4k}.glb`,
all produced from the original scientific product by `scripts/generate-shape-models.mjs`. Its
recipe, `scripts/shape-model-targets.json`, holds each body's source and options and the triangle
budget of each level; each file's own triangle count is in the file. A level is only shipped if the
source holds enough detail for it: Ida has no 4k level. The app loads the lightest level first and
a finer one only when the camera comes close, capped by the graphics quality tier.

**How every level is reduced** (since 2026-10-04): edge collapse with the meshoptimizer library
(MIT licence, a build-time tool, never shipped to the browser), then a check that the result is a
closed surface (every edge shared by exactly two triangles, in opposite directions); the script
refuses to write a level that is not. No geometry is invented: the script prints the shape
statistics before and after. The earlier method, vertex clustering, left holes, folded and flipped
faces on 38 of the 49 shipped levels. Each file's glTF `asset.copyright` carries the model's
credit, as shown in the app's info card.

`public/assets/models/bennu/bennu_shape_{1k,2k,4k}.glb`: asteroid (101955) Bennu.

- **Source**: the OSIRIS-REx SPICE archive at NAIF, a NASA PDS archive
  (`naif.jpl.nasa.gov/pub/naif/pds/pds4/orex/orex_spice/spice_kernels/dsk/`):
  `bennu_g_00880mm_alt_obj_0000n00000_v020.bds`, the OLA v20 global shape model at 88 cm
  (3,145,728 plates). Until 2026-10-04 the same v20 model came from a NASA/Goddard Scientific
  Visualization Studio export (<https://svs.gsfc.nasa.gov/5069>), which that page no longer serves.
- **Data credit**: NASA / University of Arizona / CSA / York University / MDA, from the
  OSIRIS-REx laser altimeter (OLA). Distributed by NASA PDS without restriction.
- **Modification**: read from DSK to OBJ by `scripts/dsk-to-obj.mjs`, pole brought onto +Y,
  decimated. The app drapes Bennu's own texture on it (below), so the model carries no colour.

Every model's volume-equivalent radius is checked against the published mean radius, and its
orientation by `src/config/shapeModels.test.ts`: the maximum-inertia axis within 10° of +Y when the
largest moment clearly dominates, otherwise +Y perpendicular to the body's long axis. Every level
must also have its faces pointing outwards and be a closed surface.

`public/assets/models/eros/eros_shape_{1k,2k,4k}.glb`: asteroid (433) Eros.

- **Source**: NASA PDS Small Bodies Node, `NEAR-A-MSI-5-EROSSHAPE-V1.0` (q = 128).
- **Data credit**: NASA / JHU-APL NEAR Shoemaker, Multi-Spectral Imager; shape model by
  R. Gaskell. Public domain (NASA-funded archive product, no restriction).
- **Modification**: decimated for the web.

`public/assets/models/itokawa/itokawa_shape_{1k,2k,4k}.glb`: asteroid (25143) Itokawa.

- **Source**: NASA PDS Small Bodies Node, `HAY-A-AMICA-5-ITOKAWASHAPE-V1.0` (q = 128).
- **Data credit**: JAXA Hayabusa AMICA images; shape model by R. Gaskell (PSI). Distributed by
  NASA PDS without restriction.
- **Modification**: decimated for the web.

`public/assets/models/ryugu/ryugu_shape_{1k,2k,4k}.glb`: asteroid (162173) Ryugu.

- **Source**: JAXA DARTS, Hayabusa2 SfM shape model `SHAPE_SFM_200k_v20180804`
  (Watanabe et al. 2019, *Science* 364).
- **Data credit**: **ISAS/JAXA**. The ISAS data policy allows use, including commercial use,
  provided the source is credited and **modifications are stated**.
- **Modification (stated as required)**: decimated for the web and re-oriented so that the
  rotation pole lies on +Y.

`public/assets/models/ida/ida_shape_{1k,2k}.glb`: asteroid (243) Ida. No 4k level: the 2° source grid holds ~32,400 triangles of real information, and a 60,000-triangle level would interpolate, not measure.

- **Source**: NASA PDS Small Bodies Node, `EAR-A-5-DDR-SHAPE-MODELS-V2.1`.
- **Data credit**: NASA Galileo Solid-State Imaging; shape model by P. Thomas et al. (1996).
  Public domain.
- **Modification**: converted from a latitude/longitude radius grid to a triangle mesh, then
  decimated for the web.

**Skipped on purpose, not forgotten** (read 2026-10-04; the list lives in
`src/config/shapeModelGaps.ts`): 67P/Churyumov-Gerasimenko's dataset at the ESA Planetary Science
Archive (`RO-C-MULTI-5-67P-SHAPE-V2.0`) states no licence in its readme, catalogue or user guide;
the archive asks only for an acknowledgement in publications, and ESA's website notice excludes
uses other than educational, editorial or informational ones without a specific licence. It is
not imported on an assumed licence. Tempel 1, Wild 2 and Hartley 2 have published models whose
host (`pdssbn.astro.umd.edu/holdings/`) answered HTTP 403 to every request that day, and their
missions' SPICE archives at NAIF predate the DSK format (Didymos, Dimorphos and Arrokoth, on the
same host, were read from NAIF instead, below). (11351) Leucus has two convex DAMIT solutions with different poles
and no calibrated size: importing one would present a choice as a measurement.

### Mission targets (2026-10-04)

Same pipeline. None of these bodies has a surface texture, so each model carries a uniform colour
at its published geometric albedo (`scripts/bake-shape-colour.mjs`, no map).

`public/assets/models/gaspra/gaspra_shape_{1k,2k}.glb`: asteroid (951) Gaspra. No 4k
level: the 2° source grid holds about 32,400 triangles of real information.

- **Source**: NASA PDS Small Bodies Node, `urn:nasa:pds:ast-sat.thomas.shape-models`
  (`951gaspra.tab`).
- **Data credit**: NASA Galileo Solid-State Imaging; shape model by P. Thomas et al. (1994,
  *Icarus* 107, 25). Public domain.
- **Modification**: west longitudes (as the label states) converted to east, the grid meshed and
  decimated, then rotated into its principal axes of inertia, since the published pole lies 11°
  from the axis of greatest inertia. Uniform colour at albedo 0.246 (NEOWISE, JPL SBDB).

`public/assets/models/mathilde/mathilde_shape_{1k,2k}.glb`: asteroid (253) Mathilde, from a
3° grid of about 14,400 triangles.

- **Source**: NASA PDS Small Bodies Node, `urn:nasa:pds:ast-sat.thomas.shape-models`
  (`253mathilde.tab`).
- **Data credit**: NASA/JHU-APL NEAR Multi-Spectral Imager; shape model by P. Thomas et al. (1999,
  *Icarus* 140, 17). Public domain.
- **Modification**: as for Gaspra; its published pole lies 30° from the axis of greatest inertia.
  Uniform colour at albedo 0.0436 (IRAS, JPL SBDB).

`public/assets/models/apophis/apophis_shape_1k.glb`: asteroid (99942) Apophis, the
full model.

- **Source**: NASA PDS Small Bodies Node, `urn:nasa:pds:gbo.ast-apophis.jpl.radar.shape_model`
  (`apophis_v233s7.obj`), the preliminary model B of Brozović et al. (2018, *Icarus* 300, 115).
- **Data credit**: NASA JPL Goldstone and Arecibo Observatory radar. Distributed by NASA PDS
  without restriction.
- **Modification**: pole brought onto +Y, nothing decimated. Uniform colour at albedo 0.35
  (Brozović et al. 2018, JPL SBDB). Apophis tumbles (Pravec et al. 2014); the app turns the model
  about its axis of greatest inertia at a single period.

`public/assets/models/lutetia/lutetia_shape_1k.glb`: asteroid (21) Lutetia, the full
model.

- **Source**: DAMIT, model 282. **Licence: CC BY 4.0**, with the attribution displayed in the
  app's info card.
- **Data credit**: B. Carry et al. (2010), ground-based adaptive optics and light curves,
  calibrated in size.
- **Modification**: pole brought onto +Y, nothing decimated. Uniform colour at albedo 0.19
  (Sierks et al. 2011, JPL SBDB).

`public/assets/models/didymos/didymos_shape_{1k,2k,4k}.glb` and
`public/assets/models/dimorphos/dimorphos_shape_{1k,2k,4k}.glb`: asteroid (65803) Didymos and its
moon Dimorphos.

- **Source**: the DART SPICE archive at NAIF, a NASA PDS archive
  (`naif.jpl.nasa.gov/pub/naif/pds/pds4/dart/dart_spice/spice_kernels/dsk/`):
  `didymos_g_04657mm_spc_0000n00000_v003.bds` and `dimorphos_g_00972mm_spc_0000n00000_v004.bds`,
  the SPC models also archived as `urn:nasa:pds:dart_shapemodel`, whose host refused access.
- **Data credit**: NASA/JHU-APL DART, DRACO images, stereophotoclinometry (SPC) shape models.
  Distributed by NASA PDS without restriction.
- **Modification**: read from DSK type 2 to OBJ by `scripts/dsk-to-obj.mjs`, pole brought onto +Y,
  decimated. Uniform colour at the geometric albedo of the system, 0.15 (Daly et al. 2023,
  *Nature* 616, 443).

`public/assets/models/arrokoth/arrokoth_shape_{1k,2k}.glb`: (486958) Arrokoth, from a
40,960-facet model.

- **Source**: the New Horizons SPICE archive at NAIF, a NASA PDS archive
  (`nh-j_p_ss-spice-6-v1.0`, `mu69_porter_2024_v01.bds`), the model of S. Porter et al. (2024),
  also archived as `urn:nasa:pds:nh_derived:arrokoth_shapemodel_porter2024`.
- **Data credit**: NASA/JHU-APL/SwRI New Horizons LORRI. Distributed by NASA PDS without restriction.
- **Modification**: read from DSK (big-endian) to OBJ by `scripts/dsk-to-obj.mjs`, pole brought onto
  +Y, decimated. Uniform colour at albedo 0.21 (Hofgartner et al. 2021, *Icarus*).

`public/assets/models/donaldjohanson/donaldjohanson_shape_{1k,2k,4k}.glb`: (52246) Donaldjohanson.

- **Source**: the Lucy SPICE archive at NAIF, a NASA PDS archive
  (`lucy_spice/spice_kernels/dsk/lcy_donj_k548_iso20m_v10.bds`), a shape model made by the DLR
  team by stereophotogrammetry and contour fitting.
- **Data credit**: NASA/SwRI Lucy L'LORRI. Distributed by NASA PDS without restriction.
- **Modification**: read from DSK to OBJ by `scripts/dsk-to-obj.mjs`, pole brought onto +Y,
  decimated. Uniform colour at albedo 0.103 (NEOWISE, JPL SBDB).

### Moons, a comet and main-belt asteroids (parity pass, 2026-09-22)

Same pipeline. Where a body already has a real surface texture, the model carries no baked colour:
the app **drapes the body's own texture** on it (`src/core/modelUv.ts`), so the texture credit
below in this file applies unchanged. Longitudes are read as each source label states them: the
Thomas and Stooke satellite models count longitudes **west**, which was checked on Thomas's Phobos
(the Stickney crater falls at 50 for a published 49.7° W) and converted to east before meshing.

`public/assets/models/phobos/phobos_shape_{1k,2k,4k}.glb`: Phobos.

- **Source**: NASA PDS Small Bodies Node, *Gaskell Phobos Shape Model V1.0* (q = 512,
  doi:10.26033/xzv5-bw95).
- **Data credit**: Viking Orbiter 1 and Phobos 2 images; shape model by R. W. Gaskell. Distributed by NASA PDS without restriction.
- **Modification**: decimated for the web. Its deepest local depression lies at the published
  position of the Stickney crater, which a test holds on the shipped file.

`public/assets/models/mimas/mimas_shape_{1k,2k,4k}.glb`: Mimas.

- **Source**: NASA PDS Small Bodies Node, *Gaskell Mimas Shape Model V2.0*
  (`CO-SA-ISSNA-5-MIMASSHAPE-V2.0`, q = 128).
- **Data credit**: Cassini ISS narrow-angle and Voyager 1 images; shape model by R. W. Gaskell.
  Distributed by NASA PDS without restriction.
- **Modification**: decimated for the web, pole turned from Z to Y. Mimas is the least irregular
  body in this list, and it is here on a measurement rather than on a name: its largest extent
  exceeds its smallest by 9.1%, above the 5% below which a textured sphere is both more faithful
  and cheaper.

`public/assets/models/deimos/deimos_shape_1k.glb`: Deimos.

- **Source**: NASA PDS Small Bodies Node, `EAR-A-5-DDR-SHAPE-MODELS-V2.1` (P. C. Thomas).
- **Data credit**: Viking Orbiter images; shape model by P. C. Thomas. Distributed by NASA PDS without restriction.
- **Modification**: 5° latitude/longitude grid converted to a mesh, longitudes turned from west to
  east. One level only: the grid holds no more.

`public/assets/models/amalthea/amalthea_shape_1k.glb` and
`public/assets/models/proteus/proteus_shape_1k.glb`: Amalthea and Proteus.

- **Source**: NASA PDS Small Bodies Node, `EAR-A-5-DDR-STOOKE-SHAPE-MODELS-V2.0` (P. Stooke).
- **Data credit**: Voyager 1 and 2 images (Amalthea), Voyager 2 images (Proteus); shape models by
  P. Stooke. Distributed by NASA PDS without restriction.
- **Modification**: 5° grids converted to meshes, longitudes turned from west to east. Proteus,
  nearly round and without a usable rotation frame in its source, is also rotated into its
  principal axes of inertia.

`public/assets/models/hyperion/hyperion_shape_{1k,2k}.glb`: Hyperion.

- **Source**: NASA PDS, *Saturn Small Moon Shape Models V1.0* (P. Thomas, J. Joseph and T. Ansty,
  2018, doi:10.26033/ewy3-jy61).
- **Data credit**: Cassini ISS images. Distributed by NASA PDS without restriction.
- **Modification**: rotated into its principal axes of inertia (Hyperion rotates chaotically, and
  its file's Z axis is its long axis), then decimated. No 4k level: the source has 29,268 facets.

`public/assets/models/halley/halley_shape_1k.glb`: comet 1P/Halley.

- **Source**: NASA PDS Small Bodies Node, `EAR-A-5-DDR-STOOKE-SHAPE-MODELS-V2.0`.
- **Data credit**: Giotto and Vega images; shape model by P. Stooke, with pointing by A. Abergel,
  as the label asks both to be credited. Its author calls the model extremely uncertain (500 to
  1,000 m). Distributed by NASA PDS without restriction.
- **Modification**: 5° grid converted to a mesh and rotated into its principal axes of inertia
  (the model's "north" runs along the long axis).

`public/assets/models/vesta/vesta_shape_{1k,2k,4k}.glb`: asteroid (4) Vesta.

- **Source**: NASA PDS, `DAWN-A-FC2-5-VESTADTMSPG-V1.0` (Preusker, Scholten, Matz, Roatsch,
  Jaumann, Raymond and Russell, DLR, 2016).
- **Data credit**: Dawn Framing Camera. Distributed by NASA PDS without restriction.
- **Modification**: the global 64 pixel-per-degree terrain model resampled to a 0.5° grid, then
  meshed and decimated. Same Claudia double-prime longitude system as the USGS mosaic the shipped
  texture comes from.

`public/assets/models/pallas/pallas_shape_1k.glb`, `public/assets/models/hygiea/hygiea_shape_1k.glb`
and `public/assets/models/psyche/psyche_shape_1k.glb`: asteroids
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

- Eros: NASA/USGS *Eros NEAR MSI Global Albedo Mosaics* at 760, 550 and 450 nm (Golish et al.
  2023, doi:10.17189/sv8w-5125), public domain; albedo 0.25 (Veverka et al. 2000).
- Ryugu: ISAS/JAXA v-band normal albedo map from Hayabusa2 ONC (JAXA DARTS); **modification
  stated as required**: resampled per vertex. Albedo 0.045 (Sugita et al. 2019).
- For both, since 2026-10-04: the colours first sampled from those maps are carried over onto the
  new vertices, each averaged over the area one vertex covers, because the maps could not be read
  again that day (the host serving the Eros mosaics refused access). Nothing is added: these are
  the same measured colours, with the per-vertex noise of point sampling averaged out.
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
