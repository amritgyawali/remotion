# 3D Asset System

Complete system for managing, loading, and rendering 3D models in Remotion videos. All assets are self-contained GLB 2.0 files with deterministic, frame-driven animation.

## Overview

### Directory Structure

```
lib/3d-assets/
├── catalog.ts          # Asset registry and metadata
├── use-asset.ts        # React hook for loading models
├── object-turntable.tsx # Reusable turntable component
├── index.ts            # Exports
└── README.md
public/assets/3d/
├── v1/
│   ├── characters/     # Character models
│   ├── objects/        # Product and physical objects
│   ├── abstract/       # Geometric and math forms
│   ├── environment/    # Terrain and architecture
│   └── icons/          # Small 3D icons
```

## Asset Specifications

### GLB Format Requirements

All assets must be **GLB 2.0** files with:

- ✅ Embedded geometry, materials, normals
- ✅ No external `.bin`, `.png`, `.jpg`, or texture files
- ✅ < 5 MB file size (optimized)
- ✅ Single scene (no animation sequences)
- ✅ Sensible defaults (no exotic shaders or extensions)

### Optimizations

For best performance:

1. **Compression**: Use Draco compression (built into GLB, auto-decoded)
2. **Decimation**: Reduce polygon count to ~50k max
3. **Materials**: Bake ambient occlusion if possible, use standard `MeshStandardMaterial` equivalents
4. **Normals**: Auto-computed; use tangent-space if needed for normal maps
5. **Testing**: Verify in Babylon Sandbox or Three.js editor before committing

### Tools

- **Blender → GLB**: Export with `glTF 2.0 (.glb/.gltf)`, enable:
  - ✅ Format: Binary (.glb)
  - ✅ Draco Compression (if available)
  - ✅ Include Normals
  - ✅ Include Tangents
  - ❌ Separate .bin files
  - ❌ Separate texture files

- **Online**: Sketchfab, TurboSquid, Poly Haven all offer GLB downloads

## Importing Assets

### Step 1: Prepare the Model

Save as `.glb` file (GLB 2.0 binary format, self-contained).

### Step 2: Organize

Place in correct category subdirectory:

```
public/assets/3d/v1/[category]/[asset-name]/[asset-name].glb
```

Examples:
- `public/assets/3d/v1/characters/hero-bot/hero-bot-001.glb`
- `public/assets/3d/v1/objects/electronics/smart-speaker.glb`
- `public/assets/3d/v1/abstract/geometric/orbital-torus.glb`

### Step 3: Register in Catalog

Edit `lib/3d-assets/catalog.ts` and add to the appropriate category array:

```typescript
export const OBJECT_ASSETS: Asset3d[] = [
  {
    id: 'smart-speaker',
    name: 'Smart Speaker',
    category: 'object',
    path: 'assets/3d/v1/objects/electronics/smart-speaker.glb',
    scale: 1,
    animationDuration: null,
    aspectRatios: ['16:9', '1:1'],
    dimensionModes: ['three'],
    sceneTypes: ['object3d'],
    tags: ['product', 'speaker', 'electronics', 'tech'],
    description: 'Cylindrical smart speaker with metallic finish. Product showcase turntable.',
    license: 'proprietary',
  },
  // ... more assets
]
```

**Field Reference:**

- `id` — Unique kebab-case identifier
- `name` — Display name
- `category` — One of: `character`, `object`, `environment`, `abstract`, `icon`
- `path` — Relative to `public/` directory
- `scale` — Suggested scale factor (1 = auto-computed from bounds)
- `animationDuration` — Frames for animation loop, or `null` for static
- `aspectRatios` — Which video formats suit this asset
- `dimensionModes` — Three.js rendering compatible with `'three'`
- `sceneTypes` — Remotion scene types that can use this (e.g., `'object3d'`, `'carousel3d'`)
- `tags` — Search/filter keywords
- `description` — For AI model selection
- `license` — Licensing metadata

## Using Assets

### In Components

#### Simple Turntable

```typescript
import { Object3dTurntable } from '@/lib/3d-assets'

export const MyVideo: React.FC = () => (
  <Object3dTurntable
    assetId="hero-bot-001"
    backgroundColor="#080817"
    rotationSpeed={0.009}
    cameraDistance={7.15}
  />
)
```

#### With Satellites

```typescript
import { Object3dTurntableWithSatellites } from '@/lib/3d-assets'

export const MyVideo: React.FC = () => (
  <Object3dTurntableWithSatellites
    assetId="crystal-gem"
    satelliteCount={6}
    satelliteColor="#ff6ec7"
  />
)
```

#### Custom Hook

```typescript
import { useAsset3d } from '@/lib/3d-assets'

const MyComponent: React.FC = () => {
  const model = useAsset3d('hero-bot-001')

  if (!model) return null

  return (
    <ThreeCanvas>
      <group scale={model.scale} position={model.offset}>
        <primitive object={model.object} />
      </group>
    </ThreeCanvas>
  )
}
```

### Querying Assets

```typescript
import {
  assetById,
  assetsByCategory,
  assetsByTag,
  assetsForScene,
  assetsForAspect,
} from '@/lib/3d-assets'

// By ID
const asset = assetById('hero-bot-001')

// All characters
const characters = assetsByCategory('character')

// Assets tagged "tech"
const techAssets = assetsByTag('tech')

// Assets suitable for 'object3d' scenes
const objectAssets = assetsForScene('object3d')

// Assets that fit 16:9 format
const wideAssets = assetsForAspect('16:9')
```

## In AI Generation

The AI composer (`lib/ai/compose.ts`) can reference assets by ID:

```typescript
// In storyboard
{
  type: 'object3d',
  assetId: 'hero-bot-001',
  headline: 'Meet Hero',
  caption: 'Intelligent companion',
}

// Composer generates:
<Object3dScene
  assetId="hero-bot-001"
  headline="Meet Hero"
  caption="Intelligent companion"
/>
```

## Advanced: Loading Custom URLs

For one-off assets not in the catalog:

```typescript
const model = useAsset3d('https://example.com/model.glb')
const model = useAsset3d('/path/to/custom.glb')
```

## Performance

### Caching

Each unique asset URL is loaded once and cached globally. Subsequent uses reuse the parsed scene:

```typescript
// Both compositions share one network request + parse
<Comp1 assetId="hero-bot-001" />
<Comp2 assetId="hero-bot-001" />
```

### Memory

Models are cloned per use to prevent cross-contamination. Use `clearAssetCache()` in development to free memory:

```typescript
import { clearAssetCache } from '@/lib/3d-assets'

// Dev tools
clearAssetCache()
```

### Profiling

```typescript
import { getAssetCacheStats } from '@/lib/3d-assets'

const stats = getAssetCacheStats()
console.log(stats) // { loaded: 3, pending: 1, failed: 0 }
```

## Licensing

When importing assets, respect licensing:

- **proprietary** — Custom, internal only
- **cc0** — Public domain, no attribution required
- **cc-by** — Requires attribution in video credits
- **cc-by-sa** — Attribution + same license for derivatives

Store license metadata in asset entry; use in video credits if needed.

## Troubleshooting

### Asset Loads But Doesn't Render

- Check asset bounds (may be at origin, not centered)
- Verify `scale` in catalog (may need adjustment)
- Ensure `delayRender`/`continueRender` pattern is intact

### Wrong File Format

- Confirm file is GLB 2.0 (binary), not glTF (text)
- Verify no external `.bin` or texture files required
- Test in Three.js editor or Babylon Sandbox first

### Path Not Found

- Check path in catalog matches `public/assets/3d/` structure
- Verify `staticFile()` resolution (Remotion-specific)
- No leading `/public/` — paths are relative to `public/`

### Export Fails

- Confirm `preserveDrawingBuffer: true` in `ThreeCanvas`
- Use only `useCurrentFrame()` for animation (never `useFrame()`)
- Verify no async code inside render (use hooks outside Three)

## Examples

### Simple Product Turntable

```typescript
import { Object3dTurntable } from '@/lib/3d-assets'
import { Composition, registerRoot } from 'remotion'

const MyComposition: React.FC = () => (
  <Object3dTurntable assetId="smart-speaker" />
)

export const Root = () => (
  <Composition
    id="smart-speaker-demo"
    component={MyComposition}
    durationInFrames={360}
    fps={30}
    width={1920}
    height={1080}
  />
)

registerRoot(Root)
```

### Multi-Asset Gallery

```typescript
import { assetsByCategory } from '@/lib/3d-assets'

const Gallery: React.FC = () => {
  const objects = assetsByCategory('object')
  return (
    <div>
      {objects.map((asset) => (
        <div key={asset.id}>
          <h3>{asset.name}</h3>
          <p>{asset.description}</p>
        </div>
      ))}
    </div>
  )
}
```

---

**Next Steps:**

1. Add 10–20 curated models across categories
2. Hook into AI generation for smart asset selection
3. Build asset browser UI in Studio
4. Create variant system (pose/animation picks per asset)
