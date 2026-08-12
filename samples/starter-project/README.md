# Kinetic Quote - multi-file Remotion starter

1080x1920, 30fps, 10 seconds. This folder shows the layout the studio expects
from a zipped project:

```
starter-project/
  package.json
  src/
    index.ts          <- registerRoot(Root)
    Root.tsx          <- <Composition /> declarations
    KineticQuote.tsx  <- the animation itself
```

**Use it in the studio:** zip this folder (or download `starter-project.zip` from
the studio) and drop it on the upload area. Relative imports keep working.

**Use it standalone:**

```bash
npm install
npm start          # opens Remotion Studio
npm run render     # writes out.mp4
```
