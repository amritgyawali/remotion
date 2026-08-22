# 3D Asset Library — Quick Start

## 1 Minute Setup

**Goal**: Add 5 production-ready 3D assets and use them in a video.

### A. Get Assets (Free, CC0)

Best sources for self-contained GLB files:

1. **Poly Haven** (poly.haven.com)
   - Free 3D models, CC0 license
   - Filter: Model, GLB format
   - Quality: Production-ready

2. **Sketchfab** (sketchfab.com)
   - Search, filter: Downloadable, GLB format
   - License: CC0 or CC-BY (check each)
   - Variety: Huge library

3. **Three.js Examples** (threejs.org/examples)
   - Sample models in `/models/` directory
   - Already tested with Three.js

**Recommended starting assets:**

| Name | Source | License | Use |
|------|--------|---------|-----|
| [Low Poly Astronaut](https://sketchfab.com/models/astronaut) | Sketchfab | CC0 | Character |
| [Crystal Gem](https://poly.haven.com/models) | Poly Haven | CC0 | Product |
| [Geometric Torus](https://threejs.org) | Three.js | MIT | Abstract |
| [Simple Robot](https://sketchfab.com) | Sketchfab | CC0 | Character |
| [City Skyline](https://poly.haven.com) | Poly Haven | CC0 | Environment |

### B. Download & Organize

```bash
# Create asset directories
mkdir -p public/assets/3d/v1/characters
mkdir -p public/assets/3d/v1/objects
mkdir -p public/assets/3d/v1/abstract
mkdir -p public/assets/3d/v1/environment

# Download model (e.g., astronaut.glb)
# Place in correct category:
cp ~/Downloads/astronaut.glb public/assets/3d/v1/characters/astronaut/
```

**Structure:**
```
public/assets/3d/v1/
├── characters/
│   └── astronaut/
│       └── astronaut.glb
├── objects/
│   └── smart-speaker/
│       └── smart-speaker.glb
├── abstract/
│   └── crystal-gem/
│       └── crystal-gem.glb
└── environment/
    └── floating-island/
        └── floating-island.glb
```

### C. Register in Catalog

Edit `lib/3d-assets/catalog.ts`:

```typescript
// Add to CHARACTER_ASSETS array
export const CHARACTER_ASSETS: Asset3d[] = [
  // ... existing
  {
    id: 'astronaut-simple',
    name: 'Astronaut Simple',
    category: 'character',
    path: 'assets/3d/v1/characters/astronaut/astronaut.glb',
    scale: 1,
    animationDuration: null,
    aspectRatios: ['16:9', '1:1'],
    dimensionModes: ['three'],
    sceneTypes: ['object3d', 'carousel3d'],
    tags: ['astronaut', 'space', 'character'],
    description: 'Minimalist astronaut for space narratives.',
    license: 'cc0',
  },
]
```

### D. Use in Video

Create a simple composition:

```typescript
import { Object3dScene } from '@/lib/3d-assets'
import { Composition, registerRoot } from 'remotion'

const MyVideo: React.FC = () => (
  <Object3dScene
    frames={300}
    assetId="astronaut-simple"
    headline="Explore Space"
    caption="Journey to the unknown"
    lightingTheme="cool"
    cameraMotion="orbit"
  />
)

export const Root = () => (
  <Composition
    id="SpaceExplorer"
    component={MyVideo}
    durationInFrames={300}
    fps={30}
    width={1920}
    height={1080}
  />
)

registerRoot(Root)
```

### E. View & Export

```bash
npm run dev
# Browse http://localhost:3000
# Select "SpaceExplorer"
# Click "Render" or press 'R'
```

---

## Popular Models by Use Case

### Product Showcases

**Smart Speaker / Appliances:**
- Poly Haven: Search "speaker", filter GLB
- Sketchfab: Search "product", sort by popularity

**Electronics:**
- Sketchfab: "phone", "tablet", "laptop" (filter GLB)
- License: CC0 preferred

### Characters

**Humanoid:**
- Sketchfab: "human model", "character", "person"
- License: Check CC0

**Robots:**
- Sketchfab: "robot", "bot"
- Poly Haven: Search "mechanical"

**Animals:**
- Poly Haven: "animal", "creature"
- Sketchfab: Filter CC0

### Abstract & Geometric

**Procedural Shapes:**
- Three.js examples (geometry demos)
- Sketchfab: "abstract", "geometric"

**Scientific:**
- Sketchfab: "molecule", "atom", "dna", "helix"

### Environments

**Terrain & Landscape:**
- Poly Haven: "terrain", "landscape", "mountain"
- Sketchfab: "environment", "scenery"

**Architecture:**
- Sketchfab: "building", "temple", "city"
- License: Verify

---

## Asset Quality Checklist

Before adding to catalog:

- [ ] **Format**: GLB 2.0 (binary, not glTF text)
- [ ] **Self-contained**: No external .bin, .png, .jpg files
- [ ] **Size**: < 5 MB (ideally < 2 MB)
- [ ] **Geometry**: 20k–100k polygons (balanced)
- [ ] **Materials**: Standard (no exotic shaders)
- [ ] **License**: CC0 or CC-BY (documented)
- [ ] **Preview**: Test in Three.js editor or Babylon Sandbox
- [ ] **Normals**: Present and correct

**Test in Three.js:**
1. Go to [threejs.org/editor](https://threejs.org/editor)
2. Drag & drop GLB file
3. Verify: Appears, has correct scale, renders well

---

## Tips for Best Results

### 1. Scale Models Consistently

When adding multiple assets, keep scale units consistent:
- Typical humanoid: 1.8–2.0 units tall
- Product: 1.0–1.5 units
- Abstract: Varies, but normalize via `scale` field in catalog

**Check in Three.js editor** — load asset, look at bounding box in console.

### 2. Optimize Before Adding

Use **Blender** to optimize:

```
1. Import GLB
2. Select all (A)
3. Decimate: Right panel → Modifiers → Decimate
   - Ratio: 0.5 (reduce to 50% polygons)
   - Apply
4. Merge by distance: M → By Distance
5. Normals → Recalculate
6. Export as GLB 2.0 (binary)
```

Result: Faster load, smaller file, same visual quality.

### 3. Lighting Matters

Same asset, different lighting themes:
- `default` — Professional product lighting
- `warm` — Welcoming, natural
- `cool` — Tech, modern, crisp
- `neon` — Dramatic, cyberpunk

Try different themes in the scene component.

### 4. Camera Motion

Match camera motion to content:
- `orbit` — Product showcase, 360° view
- `drift` — Gentle parallax, narrative
- `static` — Title/statement, focus on model

---

## Batch Import Workflow

To add 5+ assets at once:

**Step 1: Collect URLs**
```
astronaut: https://sketchfab.com/models/12345/download
robot: https://sketchfab.com/models/67890/download
crystal: https://poly.haven.com/models/crystal.glb
temple: https://poly.haven.com/models/temple.glb
city: https://poly.haven.com/models/city.glb
```

**Step 2: Download**
```bash
cd public/assets/3d/v1

mkdir -p characters/{astronaut,robot}
mkdir -p objects/crystal
mkdir -p environment/{temple,city}

# Download each file to correct location
curl https://sketchfab.com/.../astronaut.glb -o characters/astronaut/astronaut.glb
# ... repeat for others
```

**Step 3: Register Batch**
```typescript
// In catalog.ts, add all 5 entries to appropriate arrays

export const CHARACTER_ASSETS: Asset3d[] = [
  // ... existing
  { id: 'astronaut-simple', ... },
  { id: 'robot-simple', ... },
]

export const OBJECT_ASSETS: Asset3d[] = [
  // ... existing
  { id: 'crystal-gem', ... },
]

export const ENVIRONMENT_ASSETS: Asset3d[] = [
  // ... existing
  { id: 'pagoda-temple', ... },
  { id: 'city-skyline', ... },
]
```

**Step 4: Test**
```typescript
// In a test composition:
const assets = [
  'astronaut-simple',
  'robot-simple',
  'crystal-gem',
  'pagoda-temple',
  'city-skyline',
]

// Verify all load:
assets.forEach(id => {
  const asset = assetById(id)
  console.log(asset?.name, 'registered ✓')
})
```

---

## Common Issues

### "Asset not found"
```
Error: Asset not found: astronaut-simple
```
→ Check ID spelling in `catalog.ts`
→ Verify `assetById()` is imported
→ Reload page (clear cache)

### "staticFile() → 404"
```
staticFile('assets/3d/v1/...') not found
```
→ Path must be relative to `public/`
→ No `/public/` prefix
→ Check file exists: `ls public/assets/3d/v1/...`

### Model Loads But Is Invisible
→ Scale is wrong — adjust in catalog: `scale: 0.5` (example)
→ Bounds computed wrong — verify with `useAsset3d()` hook
→ Camera too close — increase `cameraDistance`

### File Too Large
→ Optimize in Blender: Decimate, merge by distance
→ Target: < 2 MB per model

---

## Next: AI Integration

Once you have 5+ assets:

1. **Update AI storyboard** to include asset selection:
   ```json
   { "type": "object3d", "assetId": "astronaut-simple", ... }
   ```

2. **Wire into compose.ts**:
   ```typescript
   case 'object3d':
     return `<Object3dScene assetId="${scene.assetId}" ... />`
   ```

3. **Add smart selection** — AI picks best asset for content:
   ```typescript
   const candidates = assetsForScene('object3d')
   const selected = candidates.find(a => a.tags.includes(briefKeyword))
   ```

---

## Resources

- **Poly Haven**: https://poly.haven.com
- **Sketchfab**: https://sketchfab.com (filter CC0)
- **Three.js Editor**: https://threejs.org/editor (preview GLBs)
- **Babylon Sandbox**: https://sandbox.babylonjs.com (preview GLBs)
- **Blender Docs**: https://docs.blender.org/manual/en/latest/ (export GLB)

---

**You're ready. Download 5 assets, add to catalog, ship.** 🚀
