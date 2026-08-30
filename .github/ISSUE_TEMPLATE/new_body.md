---
name: New celestial body request
about: Ask for (or propose) a planet, moon, dwarf planet, asteroid or comet to be added
title: 'Add: '
labels: new-body
assignees: ''
---

Please read [`CONTRIBUTING.md`](../../CONTRIBUTING.md#ajouter-un-corps-céleste) first — adding a
body is a single catalogue entry plus textures, but it has real requirements around position
accuracy and texture licensing that this template asks about.

**Body name**

**Position source**
Does it have an `astronomy-engine` ephemeris, a known orbit suited to a JPL Horizons binary, or
only Keplerian elements (asteroid/comet/TNO)? Link the JPL Horizons / SBDB record if you have it.

**Texture availability**
Is there a real photo mosaic (mission imagery, USGS)? Link the source and its licence. If none
exists, say so explicitly — the project uses a documented procedural texture or a flat
`fallbackColor` rather than an invented one in that case (see `ILLUSTRATIVE_SURFACES` in
`src/config/catalog.ts`).

**Why this body**
What makes it worth adding (scientific interest, a real mission, a notable orbit) — optional but
helpful for prioritization.

**Are you planning to submit the PR yourself, or just requesting it?**
