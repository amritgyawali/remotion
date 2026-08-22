# Remotion Video Studio

Upload a code file, get a rendered video. A Next.js 16 App Router app that
compiles a Remotion composition **in the browser**, previews it frame-accurately
and encodes a finished MP4/WebM with WebCodecs - including music and sound -
with no render server or queue. It supports deterministic React Three Fiber
scenes as well as DOM/SVG motion graphics.
An optional protected server engine renders on a trusted Node host or inside an
isolated Vercel Sandbox VM when you want ProRes, GIF, or server-side encoding.

```
upload .tsx / .zip  ->  sucrase compile  ->  <Player> preview  ->  browser video + audio render  ->  download
                                                              \-> optional /api/render
                                                                  Node or Vercel Sandbox -> Blob
```

It also captions video you already have. The **Subtitle Studio** at `/captions`
transcribes an uploaded clip on-device, lets you edit and style the lines, and
renders the video back out with the subtitles burned in.

```
upload .mp4  ->  NVIDIA speech (cloud) or Whisper (WASM, on-device)  ->  editable cues
             ->  generated .tsx  ->  captioned video + .srt
```

## Quick start

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev          # http://localhost:3000
```

Then click **Load** on *AI Master Template* and press **Render video**.

## Build a video from a chat message

Type what you want in **Chat → Remotion video** and press **Generate**. One click
produces a finished composition, and with **Render output automatically** left on
(the default) it continues straight through to the downloadable file.

How a generation runs:

1. The AI director plans a **storyboard**, not code: title, scenes, on-screen copy,
   palette, typography, music, grain and pacing, as one small JSON document.
2. The Studio **composes the Remotion TSX itself** from that storyboard using the
   built-in scene library and the bundled asset kit, then compiles it in the
   browser and loads the preview.

Every request also receives a fresh creative seed. It selects a different
background recipe, layout, camera, transition language, typography pair,
foreground artwork and SFX variants, while a compact design fingerprint keeps
recent results from repeating in the same browser. The seed and fingerprint are
embedded in the generated file, so a result remains exactly reproducible when
you intentionally reuse it. Background grids are prohibited; charts may still
draw the axes required to explain real data, and CSS Grid remains available for
ordinary layout.

Because the code is generated locally from a validated plan, a generation cannot
fail on a syntax error, a hallucinated import, a missing asset or a truncated
file - the failure modes that make "ask an LLM for a whole file" unreliable.

Scene types the composer can build: `title`, `statement`, `timeline`, `map`,
`landscape`, `monument`, `gallery`, `stats`, `chart`, `process`, `quote`, `cta`,
plus the dimensional set below.
Duration, aspect ratio (16:9, 9:16, 1:1, 4:5, 21:9), palette, fonts and music are
read from the prompt when you state them and inferred when you do not.

### House styles

No two generations are handed the same design. Before a single line of TSX is
written the Studio draws a **template** - a complete house style that decides
which backgrounds, layouts, type recipes, accents, finish, camera, rhythm,
palettes and font categories are even eligible:

`editorial-press` · `swiss-poster` · `kinetic-type` · `broadcast-strip` ·
`zine-collage` · `minimal-air` · `neon-arcade` · `gallery-frame` · `data-brief` ·
`story-cards` · `cinema-bars` · `terminal-log` · `pop-sticker` · `luxe-serif` ·
`split-duo` · `archive-paper`

Inside the chosen style the Studio then picks a background recipe, a page
layout, a type pairing, a headline treatment (plate, box, underline, margin bar
or outline), a rule language, a corner language, a casing rule, an accent shape,
a finish, a camera and a tempo - plus a hue rotation applied to the palette's
accents. The result is hashed into a **design fingerprint**, and both the
fingerprint and the house style of your recent videos are sent back with the
next request, so a design identity is never served twice and the same template
never runs back to back.

Palette and typography follow the same rule: a brief that names a colour
("neon", "monochrome", "gold") or a typeface class ("serif", "monospace",
"handwritten") pins that choice, and everything it leaves unsaid is chosen fresh
by the house style each time.

### Dimension

Three-dimensional treatment is opt-in, per chat:

| Mode | What it renders | When |
| --- | --- | --- |
| `flat` (default) | Graphic design only: type, colour, shape, layout and motion. | always, unless you ask otherwise |
| `depth` | Perspective stage with a drifting camera, extruded headlines, tilted cards and layered atmosphere. Pure CSS/SVG. | you say "depth", "parallax", "layered", "perspective" or ask for a camera move |
| `three` | Everything in `depth`, plus real WebGL scenes through `@remotion/three`: lights, shadows, materials and a moving camera. | you say "3D", "WebGL", "CGI", "turntable", "rotating globe" or similar |

WebGL scenes: `object3d` (lit turntable of a procedural solid - crystal, sphere,
torus knot, cube, prism, capsule or ring - with wireframe overlay, orbiting
satellites and a contact shadow), `globe3d` (rotating sphere with a graticule
cage, atmosphere shell and markers placed at real latitude/longitude),
`terrain3d` (camera flight over a displaced height field with flat shading,
wireframe topography and depth fog). `carousel3d` puts cards on a rotating rig
using CSS 3D and needs no WebGL.

All four are unavailable unless you ask for 3D. The request is remembered for
the whole chat, so a follow-up such as "now make it 20 seconds" keeps the 3D you
already asked for, and a model answer that reaches for `three` on its own is
rewritten to the flat scene that shows the same content. Everything still
animates from `useCurrentFrame()`, so previews, browser exports and server
renders match frame for frame.

### Optional: connect NVIDIA for AI-written scripts

1. Generate an NVIDIA NIM API key on <https://build.nvidia.com/>. The copied
   secret normally starts with `nvapi-`; the credential ID shown in the account
   table is not the API key.
2. Copy `.env.example` to `.env.local`, set `NVIDIA_API_KEY`, and restart `npm run dev`.
3. **Auto** starts with the fastest planner and falls back automatically when a
   model is slow, rate limited or returns something unusable.

Without a key - or when every model fails - the **Studio director** plans the
storyboard locally from your prompt and the video is still produced. The chat
says which director was used. The local planner never invents facts: statistics,
dates and quotes only appear when you wrote them, so connect NVIDIA when you want
researched copy.

The NVIDIA credential is read only by the Node.js route and is never included in
browser JavaScript. Visitors do not enter an AI access key. This makes the AI
route public on a public deployment, so configure Vercel rate limiting and NVIDIA
spend controls to protect the quota.

Run `npm run ai:check` to compose a spread of prompts and verify every generated
file satisfies the Studio contract, seeded replay is deterministic, varied seeds
produce distinct design fingerprints, and no forbidden background-grid recipe
can enter generated source.

The previous manual workflow still works: download **AI Master Template**, edit it
with any coding assistant, and upload the completed `.tsx` file.

The template is already a working composition with a lit procedural 3D sun and
tree, an original music bed, story sounds, and frame-synchronized SFX. Its
`VISUAL_PROOF_PLAN` forces every important user phrase to become a recognizable
subject and visible action. “Sun” must produce a sun; “tree” must produce a tree;
verbs, relationships, comparisons, and claims must be demonstrated—not merely
written on screen. The edit contract also covers bespoke art direction, camera,
lighting, materials, responsive layout, sound, performance, and final quality.

The **Music & sound** control applies one master setting to both the Player and
the exported file. Turn it off for a silent cut, or leave it on to mix all
authored music, sounds, narration, SFX and source-video audio.

## Subtitle a video you already have

Open **Subtitle a video** in the top bar, or go straight to
<http://localhost:3000/captions>.

1. **Drop in a video** (MP4, MOV, WebM). It is read on your device - duration,
   size, frame rate and whether it has an audio track come from mediabunny, the
   same demuxer Remotion renders with. A public video URL works too.
2. **Get the transcript**, three ways:
   * **Auto** - speech recognition, with two engines behind one button.

     **NVIDIA cloud** (used first whenever the server has an `NVIDIA_API_KEY`)
     decodes the audio in the browser, resamples it to 16 kHz mono, cuts it at
     the quietest point near each boundary and uploads those chunks to
     `/api/captions/transcribe`, which calls NVIDIA's hosted recognisers -
     Whisper large-v3 for Nepali and the other 98 languages, Parakeet and Canary
     for English and the major European ones. The video never leaves the device,
     there is nothing to download, and a chunk that fails is retried and then
     skipped rather than losing the whole transcript.

     **On this device** runs Whisper as WebAssembly inside the tab. Six models
     from tiny to small, English-only or multilingual (77 MB - 488 MB),
     downloaded once into IndexedDB and reused afterwards. Nothing is uploaded
     and no API key is involved; it does need a cross-origin isolated page for
     SharedArrayBuffer.

     Either way every word gets its own timestamp, and a cleanup pass drops
     music/silence hallucinations and the credit-loop lines Whisper falls into
     on long clips. **Auto** falls back to the other engine when one fails, so a
     missing key or a browser without SharedArrayBuffer still produces captions.

     Optionally an NVIDIA language model then tidies the transcript - one
     rewritten line per recognised line, so punctuation and spelling improve
     while every word timing is kept. It is refused if the model changes the
     line count or rewrites a line beyond recognition.
   * **Write** - paste the script and it is spread across the clip, weighted by
     word length (Devanagari clusters count as one syllable, not one code
     point, so Nepali timing reads naturally), with a blank line acting as a
     hard block break.
   * **Import** - bring an existing `.srt` or `.vtt`; word timing is filled in so
     the karaoke styles still work.
3. **Edit the lines** in the track under the preview: retime, retype, split,
   merge, delete, add, or nudge every cue at once. Line length is re-cut without
   losing a single word timing. A readability pass stretches any cue shorter
   than ~0.7s into the following silence, never over the next line, so a quick
   word never flashes past unread.
4. **Style them** with 18 finished looks - social pop, money caps, karaoke
   fill, broadcast bar, frosted glass, clean minimal, cinema serif, neon glow,
   neon tube, sunset gradient, chrome Y2K, accent box, comic slam, arcade, VHS
   tape, typewriter, marker note and Nepali bold - then take over every control:

   * **Type**: 64 bundled families in a searchable picker that previews each
     one in its own face, filtered by display, sans, condensed, serif, comic,
     tech, retro, pixel, mono, script, handwritten or Devanagari. Size, weight,
     tracking, leading, letter case, alignment and up to four balanced lines.
   * **Fill**: a solid colour or a gradient clipped to the letterforms, at any
     angle.
   * **Spoken word**: colour, pop, or a solid box; a true karaoke wipe that
     fills the word left to right across its own timing; and continuous motion -
     bounce, wave, pulse, jitter or flip - on the word being said.
   * **Effects**: outline, coloured drop shadow, glow, a hard-edged 3D depth
     stack, tilt, a frosted backdrop blur and the legibility scrim.
   * **Emphasis words**: the offer, the price, the brand name - painted in the
     emphasis colour every time they are spoken, matched without case or
     punctuation. The Tools tab ranks the candidates for you.
   * **Reveal**: word by word, whole line, or a typewriter that types each word
     across its own timestamp without the line ever reflowing.
5. **Work in bulk** in the Tools tab: find and replace (word timings survive a
   same-length replacement), sentence/title/upper/lower rewriting, punctuation
   tidying, `Name:` speaker splitting, speed correction for a transcript that
   drifts, holding captions through short pauses, frame snapping, splitting long
   cues, folding short flashes into their neighbour, and copy/paste of the whole
   look as JSON.
6. **Render** with the same browser or server engine the code studio uses. The
   output carries the original audio unless you mute it. Subtitles also export
   as `.srt`, `.vtt` and a fully styled `.ass` with per-word karaoke tags.

Everything the preview shows is one real Remotion composition, written for your
clip and compiled in the tab. **Download the .tsx** to keep it: it is a
self-contained file with your cues and style baked in, ready for Remotion Studio,
CI, or a re-upload into the code studio. Captions also export as `.srt` and
`.vtt`.

### Nepali + English (code-switched) subtitles

Built for the way people actually speak: one sentence mixing Nepali and
English, à la *"यो feature धेरै राम्रो छ"*.

* **Speech profile: Nepali + English** is the default in the Auto tab. It
  selects Whisper's `small` multilingual model with `language: 'ne'` - the
  largest model this studio can run on-device, which is what code-switched,
  low-resource-language speech needs to transcribe reliably. English words in
  the audio still come out as English; Nepali words come out in Devanagari.
  English-only and "other language" profiles are also available, and picking
  an `.en`-only model against a non-English profile is flagged before you
  transcribe.
* **Devanagari rendering is automatic.** The moment a transcript contains
  Devanagari - from Whisper, a pasted script, or an imported subtitle file -
  the studio turns on a companion Devanagari face (Noto Sans Devanagari or Anek
  Devanagari) and puts it second in the CSS font stack. The browser resolves
  the family per character, so "यो feature धेरै राम्रो छ" renders the English
  words in your chosen display face and the Nepali words in a face that
  actually has those glyphs - one caption, one visual voice, no tofu boxes.
* **Line breaking measures visual width, not code points.** Devanagari matras,
  anusvara, virama and joiners stack on the letter they belong to instead of
  taking their own space; counting them literally would make "छेउ" look five
  characters wide and leave every Nepali line ragged. Sentence-ending
  `।` / `॥` (purna viram / deergh viram) end a cue exactly the way `.`/`!`/`?`
  end an English one.
* **Balanced line wrapping.** Rather than filling the first row and dropping
  whatever's left onto the second, captions are linear-partitioned into up to
  three rows of near-equal width - the same thing a typesetter does by eye,
  computed with a binary search over row widths.

### Fonts, on-device speech and readability, in depth

* **Typography kit**: 64 self-hosted open-licence families ship with the app -
  text and grotesk faces, condensed and news faces, impact and comic display,
  editorial serifs, tech, retro, pixel and terminal faces, script and marker
  hands, and 13 that draw Devanagari for Nepali and Hindi. `npm run assets:fonts`
  re-downloads and hash-locks all of them; `npm run assets:verify` checks the
  lock without any network access.
* **Font weights are honest**: a static face carries exactly one weight, and
  asking a browser for 700 on a 400-only file produces a synthesised fake bold
  that smears at caption size and differs between preview and render host. The
  studio pins the weight for those families and greys the slider out instead.
* **Every effect is frame-derived**: gradients, glow, the depth stack, the
  karaoke wipe, the per-word motion and the typewriter all read the frame and
  nothing else - no DOM measurement, no `Math.random()`, no `Date.now()` - so
  frame N is identical in the preview, in a browser export and on a render farm.
  `npm run captions:check` compiles all 18 presets and all 64 faces and asserts
  exactly that.
* **On-device speech recognition** uses `@remotion/whisper-web` -
  whisper.cpp compiled to WebAssembly, running entirely in the tab.
  `getLoadedModels()` tells the UI which models are already cached so it can
  say "ready" instead of a download size, and threading is capped at
  `hardwareConcurrency - 1` so the UI thread keeps painting the progress bar.
* **Cloud speech recognition speaks gRPC**, because that is what NVIDIA
  actually hosts. Every speech model on build.nvidia.com is an NVIDIA Cloud
  Function reached at `grpc.nvcf.nvidia.com:443` with the model's function id
  and the `nvapi-` bearer token as call metadata - there is no OpenAI-style
  `/v1/audio/transcriptions` on `integrate.api.nvidia.com`, so an HTTP-only
  client fails on every single request no matter how the key is set. The route
  ships the function ids, vendors the Riva protos under
  `lib/captions/riva/proto/` (MIT), and compiles them to a JSON descriptor with
  `npm run riva:descriptor` so nothing has to be read off disk at runtime.
* **HTTP is still tried after gRPC**, in both the Riva and OpenAI-compatible
  dialects, so a self-hosted NIM or an NVCF function with HTTP enabled works
  through the same route. Whichever transport and language spelling answers
  first is remembered for the life of the instance; every failed attempt is
  returned to the browser, so a misconfiguration names itself instead of hiding
  behind "could not transcribe".
* **Word timings** come back as milliseconds from Riva and seconds from the
  OpenAI-shaped payloads; both are normalised, and a reply with text but no
  timings is spread by word length and labelled as estimated. Chunks are cut at
  the quietest 20 ms frame within four seconds of the target boundary, so a word
  is not split across two requests, and the WAV header is stripped before the
  PCM goes on the wire.
* **Where the audio goes**: the video file itself is never uploaded. Only the
  decoded speech is, and only when the NVIDIA engine is selected; the on-device
  engine sends nothing at all. `npm run captions:check` exercises the chunker,
  the uploader and both routes against canned responses, and `npm run riva:check`
  runs a real gRPC server built from the same protos and asserts the metadata,
  the audio bytes, the config fields and the returned word timings - neither
  needs the network.
* **Transcript hygiene**: bracketed sound events (`[Music]`, `(applause)`),
  subtitle-credit lines (`Subtitles by...`, `अनुवाद:`, `सदस्यता लिनुहोस्`) and the
  repeat-loops Whisper produces on long silence are filtered before a single
  cue is created.
* **Readability floor**: subtitling practice puts the shortest comfortable cue
  around 0.7-1s. `enforceReadability()` stretches short cues into the silence
  that follows them - never into the next line, never past the clip - so
  fast speech never produces an unreadable flash of text.

The route is served with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: credentialless` because the speech model needs a
`SharedArrayBuffer`, which browsers only hand to a cross-origin isolated
document. Those headers are scoped to `/captions`, so the code studio keeps
loading third-party assets unchanged - and the links between the two studios are
plain `<a>` tags on purpose, since a client-side navigation would not pick the
headers up. Where isolation is unavailable (Safari today), or where the WASM
bundle itself cannot be fetched, the studio says so and switches to NVIDIA cloud
transcription; the Write and Import paths still work either way.

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
renderer disabled for the simplest public deployment.

For cloud server rendering, connect a Vercel Blob store and set
`ENABLE_SERVER_RENDER=1` plus a strong `RENDER_ACCESS_KEY`. On Vercel, the route
orchestrates `@remotion/vercel`: uploaded code, Chrome, and FFmpeg execute in a
disposable Sandbox VM, and the finished file is delivered through Blob. A normal
Vercel Function does not run Chromium directly. The Vercel build creates a
reusable renderer snapshot; each job restores it and then uploads only the
current Remotion bundle. Old snapshot/Blob objects should be removed as part of
your deployment retention policy.

### Environment variables (all optional)

| Variable | Default | What it does |
| --- | --- | --- |
| `ENABLE_SERVER_RENDER` | unset | Set to `1` to turn on protected Node/Vercel Sandbox rendering. |
| `RENDER_ACCESS_KEY` | unset | Shared render key. **Required** for both Node and Vercel server rendering. |
| `NVIDIA_API_KEY` | unset | Server-only `nvapi-…` key for Chat → Remotion generation and for cloud speech recognition in the Subtitle Studio. |
| `NVIDIA_ASR_GRPC` | `grpc.nvcf.nvidia.com:443` | Riva ASR target. Point it at a self-hosted NIM (`localhost:50051`) to keep audio on your own hardware. |
| `NVIDIA_ASR_GRPC_INSECURE` | unset | `1` for a plaintext Riva server, `0` to force TLS. Unset means TLS everywhere except loopback. |
| `NVIDIA_ASR_DISABLE_GRPC` | unset | `1` skips gRPC and uses the HTTP transports only. |
| `NVIDIA_ASR_ENDPOINT` | unset | Full URL of an HTTP `/v1/audio/transcriptions` endpoint, e.g. a self-hosted NIM. |
| `NVIDIA_ASR_FUNCTION_ID` | unset | Pin one NVCF function id instead of the one belonging to the selected model. |
| `NVIDIA_ASR_MODEL` | unset | Pin one speech model instead of choosing by spoken language. |
| `MAX_RENDER_FRAMES` | `1800` | Frame ceiling for a single server render. |
| `MAX_RENDER_PIXELS` | `8294400` | Resolution ceiling (4K) for a single server render. |
| `REMOTION_CONCURRENCY` | `auto` | Remotion chooses a memory-safe worker count; a number pins it. |
| `REMOTION_GL` | `angle` on macOS/Windows, `swangle` on Linux | Chrome GL backend for WebGL/ThreeCanvas. GPU-less Linux hosts (CI, containers, Vercel Sandbox) need `swangle`. |
| `NEXT_PUBLIC_REMOTION_LICENSE_KEY` | `free-license` | Set a purchased Remotion key if the Free License does not cover your team. |
| `BLOB_READ_WRITE_TOKEN` | unset | Required for Vercel Sandbox output; created automatically when a Blob store is connected. |
| `VERCEL_SANDBOX_VCPUS` | `4` | vCPUs requested for each Vercel Sandbox render VM. |
| `VERCEL_SANDBOX_TIMEOUT_MS` | `2700000` | Sandbox lifetime ceiling (45 minutes by default). |

Copy `.env.example` to `.env.local` to try them locally.

> **Security and cost:** only load code you trust. Browser compilation uses
> `new Function()` in the application tab; it is not a security isolation
> boundary. Vercel Sandbox isolates server execution, but a public render API
> still needs authentication, rate limiting, spend controls, cancellation, and
> output cleanup before production use.

## The four rendering paths

| Path | Best use | Quality and limits |
| --- | --- | --- |
| Browser engine | Interactive renders on any Vercel/static deployment | H.264/AAC or WebM/Opus, Max preset, 2x scale, OPFS-backed output where available; bounded by device codecs, GPU, disk and RAM |
| Vercel Sandbox | Protected on-demand cloud renders | Isolated Chrome + FFmpeg VM, Blob delivery, MP4/WebM/GIF/ProRes; requires Vercel, Blob, auth and spend controls |
| Node server / local CLI | Trusted private infrastructure | CRF 9, PNG source frames, H.264/H.265/VP9/ProRes; bounded by the host |
| GitHub Actions | Trusted committed/manual offline renders | CI smoke-renders 3D + audio; **Render video** workflow creates a High/Max downloadable artifact, with a 6-hour job ceiling and no hosted-runner GPU guarantee |

**Max-quality local rendering:**

```bash
npm run render:sample                                   # the flagship sample at crf 9
node scripts/render-local.mjs my-video.tsx --preset max --scale 2 --codec h265
node scripts/render-local.mjs my-video.tsx --frames 0-119 --preset draft   # quick check
```

**Checking a render without a video player:**

```bash
npm run stills -- my-video.tsx --frames 0,60,120 --scale 0.5   # PNG contact sheet
npm run inspect -- out/my-video.mp4 --expect-audio             # tracks, duration, size
```

`stills` renders the real layout at a lower raster resolution, so it shows
exactly what the full-size export will look like. `inspect` reads the container
with mediabunny and fails when a track, duration or the audio you expected is
missing - no system FFmpeg required.

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
`@remotion/media-utils`, `@remotion/gif`, `@remotion/fonts`, `@remotion/captions`,
`@remotion/three`,
`@react-three/fiber`, and `three`. Anything else has to come with your upload as
source.

### Production asset kit

Open `/assets/index.html` in the running app, or click **Browse** under
**Production asset kit** in the left panel. The searchable, paginated gallery
and downloadable archive contain more than 1,800 production assets:

| Pack | Contents | Licence |
| --- | --- | --- |
| Visuals | 1,241 editable SVGs: 1,200 deterministic variants in 24 kinetic, organic, cosmic, framing, data and symbol families, plus 41 compatible originals | CC0-1.0 |
| Textures | 20 PNGs: film grain, paper, halftone, scanlines, vignette, light leaks, glow/bokeh/spark/smoke sprites, 4 matcaps, 3 equirectangular environment maps | CC0-1.0 |
| Typography | 64 self-hosted families across sans, grotesk, rounded, condensed, display, comic, serif, tech, retro, pixel, mono, script and handwriting, including 13 Devanagari faces (Noto Sans/Serif Devanagari, Anek, Mukta, Hind, Baloo 2, Rozha One, Yatra One, Kalam, Tiro, Martel Sans, Teko, Khand) | OFL-1.1 and Apache-2.0 |
| Audio | 8 loopable music beds and 560 SFX: 540 compact motion-ready variants in 15 families plus 20 compatible originals | CC0-1.0 |

```tsx
staticFile('assets/visual/v1/objects/phone.svg')
staticFile('assets/visual/v1/kinetic/ribbon-017.svg')
staticFile('assets/texture/v1/overlays/film-grain.png')
staticFile('assets/audio/v1/sfx/variants/motion/motion-whoosh/motion-whoosh-v017.wav')
<Audio src={staticFile('assets/audio/v1/music/ambient-calm-70bpm-loop.wav')} />   // @remotion/media
loadFont({family: 'Anton', url: staticFile('assets/fonts/v1/anton/Anton-Regular.ttf')})  // @remotion/fonts
```

Fonts are self-hosted on purpose: a render host without the family installed
silently falls back to Arial, and `loadFont()` holds the render open until the
face is parsed. Textures cover the two things procedural CSS cannot fake -
photographic grain and image-based 3D lighting.

Regenerate and validate the library with:

```bash
npm run assets           # visuals, audio, textures, fonts, then the combined catalog + ZIP
npm run assets:verify    # offline: counts, hashes, duplicates, stale files and audio levels
```

Everything except the fonts is synthesised from seeded math by the scripts in
`scripts/`, so there is no third-party artwork, sample or recording in this
repository. The font families come from the official
[google/fonts](https://github.com/google/fonts) repository under their bundled
OFL-1.1 or Apache-2.0 terms. Each family keeps its licence file;
`npm run assets:fonts` downloads the raw face and licence together and records
SHA-256 hashes in `public/assets/fonts/fonts.lock.json`.

### Samples

| Sample | What it shows |
| --- | --- |
| `samples/ai-master-template.tsx` | AI-ready single-file scaffold with a real procedural ThreeCanvas sun/tree demonstration. `VISUAL_PROOF_PLAN` maps the user’s exact sayings to literal subjects, visible actions, shared beat frames, camera/light direction, soundtrack and final quality. |
| `samples/ai-caption-template.tsx` | AI-ready single-file scaffold for burned-in subtitles: word-level timing, script-aware balanced line breaking, mixed Devanagari/Latin fonts (Nepali + English), a legibility scrim and a per-word highlight - the same engine the Subtitle Studio generates. Also downloadable from `/captions` under **AI shortcut**. |
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
  captions/page.tsx     the subtitle studio, served cross-origin isolated
  layout.tsx  page.tsx  globals.css
components/
  Studio.tsx            state machine: project -> compile -> preview -> render
  SourcePanel.tsx       dropzone, samples, file tree, entry picker
  StagePanel.tsx        <Player> stage + composition metadata
  RenderPanel.tsx       audio, engine, quality preset, format, scale, progress, output
  PlayerCanvas.tsx      dynamic({ ssr: false }) wrapper around @remotion/player
  CaptionStudio.tsx     subtitle state machine: video -> transcript -> cues -> render
  captions/             source, design and export panels, cue track, preview player
lib/
  compiler.ts           sucrase + a tiny CommonJS module graph, runs in the tab
  module-registry.ts    the modules an upload may import
  browser-render.ts     high-fidelity visual path + audio-aware Remotion web renderer
  use-render-controller.ts  the render pipeline both studios drive
  server-render-client.ts  SSE client for /api/render
  presets.ts            bitrate maths, crf table, H.264 level picker, formats
  project.ts            zip/file ingestion, entry detection
  captions/
    transcribe.ts       on-device Whisper: model download, resample, word timings
    cues.ts             grouping, retiming, editing, .srt/.vtt in and out
    composition-source.ts  writes the captioned-video .tsx the studio compiles
    video-source.ts     duration, display size, fps and audio-track probing
    style-presets.ts    the six caption looks and the studio font kit
samples/                the uploadable examples
scripts/
  generate-audio-assets.mjs   560-SFX deterministic WAV library + verifier
  generate-visual-assets.mjs  1,241-file deterministic SVG library + verifier
  generate-texture-assets.mjs deterministic PNG grain/sprite/matcap/env library
  fetch-fonts.mjs             self-hosted OFL font kit + hash lock + verifier
  build-asset-library.mjs     combined catalog, gallery and ZIP
  render-local.mjs      host-limited, max-quality CLI renderer
  preview-stills.mjs    PNG contact sheet from any composition
  inspect-media.mjs     track/duration check without a system FFmpeg
  sync-samples.mjs      samples -> public/samples (runs on predev/prebuild)
```

## How browser rendering works

MediaRecorder-based exporters record the screen in wall-clock time, so a slow
frame becomes a dropped frame. This app never records the screen. Visual-only
projects use the high-fidelity `Thumbnail -> html-to-image -> VideoEncoder`
pipeline. Projects importing `@remotion/media` use Remotion's stable web
renderer, which composites DOM, media, and supported ThreeCanvas frames, mixes
audio, and muxes AAC/Opus with the video. Large media renders use browser OPFS
when available instead of keeping the entire encoder target in RAM. Both paths
assign exact frame timestamps, so slow frames do not alter timeline timing.

Quality knobs: bitrate scales with `width x height x fps x bitsPerPixel`
(0.05 / 0.14 / 0.34 by preset, clamped to 4-160 Mbps), the H.264 level is chosen
from the macroblock rate so Chrome accepts 4K, and the encoder runs in
`quality` latency mode with `avc1.6400xx` High profile.

Audio bitrate is negotiated, not assumed: browsers cap their audio encoders far
below the video preset (Chrome refuses AAC above 128 kbps), so the export walks
320 -> 256 -> 192 -> 160 -> 128 -> 96 kbps and keeps the highest rate this device
actually accepts instead of failing the render.

3D scenes must set `gl={{preserveDrawingBuffer: true}}` on `<ThreeCanvas>`; the
exporter copies the WebGL canvas after the frame is composited, and without it
the export is blank even though the preview looks right. The studio raises a
warning when an uploaded file forgets it.

## Troubleshooting

* **"This browser has no WebCodecs support"** - use current Chrome/Edge for the
  fullest effects support, Safari 16.4+ for compatible projects, or enable the
  server engine.
* **"That file did not compile"** - the stage shows the exact error and file.
  Check that every import is in the supported list above.
* **Server render 503** - on Node, set `ENABLE_SERVER_RENDER=1`; on Vercel also
  connect Blob and set `RENDER_ACCESS_KEY`.
* **Server render times out** - functions and this route cap work at 300s.
  Lower the length, use the browser engine, or render locally.
* **Vercel Sandbox startup is slow** - a cold Sandbox installs its isolated
  renderer/browser environment before the render. Browser rendering avoids that
  startup and remains the default.
* **"This browser cannot encode AAC audio at any supported bitrate"** - pick the
  WebM format (Opus), turn Music & sound off, or use a server path. Firefox has
  no AAC encoder at all.
* **3D renders black on a Linux host** - set `REMOTION_GL=swangle`; plain `angle`
  needs a graphics stack that headless Linux boxes do not have.
* **A layer looks shifted or banded in a browser export but correct in preview** -
  give that inline `<svg>` explicit `width`/`height` attributes. The browser
  exporter serialises the tag, and one sized only by CSS has no intrinsic size,
  so it rasterises at the wrong scale. The studio warns about this on upload.
* **A texture is missing from a browser export** - it was set with
  `background-image: url(...)`, which the browser exporter does not draw. Use
  `<Img>` from `remotion` instead; CSS gradients are supported.
* **"speech model unavailable" in the Subtitle Studio** - the page is not
  cross-origin isolated, so the browser withholds `SharedArrayBuffer`. Reload
  `/captions` directly (a client-side navigation keeps the previous document's
  headers), and check that no proxy strips COOP/COEP. Safari does not support
  `credentialless` isolation yet; write or import the transcript there.
* **The Subtitle Studio cannot use the server engine** - an uploaded file lives
  only in that browser tab, so a render host cannot read it. Render on the
  device, or load the video from a public URL first.
* **A downloaded caption `.tsx` renders a black video elsewhere** - its
  `VIDEO_SRC` is the `blob:` address from your session. Replace it with a public
  URL or a `staticFile()` path before rendering the file outside the studio.

## License

MIT for this app. Generated visual, texture and audio assets are CC0-1.0. The
bundled font families are SIL Open Font License 1.1 - keep each `OFL.txt` with
its font files when you redistribute them. Remotion and your
hosting provider have their own usage/license terms; review them before a public
commercial launch: <https://remotion.dev/license> and <https://vercel.com/pricing>.
