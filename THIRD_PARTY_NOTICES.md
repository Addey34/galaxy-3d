# Third-party notices

The application source code is distributed under the PolyForm Noncommercial License 1.0.0;
see [`LICENSE.md`](LICENSE.md). The following components are not relicensed by that file.

## Planet textures and social imagery

The visual assets under `public/assets/textures/` are third-party or derived assets and must
retain their original attribution and usage terms. They fall into three groups; the machine-readable
provenance (source URL, resolution, licence) is in [`scripts/texture-sources.json`](scripts/texture-sources.json).

1. **Public domain — USGS Astrogeology / NASA-JPL spacecraft mosaics.** Derived from official
   global mosaics, no copyright restriction. Bodies: `io`, `europa`, `ganymede`, `callisto`,
   `titan`, `enceladus`, `rhea`, `iapetus`, `triton`, `charon`, `phobos`, `deimos`. Attribution is
   courteous but not legally required.

2. **CC BY 4.0 — Solar System Scope.** Requires attribution; compatible with non-commercial and
   donation-supported use. Bodies (surface / cloud / normal / spec / lights / ring layers, incl.
   8k variants): `mercury`, `venus`, `earth`, `mars`, `moon`, `jupiter`, `saturn`, `uranus`,
   `neptune`, `sun`, `stars`. Keep the "Solar System Scope (CC BY 4.0)" credit in the app.

3. **Illustrative / provenance to confirm.** No validated global spacecraft map exists for these
   bodies, so their textures are artistic/semi-fictional (some sourced from community maps such as
   planet-texture-map.fandom.com under **CC BY-NC-SA**, which forbids commercial use and requires
   author attribution + share-alike). Bodies: `eris`, `haumea`, `makemake`, `pallas`, `hygiea`,
   `vesta`, `ceres`, `pluto`, `halley`. **Action required:** record the exact author + licence of
   each in `texture-sources.json`, or replace with a public-domain / CC BY asset before any
   commercial reuse. Current non-commercial, donation-supported use is compatible with CC BY-NC-SA
   provided each author is credited.

The social preview image is a project asset and should be replaced only with material whose
redistribution rights are known.

Before adding or replacing an asset, record its source, license and attribution in
`texture-sources.json` (and here if it introduces a new licence class). Do not assume that the
PolyForm license covers images, textures or fonts.

## Ephemerides and external data

The binary ephemerides under `public/assets/ephemerides/` are generated from NASA/JPL Horizons.
The source metadata and generation range are recorded in `manifest.json`; regenerated files must
preserve that provenance.

The optional small-body lookup uses the public JPL Small-Body Database API at runtime. It is an
external service and is not bundled as application data.

## JavaScript dependencies

Dependencies listed in `package.json` and resolved by `pnpm-lock.yaml` retain their own licenses.
Their licenses are not replaced by the project license. Review dependency notices before creating a
redistribution bundle.
