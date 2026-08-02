# Third-party notices

The application source code is distributed under the PolyForm Noncommercial License 1.0.0;
see [`LICENSE.md`](LICENSE.md). The following components are not relicensed by that file.

## Planet textures and social imagery

The visual assets under `public/assets/` are third-party or derived assets and must retain their
original attribution and usage terms:

- Planetary textures credited in the application: Solar System Scope (CC BY 4.0) and NASA imagery.
- The social preview image is a project asset and should be replaced only with material whose
  redistribution rights are known.

Before adding or replacing an asset, record its source, license and attribution here or beside the
asset. Do not assume that the PolyForm license covers images, textures or fonts.

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
