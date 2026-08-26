# Editor Studio - native shell

The Editor Studio (`components/EditorStudio.tsx`, `lib/editor/*`) packaged as a
standalone desktop and mobile app with [Tauri](https://tauri.app), instead of
running inside a browser tab. Same code, same engine, same local-first
promise - nothing is uploaded - the only thing that changes is the runtime:
Tauri's WebView has no browser-tab memory ceiling, and `lib/device.ts`'s
`refineDeviceProfileForNative()` asks the Rust side for the machine's *real*
RAM/CPU (via the `system_info` command in `src-tauri/src/lib.rs`) to raise
its own quality ceilings accordingly - see that file's comment for the exact
numbers.

This directory is scoped to the editor on purpose: the Editor Studio is the
one part of the app with zero server dependency (no API routes, no
server-rendered pages), which is what makes it possible to ship as a fully
offline native binary at all. The other studios (Captions, Silence, Tools,
Resume) call server API routes for AI/cloud work and are not part of this
build.

## Layout

```
apps/editor-native/
  index.html, src/main.tsx       the Vite entry point - imports EditorStudio
                                  and app/globals.css directly from the repo
                                  root, no fork of the component code
  vite.config.ts                 esnext target (WebCodecs/BigInt need it;
                                  the old "safari13" Tauri default does not)
  src-tauri/
    tauri.conf.json              window size, bundle targets, identifier
    src/lib.rs                   the `system_info` Rust command, plugin setup
    rust-toolchain.toml          pinned to the GNU (MinGW) toolchain - see
                                  "Windows build prerequisites" below
    capabilities/default.json    fs + dialog permissions (broad, since this
                                  is a local single-user editor, not a
                                  multi-tenant app)
```

## Prerequisites

- Node.js and the root repo's `npm install` already run (this is an npm
  workspace member - `apps/editor-native` deliberately has no `node_modules`
  of its own; React/mediabunny/etc are hoisted from the repo root so there is
  exactly one copy of each, not two silently-different ones).
- Rust (`rustup`), stable channel.
- Platform-specific toolchain - see below.

## Windows build prerequisites

This repo's dev environment had no Visual Studio Build Tools installed (the
usual `x86_64-pc-windows-msvc` target Tauri recommends), so
`src-tauri/rust-toolchain.toml` is pinned to `stable-x86_64-pc-windows-gnu`
instead, which links with MinGW-w64 rather than MSVC's `link.exe`. If you
have Visual Studio Build Tools with the "Desktop development with C++"
workload installed, you can switch that file back to plain `"stable"` and
use the MSVC target instead - slightly better Windows tooling compatibility,
no functional difference to the app itself.

To build with the GNU toolchain as configured, MinGW-w64 needs to be on
`PATH` - if `gcc`/`dlltool` are not already installed, grab a build from
[WinLibs](https://winlibs.com) (UCRT, posix threads, x86_64) and add its
`bin/` directory to `PATH` before running any `cargo`/`tauri` command.

`rustup default` also needs to actually point at that GNU toolchain, not
just this directory's `rust-toolchain.toml` override - `npm run tauri
android build` runs `cargo` from inside a Gradle task, and that invocation's
working directory does not resolve the override file the way a plain
`cargo build` run from `src-tauri/` does, so it silently falls back to
whatever `rustup default` is. If Android builds fail with a `feature
edition2024 is required` error even though `cargo build` alone works fine,
this is why - run `rustup default stable-x86_64-pc-windows-gnu` (system-wide,
not just this project) to fix it for good.

## Commands

Run all of these from `apps/editor-native/`:

```bash
npm run dev              # Vite dev server alone, in an ordinary browser tab
npm run tauri dev        # the real thing: Vite + a live Tauri window
npm run tauri build      # release build + installer, in src-tauri/target/release/bundle/
```

## Android

```bash
npm run tauri android init    # one-time - generates the Android Studio project
npm run tauri android build   # needs ANDROID_HOME + NDK - see Android SDK below
```

Needs the Android SDK (platform-tools, a platform, matching build-tools) and
the Android NDK specifically (Tauri compiles the Rust side to a native
`.so` per architecture) - the NDK is the one most people don't already have
even if Android Studio is installed, since Studio doesn't install it by
default. `npm run tauri android build --debug` produces:

```
app/build/outputs/apk/universal/debug/app-universal-debug.apk
app/build/outputs/bundle/universalDebug/app-universal-debug.aab
```

The debug APK is a *universal* build (all four ABIs - arm64, armv7, x86,
x86_64 - plus debug symbols bundled together), which is why it comes out to
several hundred MB; a release build split per-ABI (`--target aarch64`, the
one real devices actually need) is a small fraction of that. Verified with
`aapt dump badging` - package `com.remotionvideostudio.editorstudio`,
label "Editor Studio", minSdk 24, targetSdk 36 - but not yet installed on an
actual device or emulator, so the UI itself is unverified on Android.

## iOS

**Cannot be built on Windows or Linux at all** - not a missing-dependency
problem, a hard platform requirement: Tauri's iOS tooling shells out to
Xcode's own `xcodebuild`/`xcodegen`, which only exist on macOS, and Apple
does not offer a way around that. To get an iOS build:

```bash
npm run tauri ios init     # on a Mac, with Xcode + its command-line tools installed
npm run tauri ios build    # needs a valid Apple Developer signing identity for a real device;
                            # the simulator build works without one
```

Once `ios init` has run on a Mac, the generated Xcode project is a normal
Xcode project - open it directly if you'd rather work there than through the
CLI. The most Windows can do toward this is exist ready for it: the shared
`lib/editor`/`components/editor` code and this Vite app need nothing iOS-specific
changed, since it's the same WKWebView-hosted frontend as every other Tauri
target.

## What's genuinely different running natively vs. the web build

- No browser-tab memory ceiling; `refineDeviceProfileForNative()` reads the
  real system RAM and raises `maxDimension`/`maxScale`/`encoderQueueDepth`
  past what `lib/device.ts`'s browser heuristic would ever assume safe.
- The `fs` and `dialog` Tauri plugins are installed and permissioned
  (`capabilities/default.json`), but **not yet wired into the editor's
  import/export flow** - `lib/editor/persistence.ts` still uses the browser
  File System Access API / plain `<input type="file">` path, which also
  works fine inside a Tauri WebView (it's still a standard web engine), it
  just doesn't get the *native* save-dialog/unrestricted-filesystem benefit
  yet. Tracked in `VIDEO_EDITOR_CHECKLIST.md`.
- Everything else - the timeline, the compositor, the command bus, export -
  is the exact same code as the web build, unmodified.
