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
        // difference on inspection. Width/height below match its portrait
        // aspect ratio (matches the trigger image's own aspect too).
        type: "video",
        src: "assets/videos/fishy-trigger01.mp4",
        width: 0.719,
        height: 1,
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
    label: "Transparent animated overlay",
    content: [
      {
        type: "alpha-video",
        src: "assets/videos/03-alpha-glow-sbs.mp4",
        width: 1,
        height: 1,
        loop: true,
      },
    ],
    onFound: "play",
    onLost: "pause",
  },
  {
    id: "trigger-04",
    targetIndex: 3,
    label: "Combination: video + 3D model",
    content: [
      {
        type: "video",
        src: "assets/videos/04-combo-video.mp4",
        width: 1,
        height: 1,
        loop: true,
      },
      {
        type: "primitive",
        geometry: "icosahedron",
        color: 0xff6b6b,
        position: [0, 0, 0.3],
        scale: 0.14,
        animation: "spin-bob",
      },
    ],
    onFound: "play",
    onLost: "pause",
  },
  {
    id: "trigger-05",
    targetIndex: 4,
    label: "3D model (GLB)",
    content: [
      {
        // Real GLB model - a fish, matching the reference trigger image
        // this fish illustration was originally generated from
        // (assets/targets-source/redblue_poster_trigger.jpg, compiled into
        // targets.mind at index 4). Original export was 1.9M triangles /
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
