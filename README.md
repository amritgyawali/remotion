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
   For automatic captions, set `GROQ_API_KEY` as well (or instead) - a free key
   from <https://console.groq.com> is the primary speech recogniser, and either
   key alone is enough to caption a video.
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

     **Cloud** (used first whenever the server has any speech key) decodes the
     audio in the browser, resamples it to 16 kHz mono, conditions it (DC
     removal, an 85 Hz high-pass under the voice, and a level pass measured over
     speech only), cuts it in the longest pause near each boundary and uploads
     those chunks to `/api/captions/transcribe`.

     That route tries **Groq's hosted Whisper large-v3 first** - it is free at
     <https://console.groq.com>, needs no download, covers 99 languages, writes
     Devanagari, and returns a measured timestamp for every individual word,
     which is what the karaoke styles ride on. Each chunk is sent with
     `temperature=0` (greedy decoding, so the model cannot re-roll a
     low-confidence segment into an invented one) and a 224-token prompt that
     *demonstrates* the wanted output rather than instructing it - Whisper has no
     instruction tuning, and conditions on the prompt as if it were the
     transcript so far, so an imperative prompt gets transcribed instead of
     obeyed. See `lib/captions/asr-prompt.ts`. The tail of the previous chunk's
     transcript rides along too, which keeps a name spelled the same way on both
     sides of a chunk boundary.

     **NVIDIA** is the automatic fallback when `GROQ_API_KEY` is unset or Groq
     fails - Whisper large-v3 for Nepali and the other 98 languages, Parakeet and
     Canary for English and the major European ones. The video never leaves the
     device, there is nothing to download, and a chunk that fails is retried and
     then skipped rather than losing the whole
     transcript. When a boundary genuinely cannot be placed in a pause, the next
     chunk carries a second and a half of overlap so the word sitting on the cut
     is transcribed whole by somebody, and the two copies are stitched back into
     one.

     **On this device** runs Whisper as WebAssembly inside the tab. Six models
     from tiny to small, English-only or multilingual (77 MB - 488 MB),
     downloaded once into IndexedDB and reused afterwards. Nothing is uploaded
     and no API key is involved; it does need a cross-origin isolated page for
     SharedArrayBuffer.

     Either way every word gets its own timestamp, and a cleanup pass drops
     music/silence hallucinations and the credit-loop lines Whisper falls into
     on long clips. **Auto** falls back to the other engine when one fails, so a
     missing key or a browser without SharedArrayBuffer still produces captions.

     **Every timestamp is then checked against the audio itself.** The same pass
     that cut the chunks also measured where speech is, frame by frame, using a
     two-threshold detector whose speech/silence split is recomputed per three
     seconds by Otsu's method rather than assumed. That map does three jobs. A
     recogniser that returns no word timings at all - which is what NVIDIA's
     hosted Whisper function does - has its text laid down on the speech,
     weighted by syllables, so a pause on screen is a pause in the audio instead
     of the text being smeared evenly across a whole minute. A recogniser that
     does return timings has its constant offset measured by cross-correlating
     its word activity against the real speech and taken back out, and any word
     left stranded in a silence is pulled onto the speech beside it. Line breaks
     are placed on real pauses rather than on whatever gap the word timings
     happened to leave. The studio reports what it did - the offset it removed,
     and the share of words that landed on speech.

     Optionally an NVIDIA language model then tidies the transcript - one
     rewritten line per recognised line, so punctuation and spelling improve
     while every word timing is kept. It is refused if the model changes the
     line count or rewrites a line beyond recognition.

     **English words come back in English.** Nepali speech is code-switched, and
     a recogniser told the language is Nepali writes the English it hears in
     Devanagari anyway - कम्प्युटर for computer, बैंक for bank, अपडेट for update,
     ओटिपी for OTP. That is neither what the speaker said nor how any Nepali
     writer spells it, so three layers put it back: the recogniser is handed the
     common loanwords as phrase hints before it starts, a hand-decided lexicon
     restores the ones it still wrote in Devanagari, and the clean-up model is
     told explicitly that each word keeps the script it belongs to. It never
     runs the other way - a Nepali word is never written in Latin - and a
     loanword that has taken a Nepali ending is left whole, because बैंकमा is a
     Nepali word and "bankमा" is not an improvement.
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

   **Type in either script.** The timeline switches between English and Nepali,
   for one line or for the whole list. In Nepali the roman letters you type
   become Devanagari the moment a word is finished - namaste → नमस्ते, banda →
   बन्द - and the conversion is shown under the field while you are still typing
   it, so nothing is a guess. A word typed in CAPITALS stays Latin, which is
   what OTP, ATM and PIN want, and Ctrl/Cmd + Space flips one line mid-sentence
   for the English in the middle of a Nepali one. A Devanagari face ships with
   the editor, so the text is readable on a machine that has no Nepali font
   installed.
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
   * **Entrance**: pop, fade, slide, rise, blur, cut - plus three loud ones,
     **stamp** (lands from oversize and settles with a decaying shake),
     **whoosh** (flies in from the side it is aligned to, under motion blur) and
     **glitch** (two frames of RGB tearing before the line resolves). All three
     work with the word-by-word reveal, and each has a matching sound.
5. **Give every sentence a sound** in the Sound tab - see below.
6. **Work in bulk** in the Tools tab: **align every line to the speech** (reads
   the audio, finds where the voice is, and moves each word onto it without
   touching a single line break - the fix for an imported `.srt` cut for a
   different edit, or a hand-typed script), find and replace (word timings
   survive a same-length replacement), sentence/title/upper/lower rewriting,
   punctuation tidying, `Name:` speaker splitting, speed correction for a
   transcript that drifts, holding captions through short pauses, frame
   snapping, splitting long cues, folding short flashes into their neighbour,
   restoring English loanwords on demand, and copy/paste of the whole look as
   JSON.
7. **Render** with the same browser or server engine the code studio uses. The
   output carries the original audio unless you mute it. Subtitles also export
   as `.srt`, `.vtt` and a fully styled `.ass` with per-word karaoke tags.

Everything the preview shows is one real Remotion composition, written for your
clip and compiled in the tab. **Download the .tsx** to keep it: it is a
self-contained file with your cues and style baked in, ready for Remotion Studio,
CI, or a re-upload into the code studio. Captions also export as `.srt` and
`.vtt`.

### Sound effects for every sentence

A caption that appears in silence reads as a caption. The same caption with a
90 ms tick under it reads as an edit. The **Sound** tab puts that layer on the
subtitle track, and it is burned into the rendered video along with the
captions - no separate audio pass, no editor.

* **Off until you turn it on.** A subtitle tool that quietly adds noise to
  someone's video is a subtitle tool nobody trusts.
* **35 effects, all from the studio's own CC0 kit** (`public/assets/audio`), so
  an export owes no attribution to anyone. Interface, impacts, motion,
  transitions, accents and foley - each one auditions at the level it will
  actually be mixed at when you tap it.
* **Auto matches the entrance.** A stamped line gets an impact, a whoosh gets
  air, a glitch gets digital stutter, a typewriter gets key strikes. Change the
  entrance in Design and the sound follows it.
* **36 takes per family, so sentence 11 does not sound like sentence 10.**
  Shuffle draws a take per sentence, In order walks them, Same take repeats one
  - useful when the sound *is* the brand. A pitch drift of a few percent per hit
  stops a repeated one-shot from sounding looped. All of it is derived from the
  sentence number, never rolled, so two renders of the same project are
  identical to the byte.
* **Levelled per effect.** Every option carries the loudness trim the asset kit
  measured for it, so 60% is 60% whether you pick a tick or a boom.
* **Ducking.** The video's own audio dips under each effect - down over 60 ms,
  held, back up over 220 ms, the shape a broadcast desk would use - so the sound
  sits with the speech instead of on top of it.
* **Placement.** Fire on every sentence, on every word (the typewriter texture)
  or only on the words marked as emphasis. Nudge the timing a few frames early,
  which is what makes the sound and the caption read as one event, and set a
  minimum gap so fast speech cannot turn the track into a machine gun.

The whole schedule is written into the downloaded `.tsx` as data - one row per
hit, with its file, time, level and pitch - so the file you export sounds
exactly like the preview on any machine that renders it, and silencing one
sentence is a matter of deleting one line.

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

* **Typography kit**: 102 self-hosted open-licence families ship with the app -
  text and grotesk faces, condensed and news faces, impact and comic display,
  editorial serifs, tech, retro, pixel and terminal faces, script and marker
  hands, and 51 that draw Devanagari for Nepali and Hindi. Nothing is fetched
  from a font CDN: a caption looks the same in the preview, in a browser export
  and on a render host, and an offline machine renders the same frames as an
  online one. Every Devanagari face is checked against its own `cmap` table for
  the full Nepali sample - consonants, matras, halanta, danda and the Devanagari
  digits - so no face in the picker can ship tofu boxes. `npm run assets:fonts`
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
  `npm run captions:check` compiles all 18 presets and all 102 faces and asserts
  exactly that.
* **Code-switching is treated as the normal case, not an edge case.**
  `lib/captions/devanagari.ts` holds one table read in both directions: forwards
  it is a phonetic input method, so a caption can be typed in Nepali from a
  Latin keyboard; backwards it sounds a Devanagari spelling out, which is how
  `lib/captions/loanwords.ts` recognises कम्प्युटर as "computer". The lexicon is
  exact-match and hand-decided, because the expensive mistake is the other
  direction: turning a Nepali word into an English one is a wrong transcript,
  while a loanword left in Devanagari is only an unpolished one. The fuzzy
  fallback behind it is gated three ways - a blocklist of Nepali words that
  collide once their vowels are dropped (कर against "car", बस against "bus",
  बन्द against "band"), a minimum of three consonants, and a refusal to touch
  any word carrying Nepali grammar - and skeletons shared by two English words
  are dropped rather than guessed at.
* **Audio is conditioned before it is recognised**: DC removal, a second-order
  high-pass at 85 Hz under the voice, and a level pass that measures loudness
  over the detected speech only and never over the pauses. Measuring the whole
  chunk makes a talker who leaves long pauses quieter than one who does not,
  and amplifies a near-silent chunk until its noise floor sounds like whispering
  - which is the classic way to make a model hallucinate a sentence into
  silence.
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
  OpenAI-shaped payloads. Which unit a payload is using is read off the key
  name, not guessed from magnitude, because a Riva reply holding small
  millisecond values looks exactly like an OpenAI reply holding seconds. Timings
  that cannot be true - all zeros, everything crammed into the first instant, or
  a transcript claiming to run past the audio it came from - are rejected as
  timings and the text is aligned to the audio instead, which is a better answer
  than pinning captions to a clock that is wrong.
* **Alignment is measured, not assumed.** `lib/captions/vad.ts` finds where
  speech is: 10 ms frames, two thresholds with a hangover so a stop consonant
  does not end a word, and a speech/silence split recomputed every three seconds
  by Otsu's method rather than taken as a fixed percentile - a percentile floor
  only works on a window that happens to be about that percent silent, and gets
  unbroken narration and long pauses both wrong. `lib/captions/align.ts` then
  places words on that map: syllable-weighted distribution when no timings came
  back (Devanagari clusters are counted by nuclei, English by vowel groups with
  the common hiatus cases), and for timings that did come back, a
  cross-correlation of word activity against real speech to measure the constant
  offset, remove it, and rescue any word stranded in a silence. Both are pure
  functions over `Float32Array` and plain data, so `npm run captions:check`
  exercises them directly.
* **Chunks are cut in real pauses**: the window around each boundary is scanned
  for the longest silence rather than the single quietest 20 ms frame, and when
  a boundary genuinely falls mid-word - unbroken speech, or a music bed under it
  - the next chunk carries 1.5 s of overlap so that word is heard whole by at
  least one request, with the two copies stitched back into one afterwards. The
  chunk clock comes from the demuxer's own timestamps, so a container whose
  audio starts late or drops a packet shifts nothing; the hole becomes a hole of
  silence. The WAV header is stripped before the PCM goes on the wire.
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

### Put an object behind the speaker

The **Objects** panel (key `3`) is the other half of a captioned edit: the
person is cut out of every frame and a picture is placed *behind their head*,
timed to the word that chose it, while the subtitles stay a live layer at the
bottom.

#### One press: **Cutout and place PNG behind**

The button at the top of the panel does the whole thing - transcript to
finished video - and it is worth reading as five decisions rather than as a
macro, because each one is a place where the obvious implementation looks wrong
on screen.

**How many.** One object for every five seconds of video, so the density is a
property of the clip rather than of how talkative the transcript is. A
ninety-second clip asks for eighteen keywords; a five-second one asks for one.

**Which words.** The transcript is ranked locally first, always - the square
root of how often a word is said, times how few lines it appears in, times a
small bias towards longer words. Rooting the count is the whole ordering: taken
linearly, the word said in every line wins every time, and the word said in
every line is what the video is *made of*, not what it is *about*. A talk that
says "market" in eight lines and "mango" in three illustrates the mango. When
`NVIDIA_API_KEY` is set, `/api/captions/keywords` asks a language model the same
question and its picks are merged over the top - it can tell a monastery from a
moment, and arithmetic cannot - but every pick is checked back against the line
it claims to come from, and a word nobody said is dropped. No key, no network,
no model: the local ranking is what ships.

A transcript in Devanagari needs two more things before its words can be
searched for, and without them the panel spends its time apologising. A Nepali
function word wearing a case marker is still a function word - `जसले`, `तेसको`,
`तपाईंलाई` - so the ending is stripped and the root is offered to the stop-word
list, which is what stops "to you" being ranked as the subject of a video. And
Nepali speech is heavily code-switched, so the recogniser writes English words
in Devanagari - `फर्स्ट`, `अप्टिमाइज`, `ल्यापटप` - and no image search on earth
has a picture filed under those. The loanword lexicon in
[`lib/captions/loanwords.ts`](lib/captions/loanwords.ts) knows the English they
stand for, so `अप्टिमाइज` is searched for as *optimize* and `फर्स्ट` is
recognised as *first* and dropped for being a stop word. A genuinely Nepali word
is searched for exactly as it was said.

**When.** A word said four times gets *one* object, at whichever of its
occurrences is furthest from every object already placed, timed to that word's
own timing rather than its line's. Without the spread, the top ten words of a
transcript routinely land inside two sentences - they are the top ten *because*
that passage is dense - and the video gets a slideshow followed by nothing.

**What picture.** `/api/captions/images` is a **ladder**, and it climbs only as
far as it has to. Each rung is asked for candidates; if that rung answers well
enough the search stops there and the rungs below it are never queried, which is
both why an ordinary noun is found in one round trip and why nothing is spent on
a paid API for a word the free ones already answered:

| | rung | where | needs a key |
|---|---|---|---|
| 1 | open and freely licensed | Wikimedia Commons (PNG only), Openverse (PNG, cleared for commercial reuse) | no |
| 2 | the whole web, transparent only | Pixabay `colors=transparent`, Google Programmable Search `imgColorType=trans`, Bing `imageType=Transparent`, SerpAPI `tbs=ic:trans` | yes, any one |
| 3 | photographs | Openverse and Commons with the format filter dropped, Pexels, Unsplash | no |
| 4 | a pictogram | Iconify, recoloured white | no |

Rung 1 answers most ordinary nouns and is the only rung that is always
available. Rung 2 exists because a transcript is about whatever it is about, and
the four providers on it all support "transparent PNG only" *natively* - so this
asks the web for exactly the thing the feature needs rather than fetching
everything and filtering afterwards. Every one of them is optional: no key, no
rung, no error. See `.env.example` for which to set; `PIXABAY_API_KEY` is free
and the best single one to have.

**Watermarks are refused by provenance, not detected in the pixels.** Rungs 1, 3
and 4 never watermark. Rung 2 can reach anything on the web, so the stock
agencies and the "free PNG" farms that stamp their logo onto every download -
Shutterstock, Alamy, Getty, Freepik, PNGItem and two dozen others - are refused
by host, and a title that advertises itself as a preview or a sample is refused
by name. The same refusal is applied again at the download proxy, because a
candidate list is data and nothing stops a caller asking for an address the
search would never have offered. That is an honest guard on where a picture came
from; claiming to spot a watermark in the pixels would not be.

**Then the browser measures what it downloaded**, because whether a file is a
cut-out is a fact about its pixels and no amount of reading a title tells you. A
file that arrived transparent is used as it is. Anything else gets a flood fill
inward from its border - a fill, not a colour key, so the white of a shirt in
the middle of a photo survives while the white behind it does not. The fill
walks a gradient as well as a flat colour, comparing each pixel against the one
it arrived from rather than only against the colour it started at, which is what
takes a lit studio sweep instead of leaving a band halfway up it; and it is
tried at **three escalating strengths, gentlest first**, so a logo on flat white
is cut with almost no tolerance and a bottle on that sweep still gets enough,
without either setting being applied to the picture it would ruin. A fill is
kept only if it found a real background: not too little (it found the corners),
not nearly all of it (it walked through the subject), and not one that leaves
the border still covered on two sides (what is left is a band, not an object).

**And when there is no cut-out anywhere, the word still gets a picture.** In
order: the studio's own art pack gets a turn, because it is at least transparent
and it only ever matches a word it actually holds a picture of. Failing that,
one last sweep asks the route for **photographs alone** - `mode: 'photo'`, which
starts at rung 3 and skips the two below it, since those have already been
proven to have nothing - and the best of what comes back is kept whole, as the
JPEG it is, with its edge ramped to nothing and its corners rounded so it reads
as an inset rather than a screenshot pasted into the frame. Those words are
**named in the panel as photographs**, because they look different on screen and
nobody should have to guess which ones they were. Only a word that fails all
three is left without an object - and it too is named, because a white box
behind someone's head is worse than nothing there.

**How big.** Three head widths across, from the slider at the bottom of the
block. The conversion from that sentence to the renderer's `scale` cancels the
head measurement out of the arithmetic entirely, so the multiple holds across a
cut from a wide shot to a close-up with nothing re-measured per frame - and
because the fetched picture is trimmed to its own content first, three heads
wide means the *object* is three heads wide rather than its bounding box.

Then it bakes, and what comes out is the finished video with the objects burned
in and the audio untouched. The subtitles are still a live layer on top, so they
can be restyled afterwards and burned in from Export whenever you like. Every
picture that came from the web is credited under the panel with its licence, and
the original clip is in the vault the whole time.

The steps under the button are the same pipeline taken apart, for when you want
to choose the pictures yourself:

1. **Plan objects.** The shot list is a pure function of the transcript. The
   keyword matcher in `lib/captions/object-library.ts` reads each cue's own
   words against a catalogue of 65 concrete objects from the studio's CC0
   visual pack - rocket, laptop, trophy, confetti, bar chart - so the thing on
   screen is always traceable to something the speaker actually said. A line
   about nothing gets nothing: an unrelated shape behind someone's head is
   worse than an empty frame. When `NVIDIA_API_KEY` is set,
   `/api/captions/objects` then refines those choices with a language model,
   which is what catches the objects a line only *implies* - "we finally
   shipped it" becomes a package. The model may only choose ids from the
   catalogue it was handed, every pick is re-validated against the transcript,
   and a failed or rate-limited request costs nothing because the local plan is
   already complete.
2. **Or use your own.** Any shot can be swapped for another catalogue object or
   for a PNG you upload; the bytes go into the same IndexedDB vault the clip
   lives in, so an uploaded object survives a refresh.
3. **Or use a 3D model.** `npm run assets:3d` builds 1,200 original CC0 GLB
   models, and the panel will put one on a slow turntable behind the speaker,
   rendered with three.js into a transparent sprite and re-rendered per frame.
   The 3D runtime is loaded only when a plan actually contains a model. The
   pack is generated rather than committed, so on a fresh checkout the panel
   says how to build it instead of failing half way through a bake.
4. **Watch it first.** *Preview the video* renders the first half minute at 480
   pixels and 15 frames a second, through the same per-frame hook, the same
   segmenter and the same compositor the bake uses - the render in miniature,
   not an approximation of it. It answers the question a still cannot: does the
   picture arrive when the word is said, and does it stay behind the head while
   the head moves. It costs a sixteenth of the pixels of a 1080x1920 export, it
   never touches the working clip, and a plan whose objects all start later than
   the window runs on to reach the first of them rather than previewing thirty
   seconds of nothing.
5. **Bake.** The clip is decoded once, the objects are composited in, and the
   video is re-encoded. The audio track is copied packet for packet, so every
   caption timing survives exactly. The original is parked in the vault
   *before* the first frame is encoded, and one press puts it back. *Size of the
   finished video* caps its long side when the full-size bake is more than the
   machine has: halving the long side quarters the pixels in the decoder, the
   canvas, the composite and the encoder at once.

**And a canvas is not permanent.** Every frame of an export is drawn on a 2D
canvas and handed to the encoder as a `VideoFrame` built from it. When the GPU
process drops that canvas's context - which on a long export at full size is a
memory problem, not a bug - every draw into it silently does nothing and the
browser refuses to make a frame out of it at all:
`Failed to construct 'VideoFrame': Invalid source state`, two thirds of the way
through a bake nobody wants to repeat. Three things answer it.
[`lib/tools/video-filter.ts`](lib/tools/video-filter.ts) treats the surface as
replaceable: a frame that cannot be built is drawn again on a new canvas before
the export is allowed to fail, and every decoded frame is closed in a `finally`
so a hook that throws cannot leak the GPU buffers that caused the problem.
[`lib/captions/object-render.ts`](lib/captions/object-render.ts) rasterises an
object's picture when its shot arrives and throws away the ones behind it, so a
plan of two dozen objects holds three of them rather than all twenty-four - only
one is ever on screen. And when even a fresh canvas cannot be painted, the
message says what actually helps: fewer pixels, from the preview or from the
size control, rather than the browser's own sentence about source states.

**A copied track still needs its clock checked.** An ordinary MP4 starts its
AAC track *below* zero - that is how a file carries the encoder's priming
samples, the ones a decoder consumes and never plays - and a muxer refuses a
negative timestamp outright: `Timestamps must be non-negative (got -0.044s)`.
Every export here that copies packets rather than re-encoding them (this bake,
every visual tool, and the audio-only remuxer) puts them through
[`lib/tools/packet-timing.ts`](lib/tools/packet-timing.ts) first. A packet that
is over before zero is dropped, because none of it was ever going to be heard;
a packet that straddles zero starts at zero and loses only the part that could
not play; **everything already at or after zero is passed through untouched**,
which is the property that keeps subtitles, objects and cuts exactly where they
were. `npm run tools:check:maths` proves the policy and then proves the point
end to end: ffmpeg writes a real MP4, copying it unchanged is refused with that
same error, and copying it through the retimer re-muxes with both tracks
starting at zero and the duration intact.

**The composite is one draw, not a shader.** Writing the mix out is what makes
this cheap. Compositing the person over a *plate* that is the frame with an
object painted on it -

    out   = mix(plate, frame, a)              // a = the person's matte
    plate = over(object, frame)               // = o.rgb·o.a + frame·(1-o.a)
    out   = frame·(a + (1-a)(1-o.a)) + o.rgb·o.a·(1-a)

— is *exactly* the frame with the object drawn over it at an effective alpha of
`o.a · (1 - a)`. The frame is never read. So there is no plate to build, no
frame texture to upload, no full-frame shader pass and no read-back: the whole
composite is one ordinary source-over draw of a small object layer whose alpha
has been multiplied by one minus the matte (`destination-out`, natively, in
canvas 2D). Three things follow. The work is proportional to the object rather
than to the frame - **22% of the frame on a typical shot**, and a 4K clip costs
what a 1080p one does plus the blit. There is no GPU path to diverge from, so a
machine without WebGL renders the same picture as everything else. And a
segmentation error anywhere the object is not cannot show up at all, because
those pixels are never touched.

Two passes are added on top, and both are about reading as *behind* rather than
pasted: the speaker casts a soft **contact shadow** onto the object (the matte
again, blurred and offset - the cheapest cue that separates two planes), and
the object **spills light** around the silhouette, confined to the band where
the matte is neither fully in nor fully out.

**The model runs as rarely as it can.** Segmentation is the expensive part of a
bake, so it is skipped entirely outside a shot, and *inside* one it only runs
when the picture has actually changed: the frame the model would be given is
compared with the last one it saw - an absolute difference over a subsampled
copy of a 256-wide image - and the previous mask is reused while the shot is
still. A hard ceiling on consecutive reuses means a slow drift can never
accumulate. On a talking head this **skips the model on around three quarters
of the frames that carry an object**, and it cannot change a frame the model
would have agreed with.

**Finding the head, and keeping it steady.** The crown is the first row whose
*run* of subject pixels crosses a fraction of the frame width - one stray pixel
of hair or a mis-segmented lamp sits above almost every real head - and the
horizontal centre is averaged over the top sixth of the subject's height, so it
tracks a turning head without chasing a curl. That point is then filtered, and
not with a blend: a blend has one setting and two jobs, and damping it enough
to kill a still speaker's wobble makes it visibly trail a real head turn. A
[one-euro filter](https://gery.casiez.net/1euro/) moves its own cutoff with the
measured speed instead. `npm run objects:check` tunes a plain blend until it
suppresses *exactly* as much jitter and then measures both through a head turn:
the filter lags less than half as far. That comparison is the reason the filter
is there, so it is a test rather than a claim.

**Placement knows what else is on screen.** Objects are sized against the
speaker's head by default rather than against the frame, so a cut between a
wide shot and a close-up does not change how big the object looks next to the
person it belongs to - with the head measurement clamped, because one frame
where the mask finds a doorway would otherwise throw a two-metre rocket across
the picture. And the object is kept out of the band the captions own, measured
from the caption style itself (its distance from the edge, plus the height its
lines occupy), so restyling the subtitles moves the boundary with them. An
object that cannot fit hangs off the open edge rather than covering the text.

**Which objects, when.** Choices are scored by the matcher's confidence times
how distinctive the word is *in this transcript* - inverse document frequency
over the cues, because the corpus that matters is this video. A clip that says
"rocket" in half its lines gets a rocket once, not eight times; the line that
mentions money once is the one worth a picture. A minimum quiet between objects
then stops a dense passage becoming a slideshow, and when two objects want the
same moment the better-scoring one takes it rather than queueing behind a weak
first match.

Everything drawn is a pure function of the clip's own clock - the entrance and
exit ease, the float, the spin, the turntable's angle - so a re-bake reproduces
the same frames, and the still preview at 3.2s is exactly the video at 3.2s.
The preview button runs the identical per-frame hook the bake runs; there is no
second compositing path that could disagree with the first. When a bake
finishes the panel reports what it actually did - how many frames carried an
object, how many of them skipped the model, how much of each frame was
repainted, and how long it took - because a claim about speed that nobody
measures is a claim about nothing.

`npm run objects:check` verifies the lot: the catalogue resolves to real files,
the matcher picks the thing a sentence is about, the planner never overlaps,
strobes or slideshows, the head anchor survives a speck above the head and an
empty frame, the filter beats the blend it replaced, the repaint rectangle
stays a fraction of the picture, and then a real browser records a clip,
imports subtitles, plans the objects, renders a still, bakes the video, reads
the optimisations back out of the panel's own report, and puts the original
back. That includes the one-press flow's own
arithmetic: one object per five seconds, the word a video is about outranking
the word it repeats, objects spread rather than clumped, a flood fill that
takes a flat background but refuses a busy photograph, white *inside* a subject
surviving the fill, and a picture that measures three head widths across at any
head size, sprite aspect or frame orientation. The picture proxy is checked
against the addresses an attacker would try - loopback, the cloud metadata
endpoint, private space, IPv6 loopback, `file://`, embedded credentials -
because it fetches whatever address it is handed, through the same vetted path
as the video importer.

The draft preview is checked the same way the still is, because a preview that
renders the clip untouched would look exactly like one that works: it is played
through in the browser and the object has to be found in it, in a colour that
was never in the footage - and the clip underneath has to be the one that was
there before. Its arithmetic is checked offline: a capped frame keeps its shape,
lands on even numbers whatever it started at, and a preview that keeps half the
frames still hands back a video the full length of the clip rather than one
running at double speed.

`npm run objects:check:maths` is the offline half on its own - 189 checks, no
network, no browser. `npm run objects:check` adds the browser and takes it to
**231**. `node scripts/check-caption-objects.cjs --web` adds one deliberate run
of the one-press button through a real browser against the real web, taking the
suite to **242**: the button is pressed, a picture is fetched and cut out, the
video is baked, and the finished frame is measured on the stage. It is off by
default because a check that fails when Wikimedia is slow is a check people
learn to ignore.

## The Tools Studio

`/tools` is a full editing bench that runs entirely in the tab. Nothing is
uploaded: the clip is decoded with [mediabunny](https://mediabunny.dev), every
frame goes through a WebGL2 shader or a 2D canvas pass, and the result is
encoded straight back out through WebCodecs. A tool is a `ToolDef` in
[`lib/tools/registry.ts`](lib/tools/registry.ts) — a category, a pitch and a
list of parameters — and one generic panel renders whichever fields it
declares, so the catalogue is data and the engines are shared.

### What is in it

| Group | Tools |
| --- | --- |
| **Colour** | Adjust (exposure, white balance, highlights/shadows/whites/blacks, gamma, fade, vibrance, clarity), White Balance, HSL Colour, 79 graded looks, **import any `.cube` LUT**, auto colour, grayscale, sepia, invert, blur, sharpen, vignette |
| **Effects** | 40 effects — glitch, VHS, old film, CRT, TV static, pixelate, mosaic, halftone, crosshatch, sketch, edge, neon, emboss, posterize, threshold, comic, oil paint, duotone, thermal, night vision, hologram, kaleidoscope, mirrors, twirl, ripple, wave, fisheye, bulge, shake, zoom/spin/directional blur, bloom, soft focus, bokeh, star filter, light leak — plus shape masks in eleven shapes |
| **Motion** | 18 camera moves: Ken Burns in and out, pans, tilts, whip pan, diagonal push, spin-in, slow rotate, bounce, pulse, shake, handheld, sway, drift |
| **Compose** | 17 transitions between two clips, split screen in seven layouts, 17 blend modes, picture-in-picture, canvas reframe with a blurred blow-up, chroma-key overlay, merge |
| **AI** | Background replace, auto reframe that follows the subject, retouch (skin smoothing, tone evening, eyes and teeth) |
| **Text** | Animated titles: eight styles, nine animations, timed in and out, measured wrapping |
| **Timing** | Cut silence, trim, split, speed, slow motion, time-lapse, loop, freeze frame, speed ramp, scene split, **reverse** |
| **Transform** | Rotate, flip, crop, aspect crop, resize, frame rate, letterbox, borders and frames |
| **Restoration** | Enhance and denoise (edge-preserving denoise, deblocking, masked sharpening), remove an object, stabilise, auto-crop bars, declick, spectral denoise |
| **Audio** | Reverb, echo, five-band EQ, nine voice characters, beat detection, gain, normalise, LUFS, fades, ducking, compressor, limiter, de-esser, noise gate, pitch shift, stereo tools |
| **Export** | Format convert, compress, GIF, thumbnail, metadata, batch export to a zip |

Every visual tool that cannot be judged from its sliders offers a **single-frame
preview** that goes through the identical engine the export does, so what you
see is what renders.

### How it fits together

```
registry.ts   the catalogue: what each card is and what it asks for
runners.ts    the only place that turns a tool's params into an engine call
frame-ops.ts  one draw pipeline: crop -> rotate -> scale -> filter -> passes
video-filter.ts  decode -> frame-ops -> encode, with a per-frame hook
```

`frame-ops.ts` has four seams, and every visual engine hangs off one of them:
an **underlay** that paints the backdrop before the picture lands on it, a
**transform** applied while the frame is still at native resolution (so a
push-in reads real detail), an ordered list of **passes** over the finished
frame, and an **overlay** on top. Engines that own a resource — a compiled
shader, a decoded second clip, a segmentation model — hand back a `dispose`
that the runner releases in a `finally`, whether the render finished, failed or
was cancelled.

Everything falls back. Each shader has a CPU path that implements the same
maths, and the result card says when one was used rather than pretending
otherwise.

### Checking it

```bash
npm run toolkit:check          # maths, then a real Chrome driving the real page
npm run toolkit:check:maths    # offline only: no browser, no network
npm run tools:check            # the AI background, colour looks and chroma key
```

The offline half settles everything arithmetic can settle: that a neutral
adjustment is the identity, that +1 EV is a doubling of *linear* light, that no
camera move can slide its own edge into frame, that a `.cube` parses
red-fastest, that the split-screen cells tile the frame exactly, that an echo
lands on the sample it was asked for and a 120 bpm click track reads as 120 bpm.

The browser half imports a clip, opens ten tools, sets their controls the way a
person would, runs them, and re-opens each finished file to measure its pixels:
desaturating has to come back grey, night vision has to come back green, a
magenta title has to put magenta on the frame, a 9:16 reframe has to come back
1080x1920, and a side-by-side montage has to have the first clip on the left and
the second on the right.

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
| `GROQ_API_KEY` | unset | Server-only `gsk_…` key from <https://console.groq.com> (free tier). The **primary** recogniser for Subtitle Studio automatic captions: `whisper-large-v3`, word-level timestamps, 99 languages. |
| `NVIDIA_API_KEY` | unset | Server-only `nvapi-…` key for Chat → Remotion generation, for the transcript polish pass, and as the **fallback** recogniser when Groq is unset or fails. |
| `NVIDIA_ASR_GRPC` | `grpc.nvcf.nvidia.com:443` | Riva ASR target. Point it at a self-hosted NIM (`localhost:50051`) to keep audio on your own hardware. |
| `NVIDIA_ASR_GRPC_INSECURE` | unset | `1` for a plaintext Riva server, `0` to force TLS. Unset means TLS everywhere except loopback. |
| `NVIDIA_ASR_DISABLE_GRPC` | unset | `1` skips gRPC and uses the HTTP transports only. |
| `NVIDIA_ASR_ENDPOINT` | unset | Full URL of an HTTP `/v1/audio/transcriptions` endpoint, e.g. a self-hosted NIM. |
| `NVIDIA_ASR_FUNCTION_ID` | unset | Pin one NVCF function id instead of the one belonging to the selected model. |
| `NVIDIA_ASR_MODEL` | unset | Pin one speech model instead of choosing by spoken language. |
| `NVIDIA_ASR_PHRASES` | unset | Comma-separated names, products or places the recogniser should expect. Riva boosts them against similar-sounding words - the one lever that fixes a proper noun written differently from the way it was spoken. |
| `NVIDIA_ASR_PHRASE_BOOST` | `6` | How hard to push those phrases. NVIDIA recommends 0 - 20; higher recall costs false positives. |
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
| Typography | 102 self-hosted families across sans, grotesk, rounded, condensed, display, comic, serif, tech, retro, pixel, mono, script and handwriting, including 51 Devanagari faces for Nepali and Hindi - text (Noto Sans/Serif Devanagari, Mukta, Ek Mukta, Hind, Khula, Karma, Sarala, Palanquin, Biryani, Cambay, IBM Plex Sans Devanagari, Yantramanav, Arya, Gotu, Jaldi), serif (Martel, Sahitya, Kadwa, Glegoo, Halant, Sumana, Asar, Kurale, Rhodium Libre, Vesper Libre, Inknut Antiqua), condensed (Khand, Teko, Rajdhani, Anek Devanagari, Pragati Narrow, Laila), display (Rozha One, Modak, Yatra One, Ranga, Jaini, Jaini Purva, Tillana, Eczar, Sarpanch, Baloo 2), calligraphic (Tiro Devanagari Hindi/Marathi/Sanskrit, Amita) and hands (Kalam, Dekko) | OFL-1.1 and Apache-2.0 |
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
npm run fonts:check      # offline: every Devanagari face really draws Nepali, read from its own cmap
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
  captions/             source, design, objects, sound and export panels, cue track, player
  captions/controls.tsx the sliders, switches and segmented controls both panels use
lib/
  compiler.ts           sucrase + a tiny CommonJS module graph, runs in the tab
  source-audit.ts       static warnings about what a browser export cannot do
  module-registry.ts    the modules an upload may import
  browser-render.ts     high-fidelity visual path + audio-aware Remotion web renderer
  lazy-chunk.ts         retried, prefetched dynamic imports for the heavy chunks
  device.ts             what this device can encode; the render-time screen wake lock
  use-render-controller.ts  the render pipeline both studios drive
  server-render-client.ts  SSE client for /api/render
  presets.ts            bitrate maths, crf table, H.264 level picker, formats
  project.ts            zip/file ingestion, entry detection
  captions/
    transcribe.ts       on-device Whisper: model download, resample, word timings
    cues.ts             grouping, retiming, editing, .srt/.vtt in and out
    composition-source.ts  writes the captioned-video .tsx the studio compiles
    object-library.ts   the 65 flat objects a spoken word can choose, and the matcher
    object-models.ts    the generated GLB pack's catalogue and its spoken vocabulary
    object-plan.ts      one choice per cue -> a shot list with a floor and a ceiling
    object-director.ts  the keyword plan, then the language model's refinement of it
    object-auto.ts      the one press: how many objects, which words, when, how big
    image-search.ts     the ladder of picture sources, and what counts as a watermark
    object-fetch.ts     searching the web for a word, downloading it, keeping the good one
    object-cutout.ts    is this a cut-out? if not, can its background be taken away?
                        and if it cannot, is a softened photograph better than nothing?
    object-anchor.ts    the top of the speaker's head, one-euro filtered, placed
    object-compositor.ts one small draw: the frame is never read, only the object
    object-sprite.ts    rasterising an object at the size it is drawn, and drawing it
    object-3d.ts        one GLB on a turntable, rendered to a transparent sprite
    object-render.ts    the per-frame hook, the still and draft previews, the bake
    sfx.ts              the sound-effect catalogue and the per-sentence scheduler
    video-source.ts     duration, display size, fps and audio-track probing
    style-presets.ts    the six caption looks and the studio font kit
  tools/
    registry.ts         the catalogue: every tool, its category and its params
    runners.ts          the one switch from a tool's params to an engine call
    frame-ops.ts        the shared draw pipeline and its four pass seams
    video-filter.ts     decode -> frame-ops -> encode, with a per-frame hook
    packet-timing.ts    where a copied packet goes when its clock starts below zero
    frame-reader.ts     forward-only frame access, for the multi-clip tools
    adjust.ts           exposure, white balance, tonal regions, HSL, clarity
    color-tone.ts       79 graded looks, baked into lookup cubes
    lut.ts              .cube import, 3D and 1D, domain-aware
    effects.ts          40 effects behind one shader and one CPU fallback
    motion.ts           18 camera moves, each covered so no edge enters frame
    mask.ts             shape masks with feathering and five treatments
    blend.ts            17 blend modes for a second clip or a still
    transitions.ts      17 transitions, two clips overlapped and encoded
    split-screen.ts     two to four clips in seven layouts
    canvas-bg.ts        reframe onto a new aspect over a blurred blow-up
    border.ts           frames and borders that inset rather than cover
    text-fx.ts          animated titles: measured wrapping, timed in and out
    retouch.ts          bilateral skin smoothing, masked in chroma
    enhance.ts          denoise, deblock on the codec's grid, masked sharpen
    inpaint.ts          object removal by diffusion from the region's edges
    track.ts            auto reframe: subject tracking with a dead band
    reverse.ts          backwards playback, decoded in memory-bounded spans
    audio-fx.ts         reverb, echo, five-band EQ, voice presets, beat detect
    audio-ops.ts        gain, gates, dynamics, loudness, pitch, stereo
    segmentation.ts     the person model: loading, polarity, temporal smoothing
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
  check-editor-toolkit.cjs  the toolkit suite: maths offline, then a real Chrome
  check-tools-effects.cjs   the AI background, colour looks and chroma key
  check-caption-objects.cjs the object layer: catalogue, matcher, planner, anchor,
                            then a real Chrome that plans, previews and bakes
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
* **A downloaded caption `.tsx` renders silently elsewhere** - its `SOUNDTRACK`
  points at `assets/audio/...` inside this app's `public/` folder. Copy that
  folder next to the file, or swap the paths for your own.
* **"Loading chunk N failed (timeout)" when a render starts** - the encoder is a
  multi-megabyte chunk fetched once per visit, and a weak mobile connection can
  exceed the fetch timeout. The studio now raises that timeout to ten minutes,
  starts the download while you are still editing, retries a failed fetch with
  backoff and waits for the connection to come back before each retry. If it
  still fails, the network dropped for good - stay on the tab and press Render
  again.

### Rendering on a phone

Browser rendering happens inside one tab, with that tab's memory. The studio
measures the device on load and lowers its own ceilings to match, because a
phone that runs out of room does not report an error - the tab is killed and the
render simply stops.

* Compositions are planned at up to 1080p or 1440p on a phone rather than 4K,
  from the form factor and `navigator.deviceMemory`.
* 1x is the proposed resolution; 2x is still selectable, and marked, because
  2x on a 1080p clip is a 4K encode in a browser tab.
* The encoder queue is held to three frames instead of eight, which trades a
  little throughput for a much smaller memory peak.
* A **screen wake lock** is taken for the duration of the render and re-taken
  when you come back to the tab: a phone that locks its screen suspends the tab,
  which stalls the encoder and then kills the render.
* Out-of-memory and codec failures are reported with the setting that fixes
  them rather than the internal message.

## License

MIT for this app. Generated visual, texture and audio assets are CC0-1.0. The
bundled font families are SIL Open Font License 1.1 - keep each `OFL.txt` with
its font files when you redistribute them. Remotion and your
hosting provider have their own usage/license terms; review them before a public
commercial launch: <https://remotion.dev/license> and <https://vercel.com/pricing>.
