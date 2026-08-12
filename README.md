# Remotion Video Studio

Upload a code file, get a rendered video. A Next.js 16 App Router app that
compiles a Remotion composition **in the browser**, previews it frame-accurately
and encodes a finished MP4/WebM with WebCodecs - including music and sound -
with no render server or queue.
An optional server engine renders with headless Chrome at maximum power when you
want ProRes, GIF or every-core encoding.

```
upload .tsx / .zip  ->  sucrase compile  ->  <Player> preview  ->  browser video + audio render  ->  download
                                                              \-> optional /api/render (headless Chrome)
```

## Quick start

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev          # http://localhost:3000
```

Then click **Load** on *Star Forge 3D* and press **Render video**.

## Build a video with AI

1. Under **Sample projects**, download **AI Master Template**.
2. Attach the downloaded `.tsx` file to your AI together with your topic, audience,
   goal, platform, duration, visual style, script or key points, assets and call to action.
3. Ask: "Follow the AI EDITING CONTRACT in this file and return one complete,
   runnable `.tsx` file. Use only the supported imports; do not return a diff."
4. Upload the completed file here, preview every scene, then render it.

The template is already a working composition with original music and timed SFX.
Its annotated edit map tells the AI where to replace the brief, theme, timeline,
scene code, object/icon/arrow/neon/geometry/depth system, soundtrack and final
Composition settings.

## Deploy to GitHub + Vercel

```bash
git init
git add .
git commit -m "Remotion Video Studio"
git branch -M main
git remote add origin https://github.com/<you>/remotion-video-studio.git
git push -u origin main
```

1. Go to <https://vercel.com/new> and import the repository.
2. Framework preset: **Next.js**. Build command, output directory and install
   command are all detected automatically - leave them untouched.
3. Deploy. No environment variables are required: browser rendering runs on the
   visitor's device, while Vercel serves the app and its static production assets.

This can be `$0` for a personal, non-commercial project within Vercel Hobby's
usage limits. Hobby is not licensed for commercial use; use Vercel Pro (or
another host) if the deployment supports a business. Keep the optional server
renderer disabled for the simplest free public deployment.

### Environment variables (all optional)

| Variable | Default | What it does |
| --- | --- | --- |
| `ENABLE_SERVER_RENDER` | unset | Set to `1` to turn on `/api/render` (headless Chrome). |
| `RENDER_ACCESS_KEY` | unset | When set, the UI must send this key before the server will render. **Strongly recommended if you enable server rendering.** |
| `MAX_RENDER_FRAMES` | `1800` | Frame ceiling for a single server render. |
| `MAX_RENDER_PIXELS` | `8294400` | Resolution ceiling (4K) for a single server render. |
| `REMOTION_CONCURRENCY` | `max` | `max` uses every core; a number pins it. |
| `REMOTION_GL` | `swangle` | Chrome GL backend used on the server. |
| `NEXT_PUBLIC_REMOTION_LICENSE_KEY` | `free-license` | Set a purchased Remotion key if the Free License does not cover your team. |
| `BLOB_READ_WRITE_TOKEN` | unset | Finished server renders are uploaded to Vercel Blob instead of streamed back inline. |

Copy `.env.example` to `.env.local` to try them locally.

> **Security:** the server engine compiles and runs code that a visitor
> uploaded. Only enable it on a private deployment, and always pair it with
> `RENDER_ACCESS_KEY`. The browser engine has no such risk - the code runs in the
> visitor's own tab, inside the browser sandbox.

## The three ways to render

| | Browser engine | Server engine | `npm run render:local` |
| --- | --- | --- | --- |
| Cost | runs on the visitor's device | serverless compute | runs on your machine |
| Limits | browser codec/RAM support | `maxDuration` 300s, frame/pixel caps | machine resources |
| Formats | MP4 (H.264 + AAC), WebM (VP9/VP8 + Opus), PNG | + GIF, ProRes 4444 | + H.265, any Remotion codec |
| Quality | up to 160 Mbps, 2x scale | crf 9, PNG frames, veryslow x264 | crf 9, PNG frames, every core |
| Needs | Chrome / Edge recommended; Safari 16.4+ | `ENABLE_SERVER_RENDER=1` | Node 20.9+ on your machine |

**Max power, locally:**

```bash
npm run render:sample                                   # the flagship sample at crf 9
node scripts/render-local.mjs my-video.tsx --preset max --scale 2 --codec h265
node scripts/render-local.mjs my-video.tsx --frames 0-119 --preset draft   # quick check
```

## What you can upload

* **A single `.tsx` / `.jsx` file** exporting a React component. If it also calls
  `registerRoot()` with `<Composition />`, the studio reads the exact width,
  height, fps and duration from it. Otherwise it falls back to 1080x1920 @ 30fps
  and marks the composition `inferred`.
* **A `.zip` project** with `src/index.ts`, `src/Root.tsx` and components -
  exactly the layout `npx create-video@latest` produces. Relative imports,
  nested folders and `.css` imports all resolve.
* Up to 200 files, 2 MB each.

Bundled modules: `remotion`, `react`, `@remotion/player`, `@remotion/shapes`,
`@remotion/paths`, `@remotion/noise`, `@remotion/motion-blur`,
`@remotion/transitions` (+ fade/slide/wipe/flip/clock-wipe), `@remotion/media`,
`@remotion/media-utils`, `@remotion/gif`. Anything else has to come with your
upload as source.

### Production asset kit

Open `/assets/index.html` in the running app, or click **Browse** under
**Production asset kit** in the left panel. The included CC0 library contains:

- 41 editable SVGs: objects, icons, arrows, neon graphics, geometry and
  browser-safe 3D/depth artwork.
- 3 original loopable music beds and 10 transition, UI, impact and reveal SFX.
- Machine-readable catalogs, source generators, usage guides and one ZIP download.

Use a visual path such as `/assets/visual/v1/objects/phone.svg`, or sound with
`<Audio src="/assets/audio/v1/music/neon-pulse-120bpm-loop.wav" />` imported
from `@remotion/media`. Regenerate and validate the whole library with:

```bash
npm run assets
npm run assets:verify
```

### Samples

| Sample | What it shows |
| --- | --- |
| `samples/ai-master-template.tsx` | AI-ready single-file scaffold. Download it, attach it to your AI with your video brief, then upload the returned complete `.tsx`. In-file markers cover the concept, script, scenes, timing, palette, typography, assets, motion rules and composition settings. |
| `samples/star-forge-3d.tsx` | 1080x1920, 30s. Real perspective 3D with **no WebGL**: a hand-written yaw/pitch rotation + perspective divide projects every tile, and each star is extruded by stacking 8 shaded copies along the view vector. Four loop shapes, one wing flap, 2x2 contact-sheet outro. |
| `samples/event-loop-orbit.tsx` | 1080x1920, 30s. Blocking vs async I/O as an orbit. A 12-line `schedule()` returns real start/end times; the request cards, the SVG ring and the running clock all read from that one source of truth, so the 4.8s vs 2.1s payoff is arithmetically honest. |
| `samples/thread-race.tsx` | 1080x1920, 30s. Concurrency against parallelism. A `roundRobin(quantum)` simulator emits the interleaved stripes - the tape, the core grid and the per-job progress bars are all derived from that segment list, never hand-keyframed. |
| `samples/pascal-cascade.tsx` | 1080x1920, 30s. Light drafting-paper palette (deliberately nothing like the dark samples). The triangle computes itself from one reduce, parent arcs draw via `pathLength="1"` dash offsets, then the evens dim out and Sierpinski appears. |
| `samples/code-becomes-geometry.tsx` | 1080x1920, 20s. Four ASCII patterns built tile-by-tile with spring physics, a typing code card, aurora background and progress HUD. Core `remotion` only. |
| `samples/neon-product-reveal.tsx` | 1080x1920, 15s. Glassmorphism, conic-gradient aurora, sweeping highlight, kinetic feature rows. |
| `samples/starter-project/` | Multi-file project, zipped to `public/samples/starter-project.zip` on build. |

The showcase samples deliberately do not share a visual template: each has its own
palette, layout engine and animation maths - a 3D matrix kernel, a promise scheduler,
a round-robin simulator and a combinatorics reduce respectively. **AI Master Template**
is the intentional starting scaffold. What all samples share is production discipline:

- Explicit resolution, frame rate and duration metadata.
- Deterministic, frame-driven animation instead of wall-clock CSS animation.
- Clear focal hierarchy, safe margins and a resolved final beat.
- Downloadable source that can be edited and uploaded again.

Every sample is downloadable from the left panel - edit one, drop it back in,
and you have your own video.

## Project layout

```
app/
  api/render/route.ts   server engine: bundle -> selectComposition -> renderMedia, streamed as SSE
  layout.tsx  page.tsx  globals.css
components/
  Studio.tsx            state machine: project -> compile -> preview -> render
  SourcePanel.tsx       dropzone, samples, file tree, entry picker
  StagePanel.tsx        <Player> stage + composition metadata
  RenderPanel.tsx       engine, quality preset, format, scale, progress, output
  PlayerCanvas.tsx      dynamic({ ssr: false }) wrapper around @remotion/player
lib/
  compiler.ts           sucrase + a tiny CommonJS module graph, runs in the tab
  module-registry.ts    the modules an upload may import
  browser-render.ts     high-fidelity visual path + audio-aware Remotion web renderer
  server-render-client.ts  SSE client for /api/render
  presets.ts            bitrate maths, crf table, H.264 level picker, formats
  project.ts            zip/file ingestion, entry detection
samples/                the uploadable examples
scripts/
  generate-audio-assets.mjs   deterministic original WAV library + verifier
  generate-visual-assets.mjs  deterministic original SVG library
  build-asset-library.mjs     combined catalog, gallery and ZIP
  render-local.mjs      unlimited CLI renderer
  sync-samples.mjs      samples -> public/samples (runs on predev/prebuild)
```

## How the free renderer works

MediaRecorder-based exporters record the screen in wall-clock time, so a slow
frame becomes a dropped frame. This app never records the screen. Visual-only
projects use the high-fidelity `Thumbnail -> html-to-image -> VideoEncoder`
pipeline. Projects importing `@remotion/media` use Remotion's stable web
renderer, which composites frames, mixes audio and muxes AAC/Opus with the
video. Both paths assign exact frame timestamps, so slow frames do not alter
timeline timing.

Quality knobs: bitrate scales with `width x height x fps x bitsPerPixel`
(0.05 / 0.14 / 0.34 by preset, clamped to 4-160 Mbps), the H.264 level is chosen
from the macroblock rate so Chrome accepts 4K, and the encoder runs in
`quality` latency mode with `avc1.6400xx` High profile.

## Troubleshooting

* **"This browser has no WebCodecs support"** - use current Chrome/Edge for the
  fullest effects support, Safari 16.4+ for compatible projects, or enable the
  server engine.
* **"That file did not compile"** - the stage shows the exact error and file.
  Check that every import is in the supported list above.
* **Server render 503** - `ENABLE_SERVER_RENDER` is not `1` on that deployment.
* **Server render times out** - functions and this route cap work at 300s.
  Lower the length, use the browser engine, or render locally.
* **Vercel build fails on `sharp`/Chromium** - the app never installs Chromium at
  build time; only `/api/render` downloads it at runtime, on first use.

## License

MIT for this app. Generated visual/audio assets are CC0-1.0. Remotion and your
hosting provider have their own usage/license terms; review them before a public
commercial launch: <https://remotion.dev/license> and <https://vercel.com/pricing>.
