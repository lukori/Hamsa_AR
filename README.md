# Image-Triggered AR Exhibition

Browser-based AR: point a phone camera at one of the exhibition's physical images
and matching digital content (video / 3D model / transparent overlay / a
combination) appears anchored to it in space. Built with **MindAR.js + three.js**
per the project brief (`בריף לקלוד קוד מערכת AR מבוססת זיהוי תמונה.md`) — no app
install, works in iOS Safari and Android Chrome, fully static, no backend.

## Current status

The scaffold is complete and wired end-to-end for **5 triggers**, each currently
using **placeholder assets** (procedurally generated trigger images, a couple of
synthetic test videos, and simple animated 3D primitives). Nothing here is final
exhibition content — swap in the real trigger images and media before the show
(see "Replacing placeholders with real content" below).

| Trigger | Content type | Files |
| --- | --- | --- |
| `trigger-01` | Video overlay | `assets/videos/01-video-overlay.mp4` |
| `trigger-02` | 3D model + animation (placeholder: procedural primitive) | — |
| `trigger-03` | Transparent animated overlay | `assets/videos/03-alpha-glow-sbs.mp4` |
| `trigger-04` | Combination: video + 3D model | `assets/videos/04-combo-video.mp4` |
| `trigger-05` | Combination: transparent overlay + 3D model | reuses `03-alpha-glow-sbs.mp4` |

## Running it locally

This is a static site — any local HTTP server works (camera access requires
either `https://` or `localhost`/`127.0.0.1`, both of which the browser treats
as a secure context):

```bash
python3 -m http.server 8080
```

Then open `http://127.0.0.1:8080/` on your phone (same Wi-Fi network — use your
computer's LAN IP instead of `127.0.0.1`) or in a desktop browser for a quick
console/logic check. **Full tracking behavior can only be tested on a real
device** — there is no simulator for this.

Tap **Start Experience** to trigger the camera permission prompt (this must
stay a real, explicit tap — auto-starting on page load silently breaks on
iPhone).

## Project structure

```
/
  index.html              start screen, camera container, imports MindAR + three.js from CDN
  /js
    main.js                MindAR init, camera start, render loop, play/pause on target found/lost
    config.js               the 5 trigger definitions — EDIT THIS to add/change triggers
    sceneBuilder.js          generic content builder (video / alpha-video / model / primitive)
  /assets
    targets.mind             compiled multi-target file (all 5 trigger images, in targetIndex order)
    /targets-source           the 5 source trigger images (currently placeholders)
    /models                   GLB files go here
    /videos                   MP4 files go here
  /tools
    compile.html              local, offline tool to compile new trigger images into targets.mind
```

No `npm install`, no build step — three.js and MindAR load straight from a
pinned CDN version via an import map in `index.html`. Keep it that way unless
there's a real reason to add a bundler.

### Why three.js is pinned to 0.160.0

MindAR 1.2.5's three.js integration still uses `renderer.outputEncoding =
sRGBEncoding`, an API that three.js removed in later releases. `three@0.160.0`
is the newest version confirmed to still work with it (this was verified
directly, not assumed — see the "how this was validated" note below). Don't
bump the three.js version in `index.html`'s import map without testing that
`new MindARThree(...)` still constructs without errors.

## Adding or replacing a trigger

There is intentionally no CMS — adding a trigger is a two-step process:

1. **Compile the image(s).** Open `tools/compile.html` locally (same static
   server as above), drop in your image(s) **in the order you want their
   `targetIndex`**, click Compile, and download the resulting `targets.mind`.
   Replace `assets/targets.mind` with it. This tool runs entirely in the
   browser — nothing is uploaded anywhere.
   - Also keep a copy of the source image in `assets/targets-source/` for
     reference (not used at runtime, just so the original isn't lost).
2. **Edit `js/config.js`.** Add/edit an entry whose `targetIndex` matches the
   image's position in the compile order (0-based), and describe its `content`
   array. `sceneBuilder.js` already supports:
   - `{ type: "video", src, width, height, loop }` — opaque video plane
   - `{ type: "alpha-video", src, width, height, loop }` — transparent overlay.
     The source MUST be a single video where the **left half is RGB color and
     the right half is a grayscale alpha mask**, side by side in one frame
     (see "Transparent overlays" below for why, and how to produce one).
   - `{ type: "model", src, position, scale, rotation, animation }` — GLB/GLTF
     model via `GLTFLoader`; `animation` optionally names a specific clip,
     otherwise the first clip in the file plays.
   - `{ type: "primitive", geometry, color, position, scale, animation }` —
     procedural three.js mesh (`box` / `sphere` / `torusKnot` / `icosahedron` /
     `octahedron`), `animation: "spin-bob"` for simple rotate+hover motion.

   A trigger's `content` array can mix any of these — everything in it shares
   one anchor group, so it all moves together, matching the physical image
   1:1 (image center = origin, image plane = XY plane, +Z lifts content above
   the image surface).

### Transparent overlays ("gif-style" animations)

Real alpha-channel WebM playback through an HTML `<video>` element is **not**
reliably supported across iOS Safari and Android Chrome (this was the original
ask — "gif animations" — before landing on this approach). Instead, `content`
type `"alpha-video"` uses the standard AR/web trick: pack the color and the
alpha mask side by side in one ordinary MP4, and a small vertex/fragment
shader in `sceneBuilder.js` splits them back into a transparent texture at
render time. This works identically everywhere a `<video>` tag works.

To produce one from a transparent animation (e.g. exported frames with alpha
from After Effects, Lottie, etc.), the general `ffmpeg` recipe is: render the
color pass and the alpha-as-grayscale pass, then stack them horizontally into
one video, e.g.:

```bash
ffmpeg -i color.mov -i alpha.mov -filter_complex hstack -an output-sbs.mp4
```

`assets/videos/03-alpha-glow-sbs.mp4` is a synthetic placeholder generated
this way (a pulsing ring, no source footage) — replace it, don't try to reuse
it for real content.

## Preparing real trigger images

From the brief — worth re-reading before printing anything:

- High resolution, rich in detail and contrast, **not** symmetric or
  repetitive, **not** on a glossy/reflective surface.
- Compile and check the feature distribution in `tools/compile.html` (or the
  hosted version at https://hiukim.github.io/mind-ar-js-doc/tools/compile/)
  before finalizing — you want good, evenly distributed features, not a
  cluster in one corner with blank space elsewhere.
- Test on an actual printed/displayed image, on a real device — this cannot be
  simulated. Checklist: different lighting (strong / weak / mixed), different
  angles and distances, partial occlusion, and reasonably fast relative
  movement. Test on both iPhone and Android — camera and motion-sensor
  permission flows differ between them.

## 3D models

- Keep polygon count and texture resolution low — the device is simultaneously
  running real-time image tracking, and a heavy model costs both frame rate
  and tracking accuracy.
- Compress with Draco or Meshopt where possible.

## Deployment

Fully static, so Vercel, Netlify, or GitHub Pages all work with zero config —
push to git and connect the repo, or drag-and-drop deploy. All three give
HTTPS automatically, which is required for camera access on a real domain
(only `localhost`/`127.0.0.1` get a free pass during local testing).

## How the MindAR + three.js integration was validated

Given how easy it is to pin an incompatible three.js version against MindAR's
three.js build (see above), the CDN combination used here
(`three@0.160.0` + `mind-ar@1.2.5`'s `mindar-image-three.prod.js`, loaded via
an import map, exactly as in `index.html`) was smoke-tested end-to-end in a
real browser before being committed to:

- The ES module imports resolve and `MindARThree` constructs without errors.
- `sceneBuilder.js`'s content builders (video plane, alpha-video shader split,
  procedural primitives) were exercised against all 5 entries in `config.js`
  in an isolated scene (no camera required) and rendered correctly — including
  visually confirming the alpha-video shader produces real transparency, not a
  black box.
- `tools/compile.html` was run against the 5 placeholder images end-to-end and
  produced a working `targets.mind`.

What was **not** and cannot be tested outside a real device: actual camera
image tracking (position/angle/scale updates, target-found/lost transitions
under real lighting), and iOS-specific camera/motion permission prompts.
