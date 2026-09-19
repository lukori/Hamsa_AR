// Trigger configuration for the AR experience.
// To add a new trigger: add its source image to /assets/targets-source,
// recompile /assets/targets.mind (see README), then add an entry here
// with the matching targetIndex (the image's position in the compile order).
//
// Content item types supported by sceneBuilder.js:
//   "backdrop"     - a flat, unlit, solid-color plane (e.g. a white card behind
//                    other content so it doesn't blend into the camera feed).
//   "video"        - opaque video plane (regular MP4, e.g. filmed/rendered footage)
//   "alpha-video"  - transparent animated overlay. Source is a single MP4 where the
//                    LEFT half is the RGB color and the RIGHT half is a grayscale
//                    alpha mask (same technique used for Lottie/Rive-style AR overlays).
//                    This avoids relying on native alpha-channel WebM decoding, which
//                    is not reliably supported across iOS Safari and Android Chrome.
//   "model"        - GLB/GLTF model, optionally with a named skeletal animation clip.
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
        type: "video",
        src: "assets/videos/01-video-overlay.mp4",
        width: 1,
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
        // Deep indigo/black card behind the fish, matching the reference
        // particle-galaxy's own background - the glow/additive-blended
        // colors below are tuned to pop against dark, not white.
        type: "backdrop",
        color: 0x0a0312,
        width: 2.3,
        height: 1.3,
        position: [0, 0, 0],
      },
      {
        // Procedurally generated volumetric fish (37,500 points, real
        // depth - fins and eyes project outward, not a flat silhouette),
        // exported as raw xyz floats from a reference particle-galaxy
        // tool's custom shape generator. Colors/glow match that tool's
        // default "Amber Vessel" palette (amber core -> violet outer,
        // additive blending). Swap this for
        // { type: "model", src: "assets/models/xxx.glb", ... } instead
        // once a real GLB is available - sceneBuilder already supports it.
        type: "points",
        src: "assets/models/fish-galaxy-points.bin",
        colorCore: "#e39b00",
        colorOuter: "#6432ff",
        blending: "additive",
        opacity: 0.55,
        pointSize: 0.022,
        position: [0, 0, 0.25],
        scale: 0.13,
        driftAmount: 0.2,
        animation: "spin",
        spinSpeed: 0.5,
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
    label: "Combination: transparent overlay + 3D model",
    content: [
      {
        type: "alpha-video",
        src: "assets/videos/03-alpha-glow-sbs.mp4",
        width: 1,
        height: 1,
        loop: true,
      },
      {
        type: "primitive",
        geometry: "octahedron",
        color: 0x6bcb77,
        position: [0, 0, 0.28],
        scale: 0.15,
        animation: "spin-bob",
      },
    ],
    onFound: "play",
    onLost: "pause",
  },
];
