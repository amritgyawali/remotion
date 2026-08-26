# Editor Studio — Implementation Checklist

Tracks `video-editor-blueprint-2026.md` against what actually exists in `lib/editor/*`,
`components/editor/*` and `components/EditorStudio.tsx` (route: `/editor`).

**Checkbox rule (strict):** a box is only ticked `[x]` once the feature is built *and*
has been manually verified working in a real browser, with real media, end to end.
Passing `tsc --noEmit` and a route returning HTTP 200 is not "tested" — those only
prove the code compiles and boots without crashing. Every box below is still `[ ]`
for that reason: this session verified compilation, static type-safety, and that
every studio route (including `/editor`) loads without a server error, but nothing
has been driven through a real browser with real footage yet. The status note after
each item says what actually exists so this file is still useful for the next
session, instead of being a wall of identical unchecked boxes.

Status tags used below: **built** (code exists, logic reviewed, not yet browser-tested),
**partial** (a real subset works, the rest of the tool's description does not),
**not started**.

---

## Part A — Architecture foundations (blueprint Part 3, 4, 6, 7, 8, 10, 12)

### Engine / document model (`lib/editor/types.ts`, `model.ts`)

- [ ] Flat-map project document (assets/tracks/clips keyed by id, not a nested tree) — **built**. `lib/editor/types.ts`
- [ ] Frame-accurate time representation — **built, but a deliberate simplification**: integer project frames at a single `fps`, not the blueprint's `{num, den}` rational. Documented in `types.ts`'s header comment as an intentional trade-off, not an oversight.
- [ ] Patch-based command bus with exact inverse per command — **built**. `lib/editor/commands.ts`, `lib/editor/ops.ts`
- [ ] Undo/redo with coalescing of rapid edits (drag) into one history step — **built**. `Engine.dispatch` in `commands.ts`
- [ ] Undo history persisted across a refresh — **built** (the whole `{doc, undo, redo, ui}` snapshot autosaves). Capped at 200 entries, not unlimited.
- [ ] UI state (playhead/zoom/selection) excluded from the undo stack — **built**, a deliberate deviation from the blueprint's pseudocode (playhead moves are not sane undo steps). See `types.ts` `UiState` comment.

### Render graph (`lib/editor/compositor.ts`)

- [ ] Single render function shared by preview and export ("what you see is what you export") — **built**
- [ ] Canvas2D compositor tier (bottom of the WebGPU → WebGL2 → Canvas2D ladder) — **built**
- [ ] WebGL2 compositor tier — not started
- [ ] WebGPU compositor tier (`texture_external`, WGSL passes, node graph) — not started
- [ ] Per-clip transform (position/scale/rotation/opacity) — **built**
- [ ] Offline-media placeholder slate (clip stays on the timeline, playable state, greyed picture) — **built**
- [ ] Per-clip colour grade + stylize filters (brightness/contrast/saturation/temperature/hue/blur/vignette/grayscale/sepia/invert) via native `ctx.filter` — **built**. `buildFilterString`/`withClipTransform` in `compositor.ts`, sliders in `Inspector.tsx`
- [ ] Per-clip crop (normalized rect, survives a relink to a different resolution) — **built**, free via the source-rect draw overload, no extra canvas cost
- [ ] Chroma key (green/blue screen) with tolerance, soft edge and spill suppression — **built**: `applyChromaKey` in `compositor.ts`, a real per-pixel `getImageData`/`putImageData` pass on an offscreen scratch canvas sized to the clip, not the full frame
- [ ] Automatic crossfade transition when two clips on the same track overlap in time — **built** (`computeCrossfadeMultipliers` in `compositor.ts` — drag one clip over its neighbour to dissolve, the classic NLE convention; visualised as a diagonal-hatch zone in `Timeline.tsx`)
- [ ] Blend modes for simultaneously-stacked layers (multiply/screen/overlay/etc, distinct from the crossfade above) — not started (no `blendMode` field exists on a clip yet)
- [ ] Masks (shape/rotoscoped) — not started
- [ ] Temporal smoothing of the chroma-key alpha across frames (stops the matte flickering) — not started; each frame is keyed independently

### Playback (`lib/editor/player.ts`)

- [ ] `requestAnimationFrame` playhead clock with backpressure (drop late frames rather than queue) — **built**
- [ ] Frame-accurate seeking — **built on top of mediabunny's own `VideoSampleSink`/`getSample`**, which already does keyframe-aware seeking — this session did not need to hand-roll a packet index/keyframe walker per blueprint §3.6, mediabunny supplies it.
- [ ] Audio-as-master-clock — **not implemented**; documented simplification. The clock is `performance.now()`; audio is a best-effort per-clip `AudioBufferSourceNode` pump restarted when the active-clip set changes (`Player.syncAudio`/`startPump`). Can drift from picture over a long play. Export is unaffected — it always mixes down offline, independent of preview.
- [ ] Live-preview audio respects clip fades/gain automation — **built**: `startPump` schedules real `gain.gain.linearRampToValueAtTime` automation from the clip's fade-in/out frames, mapped onto the `AudioContext` clock, the same shape export's offline mixdown uses
- [ ] Live-preview audio respects clip speed (`playbackRate`, pitch shifts with it - same disclosed simplification as export) — **built**
- [ ] Proxy media / dense-keyframe scrub proxies — not started (preview always decodes full-resolution source)
- [ ] Device-tiered quality policy for preview (resolution/model size by device) — not started for the editor (the app already has `lib/device.ts`'s `deviceProfile()`/`useDeviceProfile()`, not yet wired into this studio)

### Export (`lib/editor/export.ts`)

- [ ] Deterministic integer-frame export loop — **built**
- [ ] Video encode via mediabunny `CanvasSource` + `getFirstEncodableVideoCodec` — **built**
- [ ] Full-timeline offline audio mixdown (`OfflineAudioContext`) with per-clip gain and fade automation — **built**
- [ ] MP4 (H.264-family) and WebM (VP9-family) output — **built**
- [ ] Resolution scale (0.5x / 1x / 2x) and quality presets (draft/high/max) — **built**
- [ ] Export range (in/out instead of the whole timeline) — **built in the engine** (`ExportOptions.startFrame/endFrame`), **not exposed in `ExportPanel.tsx`'s UI yet**
- [ ] Cancel mid-export — **built**
- [ ] Segmented rendering + crash-resume for long exports — not started (one continuous in-memory render; a crash mid-export loses the whole job)
- [ ] Export job queue (render several outputs in the background while still editing) — not started
- [ ] Multiple simultaneous outputs from one render pass (e.g. 1080p + 9:16 crop together) — not started
- [ ] Direct-to-disk writing via `showSaveFilePicker` for very large exports — not started (result is always buffered in memory, then downloaded as a Blob)
- [ ] Post-export verification (re-open the written file, confirm duration/tracks) — not started
- [ ] Real ETA (frames/sec moving average) — not started (progress ratio + phase only)

### Persistence (`lib/editor/persistence.ts`, `handles.ts`, and the shared `lib/persist/idb.ts`)

- [ ] Source media kept as local Blob copies in the existing shared vault (IndexedDB) — **built**, reuses the same store every other studio in this app already relies on
- [ ] `FileSystemFileHandle` remembered for a picked file (Chromium "reconnect with one click") — **built**. `lib/editor/handles.ts` + its own tiny IndexedDB (`rvs-editor-handles`), kept separate from the shared vault's frozen schema
- [ ] Reconnect banner / "3 files need permission" batched flow — **partial**: per-asset reconnect button exists in the media pool; there is no single batched "Reconnect all" action yet
- [ ] Drag-and-drop import captures a reusable handle via `DataTransferItem.getAsFileSystemHandle()` — **built**
- [ ] Debounced autosave + flush on `visibilitychange`/`pagehide` — **built** (reuses the app's existing `useAutosave` hook, unmodified)
- [ ] True write-ahead log (each command durable in ~1ms, not just a debounced whole-document snapshot) — **not implemented**; this session relies entirely on the existing debounced-snapshot autosave. Honest gap vs blueprint §4.8: worst-case loss is the last ~700ms of edits, not "the last second," and there is no separate WAL object store.
- [ ] Crash-recovery banner on reload — **built** (`RestoreNotice`, reused from the shared `SaveState.tsx`)
- [ ] OPFS for large derived binaries (proxies/thumbs/waveforms/packet indexes) — not started; the one thumbnail per asset goes through the same IndexedDB blob store as the source file, not OPFS
- [ ] Storage quota manager UI (`navigator.storage.estimate()`, persistence request, per-project breakdown) — not started (the shared `idb.ts` already exports `storageEstimate()`/`requestPersistentStorage()`; the editor does not call them yet)
- [ ] Multi-tab single-writer guard (Web Locks + BroadcastChannel) — **not implemented** for this studio
- [ ] Multi-project library (save/open/duplicate/archive many projects) — **not implemented**; there is exactly one always-current project per browser, same single-workspace model every other studio in this app already uses

### UI shell (`components/editor/*`, `components/EditorStudio.tsx`)

- [ ] Three-panel workspace (media/inspector rails + centre stage+timeline) — **built**
- [ ] Canvas-rendered, virtualised multi-track timeline (not DOM-per-clip) — **built**, horizontally virtualised via `ui.scrollFrame`/`ui.zoom`; **vertical scrolling for more tracks than fit on screen is not implemented** — extra tracks are visually clipped rather than scrollable today
- [ ] Drag to move a clip, drag an edge to trim, click-drag to scrub — **built**
- [ ] Drag a clip from the media pool onto the timeline — **built on Pointer Events, not HTML5 drag-and-drop** (`MediaPool.tsx`/`Timeline.tsx`'s `hitTest`/`EditorStudio.tsx`'s pool-drag state), so the exact same gesture works on mouse *and* touch. A real bug from the previous pass is fixed here: the old native `draggable`/`dragstart` wiring had the handler on a *descendant* of the draggable element, which `dragstart` never bubbles into, so it silently never fired on any browser.
- [ ] Project canvas auto-matches the first imported clip's resolution and frame rate — **built** (`EditorStudio.tsx`'s `handleImport`, only on a genuinely empty project) - this is what keeps the preview showing a source at its own real size instead of letterboxed inside a generic 1920x1080 canvas
- [ ] Snapping (to clip edges/playhead/markers, hold Shift to disable) — **built**: `Timeline.tsx`'s drag handling calls `snapCandidates()` for move and both trim edges
- [ ] Magnetic timeline mode — not started
- [ ] Track header controls: mute / lock / hide / remove / add — **built**; solo and per-track colour/height editing are not
- [ ] Markers: add / drag / remove — **built**; named/commentable markers and chapter export are not
- [ ] Split at playhead (`S`), ripple/plain delete (`Delete`/`Alt+Delete`) — **built**
- [ ] Undo/redo buttons + `Ctrl/Cmd+Z`/`Shift+Z` — **built**
- [ ] Full JKL shuttle, three-point editing, insert/overwrite modes — not started
- [ ] Contextual inspector (project settings / transform / audio / text, only what applies) — **built**
- [ ] On-canvas transform handles (drag to move/scale/rotate on the preview itself) — not started; transform is numeric-fields-only in the inspector today
- [ ] Command palette (`Ctrl/Cmd+K`) — not started
- [ ] Remappable keyboard shortcuts / Premiere-Resolve-CapCut keymap presets — not started (shortcuts exist, are not remappable)
- [ ] Full accessibility pass (ARIA grid semantics for the timeline, screen-reader clip announcements) — not started; keyboard shortcuts exist but the canvas timeline has no ARIA grid semantics yet
- [ ] Mobile layout: the preview stage gets a real, definite height instead of fighting a CSS grid's `auto` row sizing against a `flex: 1` child, and shows first (before the media pool) instead of requiring a scroll past it — **built**, `@media (max-width: 900px)` in `globals.css` switched from `display: grid` to a flex column with explicit heights and `order: -1`
- [ ] Offline-first PWA (installable, service-worker precache) for this route — not started

---

## Part B — The 206-tool inventory (blueprint Part 2)

### A. Media ingest, assets & organization (1–14)

- [ ] 1. Add media from device — **built** (`showOpenFilePicker` + `<input>` fallback, `components/editor/MediaPool.tsx`)
- [ ] 2. Drag & drop import — **built**, captures a handle via `getAsFileSystemHandle` when available (file-from-OS import; dragging a *pool item onto the timeline* is a separate feature, see Part A's UI shell)
- [ ] 3. Media pool / bins — **partial**: flat list only, no folders/colour tags/ratings/view modes
- [ ] 4. Auto metadata extraction — **built** (`lib/editor/probe.ts`, mediabunny-based)
- [ ] 5. Thumbnail + filmstrip generation — **partial**: one poster thumbnail per asset; no filmstrip sprite sheet
- [ ] 6. Audio waveform generation — not started
- [ ] 7. Proxy / optimized media generation — not started
- [ ] 8. Smart proxy switching — not started
- [ ] 9. Scene detection on import — not started for this studio (a scene-cut detector already exists in Tools Studio's `lib/tools/scene-detect.ts`, not wired here)
- [ ] 10. Silence detection — not started for this studio (exists standalone in Silence Studio)
- [ ] 11. Duplicate / similar clip finder — not started (a file fingerprint is computed on import; nothing surfaces duplicates)
- [ ] 12. Content-based media search (CLIP embeddings) — not started
- [ ] 13. Speech-to-text indexing of assets — not started for this studio (Whisper transcription exists in Captions Studio, not wired here)
- [ ] 14. Missing-media reconnect (relink) — **built**: fingerprinting, handle permission check/grant, and a per-asset "reconnect" button (`lib/editor/persistence.ts` `reconnectAsset`, `assetsNeedingPermission`)

### B. Core timeline editing (15–38)

- [ ] 15. Multi-track timeline — **built**
- [ ] 16. Insert / overwrite / replace edits (F9/F10/F11) — not started
- [ ] 17. Blade / razor split — **built** (`S`, or click a clip then split at playhead)
- [ ] 18. Trim in / out — **built** (drag a clip edge)
- [ ] 19. Ripple trim / ripple delete — **partial**: ripple *delete* is built; ripple *trim* (closing the gap while trimming) is not — trimming only ever moves that one edge in place
- [ ] 20. Roll / slip / slide edits — not started
- [ ] 21. JKL shuttle + dynamic trim — not started
- [ ] 22. Three-point editing with I/O marks — not started
- [ ] 23. Snapping — **built** (clip edges/playhead/markers, hold Shift to disable — see Part A)
- [ ] 24. Magnetic timeline mode — not started
- [ ] 25. Track locking / mute / solo / hide / height / colour — **partial**: lock/mute/hide built; solo, per-track height editing and colour are not
- [ ] 26. Grouping & compound clips — not started
- [ ] 27. Multicam sync & switching — not started
- [ ] 28. Markers & chapters — **partial**: add/move/remove coloured markers built; named/commentable markers and chapter export are not
- [ ] 29. Range selection & bulk operations — **partial**: shift-click multi-select and bulk delete work; bulk nudge/retime do not
- [ ] 30. Copy/paste attributes — not started
- [ ] 31. Unlimited undo / redo with named history — **built** (capped at 200 steps, not literally unlimited; each step has a label)
- [ ] 32. Auto-save + version snapshots — **partial**: debounced autosave built; named restore-point snapshots are not
- [ ] 33. Timeline zoom & fit — **partial**: `Ctrl/Cmd`+wheel zoom built; "fit"/"zoom to selection" shortcuts are not
- [ ] 34. Playhead scrub with audio scrubbing — **partial**: visual scrub works; there is no audio while scrubbing (only during actual playback)
- [ ] 35. Frame-step & timecode entry — **partial**: arrow-key frame stepping and a read-only timecode display exist; there is no editable timecode entry field
- [ ] 36. Clip enable/disable & solo — **partial**: the data model supports `clip.enabled`; no UI toggle is wired to it yet
- [ ] 37. Track/clip search & filter — not started
- [ ] 38. Storyboard / list mode — not started

### C. Time & speed (39–46)

- [ ] 39. Constant speed change — **partial**: a speed slider changes playback rate identically in live preview and export; pitch is **not** preserved (no WSOLA/phase-vocoder correction — changing speed changes pitch, a known, disclosed gap)
- [ ] 40. Speed ramping with curves — not started
- [ ] 41. Reverse playback — not started
- [ ] 42. Freeze frame / hold — **built**: a per-clip toggle plus "use the frame at the playhead" to pick which instant freezes; audio on a frozen clip goes silent (a held frame has no moment of sound to loop), in both preview and export
- [ ] 43. Optical-flow frame interpolation — not started
- [ ] 44. Motion blur synthesis — not started
- [ ] 45. Time remapping keyframes — not started (no keyframe system exists yet at all — see Part I)
- [ ] 46. Beat-synced auto cut — not started

### D. Frame, transform, layout & framing (47–58)

- [ ] 47. Transform (position/scale/rotate/anchor/opacity) — **partial**: numeric-field control in the inspector; no on-canvas drag handles
- [ ] 48. Crop & pan/zoom (Ken Burns) — **partial**: crop is built (normalized rect, free via the source-rect draw, real-time in the inspector); animated pan/zoom is not (needs keyframes, which do not exist yet)
- [ ] 49. Aspect-ratio presets & safe areas — not started (canvas width/height are free-form numeric fields, no presets or safe-area overlay)
- [ ] 50. Auto Reframe with subject tracking — not started
- [ ] 51. Background fill for vertical conversion — not started (one flat background colour only)
- [ ] 52. Multi-layer PiP with corner presets — **partial**: achievable manually via multiple video tracks + transform; no corner-preset picker
- [ ] 53. Split screen layouts — not started
- [ ] 54. Distortion & perspective corner-pin — not started
- [ ] 55. Lens correction / de-fish — not started
- [ ] 56. Rolling-shutter & horizon leveling — not started
- [ ] 57. Stabilization — not started
- [ ] 58. Grid, rulers, guides & alignment tools — not started

### E. Color & tone (59–76)

- [ ] 59. Auto Color / auto white balance — not started (grading is manual-only; no histogram analysis to drive a one-click fix)
- [ ] 60. Exposure / contrast / brightness — **partial**: brightness + contrast sliders built via native `ctx.filter`, real-time; true stops-based exposure and separate highlight/shadow rolloff are not
- [ ] 61. Highlights / shadows recovery — not started (no luminance-masked tone curve)
- [ ] 62. Temperature / tint — **partial**: temperature built as a warm/cool overlay-blend approximation (not a physical Kelvin/Bradford model); tint (green/magenta axis) is not
- [ ] 63. Saturation / vibrance — **partial**: flat saturation slider built; vibrance (skin-tone-protected saturation) is not
- [ ] 64. RGB curves + luma curve — not started
- [ ] 65. Color wheels (lift/gamma/gain/offset) — not started
- [ ] 66. HSL secondaries / qualifier — not started
- [ ] 67. 3D LUT support + look library — not started
- [ ] 68. LUT intensity blending + split view — not started
- [ ] 69. Shot match / color match — not started
- [ ] 70. Skin-tone protect & face-aware grading — not started
- [ ] 71. Scopes (waveform/parade/vectorscope/histogram) — not started
- [ ] 72. Film emulation & grain — **partial**: sepia is a crude filmic tint; there is no grain/film-stock emulation
- [ ] 73. Bleach bypass / teal-orange presets — not started (no one-click look presets stacking the effects that now exist)
- [ ] 74. Adjustment layers — not started
- [ ] 75. HDR-aware pipeline & tone mapping — not started
- [ ] 76. Color management & working space — not started

*None of Part E is implemented for the timeline compositor in this session; the app's separate Tools Studio has some adjacent single-clip color tools (`lib/tools/video-filter.ts`, `frame-ops.ts`), none of which are wired into the multi-track editor's render graph.*

### F. Keying, masking & compositing (77–90)

- [ ] 77. Chroma key — **built**: tolerance, soft edge and spill suppression, a real per-pixel keying pass (`applyChromaKey` in `compositor.ts`), toggled and tuned live from the inspector
- [ ] 78. AI background removal — not started
- [ ] 79. Temporal mask smoothing — not started
- [ ] 80. Object selection & masking ("magic mask") — not started
- [ ] 81. Shape masks — not started
- [ ] 82. Rotoscoping with keyframed masks — not started
- [ ] 83. Motion tracking — not started
- [ ] 84. Object removal / clean plate — not started
- [ ] 85. Blur/mosaic/pixelate a region — not started
- [ ] 86. Blend modes — not started (no `blendMode` field exists on a clip yet)
- [ ] 87. Track mattes — not started
- [ ] 88. Alpha/transparent media support — not started
- [ ] 89. Light wrap / edge blend / matte refine — not started
- [ ] 90. Depth-based effects — not started

### G. Effects, transitions & stylization (91–110)

- [ ] 91. Transitions library — **partial**: one transition (dissolve/crossfade) is built, and it is *automatic* rather than a library entry — overlap two clips on the same track and the overlap region blends. Wipes, slides, whip-pan, glitch and luma-matte transitions are not started.
- [ ] 92. Transition drag-and-drop with duration handles — **partial**: dragging one clip onto its neighbour on the timeline *is* the duration handle (the overlap length is the crossfade length), shown as a diagonal-hatch zone in `Timeline.tsx`; there is no dedicated transition object with its own easing/duration UI
- [ ] 93. Blur family — **partial**: a flat gaussian-style blur (`ctx.filter`'s `blur()`) is built; radial, zoom, directional and tilt-shift blur are not
- [ ] 94. Sharpen & clarity / dehaze — not started (`ctx.filter` has no native sharpen)
- [ ] 95. Glow / bloom / light leaks — not started
- [ ] 96. Chromatic aberration / vignette — **partial**: vignette is built (radial gradient, multiply-blended, real-time); chromatic aberration is not
- [ ] 97. Glitch / VHS / datamosh — not started
- [ ] 98. Distortion set — not started
- [ ] 99. Stylize set — **partial**: grayscale, sepia and invert are built via `ctx.filter`; posterize/halftone/ASCII/oil-paint/pencil-sketch/edge-detect are not
- [ ] 100. Particles & overlays — not started
- [ ] 101. Shake / handheld camera — not started
- [ ] 102. Zoom-punch / beat pulse — not started
- [ ] 103. Speed-line / anime effects — not started
- [ ] 104. Freeze-frame cutout "pop-out" — not started
- [ ] 105. Text-behind-subject effect — not started
- [ ] 106. 2.5D parallax photo animation — not started
- [ ] 107. Effect stacking (reorder/bypass/solo) — not started (there is no per-clip effect list at all yet)
- [ ] 108. Node graph mode — not started
- [ ] 109. Custom shader plugin SDK — not started
- [ ] 110. Effect presets & favorites — not started

### H. Text, titles & captions (111–128)

- [ ] 111. Rich text engine — **partial**: Canvas2D `fillText`/`strokeText` with per-character styling *not* supported; correct complex-script shaping (Devanagari/Arabic) is **not** guaranteed — no HarfBuzz, relies on the browser's own canvas text shaping
- [ ] 112. Local font loading — not started (`queryLocalFonts()`/custom font upload not wired to text clips)
- [ ] 113. Stroke, shadow, glow, gradient, background box, 3D extrude — **partial**: stroke and a flat background box are built; shadow/glow/gradient/3D extrude are not
- [ ] 114. Text presets & title templates — not started
- [ ] 115. Text animation in/out/loop — **partial**: enter/exit animation (fade, slide up, slide down, pop) with an adjustable duration is built, eased with a cubic ease-out; looping/per-character stagger is not
- [ ] 116. Auto captions (word-level, local Whisper) — not started for this studio (exists standalone in Captions Studio)
- [ ] 117. Karaoke / animated word-highlight captions — not started
- [ ] 118. Caption styles library — not started
- [ ] 119. Caption editor with transcript sync — not started
- [ ] 120. Transcript-based editing (Descript-style) — not started
- [ ] 121. Filler-word & silence removal from transcript — not started for this studio
- [ ] 122. Translate captions — not started
- [ ] 123. Burn-in vs sidecar caption export (.srt/.vtt/.ass) — not started
- [ ] 124. Text-to-speech voiceover — not started
- [ ] 125. Auto-emoji & keyword emphasis — not started
- [ ] 126. RTL + vertical text support — not started
- [ ] 127. Sticker/GIF/emoji layers — not started
- [ ] 128. Lottie / vector animation import — not started

### I. Motion graphics, keyframes & rigging (129–138)

- [ ] 129. Keyframe any parameter — **not started**: every clip property (transform, opacity, audio gain) is a single static value today, not a keyframed track. This is the single largest gap versus the blueprint's document schema, which models every animatable field as `Keyframed<T>`.
- [ ] 130. Graph editor / value curves — not started
- [ ] 131. Easing presets — not started
- [ ] 132. Motion paths on canvas — not started
- [ ] 133. Auto-animate ("animate this in") — not started
- [ ] 134. Shapes & drawing layers — not started
- [ ] 135. Data-driven graphics — not started
- [ ] 136. Screen-recording annotations — not started
- [ ] 137. 3D layer transforms — not started (2D transform only: x/y/scale/rotation, no Z/perspective camera)
- [ ] 138. Templates with locked "fill-in" slots — not started

### J. Audio (139–158)

- [ ] 139. Multi-track audio mixer — **partial**: per-clip gain/mute in the inspector; no dedicated mixer panel, no per-track gain/pan, no meters
- [ ] 140. Volume keyframes + clip gain — **partial**: flat per-clip gain (dB) and mute exist; there is no keyframed volume envelope (see #129)
- [ ] 141. Fades & crossfades — **partial**: linear fade in/out (in frames) applied during export's offline mixdown; **not** reflected in the live preview's audio pump
- [ ] 142. Loudness normalization (LUFS) — not started
- [ ] 143. True-peak limiter & clip protection — not started (export audio is not limited; a hot mix can clip)
- [ ] 144. AI noise reduction — not started
- [ ] 145. De-reverb — not started
- [ ] 146. Voice enhance / "Studio Sound" chain — not started
- [ ] 147. Auto ducking — not started
- [ ] 148. Parametric EQ — not started
- [ ] 149. Compressor / gate / de-esser / expander — not started
- [ ] 150. Voice changer & pitch shift — not started
- [ ] 151. Beat detection & tempo grid — not started
- [ ] 152. Music auto-fit / auto-remix to length — not started
- [ ] 153. Silence cut / auto-jump-cut for talking heads — not started for this studio
- [ ] 154. Audio-only recording (voiceover booth) — not started
- [ ] 155. Screen + camera + mic recording — not started
- [ ] 156. Audio extraction & detach — **partial**: the data model has a standalone `audio` clip kind that composites and exports correctly; there is no one-click "detach audio from this video clip" action yet
- [ ] 157. Stem separation — not started
- [ ] 158. Sound-effect & music library — not started

### K. AI repair & "make it better" tools (159–178)

*Nothing in this category is implemented for the Editor Studio in this session — the whole Magic Fix pipeline (§5 of the blueprint) is unbuilt. Listed for completeness:*

- [ ] 159. Magic Fix (one button) — not started
- [ ] 160. AI upscale — not started
- [ ] 161. AI denoise (video) — not started
- [ ] 162. Deblur / sharpen recovery — not started
- [ ] 163. Frame interpolation to 60/120fps — not started
- [ ] 164. Auto stabilization — not started
- [ ] 165. Auto color & exposure repair — not started
- [ ] 166. Low-light enhancement — not started
- [ ] 167. Face retouch / beautify — not started
- [ ] 168. Relight / studio light — not started
- [ ] 169. Eye-contact correction — not started
- [ ] 170. Auto highlights / best-moments detection — not started
- [ ] 171. Long-video → shorts auto-clipping — not started
- [ ] 172. Virality/quality score with notes — not started
- [ ] 173. Auto B-roll suggestions — not started
- [ ] 174. Auto chapters & summary — not started
- [ ] 175. Smart crop for every platform at once — not started
- [ ] 176. Auto thumbnail generator — not started
- [ ] 177. Object/logo removal — not started
- [ ] 178. Audio-to-video sync fix — not started

### L. Export, delivery & project operations (179–192)

- [ ] 179. Local export to MP4 (H.264/HEVC-family) & WebM (VP9/AV1-family) — **built** (`lib/editor/export.ts`)
- [ ] 180. Platform presets (YouTube/Shorts/Reels/etc.) — not started (format/quality/scale controls only, no named presets)
- [ ] 181. Custom export dialog (bitrate mode, keyframe interval, profile, colour space) — **partial**: format/quality/resolution/audio toggle only
- [ ] 182. Export queue with background rendering — not started
- [ ] 183. Pause / resume / cancel export + crash-resume — **partial**: cancel is built; pause/resume and crash-resume are not
- [ ] 184. Progress with real ETA + live preview thumbnail — **partial**: phase + frame-count progress bar built; no ETA, no live thumbnail
- [ ] 185. Export range / selection only — **partial**: supported by the engine, not yet exposed in the export dialog's UI
- [ ] 186. Frame / still export (PNG/JPEG/WebP) — not started
- [ ] 187. GIF / animated WebP export — not started for this studio (a GIF encoder exists in Tools Studio, not wired here)
- [ ] 188. Audio-only export (MP3/WAV/M4A) — not started
- [ ] 189. Export presets save/share — not started
- [ ] 190. Project save / open / duplicate / archive — **partial**: one always-current autosaved project per browser; no save-as, duplicate, multi-project library, or `.vproj` file export/import
- [ ] 191. Interchange (EDL/XML/AAF/SRT/JSON) — not started
- [ ] 192. Batch operations across projects — not started

### M. Collaboration, learning & quality-of-life (193–206)

- [ ] 193. Offline-first PWA — not started for this route
- [ ] 194. Command palette (`Ctrl/Cmd+K`) — not started
- [ ] 195. AI assistant sidebar — not started
- [ ] 196. Remappable keyboard shortcuts + presets — not started (fixed shortcuts only — see Part A)
- [ ] 197. Workspace layouts — not started (one fixed layout)
- [ ] 198. Interactive onboarding — not started
- [ ] 199. Templates gallery — not started
- [ ] 200. Auto-recovery dialog after a crash — **built** (reuses the shared `RestoreNotice` component)
- [ ] 201. Storage manager (quota, cleanup) — not started for this studio (the underlying vault utilities already exist and are unused here)
- [ ] 202. Performance mode switch (preview quality vs speed) — not started
- [ ] 203. Multi-tab safety (single writer) — not started
- [ ] 204. Cloud sync of project files only — not started (no backend for this)
- [ ] 205. Share a review link — not started
- [ ] 206. Localized UI + correct Indic shaping — not started for this studio

---

## Part C — Phase roadmap (blueprint Part 9)

- [ ] **Phase 0 — Feasibility spike**: decode+composite+step frames, encode a verified MP4, persist+restore a file handle — **the spike's three risky bets are all built** (compositor, export, handle persistence) as production code rather than a throwaway spike, but none have been run end to end in a real browser by this session, so the phase's own exit criterion ("verified export") is not met yet.
- [ ] **Phase 1 — Minimum lovable editor**: this session covers a meaningful slice (import, timeline, undo/redo/autosave/crash-recovery, basic transform, basic text, basic audio, MP4/WebM export) but is missing several Phase-1 items outright: insert/overwrite edit modes, JKL, snapping, proxies, LUTs/curves, 10 transitions, colour basics, 10 text animations, loudness normalize+limiter, and Devanagari-correct text shaping.
- [ ] **Phase 2 — differentiators** (local AI, Whisper captions in-editor, Magic Fix, background removal, auto-reframe) — not started
- [ ] **Phase 3 — depth for creators** (keyframes, masks, chroma key, 100+ effects, scopes) — not started
- [ ] **Phase 4 — mobile-grade polish** — not started (no touch-specific timeline interactions, no mobile performance tier wired in)
- [ ] **Phase 5 — ecosystem & growth** (tool pages, plugin SDK, sync, localization) — not started
- [ ] **Phase 6 — pro tier & scale** (node graph, HDR, interchange, desktop helper) — not started

---

## Real-time preview, by construction

Every setting added to a clip — transform, colour grade, crop, chroma key, speed,
audio gain/fades — is a `Command` dispatched through `Engine`. That changes `doc`,
which `EditorStudio.tsx`'s `useEffect(() => playerRef.current?.setDoc(doc), [doc])`
hands straight to the `Player`, which redraws the current frame through the exact
same `renderFrame` export uses. There is no "apply" step and no separate preview
renderer to fall out of sync with the real one — a slider drag is visible on the
same frame it is dragged on, live-preview audio now included (fades and speed both
schedule real Web Audio automation, not just a flat value). This is architectural,
not a per-feature promise: the next setting added to a clip gets this for free
just by going through `ops.ts`/`Engine.dispatch` like everything else does.

## What to do next (highest-leverage gaps, in order)

1. Add a real keyframe system (`Keyframed<T>` on transform/opacity/audio gain/effects) — nearly everything in Part I and half of Part D/J depends on this existing first. This is now the single largest gap versus the blueprint's document schema.
2. Verify the whole vertical slice in a real browser, on both desktop and mobile, with real footage: import (including drag-from-pool onto the timeline) → trim/split/move → transform/color-grade/crop/key a clip → overlap two clips to dissolve → freeze a frame → animate a text clip in/out → export → play the exported file. Nothing above can be honestly ticked until this happens at least once.
3. Add on-canvas transform handles - drag directly on the preview to move/scale the selected clip, instead of numeric fields only. Deliberately deferred this pass: it needs the compositor's fit/transform math exposed as a reusable pure function and careful CSS-pixel-to-canvas-pixel coordinate mapping, and shipping it rushed risks exactly the kind of subtly-wrong interaction a preview feature can't afford.
4. Expose export range (already built in `lib/editor/export.ts`) in `ExportPanel.tsx`.
5. Add a blend-mode field to `Clip` and one compositing pass in `compositor.ts` for simultaneously-*stacked* layers (distinct from the crossfade transition, which is already built) — the cheapest way to unlock the rest of Part F.
6. Add vertical scrolling to the timeline once a project has more tracks than fit on screen.
7. Add temporal smoothing to the chroma-key alpha mask so it stops flickering frame to frame.
