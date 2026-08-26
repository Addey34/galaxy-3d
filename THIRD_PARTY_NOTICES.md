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
   `vesta`, `pluto`, `earth` (Blue Marble / Black Marble, NASA Earth Observatory / Visible Earth —
   all layers). Attribution is courteous but not legally required.

2. **CC BY 4.0 — Solar System Scope.** Requires attribution; compatible with non-commercial and
   donation-supported use. Bodies (surface / cloud / normal / spec / lights / ring layers, incl.
   8k variants): `mercury`, `venus`, `mars`, `moon`, `jupiter`, `saturn`, `uranus`, `neptune`,
   `sun`, `stars`. Keep the "Solar System Scope (CC BY 4.0)" credit in the app. **Note: `earth` is
   NASA public domain (group 1 above), not Solar System Scope** — despite otherwise sharing this
   provider with the rest of the planet set.

3. **Confirmed licence, explicitly illustrative.** The licence and source are known and recorded,
   but the map itself is not a validated scientific global mosaic (either no spacecraft imaged the
   body, or — for `halley` — flyby images were never assembled into one): `ceres`, `eris`,
   `haumea`, `makemake` (CC BY 4.0, Solar System Scope — illustrative per `texture-sources.json`),
   `halley` (public domain, Philip Stooke / NASA PDS Giotto/Vega — credit required per its entry).
   The app's own credits list (`index.html`) already discloses these as illustrative, not
   scientific maps. No action required beyond keeping that disclosure current.

4. **Unconfirmed licence — action required.** No validated global spacecraft map exists and the
   asset's author/licence has not been confirmed (community sources such as
   planet-texture-map.fandom.com are typically **CC BY-NC-SA**, which forbids commercial use and
   requires author attribution + share-alike). Bodies: `pallas`, `hygiea` — both marked
   `"tier": "full-only"` in `texture-sources.json` specifically because of this, i.e. excluded from
   any future monetized/free tier until resolved. Record the exact author + licence, or replace
   with a public-domain / CC BY asset, before any commercial reuse.

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
