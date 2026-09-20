// Trigger configuration for the AR experience.
// To add a new trigger: add its source image to /assets/targets-source,
// recompile /assets/targets.mind (see README), then add an entry here
// with the matching targetIndex (the image's position in the compile order).
//
// Content item types supported by sceneBuilder.js:
//   "backdrop"     - an unlit, solid-color plane behind other content so it
//                    doesn't blend into the camera feed. `radial: true` fades
//                    it to fully transparent at the edges (a soft glow/void,
//                    no visible boundary) instead of a hard-edged rectangle -
//                    a visible rectangle behind a rotating 3D object reads as
//                    "flat video in a frame" even when the object has real depth.
//   "video"        - opaque video plane (regular MP4, e.g. filmed/rendered footage)
//   "alpha-video"  - transparent animated overlay. Source is a single MP4 where the
//                    LEFT half is the RGB color and the RIGHT half is a grayscale
//                    alpha mask (same technique used for Lottie/Rive-style AR overlays).
//                    This avoids relying on native alpha-channel WebM decoding, which
//                    is not reliably supported across iOS Safari and Android Chrome.
//   "model"        - GLB/GLTF model. `animation: "spin"` applies a procedural Y-axis
//                    spin (`spinSpeed`) regardless of what's baked into the file;
//                    otherwise a named/first skeletal animation clip plays if the file
//                    has one. `blending: "additive" | "multiply" | "subtract"` recolors
//                    how it composites against whatever's ALREADY DRAWN IN THE WEBGL
//                    SCENE behind it (another mesh/backdrop) - it does NOT reach the
//                    real camera feed, which is a separate <video> element behind the
//                    transparent canvas, not part of the WebGL scene. Using "multiply"
//                    with nothing opaque behind the model in-scene makes it invisible
//                    (multiplies against transparent = zero). See the README before
//                    using this.
//   "primitive"    - a procedural three.js mesh with code-driven animation (rotate/
//                    hover/scale). Used here as a placeholder stand-in for "model"
//                    until real GLB assets are ready, and reusable for any trigger
//                    that just needs simple procedural motion.
//   "points"       - a static point cloud (THREE.Points) loaded from a raw Float32
//                    binary file of packed [x,y,z, x,y,z, ...] positions (any scale -
//                    use `scale` to fit it to the scene). `animation: "spin"` rotates
//                    it continuously around Y (`spinSpeed`); every particle also
//                    drifts in its own tiny orbit (`driftAmount`/`driftSpeed`) for a
//                    shimmering, alive feel. Either `color` (flat) or both
//                    `colorCore`/`colorOuter` (gradient by distance from center) -
//                    pair the gradient with `blending: "additive"` for a bright glow
//                    on a dark backdrop; use flat `color` for a solid look on light.
//   "sprite-rain"  - many camera-facing copies of one image (`src`), scattered through
//                    an imaginary box in front of the trigger image (the image is the
//                    box's back wall). `boxWidth`/`boxHeight`/`boxDepth` size the box;
//                    `rows`/`cols`/`depthLayers` set a jittered grid (not pure random,
//                    so it reads as organized) - `jitter` (0-1) controls how much each
//                    instance wanders from its grid cell. `minScale`/`maxScale` vary
//                    size per instance, on top of a size-with-depth falloff. `shadow`
//                    adds a soft offset dark decal behind each sprite on the wall
//                    (`shadowOpacity`, `shadowOffset`) - a cheap fake, not a real
//                    dynamic shadow (camera-facing sprites have no normals for real
//                    shadow-mapping to use). `fallSpeed` (box-height units/sec, 0 = static)
//                    makes every instance continuously fall and wrap back to the top -
//                    each keeps its own fixed starting phase so they wrap independently,
//                    and `fallSpeedVariance` randomizes each instance's rate a bit too.
//   "mesh-rain"    - same box/grid/jitter/fall placement as "sprite-rain", but each
//                    instance is a real 3D model (`src`, a GLB) instead of a flat
//                    billboard, rendered as one THREE.InstancedMesh (single draw call
//                    regardless of instance count - important since each instance
//                    here has real, non-trivial geometry, unlike a sprite's flat
//                    plane). `minScale`/`maxScale` are the model's own target
//                    world-space size (its largest dimension is normalized to 1 unit
//                    first, so these behave the same as in "sprite-rain" regardless of
//                    the source file's native scale). On top of falling, every
//                    instance continuously flips/tumbles around its OWN randomly
//                    chosen axis (`flipSpeed` turns/sec, `flipSpeedVariance`) rather
//                    than a shared axis - a shared axis/speed for every instance is
//                    what makes procedural animation read as robotic/duplicated.
//                    `emissiveBoost` (0-1ish, default 0.9) blends the model's own
//                    texture in as emissive light, so it stays evenly bright no
//                    matter which way it's currently facing the scene's directional
//                    light - without it, a tumbling lit model flickers dark every
//                    time it turns away from the light, which reads as "the eyes
//                    look dark" since it happens on essentially every instance at
//                    some point in its tumble. Set to 0 to fall back to normal
//                    lighting only.

export const triggers = [
  {
    id: "trigger-01",
    targetIndex: 0,
    label: "Video overlay",
    content: [
      {
        // Real content: a rendered fish animation over the yellow/magenta
        // poster art (assets/targets-source/yellow_poster_trigger.jpg is
        // the matching trigger image, compiled into targets.mind at index
        // 0). Source was 1446x2012 @ 35 Mbps / 43.7MB with an unused audio
        // track (always muted for AR autoplay anyway) - re-encoded to
        // ~6.7 Mbps / 8.4MB, no audio, same resolution; no visible quality
        // difference on inspection.
        //
        // width/height: MindAR always normalizes the anchor's local space
        // so the TRIGGER IMAGE's own width = 1 unit, regardless of the
        // video's own pixel size - so to fully cover the image (rather than
        // float smaller than it), height must be the trigger image's own
        // height/width ratio, not the video's. yellow_poster_trigger.jpg is
        // 808x1125, so height = 1125/808 = 1.392 covers it exactly. (The
        // video's own aspect, 1446x2012 = 0.7187, is close enough to the
        // image's, 808x1125 = 0.7182, that it isn't visibly stretched.)
        type: "video",
        src: "assets/videos/fishy-trigger01.mp4",
        width: 1,
        height: 1.392,
        loop: true,
      },
    ],
    onFound: "play",
    onLost: "pause",
  },
  {
    id: "trigger-02",
    targetIndex: 1,
    label: "3D model + animation",
    content: [
      {
        // Swap this for { type: "model", src: "assets/models/xxx.glb", ... }
        // once a real GLB is available. sceneBuilder already supports it.
        // (The particle-cloud experiments that used to live here are kept
        // in git history - see the checkpoint-galaxy-fish-glow tag - in
        // case that direction gets picked back up later.)
        type: "primitive",
        geometry: "torusKnot",
        color: 0x4d96ff,
        position: [0, 0, 0.22],
        scale: 0.18,
        animation: "spin-bob",
      },
    ],
    onFound: "play",
    onLost: "pause",
  },
  {
    id: "trigger-03",
    targetIndex: 2,
    label: "Rain of eyes",
    content: [
      {
        // A field of the same eye icon (assets/textures/eye.png) at varying
        // sizes and 3D depths, filling an imaginary box 3x the trigger
        // image's own width (centered - 1x extra width on each side) and
        // 3x its height, with the image as the box's back wall - eyes rain
        // down through and around the printed image, extending well beyond
        // its physical bounds on every side. Arranged on a jittered grid
        // (rows x cols x depthLayers), not pure random, so it reads as
        // organized rather than messy; `cols` scaled up 3x along with
        // boxWidth to keep the same density as before, rather than
        // spreading the original count thinner across more space. Each eye
        // gets a soft offset shadow decal on the wall behind it, and
        // continuously falls and wraps back to the top (fallSpeed), each at
        // its own independently randomized rate (fallSpeedVariance) so they
        // don't move in lockstep.
        type: "sprite-rain",
        src: "assets/textures/eye.png",
        boxWidth: 3,
        boxHeight: 3,
        boxDepth: 0.8,
        rows: 7,
        cols: 9,
        depthLayers: 2,
        minScale: 0.09,
        maxScale: 0.22,
        shadow: true,
        shadowOpacity: 0.3,
        shadowOffset: [0.02, -0.025],
        fallSpeed: 0.5,
        fallSpeedVariance: 0.25,
      },
    ],
  },
  {
    id: "trigger-04",
    targetIndex: 3,
    label: "Rain of eye coins (3D)",
    content: [
      {
        // Same "rain" idea as trigger-03, but each falling instance is a
        // real 3D model (a flat, coin-shaped eye illustration - hence
        // "flateye") instead of a flat sprite, and on top of falling it
        // continuously tumbles/flips end over end like a flipped coin -
        // each one around its own randomly chosen axis at its own speed, so
        // the field reads as many independent coins rather than one
        // animation copy-pasted. Source GLB was a raw AI image-to-3D export
        // at 1.95M triangles / 55MB (single mesh, single texture, no
        // rigging - the same story as trigger-05's fish); decimated with
        // gltf-transform the same way, down to ~39k triangles / 314KB. Held
        // up well visually, and rendered as one THREE.InstancedMesh so the
        // whole field is a single draw call no matter the instance count.
        type: "mesh-rain",
        src: "assets/models/flateye.glb",
        boxWidth: 3,
        boxHeight: 3,
        boxDepth: 0.8,
        rows: 5,
        cols: 6,
        depthLayers: 2,
        minScale: 0.14,
        maxScale: 0.3,
        shadow: true,
        shadowOpacity: 0.3,
        shadowOffset: [0.02, -0.025],
        fallSpeed: 0.4,
        fallSpeedVariance: 0.25,
        flipSpeed: 0.5,
        flipSpeedVariance: 0.5,
      },
    ],
  },
  {
    id: "trigger-05",
    targetIndex: 4,
    label: "3D model (GLB)",
    content: [
      {
        // Real GLB model - a fish. Trigger image is back to the generated
        // placeholder (assets/targets-source/trigger-05.png, compiled into
        // targets.mind at index 4) - a real "redblue" poster image was
        // tried here but was visually too similar to trigger-01's poster
        // (both busy halftone patterns), and MindAR confused the two,
        // triggering both anchors off either image. Original GLB export
        // was 1.9M triangles /
        // 55MB (a raw AI image-to-3D output); decimated with gltf-transform
        // (meshoptimizer simplify + meshopt compression + 1024px texture)
        // to ~168k triangles / 1.25MB, which held up visually very well -
        // see the README for the exact command.
        //
        // NOTE: no `blending` set here on purpose. "multiply" was tried and
        // made the model fully INVISIBLE: MindAR's renderer is transparent
        // (alpha: true, no scene background) and the real camera feed is a
        // separate <video> element behind the canvas via CSS, not part of
        // the WebGL scene - so MultiplyBlending multiplied against nothing
        // (0,0,0,0), which is zero everywhere. See the README's "blending"
        // note under "Using a real GLB model" before re-enabling it.
        type: "model",
        src: "assets/models/fisher-fish.glb",
        position: [0, 0, 0.3],
        scale: 0.7,
        animation: "spin",
        spinSpeed: 0.4,
      },
    ],
    onFound: "play",
    onLost: "pause",
  },
];
