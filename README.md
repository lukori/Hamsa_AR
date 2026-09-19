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

| Trigger | Trigger image | Content type | Files |
| --- | --- | --- | --- |
| `trigger-01` | `yellow_poster_trigger.jpg` (real) | Video overlay (real content) | `assets/videos/fishy-trigger01.mp4` |
| `trigger-02` | `trigger-02.png` (placeholder) | 3D model + animation (placeholder: spinning primitive) | — |
| `trigger-03` | `trigger-03.png` (placeholder) | Rain of eyes (real content, placeholder trigger image) | `assets/textures/eye.png` |
| `trigger-04` | `trigger-04.png` (placeholder) | Combination: video + 3D model (placeholder) | `assets/videos/04-combo-video.mp4` |
| `trigger-05` | `trigger-05.png` (placeholder) | Real GLB model | `assets/models/fisher-fish.glb` |

`trigger-01` now uses a real exhibition image and real video content, no
longer generated placeholders — see "Preparing real trigger images" below
for the compile step whenever you swap another one in. Note the video came
in at 35 Mbps / 43.7MB with an audio track that's never used (all video
content here is always muted, for autoplay); re-encoded to ~6.7 Mbps /
8.4MB with audio stripped, no visible quality difference on inspection —
worth doing for any new video

`trigger-05` briefly used a second real poster image
(`redblue_poster_trigger.jpg`) but it was reverted back to the generated
placeholder: it was visually too similar to `trigger-01`'s poster (both busy
halftone/pop-art patterns), and MindAR confused the two targets — showing
both anchors' content when only one image was in frame. **When choosing
multiple real trigger images, make sure they're distinguishable from each
other, not just individually detailed** — the brief's "rich in detail and
contrast" guidance is about each image alone, but a full multi-target set
also needs images that don't resemble each other.
handed off for a trigger, not just this one.

The particle-cloud/glow experiments that used to live on `trigger-02` (a
procedurally generated volumetric fish with additive amber/violet glow) are
still fully supported by `sceneBuilder.js` (`"points"` content type) if that
direction comes back later - see git tag `checkpoint-galaxy-fish-glow` for
the exact working config, and `assets/models/fish-galaxy-points.bin` /
`assets/models/fish-points.bin` are kept on disk either way.

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
    /textures                 plain images used as textures (e.g. "sprite-rain" sources), not trigger images
  /tools
    compile.html              local, offline tool to compile new trigger images into targets.mind
    points-from-image.html    local, offline tool to turn a reference image into a "points" asset
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
   - `{ type: "backdrop", color, width, height, position, radial }` — an
     unlit solid-color plane behind other content, so it doesn't blend into
     the camera feed. `radial: true` fades it to fully transparent at the
     edges (a soft glow/void with no visible boundary) instead of a hard
     rectangle — a visible rectangle behind a rotating 3D object reads as
     "flat video in a frame" even when the object itself has real depth.
   - `{ type: "video", src, width, height, loop }` — opaque video plane
   - `{ type: "alpha-video", src, width, height, loop }` — transparent overlay.
     The source MUST be a single video where the **left half is RGB color and
     the right half is a grayscale alpha mask**, side by side in one frame
     (see "Transparent overlays" below for why, and how to produce one).
   - `{ type: "model", src, position, scale, rotation, animation, spinSpeed, blending, depthWrite }` —
     GLB/GLTF model via `GLTFLoader` (meshopt-compressed files supported -
     `MeshoptDecoder` is already wired up). `animation: "spin"` applies a
     procedural Y-axis spin regardless of what's baked into the file
     (`spinSpeed`); otherwise, if the file has its own animation clips,
     `animation` optionally names a specific one, else the first clip plays.
     `blending: "additive" | "multiply" | "subtract"` changes how it
     composites — **but only against other opaque WebGL content already
     drawn in the scene** (another mesh, an opaque `"backdrop"`), **not**
     against the real camera feed. MindAR's renderer is transparent
     (`alpha: true`, no scene background); the live camera image is a
     separate `<video>` element positioned behind the canvas via CSS, not
     part of the WebGL scene at all. `blending: "multiply"` with nothing
     opaque behind the model in-scene multiplies against fully transparent
     (0,0,0,0) — i.e. zero — making the model **invisible**. (Confirmed by
     trying it on `trigger-05`: the model disappeared entirely.) A true
     "multiply against the live camera" effect is possible but needs a
     custom shader sampling the camera video as a texture at screen-space
     UV, replicating MindAR's own crop/letterbox math for the video element
     — not implemented here. See "Using a real GLB model" below for the
     export/compression workflow.
   - `{ type: "primitive", geometry, color, position, scale, animation }` —
     procedural three.js mesh (`box` / `sphere` / `torusKnot` / `icosahedron` /
     `octahedron`), `animation: "spin-bob"` for simple rotate+hover motion.
   - `{ type: "points", src, color | (colorCore + colorOuter), opacity, blending, pointSize, position, scale, animation, spinSpeed, driftAmount, driftSpeed }` —
     a particle cloud (`THREE.Points`) loaded from a raw binary file of packed
     `[x,y,z, x,y,z, ...]` floats, rendered with soft circular sprites and
     per-particle size variance instead of flat square dots. Either a flat
     `color`, or `colorCore`/`colorOuter` for a gradient by distance from the
     cloud's center — pair the gradient with `blending: "additive"` for a
     bright glow (tune `opacity` down, e.g. 0.5, to avoid dense clouds
     clipping to solid white from overdraw), or leave both unset for a flat
     opaque color that works on a light backdrop instead (additive washes out
     against white). `animation: "spin"` rotates the whole cloud continuously
     (`spinSpeed`); independently, every particle also drifts in a small
     individual orbit (`driftAmount` = orbit radius, `driftSpeed` = how fast)
     so the cloud shimmers in place rather than looking rigid. See
     "Particle-cloud content" below for how to make one.
   - `{ type: "sprite-rain", src, boxWidth, boxHeight, boxDepth, rows, cols, depthLayers, jitter, minScale, maxScale, shadow, shadowOpacity, shadowOffset }` —
     many camera-facing copies of one image, scattered through an imaginary
     box in front of the trigger image (the image is the box's back wall).
     Placed on a jittered grid (`rows` × `cols` × `depthLayers`, wandering up
     to `jitter` (0–1) of a cell's size) rather than pure random, so it reads
     as an organized scatter instead of a messy cloud. `minScale`/`maxScale`
     vary each instance's size on top of a size-with-depth falloff.
     `shadow: true` adds a soft offset dark decal on the wall behind each
     sprite (`shadowOpacity`, `shadowOffset`) suggesting a light from the
     front — a cheap fake, not a real dynamic shadow (camera-facing sprites
     have no surface normals for real shadow-mapping to use). `trigger-03`
     uses this for a "rain of eyes" effect.

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

### Particle-cloud content

`content` type `"points"` renders a static point cloud. `trigger-02`'s
placeholder is currently `assets/models/fish-galaxy-points.bin` — 37,500
points forming a genuinely volumetric fish (fins and eye project outward in
3D, not just a flat cutout), exported as raw xyz floats from a reference
particle-galaxy tool's procedural shape generator, rendered with that same
tool's default "Amber Vessel" glow palette (amber core → violet outer,
additive blending) on a matching dark backdrop.

There's a second, home-grown way to make one, better suited to a real
reference image rather than a procedurally generated shape:
`assets/models/fish-points.bin` (currently unused by any trigger, kept as a
reference/fallback) is a fish illustration reduced to ~6,000 of its own
stipple/ink dots, extruded into a rough volume (denser "body" regions bulge
more than thin "fin" edges, estimated from local point density) so it holds
together reasonably when rotated. To make one of these yourself: open
`tools/points-from-image.html` locally, drop in a high-contrast image (line
art, stipple/halftone illustration, or a clean silhouette work best — it
samples dark pixels directly as points), tune the threshold/point-count/depth
sliders against the live preview, and download the resulting `points.bin`.
This approach is a flat-image-based approximation, not a real 3D scan — for
genuine volume from a 2D reference, or for a fully custom procedural shape
like the fish above, a tool that generates real 3D coordinates (e.g. the
reference particle-galaxy site) or a real GLB via `type: "model"` will look
better.

The rendering itself (soft round sprites, per-particle size variance, the
individual per-particle drift/shimmer) is adapted from a reference
particle-galaxy shader technique (`PointsMaterial.onBeforeCompile`, injecting
a `sizes` and `shift` attribute and a `time` uniform) — re-tuned for a small,
dark, on-white cloud rather than a large glowing additive-blended one, since
additive blending washes out dark colors against a light background.

## Tracking smoothness (jitter)

MindAR smooths the tracked pose with a [OneEuroFilter](https://cristal.univ-lille.fr/~casiez/1euro/), tuned in `main.js`'s
`MindARThree({ filterMinCF, filterBeta, ... })` call. Its own defaults
(`filterMinCF: 0.001`, `filterBeta: 1000`) favor responsiveness over
smoothness, which shows up as visible jitter/shake on anchored content —
most noticeable on anything also spinning (like `trigger-05`'s model),
since tracking noise compounds with the real rotation. Currently set to
`filterMinCF: 0.0001, filterBeta: 10` — meaningfully smoother, at the cost
of a bit more lag when you move the phone quickly. Per MindAR's own
[tracking config docs](https://hiukim.github.io/mind-ar-js-doc/quick-start/tracking-config/):
lowering `filterMinCF` reduces jitter, raising `filterBeta` reduces delay —
they trade off against each other, so re-tune here if it ever feels too
laggy or too shaky.

## Preparing real trigger images

From the brief — worth re-reading before printing anything:

- High resolution, rich in detail and contrast, **not** symmetric or
  repetitive, **not** on a glossy/reflective surface.
- **Distinguishable from your OTHER trigger images, not just detailed on
  their own.** Confirmed the hard way: two busy halftone/pop-art posters
  used as separate triggers were similar enough that MindAR matched either
  one to both targets, triggering both anchors' content at once from a
  single image. Compile the full set together and test each image against
  the whole set, not one at a time in isolation.
- Compile and check the feature distribution in `tools/compile.html` (or the
  hosted version at https://hiukim.github.io/mind-ar-js-doc/tools/compile/)
  before finalizing — you want good, evenly distributed features, not a
  cluster in one corner with blank space elsewhere.
- Test on an actual printed/displayed image, on a real device — this cannot be
  simulated. Checklist: different lighting (strong / weak / mixed), different
  angles and distances, partial occlusion, and reasonably fast relative
  movement. Test on both iPhone and Android — camera and motion-sensor
  permission flows differ between them.

## Using a real GLB model

- Keep polygon count and texture resolution low — the device is simultaneously
  running real-time image tracking, and a heavy model costs both frame rate
  and tracking accuracy.
- **AI-generated / photogrammetry GLBs are almost never AR-ready as exported.**
  `trigger-05`'s model (`assets/models/fisher-fish.glb`) came in as a raw
  image-to-3D export at **1.9M triangles and 55MB** (single mesh, single
  2048px texture, no rigging) — completely unworkable alongside live image
  tracking on a phone. It was decimated with
  [`@gltf-transform/cli`](https://gltf-transform.dev/) (installable with no
  native build step via `npx`, unlike some mesh tools):

  ```bash
  npx @gltf-transform/cli optimize input.glb output.glb \
    --simplify-ratio 0.03 --texture-size 1024 --compress meshopt
  ```

  That took it to **~168k triangles and 1.25MB** — a 44x smaller file — with
  the fin rays, scale texture, and eye all still clearly legible (worth a
  visual check after simplifying; `--simplify-ratio` trades detail for size,
  and how far you can push it depends on the model). `--compress meshopt`
  requires the consuming `GLTFLoader` to have a `MeshoptDecoder` registered,
  which `sceneBuilder.js` already does — if you use Draco compression instead,
  you'd need to wire up a `DRACOLoader` there too.
- Check the result with `npx @gltf-transform/cli inspect your-model.glb` —
  it prints triangle count, texture sizes, and material/animation info
  without needing to open it in a 3D app.

## Updating the deployed site (cache-busting)

GitHub Pages caches static files for 10 minutes, and phone browsers often
hold onto JS modules even longer — so after pushing a change to any JS file,
a device that already opened the app once can keep running the **old**
version even though the server has the new one, because the *URL* it's
cached under hasn't changed (this has bitten us twice: once for
`config.js`/`sceneBuilder.js`, once for `main.js` itself — editing a file
without also bumping *its own* reference's `?v=N` is the same bug in a new
place, easy to miss when the edit feels "small"). There are three separate
version markers, each covering a different file, and **each needs bumping
only when its own file changes, but don't forget one just because the edit
was to a different file**:

- `index.html`'s `<script src="js/main.js?v=N">` — bump when `main.js` itself changes.
- `main.js`'s `import ... "./config.js?v=N"` — bump when `config.js` changes.
- `main.js`'s `import ... "./sceneBuilder.js?v=N"` — bump when `sceneBuilder.js` changes.

If you ever hit this despite bumping the right one, a hard refresh /
clearing site data on the phone also fixes it.

**The same problem applies to `assets/targets.mind`**, separately — it has
its own cache-buster (`MIND_VERSION` in `main.js`, appended as `?v=N` to
`imageTargetSrc`) because it changes on a different schedule than the JS
files (whenever you recompile trigger images, not whenever you edit code).
**Bump `MIND_VERSION` every time you replace `targets.mind`.** Symptom of
forgetting: brand new trigger images silently "don't work" / "don't load" on
a phone that already opened the app, because it's still holding an older
compiled target set that has no idea those images exist yet.

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
