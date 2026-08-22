# Original Procedural Audio Pack

This folder contains a deterministic, reusable audio library for Remotion Video
Studio: 8 loopable music beds and 560 sound effects. The SFX inventory preserves
all 20 original paths and adds 540 audibly parameterized variants across UI,
motion, transitions, impacts, accents, and foley.

Every WAV is synthesized locally by `scripts/generate-audio-assets.mjs`. The
pack contains no downloaded recordings, samples, presets, or third-party music.

## Format and paths

- 48,000 Hz, signed 16-bit, stereo PCM WAV
- Versioned raw files: `public/assets/audio/v1/`
- Machine-readable inventory: `public/assets/audio/catalog.json`
- SFX size budget: no more than 45 MiB; the generated v2 pack is about 35.17 MiB
- Remotion paths omit the `public/` prefix

```tsx
import {Audio} from '@remotion/media';
import {Sequence, staticFile} from 'remotion';

export const Soundtrack = () => (
  <Sequence from={45}>
    <Audio
      src={staticFile('assets/audio/v1/sfx/variants/motion/motion-whoosh/motion-whoosh-v014.wav')}
      volume={0.38}
    />
  </Sequence>
);
```

The catalog's `recommendedVolume` values leave mix headroom. Lower music to
roughly `0.10-0.18` under narration, and avoid stacking several impacts at full
volume.

## Deterministic variant paths

Each procedural family has exactly 36 variants. `NNN` is a zero-padded 1-based
index from `001` through `036`:

```text
v1/sfx/variants/{category}/{family}/{family}-v{NNN}.wav
assets/audio/v1/sfx/variants/{category}/{family}/{family}-v{NNN}.wav
```

The first form is relative to this audio folder; the second is ready for
Remotion's `staticFile()`.

| Family | Category | Variant files |
| --- | --- | --- |
| `ui-click` | `ui` | `ui/ui-click/ui-click-v001.wav` ... `v036.wav` |
| `ui-pop` | `ui` | `ui/ui-pop/ui-pop-v001.wav` ... `v036.wav` |
| `ui-notification` | `ui` | `ui/ui-notification/ui-notification-v001.wav` ... `v036.wav` |
| `ui-key` | `ui` | `ui/ui-key/ui-key-v001.wav` ... `v036.wav` |
| `motion-whoosh` | `motion` | `motion/motion-whoosh/motion-whoosh-v001.wav` ... `v036.wav` |
| `motion-swipe` | `motion` | `motion/motion-swipe/motion-swipe-v001.wav` ... `v036.wav` |
| `transition-glitch` | `transitions` | `transitions/transition-glitch/transition-glitch-v001.wav` ... `v036.wav` |
| `transition-riser` | `transitions` | `transitions/transition-riser/transition-riser-v001.wav` ... `v036.wav` |
| `transition-drop` | `transitions` | `transitions/transition-drop/transition-drop-v001.wav` ... `v036.wav` |
| `impact-hit` | `impacts` | `impacts/impact-hit/impact-hit-v001.wav` ... `v036.wav` |
| `impact-boom` | `impacts` | `impacts/impact-boom/impact-boom-v001.wav` ... `v036.wav` |
| `accent-chime` | `accents` | `accents/accent-chime/accent-chime-v001.wav` ... `v036.wav` |
| `accent-shimmer` | `accents` | `accents/accent-shimmer/accent-shimmer-v001.wav` ... `v036.wav` |
| `accent-power` | `accents` | `accents/accent-power/accent-power-v001.wav` ... `v036.wav` |
| `foley-touch` | `foley` | `foley/foley-touch/foley-touch-v001.wav` ... `v036.wav` |

Use FNV-1a over the creative seed and legacy ID to choose a stable variant
without loading the full asset array:

```ts
const fnv1a32 = (text: string) => {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
};

const variantNumber = (creativeSeed: string, legacyId: string) =>
  (fnv1a32(`${creativeSeed}:${legacyId}`) % 36) + 1;
```

Replace `{NNN}` in the selected family's `staticFilePathPattern` with
`String(variantNumber).padStart(3, '0')`. The catalog's top-level
`legacyVariantMap` contains the exact family and pattern for every legacy ID.

## Legacy-to-family mapping

All original files remain unchanged at their existing paths. They map to
variant families as follows:

| Legacy ID | Family | Category |
| --- | --- | --- |
| `ui-click-soft` | `ui-click` | `ui` |
| `ui-pop-clean` | `ui-pop` | `ui` |
| `ui-notification-bright` | `ui-notification` | `ui` |
| `whoosh-fast` | `motion-whoosh` | `motion` |
| `whoosh-deep` | `motion-whoosh` | `motion` |
| `riser-digital` | `transition-riser` | `transitions` |
| `impact-clean` | `impact-hit` | `impacts` |
| `impact-deep` | `impact-boom` | `impacts` |
| `reveal-shimmer` | `accent-shimmer` | `accents` |
| `logo-stinger` | `accent-chime` | `accents` |
| `ui-typewriter` | `ui-key` | `ui` |
| `ui-tick` | `ui-key` | `ui` |
| `ui-swipe` | `motion-swipe` | `motion` |
| `transition-glitch` | `transition-glitch` | `transitions` |
| `transition-sub-drop` | `transition-drop` | `transitions` |
| `transition-riser-organic` | `transition-riser` | `transitions` |
| `impact-snap` | `impact-hit` | `impacts` |
| `impact-boom-tail` | `impact-boom` | `impacts` |
| `accent-chime-sparkle` | `accent-chime` | `accents` |
| `accent-power-up` | `accent-power` | `accents` |

## Catalog contract

The v2 catalog exposes compact top-level `families` summaries with `id`,
`category`, `pathPattern`, `staticFilePathPattern`, `variantCount`, `motion`,
`timbre`, and `recommendedVolume`. `legacyVariantMap` lets a generator resolve a
legacy cue directly to one of those patterns.

Every SFX asset includes `family`, `variant`, `motion`, `timbre`, searchable
`tags`, and its actual `synthesisParameters`. Every asset also stores
`contentFingerprintSha256` and `perceptualFingerprintSha256`, both calculated
from the mastered floating-point signal before PCM dither. IDs, paths, both
fingerprint types, checksums, metadata, and file bytes are validated for
uniqueness and reproducibility.

## Regenerate and verify

```bash
node scripts/generate-audio-assets.mjs
node scripts/generate-audio-assets.mjs --verify-only
```

Generation removes stale generated WAV files beneath `audio/v1`, enforces the
SFX size ceiling, and rewrites the catalog. Verification re-synthesizes every
asset, compares pre-dither fingerprints and byte-for-byte PCM output, checks
RIFF headers and audio metrics, validates the family/mapping contract, and
rejects missing or stale WAV files.

## License

The generated WAV files and catalog are released under CC0-1.0. See
`public/assets/audio/LICENSE-AUDIO.md`.
