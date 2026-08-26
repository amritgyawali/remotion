# The Ultimate Browser Video Editor — Master Blueprint (2026)

> **Goal:** ship a web-based video editor that beats CapCut on speed, privacy, and depth — 100% local media (files never leave the device), 150+ editing tools, GPU-accelerated preview, real MP4/WebM rendering in the browser, and an editing session that survives refreshes, crashes and closed tabs.
>
> **Prepared for:** anup — 2026-08-26
>
> **Status:** research + architecture + implementation plan (build-ready)

---

## Table of contents

0. [Executive summary & product thesis](#part-0)
1. [The 2026 competitive landscape — top 5 editors, full feature inventories](#part-1)
2. [The 200+ tool inventory (what to build, and how to build each one)](#part-2)
3. [System architecture blueprint (engine design)](#part-3)
4. [Local-first data layer: device files, local DB, crash-proof editing](#part-4)
5. [The "Magic Fix" pipeline — turning a bad video into a great one](#part-5)
6. [UI/UX design system + interaction specification](#part-6)
7. [Export & final rendering pipeline](#part-7)
8. [Tech stack, repo structure, code contracts](#part-8)
9. [Implementation plan — 12 month roadmap with phases](#part-9)
10. [Performance engineering, QA & device matrix](#part-10)
11. [Strategy: how to actually beat CapCut](#part-11)
12. [Risks, legal, licensing & privacy](#part-12)
13. [Appendices — schemas, shortcuts, checklists, sources](#part-13)

---

<a name="part-0"></a>

# PART 0 — Executive summary & product thesis

## 0.1 One-paragraph summary

Build a **GPU-first, local-first, non-linear editor (NLE) that runs entirely in the browser**. Decode with **WebCodecs** (hardware decoders already in the browser), composite with **WebGPU** (zero-copy `texture_external` from `VideoFrame`, WGSL shader passes), mix audio with **Web Audio / AudioWorklet**, run AI locally with **ONNX Runtime Web / Transformers.js on WebGPU**, mux the final file with **Mediabunny** (pure-TS MP4/WebM/MKV writer built on WebCodecs), and keep **every byte of media on the user's disk** using **File System Access handles persisted in IndexedDB** plus **OPFS** for caches and proxies. The project document itself (timeline, effects, settings, undo history) lives in a **local database (IndexedDB) with a write-ahead command log**, so a refresh, crash, or battery death loses at most ~1 second of work.

## 0.2 The five product bets

| # | Bet | Why it wins vs CapCut |
|---|-----|-----------------------|
| 1 | **Privacy as a feature** — media never uploads; no account required to edit | CapCut/Descript/Veed upload footage to servers. "Your video never leaves your laptop" is a headline nobody in the category can copy quickly |
| 2 | **Zero-wait editing** — no upload bar, no queue, no render credits | Cloud editors are gated by upload time and render minutes; local GPU export is instant and unlimited |
| 3 | **One-tap "Make It Good"** — a single button that runs a 12-stage repair + polish pipeline | CapCut has scattered auto-tools; a single deterministic "fix everything" button with a visible before/after is a stronger promise |
| 4 | **Never lose work** — crash-proof, refresh-proof, offline-capable (PWA) | Web editors routinely lose state on refresh; making that impossible is a trust moat |
| 5 | **Pro depth under a simple skin** — Simple mode → Pro mode progressive disclosure (keyframes, curves, masks, scopes, node effects) | Beginners get CapCut simplicity; pros get Resolve-class control in the same tab |

## 0.3 Non-negotiable constraints (write these on the wall)

1. **No media upload, ever** (unless the user explicitly asks for a cloud AI feature and confirms).
2. **Preview must hold 30 fps at 1080p** on a mid-range 2022 laptop, using proxies when needed.
3. **Export must be frame-exact and deterministic** — the same project always renders the same bytes.
4. **A refresh must restore the exact editing state** including playhead, zoom, selection, panel layout and undo stack.
5. **Every feature must degrade gracefully**: WebGPU → WebGL2 → Canvas2D; WebCodecs → ffmpeg.wasm; File System Access → OPFS copy.
6. **Accessibility is not optional**: full keyboard operation, WCAG AA contrast, `prefers-reduced-motion` respected.

## 0.4 What is genuinely hard (be honest about it)

| Hard problem | Reality | Mitigation (detailed later) |
|---|---|---|
| Frame-accurate seeking | Compressed video only seeks to keyframes; long-GOP phone footage can be 5–10 s between keyframes | Build a packet index + decode-from-keyframe walker + dense-keyframe proxies (§3.6, §4.7) |
| Memory | A single 4K `VideoFrame` ≈ 30 MB of GPU memory; leaking frames kills the tab | Strict frame pool + `frame.close()` discipline + backpressure on decoder queues (§3.9) |
| Browser file access | The web **cannot** store an absolute path like `C:\Users\anup\clip.mp4` and silently re-read it | Store an opaque `FileSystemFileHandle` in IndexedDB + fingerprint + "Reconnect media" relink flow (§4.3–4.5) |
| Safari / iOS | No `showOpenFilePicker`, tighter memory, aggressive storage eviction | Mobile path = copy-into-OPFS + `navigator.storage.persist()` + smaller proxies (§4.6) |
| Audio codecs | AAC encoding is not guaranteed in every browser | Probe with `AudioEncoder.isConfigSupported()`, fall back to Opus/WebM or ffmpeg.wasm AAC (§7.4) |
| Codec patents | H.264/HEVC are patent-encumbered | Prefer AV1/VP9 for internal use; expose H.264 through the browser's own encoder; get legal review (§12.2) |

---

<a name="part-1"></a>

# PART 1 — The 2026 competitive landscape

## 1.1 Top 5 editors of 2026 (and exactly what they ship)

Ranking logic: reach + feature depth + browser relevance. #1–#3 define the feature ceiling; #4–#5 define the workflow ideas worth stealing.

### #1 — CapCut (ByteDance) — the volume leader and your direct benchmark

Desktop + mobile + **web ("CapCut Web", including a Director Mode / web video studio)**, 200M+ monthly active users, free tier with a Pro tier at roughly $19.99/mo, $179.99/yr, teams from ~$24.99/mo.

**Feature inventory (what you must match):**

- **Core editing:** multi-track timeline, split/trim/ripple delete, speed ramping (curve presets), reverse, freeze frame, crop, rotate/flip, transform (scale/position/rotation/opacity), keyframes on any property, picture-in-picture, mask shapes with feather, blend modes, layer ordering, groups, canvas/aspect presets (9:16, 1:1, 4:5, 16:9, 4:3, 2.35:1, custom), background fill (color/blur/image/pattern), snapping, magnetic-ish auto-align.
- **Text:** rich text styles, presets, fonts (large library incl. non-Latin), stroke/shadow/glow/gradient/3D, text animations in/out/loop, text templates, text-to-speech, auto captions with word-level timing and karaoke highlight, translate captions, batch caption styling, lyric/subtitle sync, sticker text, dynamic captions.
- **Audio:** music library, sound effects, voice recording, voice changer/filters, voice cloning-adjacent effects, beat detection + auto beat markers, audio ducking, noise reduction, de-reverb, volume keyframes, fade in/out, EQ presets, audio split/detach, audio-to-captions, TTS voices, audio extraction.
- **AI toolbox:** background remover (video + image), auto-cutout of objects, motion tracking, auto reframe (aspect conversion with subject tracking), retouch/beautify (face smoothing, reshape, teeth, eyes, body editor), AI expand/inpaint, object removal, relight, AI image generator, AI video generator (text-to-video, image-to-video, incl. third-party models), AI script writer, AI avatars/presenters, AI product ads, upscale/enhance/denoise, stabilization, colorize, slow-motion interpolation, long-video-to-shorts, auto highlights, template matching to trending sounds.
- **Effects/looks:** filters, LUT-ish looks, adjustment layer, curves + HSL, color wheels (lite), video effects library (glitch, VHS, bokeh, light leaks, particles), transitions library, animations library, stickers/GIFs, overlays, green screen (chroma key), frame/border, blur/mosaic/pixelate, cinematic bars, zoom/pan (Ken Burns), 3D zoom on photos.
- **Workflow:** templates ecosystem (huge, trend-driven), cloud projects, team collaboration, brand kit, share-to-TikTok pipeline, export presets, watermark-free export on many tiers, mobile↔desktop project sync.

**Where CapCut is beatable:** everything is cloud-tied and account-gated; uploads are slow on weak connections (very relevant for Nepal/South Asia bandwidth); the Pro paywall is aggressive; timeline precision and pro color/audio tools are shallow; no real node/graph effects; no offline mode; privacy concerns are a live topic.

### #2 — Adobe Premiere Pro (2026 releases, v26.x) — the professional yardstick

- **Generative AI:** **Generative Extend** (Firefly) — extend a clip up to ~2 s of video and ~10 s of audio, with regenerate/variations and revert-to-original; AI video/image-to-video generation, AI storyboard, AI translation, AI music.
- **AI editing assists:** text-based editing from transcript, **Scene Edit Detection** (auto-cut a flattened export back into clips), **Auto Color**, **Morph Cut** (jump-cut smoothing), Enhance Speech, auto ducking, Remix (music retiming), Auto Reframe, Speech to Text + captions (2026 adds **single-word captions** for social), media intelligence search (find footage by content), auto sequence creation from mood boards.
- **Craft tools:** unlimited tracks, nested sequences, multicam, proxies, Lumetri color (curves/wheels/HSL secondaries/LUTs/scopes), Essential Graphics with responsive design, motion graphics templates, masks + tracking, Warp Stabilizer, time remapping with bezier ease, Essential Sound panel, loudness normalization, After Effects dynamic link, color management, hardware encode/decode, extensive export presets.
- **Steal this:** the transcript-driven editing loop, Scene Edit Detection, Morph Cut, and "properties panel that shows only what's relevant".

### #3 — DaVinci Resolve 20 / 21 (Blackmagic) — the depth ceiling, free tier included

- Resolve 20 shipped **100+ new features** including **AI IntelliScript** (build a timeline from a text script), **AI Animated Subtitles** (word-pop captions), **AI Multicam SmartSwitch** (cut multicam by who is speaking), **AI Audio Assistant** (auto mix), **AI Dialogue Matcher**, **AI Music Editor**, **AI Beat Detector**, **Voice Convert**, **Magic Mask 2**, improved depth map, optical-flow vector tools, multi-layer compositing, keyframe editor, chroma warp.
- Resolve 21 adds a **Photo page**, AI media search by content, slate/metadata reading, de-aging, blemish removal, better keyframing, MultiMaster trim passes, layer-list node graphs, group versions, 70+ new Fusion graphics tools, Fairlight folder tracks, immersive/VR deliverables.
- **Neural Engine baseline features:** face recognition/sorting, object detection, smart reframe, speed warp retiming, super scale (upscale), auto color, color matching, magic mask, depth map, relight, object removal, audio classification.
- **Steal this:** the *page* metaphor (Cut / Edit / Color / Fusion / Fairlight / Deliver) as an answer to "how do I hide complexity without hiding power", node-based color, and scopes.

### #4 — Descript — the text-first workflow that changed expectations

- **Edit video by editing the transcript**; delete a word → the video cut happens. Filler-word ("um") removal, ripple-safe.
- **Underlord** agentic AI co-editor (20+ AI tools), Studio Sound (voice cleanup), Eye Contact (gaze correction), Regenerate (fix a misspoken word with a voice clone), Green Screen (no green screen needed), Overdub/voice cloning, AI avatars, translation + dubbing in 30+ languages with proofread, auto clips for social, screen recording, remote recording rooms, brand studio/templates, watermark-free export, 4K on paid tiers.
- **Steal this:** transcript as a first-class editing surface, and "AI credits" framing for expensive operations.

### #5 — The browser-native "fast content" tier: Clipchamp, Canva Video, VEED, Kapwing, OpusClip, Submagic, Vizard

These are your *actual* traffic competitors on the open web, and each contributes one dominant idea:

- **Clipchamp (Microsoft):** the friendliest browser timeline; templates + stock; strong export presets; deep OS/Office integration.
- **Canva Video:** design-system-driven editing — brand kit, magic switch between formats, template-first flow, collaboration.
- **VEED:** subtitle/caption powerhouse, translate + dub, clean modern UI, screen record.
- **Kapwing:** repurposing utility belt (resize, subtitle, trim, meme tools) with excellent SEO-per-tool landing pages.
- **OpusClip / Vizard / Submagic:** long-form → shorts with virality scoring, auto B-roll, animated captions, auto reframe — the highest-growth 2026 category.

**Structural lesson from this tier:** they win traffic with **one-tool landing pages** ("remove background from video", "add subtitles", "crop video for TikTok"), then upsell into the full editor. You should ship the same funnel: ~40 single-purpose tool pages, all powered by the same local engine.

## 1.2 Feature gap matrix — what "better than CapCut" concretely means

| Capability | CapCut | Premiere | Resolve | Descript | Browser tier | **You (target)** |
|---|---|---|---|---|---|---|
| Runs fully in browser | partial | partial | no | yes | yes | **yes (PWA, offline)** |
| Media stays on device | no | n/a | n/a | no | no | **yes — core promise** |
| Works with no login | no | no | yes | no | mostly no | **yes** |
| Unlimited watermark-free export | no | yes | yes | tiered | tiered | **yes (local GPU)** |
| Frame-accurate pro timeline | partial | yes | yes | no | no | **yes** |
| Node/graph effects | no | via AE | yes | no | no | **yes (WGSL node graph)** |
| Scopes + real color grading | shallow | yes | yes | no | no | **yes** |
| One-click auto repair of bad footage | partial | partial | partial | partial | partial | **yes (Magic Fix, 12 stages)** |
| Transcript-based editing | partial | yes | yes | yes | partial | **yes (local Whisper)** |
| Local AI (no server cost) | no | no | on-device GPU | no | no | **yes (WebGPU ONNX)** |
| Crash/refresh-proof project | cloud-dependent | yes | yes | cloud | weak | **yes (WAL + IndexedDB)** |
| Offline editing | no | yes | yes | no | no | **yes** |
| Devanagari/Nepali text shaping + UI | weak | yes | yes | weak | weak | **yes (HarfBuzz WASM)** |

---

<a name="part-2"></a>

# PART 2 — The tool inventory: 206 tools, each with an implementation route

How to read this: every entry is **what the user sees** → *Impl:* **how you build it in a browser**. Legend: `WGSL` = WebGPU compute/fragment pass, `WA` = WebAssembly module, `ONNX` = local neural model via ONNX Runtime Web / Transformers.js on WebGPU, `WAAPI` = Web Audio API, `WC` = WebCodecs, `CPU` = plain TypeScript in a Worker.

## A. Media ingest, assets & organization (1–14)

1. **Add media from device** — pick files/folders from local disk, nothing uploaded. *Impl:* `showOpenFilePicker()` / `showDirectoryPicker()`, fallback `<input type="file" multiple>`.
2. **Drag & drop import** — drop files or a whole folder onto the app. *Impl:* `DataTransferItem.getAsFileSystemHandle()` to capture re-openable handles.
3. **Media pool / bins** — folders, colors, ratings, search, list/grid/filmstrip views. *Impl:* IndexedDB `assets` table + virtualized list.
4. **Auto metadata extraction** — duration, resolution, fps, codec, bitrate, rotation, color primaries, audio layout, creation date, GPS. *Impl:* Mediabunny/MP4Box parse of container + `VideoDecoder.configure()` probe.
5. **Thumbnail + filmstrip generation** — sprite sheets for timeline clips. *Impl:* seek-and-decode at N intervals → draw to `OffscreenCanvas` → store WebP in OPFS.
6. **Audio waveform generation** — peak + RMS pyramids at multiple zoom levels. *Impl:* `AudioDecoder` → min/max reduction in Worker → binary peak file in OPFS.
7. **Proxy / optimized media generation** — 540p or 720p dense-keyframe copies for buttery scrubbing. *Impl:* `VideoDecoder` → downscale WGSL → `VideoEncoder` (keyframe every 6–12 frames) → Mediabunny → OPFS.
8. **Smart proxy switching** — proxy while scrubbing, full-res when paused/exporting. *Impl:* dual source resolver keyed on playback state.
9. **Scene detection on import** — split a long file into shots automatically. *Impl:* per-frame histogram + edge-change delta on GPU, threshold + hysteresis (mirrors Premiere's Scene Edit Detection).
10. **Silence detection** — mark and optionally remove dead air. *Impl:* RMS/LUFS gate with min-duration and padding, CPU in Worker.
11. **Duplicate / similar clip finder** — avoid re-importing the same file. *Impl:* fingerprint = name + size + `lastModified` + SHA-256 of first & last 1 MB.
12. **Content-based media search** — "find the shots with a dog" (Resolve/Premiere parity). *Impl:* CLIP image embeddings per keyframe (ONNX) stored in IndexedDB + cosine search.
13. **Speech-to-text indexing of all assets** — search footage by spoken words. *Impl:* Whisper tiny/base (ONNX, WebGPU) transcript per asset, stored locally.
14. **Missing-media reconnect (relink)** — file moved/renamed → guided re-pick with auto-match. *Impl:* fingerprint match + `requestPermission()` inside a click handler (§4.5).

## B. Core timeline editing (15–38)

15. **Multi-track timeline** — unlimited video/audio/text/adjustment tracks. *Impl:* immutable project doc + virtualized canvas/DOM hybrid renderer.
16. **Insert / overwrite / replace edits** — F9/F10/F11 pro edit modes. *Impl:* pure functions on the timeline model (command objects).
17. **Blade / razor split** — cut at playhead or pointer (`B`, `Cmd/Ctrl+K`). *Impl:* split clip into two clip records sharing the source.
18. **Trim in / out** — drag edges with sub-frame snapping and live preview overlay. *Impl:* pointer capture + preview-time override (mobile pattern from img.ly's timeline research).
19. **Ripple trim / ripple delete** — close the gap automatically (`T`, `Q`, `W`). *Impl:* shift all downstream clips by delta in one command.
20. **Roll / slip / slide edits** — the four classic trim types. *Impl:* dual-edge command with source-offset math.
21. **JKL shuttle + dynamic trim** — variable-speed playback and trim-while-playing. *Impl:* rate-driven scheduler, `K` pause, `Shift+J/L` speed steps.
22. **Three-point editing with I/O marks** — source and timeline marks. *Impl:* mark model + edit executor.
23. **Snapping** — to playhead, clip edges, markers, beats, keyframes (`N` to toggle). *Impl:* candidate-set nearest-neighbour within pixel tolerance.
24. **Magnetic timeline mode** — optional auto-close gaps like CapCut. *Impl:* post-command normalization pass.
25. **Track locking / mute / solo / hide / height / color** — per-track state. *Impl:* track flags in project doc.
26. **Grouping & compound clips (nested sequences)** — collapse many clips into one. *Impl:* recursive composition node in the render graph.
27. **Multicam sync & switching** — sync by timecode/audio, cut between angles. *Impl:* cross-correlation of audio peaks; angle switcher command.
28. **Markers & chapters** — colored, named, comment-able; export as YouTube chapters. *Impl:* marker list + text export.
29. **Range selection & bulk operations** — select across tracks, nudge, delete, retime. *Impl:* selection set + batched commands.
30. **Copy/paste attributes** — paste only effects, or only transform, or only color. *Impl:* attribute-scoped clipboard payload.
31. **Unlimited undo / redo with named history** — jump back to any state. *Impl:* command pattern + periodic snapshots (§4.8).
32. **Auto-save + version snapshots** — timeline of "restore points". *Impl:* WAL + compaction checkpoints in IndexedDB.
33. **Timeline zoom & fit** — wheel/pinch zoom, `Shift+Z` fit, zoom-to-selection. *Impl:* time↔pixel transform with anchored zoom.
34. **Playhead scrub with audio scrubbing** — hear while dragging. *Impl:* granular resample of decoded PCM at scrub rate.
35. **Frame-step & timecode entry** — arrow keys, `+`/`-` numeric offsets, SMPTE timecode field. *Impl:* rational-time model (`num/den`) to avoid float drift.
36. **Clip enable/disable & solo** — A/B a change without deleting. *Impl:* clip flag honored by the render graph.
37. **Track/clip search & filter** — find clips by name, tag, effect, or transcript word. *Impl:* in-memory index.
38. **Storyboard / list mode** — a simple card-based sequence for beginners that maps 1:1 to the timeline. *Impl:* alternate view over the same document.

## C. Time & speed (39–46)

39. **Constant speed change** — 0.1x–16x with pitch-preserved audio. *Impl:* time mapping + WSOLA/phase-vocoder pitch correction (WA).
40. **Speed ramping with curves** — bezier-eased ramps, presets (Hero, Bullet, Jump Cut). *Impl:* piecewise time-warp function on source time.
41. **Reverse playback** — backwards clips. *Impl:* reverse-decode via GOP cache or pre-rendered reversed proxy.
42. **Freeze frame / hold** — insert a still. *Impl:* clip with zero time-derivative.
43. **Optical-flow frame interpolation (smooth slow-mo)** — real 120 fps look from 30 fps. *Impl:* RIFE-class ONNX model or GPU optical-flow WGSL, cached to OPFS.
44. **Motion blur synthesis** — believable blur on fast motion or speed-ups. *Impl:* multi-sample temporal accumulation in WGSL.
45. **Time remapping keyframes** — draw the time curve directly. *Impl:* keyframed time-map with monotonic constraint.
46. **Beat-synced auto cut** — cut clips exactly to detected beats. *Impl:* onset/tempo detection (WAAPI + CPU) → cut commands at beat times.

## D. Frame, transform, layout & framing (47–58)

47. **Transform (position/scale/rotate/anchor/opacity)** — with on-canvas handles. *Impl:* 4×4 matrix per layer, single WGSL pass.
48. **Crop & pan/zoom (Ken Burns)** — animated crop rectangles. *Impl:* keyframed UV rect.
49. **Aspect-ratio presets & safe areas** — 9:16, 1:1, 4:5, 16:9, 2.39:1, custom, with title/action safe overlays. *Impl:* canvas config + overlay guides.
50. **Auto Reframe with subject tracking** — convert 16:9 to 9:16 keeping the subject centered. *Impl:* face/person detection (ONNX) + smoothed crop path with dead-zone.
51. **Background fill for vertical conversion** — blurred/mirrored/color/gradient/generated backdrop. *Impl:* dual-draw with separable gaussian blur WGSL.
52. **Multi-layer PiP with corner presets** — reaction-video layouts. *Impl:* layout presets writing transform values.
53. **Split screen layouts** — 2/3/4-up grids, diagonal splits, templates. *Impl:* layout generator + per-cell mask.
54. **Distortion & perspective corner-pin** — place video on a screen or wall. *Impl:* homography matrix in WGSL.
55. **Lens correction / de-fish** — fix GoPro/action-cam bulge. *Impl:* Brown–Conrady polynomial undistort WGSL.
56. **Rolling-shutter & horizon leveling** — straighten wobbly phone footage. *Impl:* per-row shear estimated from motion vectors.
57. **Stabilization** — smooth handheld shake with adjustable strength + auto-crop. *Impl:* pyramidal Lucas–Kanade / feature tracking (WA or WGSL) → low-pass camera path → warp.
58. **Grid, rulers, guides & alignment tools** — align/distribute layers. *Impl:* pure UI math over layer bounds.

## E. Color & tone (59–76)

59. **Auto Color / auto white balance** — one-click correction. *Impl:* gray-world + percentile black/white point from a GPU histogram readback.
60. **Exposure / contrast / brightness** — primary sliders. *Impl:* linear-light WGSL ops.
61. **Highlights / shadows / whites / blacks recovery** — rescue clipped footage. *Impl:* luminance-masked tone curve.
62. **Temperature / tint** — Kelvin-based WB. *Impl:* chromatic adaptation matrix (Bradford) in WGSL.
63. **Saturation / vibrance / natural saturation** — protect skin tones. *Impl:* saturation-weighted boost with skin-hue guard.
64. **RGB curves + luma curve** — full curve editor with bezier control points. *Impl:* curve → 256/1024-entry 1D LUT texture.
65. **Color wheels (lift/gamma/gain/offset)** — Resolve-style trackballs. *Impl:* ASC-CDL math in WGSL.
66. **HSL secondaries / qualifier** — select a hue range and change only that. *Impl:* HSL keyer producing a soft mask + adjustment.
67. **3D LUT support (.cube) + built-in look library** — import creator LUTs. *Impl:* parse `.cube` → 3D texture → trilinear sample WGSL.
68. **LUT intensity blending + before/after split view** — taste control. *Impl:* mix factor + split-screen compositor.
69. **Shot match / color match** — match clip B to clip A's look. *Impl:* per-channel mean/std transfer in Lab, optional histogram matching.
70. **Skin-tone protect & face-aware grading** — keep faces natural. *Impl:* face landmarks (ONNX) → soft mask → masked grade.
71. **Scopes: waveform, RGB parade, vectorscope, histogram** — broadcast-legal grading. *Impl:* WGSL compute reduction into a scope texture, drawn on a second canvas.
72. **Film emulation & grain** — stocks + realistic grain with size/roughness. *Impl:* LUT + tiled blue-noise/perlin grain in WGSL.
73. **Bleach bypass / teal-orange / cinematic presets** — instant looks. *Impl:* preset stacks of the above nodes.
74. **Adjustment layers** — grade everything below on the timeline. *Impl:* render-graph node applied to the composited result.
75. **HDR-aware pipeline & tone mapping** — handle HLG/PQ phone footage without washed-out results. *Impl:* transfer-function decode → linear → ACES-ish tonemap → sRGB encode.
76. **Color management & working space** — tag Rec.709/sRGB, optional linear compositing. *Impl:* per-asset primaries/transfer from container metadata.

## F. Keying, masking & compositing (77–90)

77. **Chroma key (green/blue screen)** — tolerance, softness, spill suppression, edge choke, light wrap. *Impl:* YCbCr distance keyer WGSL + despill pass.
78. **AI background removal (no green screen)** — CapCut/Descript parity. *Impl:* MediaPipe Selfie Segmentation or a matting model (ONNX/WebGPU); note: Robust Video Matting is **GPL-3.0** — avoid in closed source (§12.3).
79. **Temporal mask smoothing** — stop the matte from flickering. *Impl:* EMA blend of previous mask + guided filter WGSL.
80. **Object selection & masking ("magic mask")** — click a subject, track it. *Impl:* SAM-class encoder/decoder ONNX + propagate with optical flow.
81. **Shape masks (rect/ellipse/polygon/bezier)** — with feather, expansion, invert, per-mask blend. *Impl:* SDF evaluation in WGSL; bezier tessellated CPU-side.
82. **Rotoscoping with keyframed masks** — hand-animated masks. *Impl:* keyframed control points + interpolation.
83. **Motion tracking (point/planar)** — pin text or a blur to a moving object. *Impl:* NCC template tracker or KLT in WA; planar via homography.
84. **Object removal / clean plate** — erase a logo, person, or mic. *Impl:* inpainting model (ONNX) per frame + temporal blend, or patch-from-neighbour-frames.
85. **Blur/mosaic/pixelate face or region (auto face blur)** — privacy tool. *Impl:* face detect + tracked mask + blur WGSL.
86. **Blend modes (30+)** — multiply, screen, overlay, add, difference, hue, saturation, color, luminosity… *Impl:* one WGSL function with a mode switch (a shipped WebGPU editor proves 37 modes in a single shader).
87. **Track mattes (luma/alpha)** — use one layer as another's mask. *Impl:* render-graph dependency + channel sampling.
88. **Alpha/transparent media support** — import & export transparent WebM/ProRes-4444-ish. *Impl:* VP9/VP8 alpha in WebM via Mediabunny.
89. **Light wrap / edge blend / matte refine** — make composites believable. *Impl:* dilate/erode + blur of matte + additive edge pass.
90. **Depth-based effects** — fake depth of field, depth-based fog/relight. *Impl:* monocular depth model (ONNX) → depth texture → circular-bokeh blur WGSL.

## G. Effects, transitions & stylization (91–110)

91. **Transitions library (100+)** — dissolve, dip to black/white, wipes, slides, whip pan, zoom, glitch, film burn, luma-matte transitions. *Impl:* parameterized two-input WGSL shaders; luma-matte ones sample a grayscale video/image.
92. **Transition drag-and-drop with duration handles** — `Cmd/Ctrl+T` default transition. *Impl:* transition node between adjacent clips.
93. **Blur family** — gaussian, box, radial, zoom, directional, tilt-shift, lens bokeh. *Impl:* separable + polar-sampling WGSL passes.
94. **Sharpen & clarity / structure / dehaze** — make soft footage crisp. *Impl:* unsharp mask + local-contrast (guided filter) WGSL.
95. **Glow / bloom / light leaks / lens flare** — cinematic light. *Impl:* threshold → mip-chain downsample/upsample bloom WGSL.
96. **Chromatic aberration / vignette / halation** — lens character. *Impl:* per-channel UV offset + radial falloff WGSL.
97. **Glitch / VHS / datamosh / RGB split / scanlines / CRT** — trend effects. *Impl:* noise + block-displacement WGSL with time seed.
98. **Distortion set** — wave, ripple, twirl, bulge, fisheye, mirror/kaleidoscope. *Impl:* UV warp functions WGSL.
99. **Stylize set** — cartoon/posterize, halftone, ASCII, oil paint, pencil sketch, edge detect. *Impl:* quantization + convolution WGSL.
100. **Particles & overlays** — snow, dust, confetti, bokeh lights, rain, fire. *Impl:* GPU particle system (compute shader) + additive-blend video overlays.
101. **Shake / handheld / earthquake camera** — add energy. *Impl:* procedural noise on transform.
102. **Zoom-punch / beat pulse** — auto-scale on the beat. *Impl:* keyframes generated from beat markers.
103. **Speed-line / anime effects & impact frames** — short-form staples. *Impl:* radial-line shader + white-flash frames.
104. **Freeze-frame cutout "pop-out"** — subject frozen with white outline (CapCut classic). *Impl:* segmentation matte → outline dilate → hold frame.
105. **Text-behind-subject effect** — title behind a person. *Impl:* segmentation matte reorders text layer between fg/bg.
106. **3D-ish photo animation (2.5D parallax)** — animate stills with depth. *Impl:* depth map → mesh displacement → camera move.
107. **Effect stacking with reorder, bypass, solo** — an effects rack per clip. *Impl:* ordered effect list → compiled shader chain.
108. **Node graph mode (Pro)** — wire effects/mattes/merges like Fusion. *Impl:* DAG compiled into render passes.
109. **Custom shader plugin SDK** — creators publish WGSL effects. *Impl:* sandboxed WGSL string + a manifest describing uniforms/UI controls (§11.5).
110. **Effect presets & favorites** — save any stack as a one-click look. *Impl:* serialize effect list into the preset store.

## H. Text, titles & captions (111–128)

111. **Rich text engine** — font, size, weight, tracking, leading, alignment, per-character styling. *Impl:* HarfBuzz-WASM shaping → glyph atlas → SDF text rendering in WGSL (needed for correct **Devanagari/Nepali** and Arabic shaping, which Canvas2D handles inconsistently).
112. **Local font loading** — use the fonts on the user's machine. *Impl:* `queryLocalFonts()` where available, plus user-uploaded `.ttf/.otf` stored in OPFS.
113. **Stroke, shadow, glow, gradient, background box, 3D extrude** — title styling. *Impl:* multi-pass SDF effects.
114. **Text presets & title templates** — lower thirds, intros, end cards, quote cards. *Impl:* JSON template with slots + keyframes.
115. **Text animation in/out/loop (typewriter, pop, slide, blur, bounce, wave, glitch)** — per-character or per-word timing. *Impl:* per-glyph transform driven by a stagger function.
116. **Auto captions (word-level)** — local speech-to-text with timestamps. *Impl:* Whisper via Transformers.js on WebGPU (`whisper-tiny.en` ≈ fast, `whisper-base.en` ≈ 145 MB for better accuracy) in a Worker; models cached in IndexedDB.
117. **Karaoke / animated word highlight captions** — the #1 short-form conversion feature (Resolve 20 shipped this as "AI Animated Subtitles"). *Impl:* word timings + per-word highlight shader.
118. **Caption styles library** — Hormozi-style, bounce, box, gradient, emoji-injected. *Impl:* style presets applied to the caption track.
119. **Caption editor with transcript sync** — edit text, split/merge cues, fix timing by dragging. *Impl:* cue list bound to the transcript model.
120. **Transcript-based editing (Descript-style)** — delete a sentence in text, the video cuts. *Impl:* map word timings → timeline ranges → ripple-delete command.
121. **Filler-word & silence removal from transcript** — "remove all 'um'" in one click. *Impl:* token filter → batch cut commands.
122. **Translate captions & subtitles (multi-language)** — 30+ languages. *Impl:* local NLLB/M2M-100 small model (ONNX) or an opt-in cloud API with explicit consent.
123. **Burn-in vs sidecar export** — hardcode captions or export `.srt`/`.vtt`/`.ass`. *Impl:* renderer path vs text serializer.
124. **Text-to-speech voiceover** — generate narration from a script. *Impl:* local Piper/Kokoro-class TTS (ONNX) or Web Speech API; per-language voices incl. Hindi/Nepali.
125. **Auto-emoji & keyword emphasis** — highlight power words, add emoji beats. *Impl:* keyword rules + caption style overrides.
126. **RTL + vertical text support** — Arabic/Hebrew/CJK. *Impl:* bidi + vertical writing modes in the shaper.
127. **Sticker/GIF/emoji layers** — animated stickers with transform + keyframes. *Impl:* APNG/WebP/Lottie decode → texture per frame.
128. **Lottie / vector animation import** — designer-made motion graphics. *Impl:* `lottie-web` rendered to `OffscreenCanvas` → texture.

## I. Motion graphics, keyframes & rigging (129–138)

129. **Keyframe any parameter** — transform, effect values, opacity, audio gain, color. *Impl:* per-property keyframe list with typed interpolation.
130. **Graph editor / value curves** — bezier easing per keyframe with handles. *Impl:* cubic bezier evaluation + curve UI canvas.
131. **Easing presets** — ease in/out, overshoot, spring, bounce, elastic. *Impl:* named easing functions.
132. **Motion paths on canvas** — drag a spatial path for position keyframes. *Impl:* path editing overlay writing keyframes.
133. **Auto-animate ("animate this in")** — pick an entrance/exit and let the system keyframe it. *Impl:* animation recipe generator.
134. **Shapes & drawing layers** — rectangles, ellipses, arrows, lines, freehand, callouts, progress bars. *Impl:* SDF/vector rasterization in WGSL.
135. **Data-driven graphics** — counters, progress rings, subscriber bars, charts from CSV. *Impl:* template + data binding, rendered per frame.
136. **Screen-recording annotations** — zoom-follow-cursor, click ripples, keystroke overlays. *Impl:* pointer log from `getDisplayMedia` capture + auto zoom keyframes.
137. **3D layer transforms (Pro)** — Z position, rotation on 3 axes, perspective camera. *Impl:* full 4×4 MVP matrix per layer in the compositor.
138. **Templates with locked "fill-in" slots** — CapCut-style template consumption + creation. *Impl:* template manifest marking editable slots; render others read-only.

## J. Audio (139–158)

139. **Multi-track audio mixer** — per-track gain, pan, mute, solo, meters. *Impl:* Web Audio graph mirroring the timeline.
140. **Volume keyframes + clip gain** — rubber-band envelope on the clip. *Impl:* `GainNode` automation from keyframes; offline path uses `OfflineAudioContext`.
141. **Fades & crossfades** — linear/log/S-curve. *Impl:* envelope curves.
142. **Loudness normalization (LUFS)** — target -14 LUFS for YouTube/social, -23 for broadcast. *Impl:* ITU-R BS.1770 K-weighted measurement in an AudioWorklet, then gain trim + true-peak limiter.
143. **True-peak limiter & clip protection** — no distortion on export. *Impl:* lookahead limiter AudioWorklet.
144. **AI noise reduction / denoise** — remove hiss, fans, traffic. *Impl:* RNNoise (WASM) for realtime; DeepFilterNet-class ONNX for quality.
145. **De-reverb / room-echo removal** — fix bathroom-sounding rooms. *Impl:* spectral de-reverb model (ONNX) or spectral subtraction.
146. **Voice enhance / "Studio Sound"** — podcast-grade voice in one click. *Impl:* denoise → de-reverb → EQ → de-esser → compressor → loudness chain.
147. **Auto ducking** — music drops when someone speaks. *Impl:* sidechain envelope follower from the VO track.
148. **Parametric EQ (10-band) + presets** — podcast, phone, bass boost. *Impl:* cascaded `BiquadFilterNode`s (offline mirror for export).
149. **Compressor / gate / de-esser / expander** — dynamics rack. *Impl:* AudioWorklet DSP.
150. **Voice changer & pitch shift** — chipmunk, deep, robot, alien, formant-preserving. *Impl:* phase-vocoder/WSOLA in WASM.
151. **Beat detection & tempo grid** — auto markers on the music. *Impl:* onset detection + tempo estimation (CPU Worker).
152. **Music auto-fit / auto-remix to length** — shorten a song musically, not by fading. *Impl:* beat-aligned cut & crossfade search (Premiere's Remix idea).
153. **Silence cut / auto-jump-cut for talking heads** — tighten dead air. *Impl:* VAD (Silero-class ONNX or RMS gate) → batch ripple deletes.
154. **Audio-only recording (voiceover booth)** — record narration against the timeline with countdown + punch-in. *Impl:* `MediaRecorder`/`AudioWorklet` capture → OPFS.
155. **Screen + camera + mic recording** — build content inside the editor. *Impl:* `getDisplayMedia` + `getUserMedia` → `MediaRecorder` → OPFS → auto-import.
156. **Audio extraction & detach** — split audio from video. *Impl:* separate audio clip referencing the same asset.
157. **Stem separation (vocals / music / drums)** — remove vocals from a song, isolate speech. *Impl:* Demucs-lite/Spleeter-class ONNX in a Worker (heavy → background job with progress).
158. **Sound-effect & music library with local caching** — searchable, tagged, offline after first use. *Impl:* licensed pack downloaded into OPFS.

## K. AI repair & "make it better" tools (159–178)

159. **Magic Fix (one button)** — analyze + repair + polish in one pass (§5). *Impl:* orchestrated pipeline with a visible plan and per-step toggles.
160. **AI upscale to 2K/4K** — rescue 480p footage. *Impl:* Real-ESRGAN/Anime4K-class CNN as WGSL compute (proven at scale: a browser upscaler serving ~250k MAU with zero server cost).
161. **AI denoise (video grain/ISO noise)** — clean night footage. *Impl:* temporal + spatial NN denoise (ONNX), or fast 3D-median WGSL for realtime preview.
162. **Deblur / sharpen recovery** — fix soft focus. *Impl:* deconvolution-style NN (ONNX) with strength slider.
163. **Frame interpolation to 60/120 fps** — smooth choppy video. *Impl:* RIFE-class ONNX.
164. **Auto stabilization** — handheld → tripod look. *Impl:* see #57, applied automatically when shake score is high.
165. **Auto color & exposure repair** — fix dark/washed/overexposed clips. *Impl:* histogram analysis → curve + WB decisions.
166. **Low-light enhancement** — lift shadows without wrecking noise. *Impl:* retinex/curve NN + denoise, order matters (denoise → lift → sharpen).
167. **Face retouch / beautify** — skin smoothing (frequency-separated), blemish removal, eye brighten, teeth whiten, subtle reshape. *Impl:* landmarks (ONNX) → masked bilateral/high-pass WGSL. Ship conservative defaults + an obvious off switch.
168. **Relight / studio light** — fake a key light on a face. *Impl:* depth/normal estimate → lambertian relight WGSL.
169. **Eye-contact correction** — gaze looks at camera (Descript parity). *Impl:* gaze-redirection model (ONNX) on the eye region only.
170. **Auto highlights / best-moments detection** — make a 30 s cut from 30 min. *Impl:* score frames on motion + faces + speech energy + laughter + scene novelty → pick top segments → build a timeline.
171. **Long-video → shorts (auto clipping)** — the OpusClip/Vizard category. *Impl:* transcript topic segmentation + hook detection → vertical reframe + captions → export queue.
172. **Virality/quality score with actionable notes** — "hook is weak in first 1.5 s", "audio is 6 LUFS too quiet". *Impl:* rule engine over the analysis metrics (fully local, explainable).
173. **Auto B-roll suggestions** — propose stock/local clips per transcript line. *Impl:* CLIP text→image search over the user's own media first (privacy-friendly), then optional stock.
174. **Auto chapters & summary** — YouTube chapters + description draft. *Impl:* transcript segmentation + local summarizer (small LLM ONNX) or opt-in cloud.
175. **Smart crop for every platform in one action** — render 9:16, 1:1, 16:9 variants together. *Impl:* multi-output export with per-output reframe paths.
176. **Auto thumbnail generator** — pick the best frame + add title text. *Impl:* frame scoring (sharpness, faces, smiles, exposure) + title template.
177. **Object/logo removal** — see #84, exposed as a one-click brush.
178. **Audio-to-video sync fix** — correct A/V drift from screen recordings. *Impl:* cross-correlate audio with reference, apply offset.

## L. Export, delivery & project operations (179–192)

179. **Local GPU export to MP4 (H.264/HEVC) & WebM (VP9/AV1)** — no server, no queue, no watermark. *Impl:* WGSL composite → `VideoFrame` → `VideoEncoder` → Mediabunny mux → write via File System Access.
180. **Platform presets** — YouTube 4K/1080p, Shorts/Reels/TikTok, Instagram feed, Facebook, X, WhatsApp-friendly small, LinkedIn, plus "Master (high bitrate)". *Impl:* preset table of resolution/fps/bitrate/codec/loudness.
181. **Custom export dialog** — resolution, fps, bitrate mode (CBR/VBR/quality), keyframe interval, profile/level, audio codec/bitrate/sample rate, color space. *Impl:* validated against `VideoEncoder.isConfigSupported()` before enabling.
182. **Export queue with background rendering** — queue several outputs, keep editing. *Impl:* dedicated render Worker pool + job store in IndexedDB.
183. **Pause / resume / cancel export + crash-resume** — resume a 40-minute render after a crash. *Impl:* chunked segment rendering (e.g. 10 s segments) written to OPFS, then concatenated.
184. **Progress with real ETA + live preview thumbnail** — trust while waiting. *Impl:* frames-done/rate estimator + periodic frame snapshot.
185. **Export range / selection only / marked range** — render a slice. *Impl:* time-range parameter on the render job.
186. **Frame / still export (PNG/JPEG/WebP)** — grab thumbnails. *Impl:* single-frame render → `convertToBlob()`.
187. **GIF / animated WebP export** — short loops. *Impl:* frame quantization + gif.js-class WASM encoder.
188. **Audio-only export (MP3/WAV/M4A)** — podcast cut. *Impl:* `OfflineAudioContext` mixdown → `AudioEncoder`/WAV writer → Mediabunny.
189. **Export presets save/share** — team-standard outputs. *Impl:* preset objects in local DB, exportable as JSON.
190. **Project save / open / duplicate / archive** — `.vproj` JSON (+ optional bundle with media copies). *Impl:* serialize the document; bundle = ZIP written via streaming.
191. **Import/export interchange** — EDL/XML/AAF-lite out for pro handoff, `.srt/.vtt` for captions, JSON for automation. *Impl:* serializers per format (start with EDL + FCPXML-lite).
192. **Batch operations** — apply a preset/caption style/export to many projects. *Impl:* job queue over the project list.

## M. Collaboration, learning & quality-of-life (193–206)

193. **Offline-first PWA** — install to desktop/home screen, works with no internet. *Impl:* service worker precache + `navigator.storage.persist()`.
194. **Command palette (`Cmd/Ctrl+K`)** — every action searchable by name. *Impl:* central command registry (same registry powers shortcuts + menus + AI actions).
195. **AI assistant sidebar** — "cut the silences, add captions, make it 9:16" → it executes real commands. *Impl:* LLM → structured command calls against the registry, with a preview/undo step.
196. **Fully remappable keyboard shortcuts + Premiere/Resolve/CapCut presets** — pros switch in minutes. *Impl:* keymap JSON in local DB.
197. **Workspace layouts** — Edit / Color / Audio / Caption / Export layouts, saved per user. *Impl:* persisted panel geometry.
198. **Interactive onboarding & contextual coach marks** — first-run "make your first cut" in 60 s. *Impl:* step machine tied to real UI events.
199. **Templates gallery (local + community)** — one-tap trend videos. *Impl:* template manifests + downloadable asset packs.
200. **Auto-recovery dialog after a crash** — "Restore your session from 12 seconds ago?". *Impl:* WAL replay (§4.9).
201. **Storage manager** — show cache/proxy usage, quota, one-click cleanup. *Impl:* `navigator.storage.estimate()` + OPFS walk.
202. **Performance mode switch** — quality vs speed preview (1/1, 1/2, 1/4 resolution, effects bypass). *Impl:* render-scale parameter.
203. **Multi-tab safety** — only one tab may write a project; others open read-only. *Impl:* Web Locks + BroadcastChannel.
204. **Optional cloud sync of *project files only*** — tiny JSON sync, media stays local. *Impl:* encrypted document sync; media referenced by fingerprint with relink on the other device.
205. **Share a review link (opt-in render upload)** — only the exported file, only if asked. *Impl:* explicit consent screen; default off.
206. **Localized UI (English, नेपाली, हिन्दी + more) with correct Indic shaping** — a real edge in South Asia. *Impl:* i18n bundles + HarfBuzz shaping in both UI and titles.

> **Count: 206 tools.** That is comfortably past the "100+" requirement, and each entry has a concrete browser implementation route. Phase priority for these is set in §9.

---

<a name="part-3"></a>

# PART 3 — System architecture blueprint (the engine)

## 3.1 The 8-layer architecture

```
┌───────────────────────────────────────────────────────────────────┐
│ L8  Shell / PWA: routing, service worker, install, updates, i18n         │
├───────────────────────────────────────────────────────────────────┤
│ L7  UI layer (React): panels, timeline canvas, inspector, dialogs        │
├───────────────────────────────────────────────────────────────────┤
│ L6  Command layer: every mutation is a Command (undo/redo, AI, macros)   │
├───────────────────────────────────────────────────────────────────┤
│ L5  Project document (immutable state): tracks, clips, effects, assets   │
├───────────────────────────────────────────────────────────────────┤
│ L4  Persistence: IndexedDB (doc + WAL + handles) | OPFS (media caches)   │
├───────────────────────────────────────────────────────────────────┤
│ L3  Scheduler: playback clock, frame budget, job queues, backpressure    │
├───────────────────────────────────────────────────────────────────┤
│ L2  Media engine: demux, decode, frame cache, render graph, audio graph  │
├───────────────────────────────────────────────────────────────────┤
│ L1  Platform: WebCodecs | WebGPU/WebGL2 | Web Audio | WASM | OPFS | IDB  │
└───────────────────────────────────────────────────────────────────┘
```

**Golden rule:** the UI never touches the platform layer directly. UI → Command → Document → (Scheduler → Engine). This is what makes undo, autosave, AI automation, macros, and testing all fall out for free.

## 3.2 Thread / worker topology

Browsers give you one main thread; a video editor needs six or more. Use `Worker` + `SharedArrayBuffer` (needs COOP/COEP headers) or transferables.

| Thread | Responsibility | Never does |
|---|---|---|
| **Main** | React UI, input, panel layout, `requestAnimationFrame` compositing calls | decode, encode, file I/O, heavy math |
| **Decode workers (2–4)** | `VideoDecoder` per active source, packet reading, frame delivery | GPU pass authoring |
| **Render worker** | WebGPU device, WGSL passes, offscreen canvas for the preview | DOM access |
| **Audio worklet + audio worker** | realtime mixing/DSP; waveform + LUFS analysis | blocking work in the worklet |
| **AI worker(s)** | ONNX/Transformers.js sessions (Whisper, segmentation, upscale) | touching the render graph |
| **Persistence worker** | OPFS sync access handles, IndexedDB writes, WAL flush, proxy generation | UI state |
| **Export worker(s)** | deterministic render + encode + mux jobs | preview rendering |

Communication: a single typed message bus (`postMessage` with a discriminated-union protocol). Frames move as **transferable** `VideoFrame`s; never structured-clone pixel buffers.

## 3.3 Module map (packages)

```
@ve/core-model        immutable project document, rational time, schema + zod validation, migrations
@ve/commands          every mutation (split, trim, addEffect...), inverse ops, macro composition
@ve/engine-media      demux/decode, packet index, frame cache, proxy builder, thumbnails, waveforms
@ve/engine-render     WebGPU device, pass compiler, WGSL library, blend modes, node graph -> passes
@ve/engine-audio      Web Audio graph builder, offline mixdown, DSP worklets, loudness
@ve/engine-export     render loop, VideoEncoder/AudioEncoder config probing, Mediabunny muxing, resume
@ve/ai                model registry, download+cache, Whisper, segmentation, upscale, depth, VAD
@ve/persistence       Dexie schema, WAL, snapshots, handle store, OPFS FS abstraction, quota manager
@ve/ui-kit            design tokens, primitives, icons, motion presets, a11y helpers
@ve/timeline          timeline renderer + interactions (hit-testing, drag, snap, zoom, touch)
@ve/app               composition root, routing, PWA, i18n, telemetry (local-only by default)
@ve/tool-pages        single-purpose SEO tool pages reusing the same engine
```

## 3.4 The project document (single source of truth)

Design rules: **flat maps + ids** (not deep trees), **rational time** (`{n, d}`) not floats, **every entity versioned**, **source-of-truth is serializable JSON** so it can be diffed, autosaved, and synced.

```ts
type Rational = { n: number; d: number };            // 1001/30000 = one NTSC frame

interface ProjectDoc {
  schemaVersion: 7;
  id: string;
  name: string;
  createdAt: number; updatedAt: number;
  settings: {
    canvas: { width: number; height: number };
    fps: Rational;                                    // timeline base rate
    sampleRate: 48000 | 44100;
    colorSpace: "srgb" | "rec709" | "display-p3";
    background: { type: "color" | "blur" | "image"; value: string };
    snapping: boolean; magnetic: boolean;
  };
  assets: Record<AssetId, Asset>;
  tracks: TrackId[];                                  // z-order, bottom -> top
  trackMap: Record<TrackId, Track>;
  clipMap: Record<ClipId, Clip>;
  effectMap: Record<EffectId, EffectInstance>;
  transitionMap: Record<TransitionId, Transition>;
  markers: Marker[];
  captions: CaptionTrack[];
  ui: { playhead: Rational; zoom: number; scrollX: number; selection: string[]; layout: string };
}

interface Asset {
  id: AssetId;
  kind: "video" | "audio" | "image" | "font" | "lut" | "lottie";
  name: string;                    // "wedding_A7III_0031.MP4"
  displayPath?: string;            // human-readable hint only, e.g. "D:/shoots/wedding/..."
  handleKey?: string;              // key into the IndexedDB handle store (see 4.3)
  opfsPath?: string;               // set when the file was copied into OPFS (mobile/Safari)
  fingerprint: string;             // name|size|lastModified|sha256(first+last 1MB)
  size: number; lastModified: number;
  probe: {                         // filled at import
    duration: Rational; width: number; height: number;
    fps: Rational; rotation: 0|90|180|270;
    videoCodec: string; audioCodec?: string;
    audioChannels?: number; audioSampleRate?: number;
    bitDepth: number; transfer: "bt709"|"pq"|"hlg"|"srgb";
  };
  derived: {                       // all in OPFS, all regenerable
    proxyPath?: string; waveformPath?: string; thumbsPath?: string;
    packetIndexPath?: string; transcriptId?: string;
  };
  status: "ready" | "missing" | "needs-permission" | "proxying";
}

interface Clip {
  id: ClipId; trackId: TrackId; assetId?: AssetId;
  kind: "video" | "audio" | "image" | "text" | "shape" | "adjustment" | "compound";
  timelineStart: Rational; duration: Rational;      // position on timeline
  sourceIn: Rational;  speed: number | SpeedCurve;   // source trim + retime
  transform: Keyframed<Transform>;
  opacity: Keyframed<number>; blendMode: BlendMode;
  effects: EffectId[]; masks: Mask[];
  audio: { gain: Keyframed<number>; pan: Keyframed<number>; muted: boolean };
  text?: TextSpec; label?: string; enabled: boolean; locked: boolean;
}
```

**Why this shape works:** any command is a small patch on flat maps (cheap to diff and log); the render graph is derived, never stored; `derived` artifacts can be deleted at any time to reclaim space; and `handleKey` + `fingerprint` + `displayPath` together implement the "save the path, pull from the local device" requirement as far as browsers physically allow (§4.2).

## 3.5 Render graph: from document to pixels

For a requested timeline time `t`:

1. **Resolve** — find every clip whose range contains `t` (interval tree per track), ordered bottom→top.
2. **Request frames** — for each video clip, map timeline time → source time through trim + speed curve, then ask the frame cache for that source frame.
3. **Build the pass list** — per clip: decode texture → color-space decode → transform → effect chain → mask → blend into the accumulation target.
4. **Ping-pong composite** — two GPU textures alternate as read/write targets (proven pattern in shipped WebGPU editors); a single WGSL shader with a mode switch can host 30+ blend modes.
5. **Transitions** — a two-input pass reading the outgoing and incoming subtrees.
6. **Output** — present to the preview canvas, or (for export) copy into a `VideoFrame` with the exact presentation timestamp.

```wgsl
// Zero-copy ingestion of a decoded frame, no CPU round-trip.
@group(0) @binding(0) var srcTex : texture_external;  // from importExternalTexture(VideoFrame)
@group(0) @binding(1) var samp   : sampler;
@group(0) @binding(2) var<uniform> u : Uniforms;      // transform, effect params, time

@fragment fn fs(@location(0) uv : vec2f) -> @location(0) vec4f {
  let p = (u.invMatrix * vec3f(uv, 1.0)).xy;          // apply transform in UV space
  var c  = textureSampleBaseClampToEdge(srcTex, samp, p);
  c = applyColor(c, u.color);                          // exposure/contrast/wb/curves/LUT
  c.a *= maskAlpha(p, u.mask) * u.opacity;
  return c;
}
```

**Effect compilation:** each effect is a WGSL snippet + a uniform schema. The pass compiler **fuses** all per-pixel effects of one clip into a single shader when possible (huge win: 8 effects, 1 pass), and only breaks into separate passes for effects that need neighbourhood sampling (blur, sharpen, bloom, distortion with feedback).

## 3.6 Playback engine & frame-accurate seeking

The hardest correctness problem in a browser NLE. Rules that make it work:

1. **Build a packet index at import** — `[{ pts, dts, isKeyframe, byteOffset, size }]` per video track (Mediabunny/MP4Box give you this). Persist it in OPFS so it is built once.
2. **Seek = find the nearest keyframe ≤ target, decode forward, discard until pts ≥ target.** Never trust a `<video>` element's `currentTime` for frame accuracy.
3. **Two caches**: a small **decoded-frame LRU** (GPU textures, e.g. 24–64 frames, capped by bytes) and a bigger **encoded-packet cache** (cheap RAM) so backward stepping does not re-read the file.
4. **Direction-aware prefetch** — during forward playback keep the decoder queue 8–16 frames ahead; during backwards playback decode GOP-at-a-time into the cache.
5. **Scrub mode** — while dragging, target the *proxy* with dense keyframes (a keyframe every 6–12 frames makes any seek < 1 GOP) and drop quality to 1/2 or 1/4 render scale.
6. **Clock** — audio is the master clock (`AudioContext.currentTime`); video frames are presented to the closest vsync via `requestAnimationFrame`; drop frames rather than desync audio.
7. **Rational time everywhere** — all cuts land on exact frame boundaries; float seconds are only used at the API edge.

```ts
async function seekExact(source: MediaSource, target: Rational): Promise<VideoFrame> {
  const t = toMicros(target);
  const kf = source.index.lastKeyframeAtOrBefore(t);
  if (source.decoderPos > t || source.decoderPos < kf.pts) {
    await source.decoder.flush();
    source.decoder.configure(source.config);          // reset on backward seek
    source.decoderPos = kf.pts;
    source.feedFrom(kf);
  }
  for await (const frame of source.frames()) {        // decode forward
    if (frame.timestamp + frame.duration! <= t) { frame.close(); continue; }
    return frame;                                     // caller owns it -> must close()
  }
  throw new Error("seek past end");
}
```

## 3.7 Audio engine

- **Preview:** build a Web Audio graph that mirrors the timeline: `AudioBufferSourceNode` (or `MediaStreamTrackProcessor`-fed buffers) → clip gain → effects (`BiquadFilter`, `DynamicsCompressor`, custom `AudioWorklet`) → track gain/pan → master bus → limiter → destination. Schedule clips slightly ahead (200–500 ms lookahead) and reschedule on edit.
- **Export:** rebuild the *same* graph inside an `OfflineAudioContext` at the target sample rate and render deterministically — this is the only way to guarantee that the exported mix equals the preview mix. Keep one shared "graph builder" function used by both paths.
- **Analysis:** LUFS (K-weighted, ITU-R BS.1770), true peak, RMS, VAD and beats all run in workers on decoded PCM and are cached per asset.

## 3.8 AI subsystem

- **Model registry:** each model has `{ id, task, files, sizeMB, backend: "webgpu" | "wasm", minVram, license }`. Nothing downloads until the user triggers a feature; show size and a one-time "download 145 MB model?" prompt; cache in IndexedDB/Cache Storage so later runs are seconds not minutes.
- **Backends:** Transformers.js (Whisper, CLIP, translation) and ONNX Runtime Web with the WebGPU execution provider (segmentation, matting, upscale, depth). Use **IO binding / graph capture** to keep tensors on the GPU between passes; fall back to WASM+SIMD on unsupported devices.
- **Job model:** every AI action is a background job with progress, cancel, and a result that lands in the document via a Command (so it is undoable). Long jobs survive navigation because their outputs are written to OPFS as they go.
- **Tiering by device:** detect adapter limits + memory, then choose model size (e.g. `whisper-tiny` on phones, `whisper-base` on desktop; 2x upscale on mobile, 4x on desktop).

## 3.9 Memory management (the thing that kills naive editors)

1. **Every `VideoFrame` is a GPU allocation** — a 4K frame is roughly 30 MB. Frames must be `close()`d in a `finally` block. Adopt an eslint rule + a dev-mode leak tracker that logs frames alive > 2 s.
2. **Frame pool with byte budget**, not count budget: `budget = min(512MB, 0.25 * deviceMemory)`. Evict LRU on insert.
3. **Backpressure**: if `decoder.decodeQueueSize > 8`, stop feeding; if the render worker is behind by > 2 frames, drop instead of queueing.
4. **Texture reuse**: allocate ping-pong targets once per canvas size; never create textures per frame.
5. **Explicit teardown** on project close: destroy decoders, textures, worklets, sessions; call `device.destroy()` when leaving the editor.
6. **Watchdog**: sample `performance.memory` / `navigator.deviceMemory` where available; if pressure is high, auto-drop preview scale and warn once.

## 3.10 Capability detection & graceful degradation

```ts
export async function detectCapabilities() {
  const gpu = "gpu" in navigator ? await navigator.gpu.requestAdapter() : null;
  const canH264 = "VideoEncoder" in self && (await VideoEncoder.isConfigSupported({
    codec: "avc1.640028", width: 1920, height: 1080, bitrate: 12_000_000, framerate: 30,
  })).supported;
  const canAAC = "AudioEncoder" in self && (await AudioEncoder.isConfigSupported({
    codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: 192_000,
  })).supported;
  return {
    webgpu: !!gpu, webgl2: !!document.createElement("canvas").getContext("webgl2"),
    webcodecs: "VideoDecoder" in self, h264Encode: canH264, aacEncode: canAAC,
    opfs: !!navigator.storage?.getDirectory, fsAccess: "showOpenFilePicker" in self,
    sab: typeof SharedArrayBuffer !== "undefined", // requires COOP/COEP headers
    cores: navigator.hardwareConcurrency ?? 4, memGB: (navigator as any).deviceMemory ?? 4,
  };
}
```

| Capability missing | Degradation |
|---|---|
| WebGPU | WebGL2 renderer (same effect library compiled to GLSL for the top ~40 effects), then Canvas2D for basic cuts |
| WebCodecs encode | ffmpeg.wasm export (slower, warn the user with an honest ETA) |
| AAC encode | Opus in WebM, or ffmpeg.wasm AAC for MP4 |
| File System Access | `<input type="file">` import + copy into OPFS + download-based export |
| OPFS | IndexedDB blob storage (slower), reduced proxy sizes |
| SharedArrayBuffer | single-threaded ffmpeg.wasm; message-passing instead of shared buffers |
| Low memory / mobile | 720p proxies, 1/2 preview scale, tiny AI models, max 6 tracks in preview |

---

<a name="part-4"></a>

# PART 4 - Local-first data layer: device files, local DB, crash-proof editing

This part answers your core requirement directly: the video stays on the user's device, we remember the file, we pull it back from local disk, and every setting and edit lives in a local database so a refresh never destroys work.

## 4.1 The three storage tiers (never mix them up)

| Tier | Technology | What lives there | Size | Survives refresh | Survives clearing site data |
|---|---|---|---|---|---|
| T1 - the user's own files | File System Access handles (FileSystemFileHandle) | the original videos, in place, on their disk | unlimited | yes (handle persists; permission may need re-grant) | yes (the file is theirs) |
| T2 - large derived data | OPFS (origin private file system) | proxies, thumbnails, waveforms, packet indexes, AI models, export segments, recordings | GBs (quota-bound) | yes | no |
| T3 - structured state | IndexedDB (via Dexie) | project document, WAL, snapshots, settings, keymaps, presets, handle objects, fingerprints | MBs | yes | no |

localStorage is used only for tiny non-critical UI flags (theme, last opened project id). It is synchronous, about 5 MB, string-only - never put project data there.

OPFS is the right home for big binaries: it is broadly available, and in a Worker you get createSyncAccessHandle() for fast synchronous reads and writes (the same mechanism SQLite-Wasm and Photoshop-on-web rely on; teams have reported roughly 3x faster project loads after moving from IndexedDB blobs to OPFS).

## 4.2 The truth about "save the path" (important, read carefully)

A browser cannot store an absolute path such as D:/shoots/wedding/clip.mp4 and silently reopen it later. There is no path-based file access API, and there will not be one, for security reasons. What you can do - and what Photoshop Web and VS Code Web do - is:

1. Get a FileSystemFileHandle when the user picks the file (or drops it).
2. Store that handle object itself in IndexedDB. Handles are structured-clonable, so db.handles.put({ key, handle }) works. VS Code Web keeps its handles in an IndexedDB store exactly like this.
3. Store a human-readable path hint (handle.name, plus the directory name when the user granted a directory) for display only, so the UI can say: wedding_A7III_0031.MP4 in /shoots/wedding.
4. On reopen, retrieve the handle and call handle.queryPermission({ mode: "read" }). A handle restored from IndexedDB will usually report "prompt", because file-access permission does not automatically persist across a page refresh. Then call handle.requestPermission({ mode }) inside a user gesture (a click) to get access back - one click, no re-picking, no re-upload. Chrome additionally offers persistent permissions ("allow on every visit"), which removes even that click on repeat visits.
5. If the file was moved, renamed or deleted, fall back to the relink flow (4.5).
6. On platforms without showOpenFilePicker (notably iOS and iPadOS Safari), use an input element and copy the bytes into OPFS once. From then on the app owns a private copy that always reopens with zero prompts (4.6).

So the honest promise to the user is: your file never leaves your device; we remember which file you used and reopen it with one click, or keep a private local copy if your browser needs it.

## 4.3 IndexedDB schema (Dexie)

```ts
import Dexie, { type Table } from "dexie";

export class VeDB extends Dexie {
  projects!:  Table<ProjectRow, string>;   // { id, name, updatedAt, thumbKey, docVersion }
  docs!:      Table<DocRow, string>;       // { projectId, doc, version, savedAt }
  wal!:       Table<WalRow, number>;       // { seq++, projectId, cmd, ts }  <- write-ahead log
  snapshots!: Table<SnapRow, number>;      // { id++, projectId, version, doc, ts, label }
  handles!:   Table<HandleRow, string>;    // { key, handle, name, size, lastModified, fingerprint }
  assets!:    Table<AssetRow, string>;     // asset metadata + derived artifact paths
  settings!:  Table<KV, string>;           // prefs, keymap, layouts, export presets
  presets!:   Table<PresetRow, string>;    // effect / caption / export presets
  models!:    Table<ModelRow, string>;     // downloaded AI model metadata
  transcripts!: Table<TranscriptRow, string>; // { id, assetId, words }
  jobs!:      Table<JobRow, string>;       // export / AI jobs with resume state

  constructor() {
    super("ve");
    this.version(7).stores({
      projects:    "id, updatedAt",
      docs:        "projectId, version",
      wal:         "++seq, projectId, ts",
      snapshots:   "++id, projectId, version, ts",
      handles:     "key, fingerprint",
      assets:      "id, fingerprint, projectId",
      settings:    "key",
      presets:     "id, kind",
      models:      "id",
      transcripts: "id, assetId",
      jobs:        "id, projectId, status",
    });
  }
}
export const db = new VeDB();
```

## 4.4 Persisting and restoring a device file (production-shaped code)

```ts
// ---------- import ----------
export async function importFromDevice() {
  const handles = await window.showOpenFilePicker({   // must be called from a click
    multiple: true,
    types: [{ description: "Media", accept: { "video/*": [".mp4", ".mov", ".webm", ".mkv"] } }],
  });
  for (const handle of handles) {
    const file = await handle.getFile();
    const fingerprint = await fingerprintFile(file);
    const key = "h_" + fingerprint;
    await db.handles.put({ key, handle, name: file.name, size: file.size,
                          lastModified: file.lastModified, fingerprint });
    dispatch(commands.addAsset({ handleKey: key, name: file.name, fingerprint,
                                size: file.size, lastModified: file.lastModified }));
    queueBackgroundWork(key);  // probe + packet index + thumbs + waveform + proxy
  }
}

// ---------- fingerprint: cheap, but strong enough to re-identify a file ----------
export async function fingerprintFile(file: File): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 1048576).arrayBuffer());
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 1048576)).arrayBuffer());
  const buf = new Uint8Array(head.length + tail.length);
  buf.set(head, 0);
  buf.set(tail, head.length);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  return file.size + "_" + file.lastModified + "_" + hex.slice(0, 32);
}

// ---------- restore after refresh ----------
export async function resolveAssetFile(asset: Asset, opts: { interactive: boolean }) {
  if (asset.opfsPath) return readFromOpfs(asset.opfsPath);   // private copy: always works
  const row = asset.handleKey ? await db.handles.get(asset.handleKey) : undefined;
  if (!row) return null;

  const mode = "read" as const;
  let state = await row.handle.queryPermission({ mode });
  if (state === "prompt") {
    if (!opts.interactive) { markAsset(asset.id, "needs-permission"); return null; }
    state = await row.handle.requestPermission({ mode });    // inside a click handler only
  }
  if (state !== "granted") { markAsset(asset.id, "needs-permission"); return null; }

  try {
    const file = await row.handle.getFile();                 // throws if moved or deleted
    if ((await fingerprintFile(file)) !== row.fingerprint) markAsset(asset.id, "changed");
    return file;
  } catch {
    markAsset(asset.id, "missing");
    return null;
  }
}
```

UX rule: never call requestPermission() on load. When a project opens with assets in needs-permission, show a single banner - "Reconnect 3 media files" - with one button. One click restores everything, because permission is requested for all handles inside that one gesture.

## 4.5 Missing media and the Reconnect (relink) flow

```
Open project
  |
  +- all assets resolve?    -> edit normally
  |
  +- some need permission   -> banner: [Reconnect media]  (1 click, batched requestPermission)
  |
  +- some missing or moved  -> Relink dialog:
        - list missing files with name, size, duration, last known folder
        - [Locate...] pick the file or its folder
        - auto-match the rest of that folder: fingerprint, then name+size, then name
        - offer [Keep a local copy in the app] to prevent recurrence (copies into OPFS)
        - allow editing with placeholder offline clips (grey slate, waveform preserved)
```

Critical detail: the timeline must open and stay editable even when media is missing. Offline clips render a placeholder slate (like Premiere's media-offline slate), and every cut and effect survives, because the document references assets by id, not by file bytes.

## 4.6 Mobile and Safari path (no picker, tighter storage)

```ts
export async function importMobile(files: FileList) {
  const root = await navigator.storage.getDirectory();               // OPFS
  const dir = await root.getDirectoryHandle("media", { create: true });
  for (const file of Array.from(files)) {
    const fp = await fingerprintFile(file);
    const name = fp + "_" + file.name;
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await file.stream().pipeTo(w);                                    // stream, never buffer in RAM
    dispatch(commands.addAsset({ opfsPath: "media/" + name, name: file.name, fingerprint: fp,
                                size: file.size, lastModified: file.lastModified }));
  }
}

if (navigator.storage?.persist) {
  const persisted = await navigator.storage.persisted();
  if (!persisted) await navigator.storage.persist();   // ask to be exempt from LRU eviction
}
const { usage, quota } = await navigator.storage.estimate();  // show in the Storage panel
```

Facts to design around: browsers evict origin storage least-recently-used under storage pressure, and origins granted persistent storage are skipped. Chromium allows a large share of free disk per origin, while WebKit grants persistence heuristically and can clear non-persistent storage after roughly seven days without interaction. Therefore on mobile: ask for persistence, keep OPFS copies optional and clearly labelled, always be able to rebuild derived data, and warn loudly before the app's private copy becomes the only copy of the user's footage.

## 4.7 Proxy and cache strategy

| Artifact | Format | Where | Rebuildable | Rough size |
|---|---|---|---|---|
| Proxy video | 540p/720p H.264 or VP9, keyframe every 6-12 frames | OPFS | yes | 4-8 MB per minute |
| Filmstrip thumbs | WebP sprite sheets, 160 px tall | OPFS | yes | 1-3 MB per minute |
| Waveform peaks | Float32 min/max pyramid, 4 zoom levels | OPFS | yes | ~0.5 MB per minute |
| Packet index | binary array of pts/offset/size/keyflag | OPFS | yes | tiny |
| Transcript | JSON word timings | IndexedDB | yes (re-run Whisper) | tiny |
| AI models | ONNX weights | Cache Storage / OPFS | yes (re-download) | 20-600 MB |
| Export segments | fragmented MP4 chunks for resume | OPFS | yes | temporary |

Cache policy: cap derived data at about 40% of the reported quota, evict per project by LRU, and expose a Storage panel with a per-project breakdown plus a Clear caches button that never touches originals.

## 4.8 Undo/redo and autosave that do not fight each other

The classic bug: autosave writes state and clobbers the undo stack. Fix it by making the command log the source of truth.

```ts
interface Command<P = unknown> {
  type: string;                        // "clip.split"
  params: P;                           // { clipId, at }
  apply(doc: ProjectDoc): ProjectDoc;  // pure function
  invert(before: ProjectDoc, after: ProjectDoc): Command;  // exact inverse
  coalesceKey?: string;                // merge rapid drags: "clip.trim:abc"
  label: string;                       // shown in history: "Split clip"
}

class Editor {
  doc!: ProjectDoc;
  undoStack: HistoryEntry[] = [];
  redoStack: HistoryEntry[] = [];

  dispatch(cmd: Command) {
    const before = this.doc;
    const after = cmd.apply(before);
    if (after === before) return;                       // no-op guard
    const inverse = cmd.invert(before, after);
    const top = this.undoStack[this.undoStack.length - 1];

    if (top && cmd.coalesceKey && top.key === cmd.coalesceKey && Date.now() - top.ts < 600) {
      top.redo = cmd;                                   // merge drag noise into one undo step
      top.ts = Date.now();
    } else {
      this.undoStack.push({ key: cmd.coalesceKey, undo: inverse, redo: cmd,
                           label: cmd.label, ts: Date.now() });
      if (this.undoStack.length > 200) this.undoStack.shift();
    }

    this.redoStack.length = 0;
    this.doc = after;
    persistence.appendToWal(cmd);      // durable in about 1 ms
    persistence.scheduleSnapshot();    // debounced full-document write
    bus.emit("doc", after);            // structural sharing keeps re-render cheap
  }
}
```

Persistence rules:

1. WAL append on every command - a tiny record { seq, projectId, cmd, ts }. This is the crash-safety net.
2. Debounced snapshot of the whole document after about 1.5 s of idle, forced on visibilitychange and pagehide, and every 200 commands.
3. Compaction: after a snapshot at version V, delete WAL rows with seq <= V.seq. Keep the last ~20 snapshots as user-visible restore points.
4. Persist the undo history itself (last 50-100 entries with inverses) so undo still works after a refresh. Almost every web editor gets this wrong; getting it right is a trust feature.
5. Single writer: navigator.locks.request("project:" + id, ...) holds an exclusive lock. Other tabs open read-only and can request takeover. Broadcast document changes over BroadcastChannel so a second tab stays live.

```ts
// forced flush on tab hide - the only reliable "user is leaving" signal on mobile
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persistence.flushNow();
});
window.addEventListener("pagehide", () => persistence.flushNow());
```

## 4.9 Crash recovery sequence

```
App start
  1. read settings + last project id
  2. load the latest snapshot for that project (one IndexedDB get)
  3. read WAL rows with seq > snapshot.seq
  4. replay them in order (pure functions, no I/O) -> exact pre-crash state
  5. restore UI state: playhead, zoom, scroll, selection, panel layout, active tool
  6. resolve assets: OPFS copies instantly; handles via queryPermission,
     batched into a single Reconnect banner when needed
  7. if WAL replay applied any rows, toast: "Recovered your last 14 edits" [View history]
  8. resume interrupted jobs (export / AI) from their chunk boundaries
```

Guarantee you can advertise: maximum work loss is the commands issued in the last second, and only if the browser died mid-write. In practice the WAL makes it zero.

## 4.10 What gets saved so a refresh feels like nothing happened

| Category | Examples | Store |
|---|---|---|
| Document | tracks, clips, trims, effects, keyframes, masks, captions, markers | IndexedDB docs + wal |
| Session UI | playhead, zoom, scrollX, selection, active tool, open panels, layout, track heights | the doc's ui block (so restore and undo cover it) |
| Preferences | theme, language, snapping, magnetic mode, autosave interval, proxy policy, keymap preset, custom shortcuts | settings |
| Tool settings | last-used values per tool (blur radius, caption style, export preset), favorites, recents | settings + presets |
| Assets | fingerprints, probe metadata, derived artifact paths, permission status | assets + OPFS files |
| Jobs | export queue, AI jobs, progress and resume offsets | jobs |
| Learning state | onboarding steps completed, tips dismissed | settings |

---

<a name="part-5"></a>

# PART 5 - The "Magic Fix" pipeline: make a bad video good

This is your headline feature. It must be one button, explainable, reversible, and fast.

## 5.1 Stage 1 - analysis pass (runs once per asset, cached by fingerprint)

Sample 2-4 frames per second from the proxy (not every frame) and compute on the GPU where possible.

| Metric | How | Drives |
|---|---|---|
| Luma histogram, mean, p1/p99, clipped % | WGSL histogram + readback | exposure, contrast, highlight recovery |
| Per-channel means, white-balance estimate | gray-world + white-patch | WB correction |
| Noise estimate | high-pass energy in flat regions | denoise strength |
| Sharpness score | variance of Laplacian | sharpen or skip |
| Shake score | frame-to-frame global motion and jerk | stabilization strength |
| Rolling-shutter score | row-wise motion divergence | RS correction |
| Faces (count, size, position) | face detector (ONNX) | reframe, retouch, skin protect |
| Person mask coverage | segmentation | background tools, auto reframe |
| Scene cuts | histogram delta with hysteresis | auto split, chapters |
| Speech segments | VAD (Silero-class ONNX) | silence cutting, captions |
| Loudness (LUFS), true peak, SNR, hum, reverb | AudioWorklet analysis | audio repair chain |
| Letterbox / orientation | edge scan + container rotation | auto crop |
| Duplicate or frozen frames | frame hashing | drop bad frames |

Store the result as an AnalysisReport in IndexedDB keyed by asset fingerprint, so re-opening a project never re-analyses.

## 5.2 Stage 2 - decision engine (explainable rules, not a black box)

```ts
function planFixes(a: AnalysisReport): FixPlan {
  const steps: FixStep[] = [];

  // ---------- video ----------
  if (a.luma.clippedPct > 0.5)
    steps.push({ id: "highlightRecovery", amount: clamp(a.luma.clippedPct / 5, 0.2, 0.8),
                 why: "Bright areas are blown out" });
  if (a.luma.mean < 70)
    steps.push({ id: "exposure", amount: mapRange(a.luma.mean, 20, 70, 0.9, 0.15),
                 why: "Footage is underexposed" });
  if (a.luma.mean > 185)
    steps.push({ id: "exposure", amount: -mapRange(a.luma.mean, 185, 235, 0.1, 0.6),
                 why: "Footage is overexposed" });
  if (a.contrastRange < 0.45)
    steps.push({ id: "autoContrast", amount: 0.5, why: "Flat, low-contrast image" });
  if (a.wbDeltaKelvin > 400)
    steps.push({ id: "whiteBalance", kelvin: a.wbTargetKelvin, why: "Colour cast detected" });
  if (a.noise > 0.35)
    steps.push({ id: "denoise", amount: clamp(a.noise, 0.3, 0.85), why: "Visible grain or noise" });
  if (a.shake > 0.4)
    steps.push({ id: "stabilize", amount: clamp(a.shake, 0.4, 0.9), crop: "auto", why: "Camera shake" });
  if (a.rollingShutter > 0.35)
    steps.push({ id: "rollingShutter", amount: 0.6, why: "Jello or skew from a phone sensor" });
  if (a.sharpness < 0.35 && a.noise < 0.6)
    steps.push({ id: "sharpen", amount: 0.4, why: "Slightly soft focus" });
  if (a.width < 1280 && a.faceMaxHeightPct > 0.15)
    steps.push({ id: "upscale", factor: a.width < 720 ? 4 : 2, why: "Low resolution source" });
  if (a.letterboxDetected) steps.push({ id: "cropBars", why: "Black bars baked into the video" });
  if (a.duplicateFramePct > 3) steps.push({ id: "dropDuplicates", why: "Frozen or duplicate frames" });
  if (a.hdrTransfer !== "bt709") steps.push({ id: "toneMap", why: "HDR source needs SDR tone mapping" });

  // ---------- audio (order matters) ----------
  if (a.hum > 0.2) steps.push({ id: "notchHum", freq: a.humFreq, why: "Electrical hum" });
  if (a.snr < 18)
    steps.push({ id: "denoiseAudio", amount: clamp((18 - a.snr) / 18, 0.3, 0.9),
                 why: "Background noise" });
  if (a.reverb > 0.4) steps.push({ id: "dereverb", amount: 0.5, why: "Echoey room" });
  steps.push({ id: "voiceEq", preset: a.speechPresent ? "voice" : "neutral", why: "Clarity" });
  if (a.dynamicRange > 14) steps.push({ id: "compress", ratio: 2.5, why: "Uneven levels" });
  steps.push({ id: "loudness", targetLufs: -14, why: "Match platform loudness" });
  steps.push({ id: "truePeakLimit", ceilingDb: -1, why: "Prevent clipping" });
  if (a.silencePct > 12 && a.speechPresent)
    steps.push({ id: "cutSilence", padMs: 120, minMs: 400, why: "Long pauses" });

  // ---------- framing and finish ----------
  if (a.targetAspect !== a.sourceAspect)
    steps.push({ id: "autoReframe", why: "Fit the target aspect ratio" });
  if (a.speechPresent)
    steps.push({ id: "captions", style: "clean", why: "Most social video is watched muted" });

  return { steps, estimatedSeconds: estimate(steps, a) };
}
```

## 5.3 Stage 3 - correct execution order (this matters more than the algorithms)

1. Decode and tone map (HDR to working space).
2. Crop baked-in bars, apply container rotation.
3. Rolling-shutter and lens correction.
4. Stabilize - before sharpening, because warping softens the image.
5. Temporal denoise - before sharpen and before upscale.
6. Upscale / super-resolution.
7. Sharpen, clarity, dehaze.
8. Exposure, then contrast, then white balance, then curves, then saturation.
9. Face-aware retouch (masked and subtle).
10. Look or LUT, then film grain.
11. Reframe or crop to the target aspect, subject-tracked.
12. Audio chain: hum notch, denoise, de-reverb, EQ, de-esser, compressor, loudness, limiter.
13. Timeline edits: silence cuts, scene splits, beat sync.
14. Captions and titles.
15. Final encode.

Why the order matters: sharpening before denoise amplifies noise; upscaling noisy footage bakes the noise in at four times the size; grading before cleanup means grading the artifacts; reframing before stabilization wastes the crop margin the stabilizer needs.

## 5.4 Stage 4 - the UX of the magic

- Button: **Make It Good**, with a subtitle stating exactly what will happen (fix shake, brighten, clean audio, add captions).
- Show the plan as a checklist with per-item toggles and a why tooltip. Remember de-selections as a user preference.
- Before/after wipe slider on the preview, plus a single-key A/B toggle.
- Everything lands as normal, editable effects on the clip, not a locked black box, so users can dial each one back. This is the single biggest UX advantage over CapCut's opaque one-tap tools.
- One undo removes the whole Magic Fix, because it is dispatched as one macro command.
- Preview at half scale while heavy steps (upscale, interpolation) render in the background with a progress chip. Never block the timeline.
- Report results honestly: "Audio was 9 LUFS too quiet - fixed. Shake was severe - stabilized with 6 percent crop."

## 5.5 Presets that sell

| Preset | Chain |
|---|---|
| Phone video rescue | stabilize + denoise + auto colour + voice cleanup + loudness + captions |
| Low light rescue | denoise, exposure lift, shadow recovery, chroma denoise, mild sharpen |
| Old or low-res footage | 4x upscale, deblur, grain, frame interpolation to 60 fps |
| Talking head studio look | silence cut, studio voice, relight, subtle retouch, background blur, captions |
| Wedding or event highlight | scene detect, best moments, beat-synced cuts, warm film look, music ducking |
| Screen recording cleanup | cursor zoom, crop, text sharpen, silence cut, captions |
| Vertical repurpose | auto reframe, background fill, caption style, hook cut, 15/30/60 second versions |

---

<a name="part-6"></a>

# PART 6 - UI/UX design system and interaction specification (2026)

## 6.1 Design principles

1. **One obvious next action.** Every screen has exactly one primary button. Import, then Edit, then Export.
2. **Progressive disclosure.** Simple mode shows 12 tools. Pro mode reveals keyframes, curves, masks, scopes, node graph. The switch is one toggle and it is remembered.
3. **Direct manipulation first.** Drag on the canvas, drag on the timeline, drag on the number. Dialogs are a fallback, never the primary path.
4. **Zero dead time.** Optimistic UI, skeletons, background jobs with chips, never a full-screen blocking spinner.
5. **Reversible everything.** Undo, A/B compare, non-destructive effect stacks, restore points.
6. **Explain the AI.** Every automatic decision shows what it did and why, with a slider to change it.
7. **Dark by default, light by choice.** Editing is a dark-room activity; media colour must not be judged against a bright chrome.
8. **Accessible by construction.** Keyboard-complete, WCAG AA contrast, focus visible, motion optional.

## 6.2 Layout (desktop)

```
+-------------------------------------------------------------------------+
| Top bar: project name | Simple/Pro | Magic Fix | Share | Export         |
+---------+---------------------------------------------+-----------------+
| Left    |            Preview canvas                   | Inspector       |
| rail:   |   (safe areas, transform handles, scopes)   | (contextual:    |
| Media   |                                             |  clip, text,    |
| Text    +---------------------------------------------+  audio, color,  |
| Audio   | Transport: in/out, timecode, loop, quality  |  effect params) |
| Effects +---------------------------------------------+                 |
| Color   |            Timeline                         |                 |
| AI      |  ruler | tracks | waveforms | keyframe lane  |                 |
+---------+---------------------------------------------+-----------------+
| Status bar: cache size, GPU mode, autosave state, job chips             |
+-------------------------------------------------------------------------+
```

Rules: panels are resizable and dockable, layouts are named and persisted, the inspector is strictly contextual (never show 40 irrelevant fields), and the timeline can go full-width with one keystroke.

## 6.3 Layout (mobile and touch)

- Vertical stack: preview on top (about 45 percent of height), tool strip in the middle, timeline at the bottom.
- The timeline is centre-locked: the playhead stays fixed in the middle and the strip scrolls under it (CapCut pattern, far better with a thumb).
- Trim handles are at least 44 by 44 CSS px, with a magnified preview overlay while dragging. Mobile trimming needs its own preview time, independent of the composition playhead.
- Bottom sheets, not modals. Every sheet is dismissible by drag.
- Gestures: pinch to zoom the timeline, two-finger drag to pan, long-press to pick up a clip, double-tap to fit, swipe up on a clip for its inspector.
- Haptics on snap, cut, and clip pickup where supported.
- No hover-only affordances anywhere.

## 6.4 Design tokens

| Token | Value | Note |
|---|---|---|
| surface/0 | #0E0F12 | app background |
| surface/1 | #15171B | panels |
| surface/2 | #1C1F24 | cards, timeline tracks |
| surface/3 | #24282F | hover, elevated |
| Material-style base | #121212 family | avoid pure black: elevation needs shadow contrast |
| text/primary | #F2F4F7 (>= 4.5:1 on surface/1) | body |
| text/secondary | #A7AFBC (>= 4.5:1) | labels |
| accent | #4C8DFF | primary actions, playhead |
| accent/press | #3A72D6 | active state |
| success / warn / danger | #34D399 / #F5B23B / #F2555A | all >= 3:1 against their surface |
| track/video, track/audio, track/text | #2C6BED, #17A08A, #B4632F | desaturated for dark UI |
| radius | 6 / 10 / 16 px | controls / cards / sheets |
| spacing | 4 px base scale | 4, 8, 12, 16, 24, 32 |
| type | Inter or system UI, 12/13/14/16/20/28 | tabular numerals for timecode |
| motion | 120 ms micro, 200 ms panel, 320 ms sheet, cubic-bezier(0.2, 0, 0, 1) | all disabled under prefers-reduced-motion |
| elevation | shadow plus 1 px hairline border rgba(255,255,255,0.06) | dark UI needs borders, not just shadows |

Dark-theme discipline: desaturate brand colours for large dark surfaces, keep body text at 4.5:1 and large text plus UI components at 3:1 minimum, and never rely on colour alone to convey state (add an icon or label).

## 6.5 Timeline interaction specification

| Interaction | Behaviour |
|---|---|
| Click clip | select; Shift-click extends; Cmd/Ctrl-click toggles; drag on empty space marquee-selects |
| Drag clip body | move with snapping to playhead, clip edges, markers, beats; ghost preview at the target; auto-scroll near edges |
| Drag clip edge | trim with a live frame preview at the trimmed edge; hold Alt for ripple; Shift disables snapping |
| Hover between clips | show the roll cursor; drag to roll the edit |
| Double-click clip | open its inspector tab |
| Scroll wheel | vertical scroll; Cmd/Ctrl-wheel zooms around the pointer; Shift-wheel scrolls horizontally |
| Pinch | zoom around the gesture centre |
| Drag ruler | scrub, with audio scrubbing at low volume |
| Right-click | contextual menu with the ten most likely commands only |
| Keyframe lane | expandable per property; drag keyframes, right-click for easing, box-select many |
| Playhead | always visible; auto-follows during playback with smooth-scroll paging, never jitter |
| Snap indicator | 1 px accent line plus a subtle tick sound or haptic |
| Overwrite vs insert drop | modifier-driven, with a distinct drop indicator per mode |

Performance rule: the timeline is rendered on a canvas (or WebGL layer) with virtualization, not thousands of DOM nodes. Hit-testing uses an interval tree per track. Target 60 fps drag on a 500-clip timeline; keep the pointer handler under 4 ms.

## 6.6 Keyboard shortcut map (Premiere and Resolve conventions, fully remappable)

| Action | Key |
|---|---|
| Play / pause | Space |
| Shuttle reverse / stop / forward | J / K / L (repeat J or L for 2x, 4x; hold K with J or L to crawl) |
| Step one frame back / forward | Left / Right (Shift for 5 frames) |
| Go to start / end | Home / End |
| Mark in / out | I / O |
| Clear in and out | Alt+X |
| Add cut at playhead | Cmd/Ctrl+K (add cut on all tracks: Cmd/Ctrl+Shift+K) |
| Blade tool | B (select A, ripple trim R, slip Y, hand H, zoom Z) |
| Ripple delete | Shift+Delete (lift or delete: Delete) |
| Ripple trim to playhead | Q (before) / W (after) |
| Insert / overwrite / replace | F9 / F10 / F11 |
| Toggle snapping | N |
| Add marker | M (Shift+M next marker, Cmd/Ctrl+Shift+M previous) |
| Zoom to fit / in / out | Shift+Z / Plus / Minus |
| Nudge selection one frame | Comma / Period (Shift for 5) |
| Cycle trim side | U |
| Select nearest edit point | V (dynamic trim mode: W) |
| Default transition | Cmd/Ctrl+T |
| Group / ungroup | Cmd/Ctrl+G / Cmd/Ctrl+Shift+G |
| Toggle clip enable | Shift+E |
| Undo / redo | Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z |
| Save (force snapshot) | Cmd/Ctrl+S |
| Command palette | Cmd/Ctrl+P |
| Magic Fix | Cmd/Ctrl+Shift+M... reserved; use Cmd/Ctrl+Alt+M |
| A/B compare original | Backslash |
| Export | Cmd/Ctrl+E |
| Full-screen preview | Backtick |

Ship three preset keymaps on day one: Default, Premiere, Resolve. Power users switch in one click and stay.

## 6.7 Onboarding and first-run

1. Landing state: a single drop zone reading "Drop a video, or record your screen" plus a sample project to open with no import.
2. On first import, run analysis silently and surface one card: "This clip is shaky and quiet. Fix it?" with a Fix button. This teaches the differentiator in the first 30 seconds.
3. A three-step coach mark tour (trim, add text, export) that can be dismissed and resumed, tracked in local settings.
4. Empty-state teaching in every panel, with a one-line explanation and a single example action.
5. Never gate export behind an account in the free tier. The first successful export is the moment a user becomes a user.

## 6.8 Accessibility checklist

- Every command is reachable by keyboard and appears in the command palette.
- Focus rings are visible on every interactive element (2 px accent outline plus offset).
- Timeline is operable with the keyboard: Tab to the track list, arrow keys to move between clips, Enter to select, arrows plus modifiers to trim.
- ARIA: the timeline is a grid with row and column semantics; clips announce name, track, start, duration and selected state.
- Live regions announce job progress, autosave state, and errors.
- Text contrast at least 4.5:1, large text and UI components at least 3:1, in both themes.
- prefers-reduced-motion removes parallax, sheet slides and playhead easing.
- Captions UI supports large text and high-contrast styles by default.
- All colour-coded states also carry an icon or text label.
- Hit targets at least 44 px on touch, at least 32 px on pointer.

---

<a name="part-7"></a>

# PART 7 - Export and final rendering pipeline

## 7.1 The rendering contract

Export must be **deterministic** and **decoupled from the preview**: the same project renders the same frames every time, on any machine, regardless of playback performance. Achieve that by rendering on a **virtual clock** rather than wall time.

1. Compute the total frame count: duration multiplied by the project frame rate, using rational math.
2. For frame index i, timeline time equals i multiplied by (fps.d / fps.n). No floats, no drift.
3. Pull every needed source frame with the exact seek walker (3.6). Never skip a frame because a decoder is slow - wait for it.
4. Composite through the same render graph the preview uses, at full resolution and full quality (no proxy, no half-scale, all effects enabled).
5. Copy the result into a VideoFrame with timestamp = i multiplied by (1e6 multiplied by fps.d / fps.n) microseconds, then encode.
6. Mix audio separately and deterministically with OfflineAudioContext, then encode and interleave.

## 7.2 Export loop (shape of the real code)

```ts
import { Output, Mp4OutputFormat, BufferTarget, EncodedVideoPacketSource,
         EncodedAudioPacketSource } from "mediabunny";

export async function renderProject(doc: ProjectDoc, opt: ExportOptions, onProgress: (p: number) => void) {
  const out = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }),
                           target: new BufferTarget() });
  const vSource = new EncodedVideoPacketSource("avc");
  const aSource = new EncodedAudioPacketSource("aac");
  out.addVideoTrack(vSource);
  out.addAudioTrack(aSource);
  await out.start();

  const encoder = new VideoEncoder({
    output: (chunk, meta) => vSource.add(chunk, meta),
    error: (e) => fail(e),
  });
  encoder.configure({
    codec: opt.codec,               // e.g. avc1.640028 (H.264 High 4.0)
    width: opt.width, height: opt.height,
    bitrate: opt.bitrate, framerate: opt.fps,
    latencyMode: "quality",
    hardwareAcceleration: "prefer-hardware",
  });

  const total = frameCount(doc, opt.fps);
  for (let i = 0; i < total; i++) {
    if (job.cancelled) break;
    const t = frameTime(i, opt.fps);
    const gpuFrame = await renderGraph.renderAt(t, { scale: 1, quality: "final" });
    const frame = new VideoFrame(gpuFrame.canvas, { timestamp: micros(t), duration: microsPerFrame(opt.fps) });
    encoder.encode(frame, { keyFrame: i % opt.gop === 0 });
    frame.close();
    if (encoder.encodeQueueSize > 8) await encoder.flush();      // backpressure
    if (i % 15 === 0) { onProgress(i / total); await checkpoint(i); }
  }

  await encoder.flush();
  encoder.close();
  await encodeAudioTrack(doc, opt, aSource);   // OfflineAudioContext -> AudioEncoder -> muxer
  await out.finalize();
  return out.target.buffer;                    // write to disk via File System Access
}
```

Why Mediabunny: it is a zero-dependency TypeScript library that reads and writes MP4, MOV, WebM, MKV, MP3, WAV, Ogg, plus HLS, supports fast-start and fragmented MP4, 25 codecs, hardware encode and decode through WebCodecs, multi-track output, streaming targets with automatic backpressure, and microsecond timing precision. It explicitly targets the "build a video editor" use case. MP4Box.js is the mature alternative for demuxing and indexing.

## 7.3 Audio mixdown for export

```ts
async function encodeAudioTrack(doc: ProjectDoc, opt: ExportOptions, sink: EncodedAudioPacketSource) {
  const ctx = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.ceil(durationSeconds(doc) * opt.sampleRate),
    sampleRate: opt.sampleRate,
  });
  buildAudioGraph(doc, ctx);            // exactly the same builder the preview uses
  const rendered = await ctx.startRendering();

  const enc = new AudioEncoder({ output: (c, m) => sink.add(c, m), error: fail });
  const cfg = { codec: opt.audioCodec, sampleRate: opt.sampleRate, numberOfChannels: 2, bitrate: opt.audioBitrate };
  if (!(await AudioEncoder.isConfigSupported(cfg)).supported) return fallbackAudio(rendered, opt);
  enc.configure(cfg);

  const CHUNK = 4096;
  for (let off = 0; off < rendered.length; off += CHUNK) {
    const n = Math.min(CHUNK, rendered.length - off);
    const interleaved = interleave(rendered, off, n);
    enc.encode(new AudioData({
      format: "f32", sampleRate: opt.sampleRate, numberOfFrames: n,
      numberOfChannels: 2, timestamp: (off / opt.sampleRate) * 1e6, data: interleaved,
    }));
  }
  await enc.flush();
  enc.close();
}
```

AAC in MP4 is the compatibility target, but AAC encoding is not guaranteed everywhere. Always probe with AudioEncoder.isConfigSupported and fall back to Opus in WebM, or route the mixdown through ffmpeg.wasm to produce AAC.

## 7.4 Codec strategy and probing

| Target | Video | Audio | Container | Notes |
|---|---|---|---|---|
| Universal share | H.264 High (avc1.640028) | AAC-LC | MP4 | works everywhere, patent-encumbered |
| High efficiency | HEVC (hvc1) where supported | AAC | MP4 | hardware-dependent, licensing caution |
| Open and efficient | AV1 (av01) or VP9 | Opus | WebM or MP4 | best quality per bit, slower encode |
| Transparency | VP9 with alpha | Opus | WebM | for overlays and stickers |
| Audio only | n/a | AAC, MP3, or WAV | M4A, MP3, WAV | podcast and voice-over export |
| Animation | frame sequence | n/a | GIF or animated WebP | quantized palette |

Never hard-code a codec string. Build a preference list, probe each with isConfigSupported, and pick the first supported entry. Surface the result plainly: "Exporting H.264 with hardware acceleration" or "Your browser lacks H.264 encoding, exporting WebM instead".

## 7.5 Platform presets

| Preset | Resolution | FPS | Video bitrate | Audio | Loudness |
|---|---|---|---|---|---|
| YouTube 4K | 3840x2160 | source | 45 Mbps | AAC 384 kbps | -14 LUFS |
| YouTube 1080p | 1920x1080 | source | 12 Mbps | AAC 256 kbps | -14 LUFS |
| Shorts / Reels / TikTok | 1080x1920 | 30 or 60 | 10 Mbps | AAC 192 kbps | -14 LUFS |
| Instagram feed | 1080x1350 | 30 | 8 Mbps | AAC 192 kbps | -14 LUFS |
| X / Twitter | 1280x720 | 30 | 5 Mbps | AAC 128 kbps | -14 LUFS |
| WhatsApp friendly | 854x480 | 30 | 1.5 Mbps | AAC 96 kbps | -16 LUFS |
| Master archive | source | source | 80 Mbps or lossless-ish | AAC 512 kbps or PCM | none |
| Web hero loop | 1920x1080 | 30 | 4 Mbps VP9 | none | n/a |

Each preset also carries a reframe policy, a caption style, and a file-name template such as {project}_{preset}_{date}.

## 7.6 Reliability features that separate you from toy editors

- **Segmented rendering:** render in 10-second segments to fragmented MP4 chunks in OPFS, then concatenate. A crash at minute 38 resumes at minute 38.
- **Job store:** every export is a row in IndexedDB with status, progress, options and chunk manifest. Reload the page and the job resumes.
- **Cancel and pause:** cooperative cancellation checked every frame; pause simply stops feeding the encoder.
- **Real ETA:** exponential moving average of frames per second over the last 3 seconds, not a fake linear estimate.
- **Live preview thumbnail** of the frame currently being encoded, updated once a second, so the wait feels productive.
- **Multiple outputs in one pass:** render the composite once, then feed several encoders (1080p plus 9:16 crop plus thumbnail) to avoid re-rendering.
- **Direct-to-disk writing:** use showSaveFilePicker and a FileSystemWritableFileStream so a 4 GB export never lives in RAM. Fall back to a Blob download when the picker is unavailable.
- **Post-export verification:** re-open the written file with the demuxer, confirm duration, track count and the last frame timestamp, then show a Verified badge.
- **Export history** with the exact settings used, so a re-export is one click.

---

<a name="part-8"></a>

# PART 8 - Tech stack, repo structure and code contracts

## 8.1 Recommended stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript strict | a video editor without types is unmaintainable |
| UI | React 19 plus Vite | ecosystem, Suspense for lazy panels, fast HMR |
| State | Zustand plus Immer for UI state; custom immutable document plus command bus for the project | the document must not live in a generic store |
| Styling | Tailwind with CSS variables for tokens, plus Radix primitives | fast, accessible, themeable |
| Timeline rendering | Canvas 2D or PixiJS layer with virtualization | thousands of clips at 60 fps |
| GPU compositing | WebGPU with a WebGL2 fallback | zero-copy texture_external, compute shaders |
| Decode and encode | WebCodecs | hardware acceleration already in the browser |
| Muxing and demuxing | Mediabunny (primary), MP4Box.js (indexing) | pure TS, streaming, MP4 plus WebM plus MKV |
| Fallback transcode | ffmpeg.wasm | exotic codecs, AAC when missing, subtitle burn-in |
| Audio | Web Audio plus AudioWorklet, OfflineAudioContext for export | deterministic mixdown |
| Text shaping | HarfBuzz WASM plus fontkit, SDF glyph atlas | correct Devanagari, Arabic, CJK |
| AI runtime | ONNX Runtime Web (WebGPU EP) plus Transformers.js | local models, no server cost |
| Local DB | Dexie over IndexedDB | schema versioning, migrations, live queries |
| Big binaries | OPFS with sync access handles in workers | fast, large, private |
| PWA | Vite PWA plugin with Workbox | installable, offline |
| Tests | Vitest, Playwright, plus a golden-frame visual harness | frame-exact regression testing |
| Errors and analytics | local-first logging with opt-in upload | privacy is the product |

## 8.2 Repository structure

```
ve/
  apps/
    editor/            main SPA (routes: /, /edit/:projectId, /tools/*)
    tools/             single-purpose SEO pages reusing the engine
  packages/
    core-model/        document types, rational time, zod schema, migrations
    commands/          command definitions, inverses, macros, registry
    engine-media/      demux, decode, packet index, frame cache, proxies, thumbs, waveforms
    engine-render/     WebGPU device, pass compiler, WGSL library, node graph
    engine-audio/      graph builder, worklets, loudness, offline mixdown
    engine-export/     render loop, encoder probing, muxing, segments, resume
    ai/                model registry, whisper, segmentation, upscale, depth, vad
    persistence/       dexie schema, wal, snapshots, handle store, opfs fs, quota
    timeline/          renderer, hit-testing, gestures, snapping
    ui-kit/            tokens, primitives, icons, motion, a11y
    i18n/              locale bundles (en, ne, hi, ...)
  wasm/                harfbuzz, rnnoise, ffmpeg builds, custom dsp
  models/              model manifest (downloaded at runtime, never bundled)
  e2e/                 playwright specs plus golden frames
```

## 8.3 Worker message protocol (typed, discriminated)

```ts
type ToRender =
  | { t: "init"; canvas: OffscreenCanvas; caps: Caps }
  | { t: "renderAt"; time: Rational; scale: number; quality: "draft" | "final"; graph: GraphIR }
  | { t: "frame"; sourceId: string; frame: VideoFrame }        // transferred
  | { t: "dispose"; sourceId: string };

type FromRender =
  | { t: "ready"; adapter: string; limits: Record<string, number> }
  | { t: "rendered"; time: Rational; bitmap?: ImageBitmap; ms: number }
  | { t: "stats"; fps: number; gpuMemMB: number; dropped: number }
  | { t: "error"; message: string; recoverable: boolean };
```

Rules: one protocol file per worker, exhaustive switch statements, and no shared mutable state except explicit SharedArrayBuffer ring buffers for audio.

## 8.4 Headers you must set (or half the stack silently degrades)

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Permissions-Policy: (as needed for camera, microphone, display-capture)
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' (model CDN)
```

COOP plus COEP unlock SharedArrayBuffer, which multithreaded ffmpeg.wasm and shared audio ring buffers need. Serve models with proper CORS or self-host them.

## 8.5 Golden-frame testing (the only way to keep quality)

1. Fixture projects committed as JSON with tiny generated source clips (synthetic gradients, moving shapes, tone bursts).
2. For each fixture, render frames at fixed indexes headlessly and compare against committed PNGs with a perceptual diff threshold.
3. Encode a five-second export and assert duration, frame count, track layout and audio LUFS within tolerance.
4. Run the suite on every pull request across two GPU backends (WebGPU and the WebGL2 fallback).
5. Additionally assert determinism: render the same fixture twice and require byte-identical output.

---

<a name="part-9"></a>

# PART 9 - Implementation plan: 12 months, 7 phases

Assumed team: 2 to 4 engineers plus one designer. Solo is possible but multiply timelines by roughly 2.5.

## Phase 0 - Feasibility spike (weeks 1-2)

Goal: prove the risky parts before building product.

- Decode an MP4 with WebCodecs, draw it through WebGPU with texture_external, and step frames accurately.
- Encode 300 composited frames plus audio to a playable MP4 with Mediabunny; verify in VLC and QuickTime.
- Store a FileSystemFileHandle in IndexedDB, refresh, and restore access with one click.
- Measure: decode fps at 1080p and 4K, GPU memory at 30 clips, export speed versus realtime.
- Exit criterion: 1080p 30 fps preview with three layers and two effects, plus a verified export.

## Phase 1 - Minimum lovable editor (weeks 3-10)

- Import (picker, drag-drop, OPFS mobile path), media pool, probing, thumbnails, waveforms, proxies.
- Document model, command bus, undo/redo, WAL, snapshots, crash recovery, relink flow.
- Timeline: multi-track, drag, trim, split, ripple delete, snapping, zoom, markers.
- Preview with the audio-master clock, transport, JKL, frame stepping.
- Effects v1: transform, crop, opacity, blend modes, 12 transitions, colour basics with curves and LUTs.
- Text v1: styles, presets, 10 animations, correct Devanagari shaping.
- Audio v1: gain, fades, keyframes, mixer, loudness normalize, limiter.
- Export v1: H.264 plus AAC MP4, 5 presets, progress, cancel, direct-to-disk writing.
- Ship as a PWA with offline support. This is a genuinely usable product.

## Phase 2 - The differentiators (weeks 11-18)

- Local AI worker plus model registry with download and cache.
- Whisper captions with word timings, caption styles, karaoke highlight, SRT and VTT export.
- Transcript panel with text-based editing, filler-word and silence removal.
- Background removal, auto reframe with subject tracking, face detection.
- Magic Fix v1: full analysis pass, decision engine, 12-step pipeline, before and after UI.
- Stabilization, denoise, auto colour, upscale 2x.
- Storage manager, quota warnings, persistence request.

## Phase 3 - Depth for creators (weeks 19-26)

- Keyframes everywhere plus the graph editor with bezier easing.
- Masks: shapes, feather, invert, tracking; chroma key with despill and light wrap.
- Effects library to 100-plus, effect fusion in the pass compiler, presets and favorites.
- Scopes: waveform, parade, vectorscope, histogram. Shot match. HSL secondaries.
- Speed ramps, reverse, freeze, optical-flow interpolation, motion blur.
- Compound clips, adjustment layers, multicam, nested comps.
- Templates system plus a template gallery, brand kit, shared presets.

## Phase 4 - Mobile-grade polish (weeks 27-34)

- Touch timeline (centre-locked, 44 px handles, magnified trim preview), bottom sheets, gestures, haptics.
- Mobile performance tier: 720p proxies, tiny models, capped tracks, thermal-aware quality drop.
- Screen, camera and microphone recording built in.
- Auto-clip long videos to shorts, hook detection, virality notes, multi-aspect batch export.
- Full accessibility pass plus keyboard-complete audit.

## Phase 5 - Ecosystem and growth (weeks 35-44)

- 40 single-purpose tool pages (remove background, add subtitles, crop for TikTok, compress, convert, trim, merge, extract audio, and so on), all local-first and all deep-linking into the editor.
- Plugin SDK for WGSL effects and template packs, with a review process.
- Optional encrypted project sync (documents only, never media) plus multi-device relink.
- Team features: shared presets, brand kits, review links with opt-in render upload.
- Localization: English, Nepali, Hindi first, then Spanish, Portuguese, Indonesian, Arabic.

## Phase 6 - Pro tier and scale (weeks 45-52)

- Node graph mode, 3D layers, depth effects, relight, object removal.
- HDR pipeline, colour management, 10-bit paths where the browser allows.
- Interchange: EDL and FCPXML-lite export, timeline import from CapCut and Premiere where feasible.
- Render farm option: an opt-in local desktop helper (Tauri) for long 4K jobs, still no cloud upload.
- Performance hardening: 500-clip projects, two-hour timelines, 4K multicam.

## Definition of done for every feature

1. Works with keyboard only, and on touch.
2. Has an undo path and appears in the command palette.
3. Persists across refresh (state and settings both).
4. Degrades gracefully when a capability is missing.
5. Has a golden-frame or unit test.
6. Has an empty state, a loading state, and an error state.
7. Never blocks the main thread for more than 16 ms.
8. Is documented in one sentence inside the app help panel.

---

<a name="part-10"></a>

# PART 10 - Performance engineering, QA and device matrix

## 10.1 Performance budgets (enforce these in CI)

| Metric | Target | Hard fail |
|---|---|---|
| First contentful paint (editor shell) | under 1.2 s on a mid laptop | over 2.5 s |
| Time to first frame after import | under 1.5 s for a 1080p clip | over 4 s |
| Preview frame rate, 1080p, 3 layers, 5 effects | 30 fps sustained | under 24 fps |
| Preview frame rate, 4K proxy mode | 30 fps | under 20 fps |
| Scrub latency (pointer move to new frame) | under 80 ms | over 200 ms |
| Timeline drag frame rate, 500 clips | 60 fps | under 40 fps |
| Main-thread long tasks during playback | none over 16 ms | any over 50 ms |
| GPU memory, typical session | under 700 MB | over 1.5 GB |
| Undo latency | under 30 ms | over 100 ms |
| Autosave write | under 20 ms, off the main thread | over 100 ms or main thread |
| Project open with 200 clips | under 800 ms | over 2 s |
| Export speed, 1080p30 with light effects | at least 1.5x realtime with hardware encode | under 0.5x |
| Caption generation, 10 minutes of audio | under 60 s on desktop WebGPU | over 4 minutes |
| JS bundle, initial route | under 400 KB gzipped | over 900 KB |

## 10.2 Device tiers and automatic quality policy

| Tier | Detection | Policy |
|---|---|---|
| High (desktop discrete GPU, 16 GB plus) | adapter limits high, 8-plus cores, deviceMemory 8-plus | full-res preview, 4x upscale, whisper-base, 64-frame cache, 4K export |
| Mid (laptop integrated GPU) | 4-8 cores, deviceMemory 8 | 1080p proxy preview, 2x upscale, whisper-base, 32-frame cache |
| Low (older laptop, no WebGPU) | WebGL2 only | 720p proxy, half-scale preview, effects capped at 3 per clip, whisper-tiny |
| Mobile high (recent flagship) | WebGPU present, 6-plus cores | 720p proxy, 1080p export, tiny models, 12-frame cache |
| Mobile low | no WebGPU or 4 GB RAM | 540p proxy, 720p export, no AI upscale, single-pass effects only |

Apply the policy automatically, show it in the status bar as a quality chip, and let the user override it. Re-evaluate when frames start dropping (three consecutive seconds under target drops preview scale one step).

## 10.3 Test matrix

| Axis | Coverage |
|---|---|
| Browsers | Chrome, Edge, Brave (Chromium), Safari macOS and iOS, Firefox (fallback paths) |
| OS | Windows 11, macOS, Ubuntu, Android 13-plus, iOS 17-plus |
| Codecs in | H.264, HEVC, VP9, AV1, MPEG-4, ProRes where supported, MJPEG from old cameras |
| Containers in | MP4, MOV, WebM, MKV, AVI, 3GP, TS |
| Audio in | AAC, MP3, Opus, Vorbis, FLAC, WAV, AC-3 |
| Nasty real-world files | variable frame rate phone video, rotation metadata, HDR HLG and PQ, 10-bit, 60 and 120 fps, multi-audio-track, no-audio, corrupt tail, 4 GB plus, long GOP (5-10 s keyframes) |
| Project scale | 1 clip, 50 clips, 500 clips, 2-hour timeline, 8 video plus 8 audio tracks |
| Storage states | quota nearly full, persistence denied, media moved, media deleted, permission revoked, two tabs open |
| Interruptions | refresh mid-edit, tab crash, OS sleep during export, network loss during model download, storage evicted |
| Accessibility | keyboard-only pass, screen reader pass, 200 percent zoom, reduced motion, high contrast |

## 10.4 Observability without violating privacy

- Local ring-buffer log (last 2000 events) stored in IndexedDB, viewable in a Diagnostics panel, exportable as a text file the user can attach to a bug report.
- Aggregate counters only, and only with opt-in: capability flags, tier, feature usage counts, crash type. Never file names, never frames, never transcripts.
- Crash breadcrumbs: last 20 commands (types only) so a bug report reproduces the sequence without exposing content.

---

<a name="part-11"></a>

# PART 11 - Strategy: how to actually beat CapCut

## 11.1 Positioning

> "The editor that never uploads your video. Full studio power, in your browser, offline, free to export."

Three pillars to repeat everywhere: **Private by design. Instant, because it runs on your device. Deep enough to grow into.**

## 11.2 Wedge strategy (do not attack the whole product at once)

1. **Wedge 1: privacy plus speed.** Target creators, educators, lawyers, doctors, HR teams and anyone who cannot upload footage. This is a category CapCut structurally cannot serve.
2. **Wedge 2: bad-footage rescue.** Own the phrase "fix my video". Magic Fix is the demo that spreads.
3. **Wedge 3: tool pages.** Forty local-first single-purpose tools that rank in search and convert into the editor.
4. **Wedge 4: regional strength.** First-class Nepali and Hindi UI, Devanagari titles that actually shape correctly, wedding and event templates, low-bandwidth friendliness. Global tools do this badly.
5. **Wedge 5: pro depth.** Once retention holds, ship node effects, scopes and colour management to capture users who outgrow CapCut.

## 11.3 Pricing model

| Tier | Price | Contents |
|---|---|---|
| Free | 0 | full editor, unlimited local exports up to 1080p, watermark-free, all core tools, 3 AI runs per day |
| Pro | roughly 8 to 12 USD per month | 4K export, unlimited local AI, all effects and templates, project sync, priority features |
| Studio | roughly 20 to 30 USD per month | team presets and brand kits, review links, plugin publishing, desktop helper for long renders |
| Lifetime local | one-time | a version that runs entirely offline, no account - a strong differentiator |

Local AI costs you nothing per run, so a generous free tier is sustainable. That is a structural cost advantage over every cloud editor, and it is exactly how a browser upscaler reached hundreds of thousands of monthly users with zero server cost.

## 11.4 Growth engine

- Tool pages for search intent, each with a live demo that works before signup.
- Shareable before/after cards generated by Magic Fix (a two-second GIF plus the fix list) with an attribution watermark that users can remove in Pro.
- Template packs by niche: wedding, real estate, food, gaming, education, product ads.
- Creator program: publish an effect or template pack, earn revenue share.
- Public changelog and a roadmap board. Editors are chosen by trust.

## 11.5 Plugin SDK sketch

```json
{
  "id": "com.example.filmburn",
  "name": "Film Burn",
  "version": "1.0.0",
  "kind": "effect",
  "engine": "wgsl",
  "entry": "effect.wgsl",
  "passes": 1,
  "needsNeighborhood": false,
  "uniforms": [
    { "name": "intensity", "type": "f32", "min": 0, "max": 1, "default": 0.6, "label": "Intensity", "keyframable": true },
    { "name": "seed", "type": "f32", "min": 0, "max": 100, "default": 7, "label": "Variation" }
  ],
  "assets": ["grain.webp"],
  "license": "MIT"
}
```

The host validates the WGSL against an allowlist of bindings, compiles it in a sandbox device, enforces a per-pass time budget, and rejects plugins that exceed it. Plugins can never touch storage, the network, or the document - only pixels.

## 11.6 Twelve-month success metrics

| Metric | Target |
|---|---|
| Import-to-first-export conversion | over 45 percent of new sessions |
| Magic Fix usage among new users | over 60 percent |
| Week-4 retention | over 25 percent |
| Median export time, 1080p one minute | under 40 s |
| Crash-free sessions | over 99.5 percent |
| Work-loss reports | zero |
| Free-to-Pro conversion | 2 to 4 percent |
| Tool-page organic sessions | over 100k per month by month 12 |

---

<a name="part-12"></a>

# PART 12 - Risks, legal, licensing and privacy

## 12.1 Engineering risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Memory blow-up from unclosed VideoFrames | tab crash, lost trust | frame pool with a byte budget, mandatory close in finally, dev-mode leak tracker, CI memory test |
| Long-GOP footage makes scrubbing unusable | product feels broken | dense-keyframe proxies, packet index, decode-from-keyframe walker, scrub-mode quality drop |
| Browser lacks H.264 or AAC encoding | export fails at the last step | probe with isConfigSupported, fall back to VP9 plus Opus in WebM, or ffmpeg.wasm for AAC |
| WebGPU unavailable or driver-blocklisted | no preview | WebGL2 renderer for the top 40 effects, then Canvas2D basic mode |
| Storage eviction wipes proxies or private copies | user thinks work is lost | request persistence, keep originals as the source of truth, make all derived data rebuildable, warn when the app holds the only copy |
| Permission prompts confuse users | abandonment | batch a single Reconnect action, explain why in one sentence, offer a permanent local copy |
| AI model downloads are large | slow first run in low-bandwidth regions | tiered model sizes, explicit size prompts, resumable downloads, cache in IndexedDB, offer a no-AI path for every feature |
| Mobile thermal throttling | frame drops mid-session | thermal-aware quality policy, background heavy jobs, warn once |
| VFR (variable frame rate) phone footage | audio drift | normalize to CFR on proxy generation, keep a pts map for the original |
| Two tabs editing the same project | corruption | Web Locks single-writer, read-only second tab, takeover flow |
| Scope creep across 200 tools | never shipping | phase gates from Part 9, and the Definition of Done checklist |

## 12.2 Codec and patent considerations

- H.264 and HEVC are covered by patent pools. Using the browser's built-in encoder through WebCodecs means the platform provides the codec, but that does not automatically transfer every obligation to you - get a lawyer's opinion before commercial launch, especially if you ship a desktop wrapper that bundles its own encoder.
- Prefer AV1 and VP9 plus Opus for internal formats, proxies, and web delivery. Offer H.264 as the compatibility export.
- If you bundle ffmpeg.wasm, be explicit about your build's licence: standard builds are LGPL-2.1-or-later, but enabling GPL components (for example x264) makes the result GPL, which is incompatible with closed-source distribution. Build a minimal, LGPL-only configuration and document it.

## 12.3 AI model licensing (this bites people)

| Model class | Typical licence | Verdict |
|---|---|---|
| Whisper (OpenAI weights, ONNX conversions) | MIT | safe for commercial use |
| MediaPipe Selfie Segmentation | Apache-2.0 | safe |
| Robust Video Matting (RVM) | GPL-3.0 | avoid in a closed-source product; do not link it into your bundle |
| Real-ESRGAN | BSD-3-Clause (check the specific weights) | usually safe, verify per checkpoint |
| Segment Anything | Apache-2.0 (model), check derivatives | generally safe |
| RNNoise | BSD | safe |
| RIFE and similar interpolation | varies, some non-commercial | verify each checkpoint before shipping |

Rule: maintain a MODEL-LICENSES.md file with the licence, source URL and commercial-use verdict for every model you ship, and block CI if a model lacks an entry.

## 12.4 Content licensing

- Fonts: bundle only fonts with clear web-embedding rights (SIL OFL or Apache). Use system and user-provided fonts otherwise. Nepali and Hindi coverage matters here - verify Devanagari glyph coverage per font.
- Music and sound effects: licence per-track for redistribution inside exports, and keep an attribution record in the project file.
- Templates and stock: track provenance per asset, and never let a free-tier user unknowingly export licensed content.
- Store licence metadata inside the project document so exports can be audited later.

## 12.5 Privacy and security architecture

1. **Default: no upload.** Media, transcripts, and analysis stay local. State this in the UI, not only in a policy page.
2. Any cloud feature is opt-in per action, with a clear dialog naming exactly what will be sent and to whom, plus a persistent indicator while it happens.
3. No third-party analytics scripts in the editor route. First-party, aggregate, opt-in only.
4. Strict CSP, no eval other than wasm-unsafe-eval, self-hosted models where possible, subresource integrity for model files.
5. Sanitize all imported text (SRT, project files) before rendering; treat imported project JSON as untrusted and validate it with a schema.
6. Plugins run with pixel-only capabilities: no storage, no network, no document access.
7. Local diagnostics never include frames, audio, transcripts, or file paths unless the user explicitly attaches them.
8. Add a one-click **Delete all local data** control that clears IndexedDB, OPFS and caches, and reports exactly what was removed.

---

<a name="part-13"></a>

# PART 13 - Appendices

## A. Project file schema (top level, v7)

```json
{
  "schemaVersion": 7,
  "id": "prj_01H9",
  "name": "Wedding Highlight",
  "createdAt": 1756100000000,
  "updatedAt": 1756200000000,
  "settings": {
    "canvas": { "width": 1080, "height": 1920 },
    "fps": { "n": 30000, "d": 1001 },
    "sampleRate": 48000,
    "colorSpace": "rec709",
    "background": { "type": "blur", "value": "40" },
    "snapping": true,
    "magnetic": false
  },
  "assets": {
    "as_1": {
      "kind": "video",
      "name": "A7III_0031.MP4",
      "displayPath": "D:/shoots/wedding",
      "handleKey": "h_2841_1723_9ab3",
      "opfsPath": null,
      "fingerprint": "2841_1723_9ab3",
      "probe": { "duration": { "n": 3600, "d": 1 }, "width": 3840, "height": 2160,
                 "fps": { "n": 30000, "d": 1001 }, "rotation": 0,
                 "videoCodec": "avc1.640033", "audioCodec": "mp4a.40.2",
                 "transfer": "bt709" },
      "derived": { "proxyPath": "proxy/as_1_720.mp4", "waveformPath": "wave/as_1.bin",
                   "thumbsPath": "thumbs/as_1", "packetIndexPath": "index/as_1.bin",
                   "transcriptId": "tr_1" },
      "status": "ready"
    }
  },
  "tracks": ["tr_v1", "tr_v2", "tr_a1"],
  "trackMap": {
    "tr_v1": { "kind": "video", "name": "V1", "height": 72, "locked": false, "muted": false }
  },
  "clipMap": {
    "cl_1": {
      "trackId": "tr_v1", "assetId": "as_1", "kind": "video",
      "timelineStart": { "n": 0, "d": 1 }, "duration": { "n": 150, "d": 30 },
      "sourceIn": { "n": 90, "d": 30 }, "speed": 1,
      "transform": { "static": { "x": 0, "y": 0, "scale": 1, "rotation": 0, "anchor": [0.5, 0.5] } },
      "opacity": { "static": 1 }, "blendMode": "normal",
      "effects": ["ef_1", "ef_2"], "masks": [],
      "audio": { "gain": { "static": 0 }, "pan": { "static": 0 }, "muted": false },
      "enabled": true, "locked": false
    }
  },
  "effectMap": {
    "ef_1": { "type": "color.basic", "params": { "exposure": 0.22, "contrast": 0.1, "wbKelvin": 5600 } },
    "ef_2": { "type": "stabilize", "params": { "amount": 0.6, "crop": "auto" }, "bakedPath": "bake/ef_2.bin" }
  },
  "transitionMap": {},
  "markers": [{ "time": { "n": 120, "d": 30 }, "label": "first kiss", "color": "pink" }],
  "captions": [{ "trackId": "cap_1", "style": "karaoke-bold", "cues": [] }],
  "ui": { "playhead": { "n": 45, "d": 30 }, "zoom": 1.8, "scrollX": 0,
          "selection": ["cl_1"], "layout": "edit" }
}
```

## B. IndexedDB store summary

| Store | Key | Purpose | Cleared by |
|---|---|---|---|
| projects | id | project list plus thumbnails | user delete |
| docs | projectId | latest full document snapshot | project delete |
| wal | seq (auto) | write-ahead command log | compaction |
| snapshots | id (auto) | restore points | retention policy (keep 20) |
| handles | key | FileSystemFileHandle objects plus fingerprints | asset removal |
| assets | id | metadata, derived paths, status | project delete |
| settings | key | prefs, keymap, layouts, tool defaults | reset settings |
| presets | id | effect, caption and export presets | user delete |
| models | id | AI model registry state | storage cleanup |
| transcripts | id | word-level transcripts | asset removal |
| jobs | id | export and AI job state, resume offsets | completion |

## C. OPFS layout

```
/media/            optional private copies (mobile and Safari path)
/proxy/            720p or 540p dense-keyframe proxies
/thumbs/           filmstrip sprite sheets
/wave/             waveform peak pyramids
/index/            packet indexes
/bake/             baked effect data (stabilization transforms, tracking data)
/export/           in-progress export segments
/models/           downloaded ONNX weights
/recordings/        screen, camera and microphone captures
```

## D. Launch checklist

1. Golden-frame suite green on WebGPU and WebGL2.
2. Export verified in VLC, QuickTime, Windows Photos, Chrome, Safari, iOS Photos, and one Android device.
3. Refresh test: 200 random edits, refresh 20 times, zero state loss.
4. Kill test: force-quit the tab mid-edit 20 times, verify WAL recovery each time.
5. Relink test: move, rename and delete media, verify all three recovery paths.
6. Quota test: fill storage to 95 percent and verify graceful degradation and clear messaging.
7. Permission test: revoke file access in browser settings and verify the Reconnect flow.
8. Two-tab test: open the same project twice, verify single-writer behaviour.
9. Accessibility: keyboard-only edit and export, screen reader pass, 200 percent zoom.
10. Mobile: complete an edit and export on a mid-range Android and on an iPhone.
11. Performance budgets met on the mid tier (Part 10.1).
12. Legal: model licence file complete, codec review done, font and music licences recorded.
13. Privacy: verify with devtools that no media bytes leave the device during a full session.
14. Support: diagnostics export works, help panel covers every tool in one sentence.

## E. Immediate next 10 actions (start here on Monday)

1. Scaffold the monorepo from Part 8.2 with TypeScript strict and Vite.
2. Ship the Phase 0 spike: WebCodecs decode plus WebGPU draw plus frame stepping.
3. Ship the export spike: 300 frames plus audio to a verified MP4 with Mediabunny.
4. Ship the persistence spike: handle in IndexedDB, refresh, one-click reconnect.
5. Write the ProjectDoc types and zod schema, plus the migration runner.
6. Build the command bus with undo, WAL and snapshot compaction.
7. Build the timeline canvas renderer with drag, trim, split and snapping.
8. Build the render graph with the pass compiler and the first 10 effects.
9. Build the Magic Fix analysis pass and the decision table from Part 5.2.
10. Set up the golden-frame CI harness before the effect library grows.

## F. Key sources consulted (2026 research)

**Competitor features**
- CapCut official tools, features, pricing and release pages (capcut.com/tools, /features, /resource/new-release)
- Descript product and AI pages (descript.com, /video-editing, /ai-video)
- Blackmagic DaVinci Resolve what-is-new pages plus the Resolve 20 new-features guide PDF, and Resolve 21 coverage on CineD, DPReview and MiraCamp
- Adobe Premiere Pro AI video editing page, what-is-new release notes, Generative Extend overview and FAQ, Adobe newsroom
- Roundups: PCMag and ZDNet best online video editors, Vizard and Flocksy comparisons, Animoto and gregpreece feature lists

**Browser video engine**
- WebCodecs specification (w3.org/TR/webcodecs) and Chrome's WebCodecs best practices (data locality, frame lifetime, closing frames)
- MDN VideoDecoder, VideoFrame, AudioEncoder references
- caniuse WebGPU support data; WebGPU showcase of a shipped browser NLE (external textures, ping-pong compositor, 37 blend modes)
- Mediabunny documentation and repository (formats, codecs, muxing, streaming, conversion)
- MP4Box.js repository; ffmpeg.wasm repository and performance notes
- Open-source references: webgpu-video-encoding, webgpu-video-processor

**Local-first storage**
- MDN File System API, FileSystemFileHandle, queryPermission, requestPermission, origin private file system, storage quotas and eviction, StorageManager.persist
- Chrome developer docs on the File System Access API and persistent permissions; web.dev articles on persistent storage and OPFS
- WebKit storage policy update (seven-day inactivity eviction, heuristic persistence)
- Lumafield engineering note on faster project loads with OPFS; VS Code web handle-store pattern

**In-browser AI**
- Transformers.js WebGPU guide and the Whisper WebGPU demo space
- ONNX Runtime Web WebGPU execution provider docs (IO binding, graph capture)
- MediaPipe Selfie Segmentation documentation; Robust Video Matting repository (GPL-3.0)
- web.dev case study of a WebGPU plus WebCodecs AI video upscaler running at scale with zero server cost; web-realesrgan and Anime4K-style WebGPU upscaling references

**UI/UX**
- img.ly article on designing a timeline for mobile video editing (independent trim preview time)
- Timeline UI pattern guides (Eleken, Groto)
- Premiere Pro JKL and dynamic trimming documentation; Premiere and Resolve shortcut references
- Material dark theme guidance, Carbon accessibility colour guidance, Smashing Magazine on accessible dark themes

---

*End of blueprint. Build order: Part 9 Phase 0, then Phase 1. Everything else is detail you already have.*
