// Trigger configuration for the AR experience.
// To add a new trigger: add its source image to /assets/targets-source,
// recompile /assets/targets.mind (see README), then add an entry here
// with the matching targetIndex (the image's position in the compile order).
//
// Content item types supported by sceneBuilder.js:
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
//                    binary file of packed [x,y,z, x,y,z, ...] positions, normalized
//                    to fit roughly a unit box. Good for a "particle cloud" rendering
//                    of a 2D reference image/silhouette. `animation: "spin"` rotates
//                    it continuously around Y; `spinSpeed` controls the rate.

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
        // Particle-cloud rendering of a reference fish illustration,
        // extracted from its stipple/halftone dots. Swap this for
        // { type: "model", src: "assets/models/xxx.glb", ... } instead
        // once a real GLB is available - sceneBuilder already supports it.
        type: "points",
        src: "assets/models/fish-points.bin",
        color: 0x111111,
        pointSize: 0.012,
        position: [0, 0, 0.25],
        scale: 0.9,
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
