# Original texture production kit

This folder contains deterministic PNG overlays, sprites, matcaps, and
equirectangular environment maps generated from seeded project-owned math by
`scripts/generate-texture-assets.mjs`.

- Browse exact paths, dimensions, roles, and checksums in `catalog.json`.
- Regenerate with `npm run assets:texture`.
- Verify offline with `node scripts/generate-texture-assets.mjs --verify-only`.
- The generated PNG files are released under CC0-1.0.
