# Code map and maintenance guide

This document is the index for the remaining source files. It explains ownership,
data flow, CSS boundaries, generated assets, and the security assumptions that must
remain true when the project evolves.

## Composition and runtime flow

`index.html` owns the static DOM shell and loads `src/MainSolarSystemApp.ts`.
`MainSolarSystemApp` is the only composition root that may wire DOM modules. It
creates the headless `SolarSystemApp`, then connects navigation, playback, mode
switching, overlays, i18n, guided tour and fullscreen controls.

`SolarSystemApp` has no DOM dependency. Its `init` method creates the core services
and Three.js systems in dependency order, while `dispose` releases them in reverse
ownership order. New browser UI must be added to the composition root or a dedicated
`src/ui` module, never to a core or Three.js service.

## Source directories

| Directory                  | Responsibility                                               | Allowed dependencies                  |
| -------------------------- | ------------------------------------------------------------ | ------------------------------------- |
| `src/config`               | Catalogues and engine settings                               | Pure data and shared types            |
| `src/core`                 | Clocks, frames, scales, ephemerides and orbital math         | Three.js only at the service boundary |
| `src/components/systems`   | Renderer, camera, textures, lighting and animation ownership | Three.js and config                   |
| `src/components/celestial` | Mesh/layer construction and disposal                         | Three.js, config and texture system   |
| `src/ui`                   | DOM controls and projected overlays                          | DOM, i18n and public API              |
| `src/i18n`                 | Locale state and static/dynamic translation                  | DOM only in `dom.ts`                  |
| `src/utils`                | Cross-cutting browser-safe helpers and logging               | No application orchestration          |
| `scripts`                  | Maintainer-only asset generation                             | Node.js and development dependencies  |

The catalogue in `src/config/bodies.ts` is the source of truth. Generic systems must
branch on `kind`, `frame` or an optional capability, never on a body name.

## CSS map

`src/styles.css` is intentionally a single deployable stylesheet. Its sections are
ordered by layout ownership:

1. shared scene surface and browser input rules;
2. top navigation;
3. mode switcher;
4. loader and error state;
5. help, language and credits;
6. time/playback panel;
7. guided tour;
8. mobile overrides;
9. orbit settings;
10. projected exploration labels and body information.

The shared `.scene-panel` variables are the visual contract for overlays. A component
may override its accent or geometry, but should not duplicate the base surface,
border, blur and shadow declarations. Mobile rules disable expensive backdrop blur,
bound panel widths to the viewport, preserve 44px-class touch targets where practical,
and keep mode controls above the time panel.

When adding a selector, verify its producer in `index.html` or `src/ui`. Dynamic labels
are produced by `exploHud.ts`; a selector can therefore be absent from the static HTML
and still be live. Prefer class state over inline style state so keyboard and automated
accessibility checks observe the same result.

## Scripts and generated assets

Both scripts are retained because they have active package commands and produce assets
consumed by the application:

- `generate-horizons-ephemerides.mjs` downloads fixed NASA/JPL Horizons vectors and
  writes the local manifest plus hashed binary files. These generated files belong in
  `public/assets/ephemerides` because deployment must work without runtime NASA calls.
- `resize-textures.mjs` creates missing derived texture resolutions. It never overwrites
  an existing destination. It is a maintainer tool, not part of the browser bundle.

Do not add generated reports, temporary files, credentials, or local Firebase state to
the repository. `.gitignore` covers those outputs; committed ephemerides and textures
remain intentionally tracked deployment assets.

## Security contract

Firebase Hosting supplies CSP and hardening headers from `firebase.json`. The browser
application therefore must keep scripts and styles external and must not reintroduce
inline event handlers. User-facing text is assigned with `textContent`; HTML parsing is
not used for translated or network-derived values.

The Horizons manifest is treated as untrusted input: its schema, numeric ranges, hashed
binary filename and same-origin URL are checked before fetching a binary. External body
links are restricted to HTTPS Wikipedia hosts and always use `noopener noreferrer`.

These controls do not make a public front end a secret store. API keys, credentials and
service-account files must remain outside the client bundle and are ignored by Git.

## Change checklist

1. Extend configuration/catalogue first.
2. Keep pure calculations in `src/core` and add a deterministic Vitest test.
3. Give every Three.js resource one owner and an explicit disposal path.
4. Use DOM APIs and translated text nodes for UI output.
5. Add or update a Playwright contract for visible UI or WebGL behavior.
6. Run `pnpm verify`, `pnpm build`, and targeted e2e; use `pnpm verify:all` for a
   release or substantial UI change.

## Content and asset pipeline

The public content roadmap is maintained in docs/UNIVERSE_CATALOG.md.
Natural bodies are added to src/config/bodies.ts or src/config/smallBodies.ts first.
Textures currently use JPEG files under public/assets/textures/{body}/ and are generated
with pnpm textures:resize when a declared derived resolution is missing.

Models, probes, deep-sky objects and large populations are not supported by dropping a
file into public/assets. Each future capability needs a typed catalogue contract, an
explicit position referential, a license note, LOD policy, fallback and disposal tests.
Use instancing, point fields or statistical envelopes for populations; do not create one
mesh per star, asteroid, Oort-cloud body or galaxy particle.
