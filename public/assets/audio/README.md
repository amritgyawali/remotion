# Original Audio Pack

This folder contains a compact, reusable sound library for Remotion Video Studio:
three loopable music beds and ten UI, transition, impact, and reveal effects.
Every WAV is synthesized locally by `scripts/generate-audio-assets.mjs`; the pack
contains no downloaded recordings, samples, presets, or third-party music.

## Format and paths

- 48,000 Hz, 16-bit, stereo PCM WAV
- Versioned files live under `public/assets/audio/v1/`
- The machine-readable inventory is `public/assets/audio/catalog.json`
- In a Remotion composition, omit the `public/` prefix:

```tsx
import {Audio} from '@remotion/media';
import {Sequence} from 'remotion';

const audio = (file: string) => `/assets/audio/v1/${file}`;

export const Soundtrack = () => (
  <>
    <Audio
      src={audio('music/neon-pulse-120bpm-loop.wav')}
      loop
      volume={0.18}
    />
    <Sequence from={45}>
      <Audio
        src={audio('sfx/transitions/whoosh-fast.wav')}
        volume={0.4}
      />
    </Sequence>
  </>
);
```

The catalog's `recommendedVolume` values leave useful mix headroom. Lower music
to roughly `0.10-0.18` under narration, and avoid stacking several impacts at
full volume.

## Inventory

| ID | File | Duration | Intended use |
| --- | --- | ---: | --- |
| `neon-pulse` | `music/neon-pulse-120bpm-loop.wav` | 8.0 s | Neon, technology, product motion |
| `warm-inspiration` | `music/warm-inspiration-96bpm-loop.wav` | 10.0 s | Friendly explainers and education |
| `cinematic-orbit` | `music/cinematic-orbit-80bpm-loop.wav` | 12.0 s | Space, premium, dramatic builds |
| `ui-click-soft` | `sfx/ui/click-soft.wav` | 0.1 s | Buttons and small state changes |
| `ui-pop-clean` | `sfx/ui/pop-clean.wav` | 0.2 s | Icons, badges, and callouts |
| `ui-notification-bright` | `sfx/ui/notification-bright.wav` | 0.5 s | Positive notifications |
| `whoosh-fast` | `sfx/transitions/whoosh-fast.wav` | 0.4 s | Arrows and quick transitions |
| `whoosh-deep` | `sfx/transitions/whoosh-deep.wav` | 0.9 s | Large cinematic transitions |
| `riser-digital` | `sfx/transitions/riser-digital.wav` | 1.5 s | Build into a reveal or payoff |
| `impact-clean` | `sfx/impacts/impact-clean.wav` | 0.4 s | Crisp text or product reveals |
| `impact-deep` | `sfx/impacts/impact-deep.wav` | 0.8 s | Major beats and payoffs |
| `reveal-shimmer` | `sfx/accents/reveal-shimmer.wav` | 1.0 s | Premium reveals and sparkles |
| `logo-stinger` | `sfx/accents/logo-stinger.wav` | 1.2 s | Logo and closing moments |

All durations are exact multiples of one frame at 30 fps. Music loops are four
bars long, and their boundaries are faded to silence over six milliseconds to
avoid clicks.

## Regenerate and verify

```bash
node scripts/generate-audio-assets.mjs
node scripts/generate-audio-assets.mjs --verify-only
```

The verifier checks the RIFF/PCM header, duration, peak level, RMS level, DC
offset, loop seam, and SHA-256 checksum recorded in the catalog.

## Renderer note

The Player, free browser renderer, local Remotion renderer, and enabled server
renderer can all play and export these audio layers. Sound-enabled browser
projects must import `<Audio>` from `@remotion/media`; the studio automatically
routes them through Remotion's audio-aware web renderer and muxes AAC into MP4
or Opus into WebM.

## License

The generated WAV files are released under CC0-1.0. See
`public/assets/audio/LICENSE-AUDIO.md`.
