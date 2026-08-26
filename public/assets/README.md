# Remotion Production Asset Kit

This archive contains 1241 editable SVG visuals, 20 textures, sprites and environment maps, 102 font families, 8 loopable music beds, and 560 sound effects.

## Install

Extract the contents of this archive into your Remotion project public/assets directory. The existing visual/, texture/, fonts/ and audio/ paths are preserved.

Use assets without the public/ prefix:

    staticFile('assets/visual/v1/kinetic/burst-001.svg')
    staticFile('assets/texture/v1/overlays/film-grain.png')
    staticFile('assets/audio/v1/music/neon-pulse-120bpm-loop.wav')

Fonts load with @remotion/fonts so a render never waits on the network:

    loadFont({family: 'Anton', url: staticFile('assets/fonts/v1/anton/Anton-Regular.ttf')})

- catalog.json is the combined machine-readable catalog.
- visual/v1/catalog.json, texture/catalog.json, fonts/catalog.json and audio/catalog.json contain pack-specific metadata.
- index.html is the searchable gallery.
- Generated visuals, textures and audio are CC0-1.0 and require no attribution.
- Fonts are licensed per family under OFL-1.1 or Apache-2.0. Every required license text is included beside its font binary and must remain with redistributed copies.
- The combined catalog records the SPDX license and license path for every asset.

