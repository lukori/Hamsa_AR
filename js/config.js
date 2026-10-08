// Trigger configuration for the AR experience.
// To add a new trigger: add its source image to /assets/targets-source,
// recompile /assets/targets.mind (see README), then add an entry here
// with the matching targetIndex (the image's position in the compile order).
//
// Optional per-trigger `group: "name"`: triggers sharing a name never show at
// the same time (main.js lets only one member show - the one already showing
// keeps it, else the first found). Use it when several images (e.g. photos of
// one print under different lighting) lead to the same content, so near-
// identical matches don't draw overlapping copies.
//
// Optional per-trigger `lostGraceMs` (default 0 = off): when tracking of this
// image drops, keep showing its content frozen at the last known pose for this
// many milliseconds instead of hiding it at once; if the image is re-found in
// time it carries on, otherwise it disappears. For images that are hard to
// lock onto (few trackable features) and flicker out for a frame or two.
// Leave it off for images that track reliably (e.g. the yellow poster).
// (Used at 2000ms on the text-panel triggers. History: 500ms first - git tag
// checkpoint-grace-hold-500ms - then off for a test, then 1000ms, then 2000ms
// after a debug log showed 4 of 8 tracking gaps lasting 1.0-1.8s; in the final
// full-frame sessions 2000ms left zero disappearances.)
//
// Optional per-trigger `contentTransform: { position: [x, y, z], scale }`: for
// an image that is only a CROP of the real print. MindAR anchors content to
// the trigger image's own centre, with the image's width = 1 unit - so for a
// crop, content authored in whole-print units (width = 1) needs `scale` =
// printWidthPx / cropWidthPx and a `position` offset (in crop-width units, y
// up) from the crop's centre to the print's centre. (Currently unused: a title-
// block crop was tried and never locked in 4 debug sessions, so it was removed.)
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
    id: "trigger-02a",
    targetIndex: 1,
    label: "Hamsa text panel - wall photo variant (same coin rain)",
    // `group`: triggers sharing a group name (several images of the SAME
    // print under different lighting, all leading to the same content) never
    // show at the same time - see main.js. Without it, two similar variants
    // matching at once would each draw their own overlapping rain.
    group: "text-panel",
    lostGraceMs: 2000,
    content: [
      {
        // Second image for the same print: a real photo of the printed
        // panel on the gallery wall (assets/targets-source/
        // what_luck_text_trigger_photo1.jpg, 526x745, cropped to the print's
        // edge; compiled at index 1). Same content as the other text variants; `group` keeps only one shown.
        // boxHeight = 3 * 745/526 = 4.25 for this image's own aspect.
        type: "mesh-rain",
        src: "assets/models/flateye.glb",
        boxWidth: 3,
        boxHeight: 4.25,
        boxDepth: 0.8,
        rows: 7,
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
    id: "trigger-02b",
    targetIndex: 2,
    label: "Hamsa text panel - higher-resolution wall photo variant (same coin rain)",
    // `group`: triggers sharing a group name (several images of the SAME
    // print under different lighting, all leading to the same content) never
    // show at the same time - see main.js. Without it, two similar variants
    // matching at once would each draw their own overlapping rain.
    group: "text-panel",
    lostGraceMs: 2000,
    content: [
      {
        // Third image for the same print: a higher-resolution photo of the
        // printed panel on the gallery wall (assets/targets-source/
        // what_luck_text_trigger_photo2.jpg, scaled from 1500x2000 to
        // 900x1200 to keep targets.mind's size down; compiled at index 2).
        // Same content as the other text variants; `group` keeps only one shown.
        // boxHeight = 3 * 1200/900 = 4.0 for this image's own aspect.
        type: "mesh-rain",
        src: "assets/models/flateye.glb",
        boxWidth: 3,
        boxHeight: 4,
        boxDepth: 0.8,
        rows: 7,
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
    id: "trigger-02d",
    targetIndex: 3,
    label: "Hamsa text panel - photo taken in the gallery (same coin rain)",
    // `group`: triggers sharing a group name (several images of the SAME
    // print under different lighting, all leading to the same content) never
    // show at the same time - see main.js. Without it, two similar variants
    // matching at once would each draw their own overlapping rain.
    group: "text-panel",
    lostGraceMs: 2000,
    content: [
      {
        // Photo taken in the gallery itself (assets/targets-source/
        // what_luck_text_trigger_gallery.jpg): the original 1500x2000 phone
        // photo showed wall around the paper, so it was cropped to the
        // print's own edge (found by contrast-boosting to reveal the paper
        // edge: x 156-1440, y 136-1956) and scaled to 900x1276; compiled at
        // index 3. boxHeight = 3 * 1276/900 = 4.25 for this image's aspect.
        type: "mesh-rain",
        src: "assets/models/flateye.glb",
        boxWidth: 3,
        boxHeight: 4.25,
        boxDepth: 0.8,
        rows: 7,
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
    id: "trigger-02d-lo",
    targetIndex: 4,
    label: "Hamsa text panel - gallery photo, low-res copy (same coin rain)",
    // `group`: triggers sharing a group name (several images of the SAME
    // print under different lighting, all leading to the same content) never
    // show at the same time - see main.js. Without it, two similar variants
    // matching at once would each draw their own overlapping rain.
    group: "text-panel",
    lostGraceMs: 2000,
    content: [
      {
        // LOW-RESOLUTION copy of the gallery photo (assets/targets-source/
        // what_luck_text_trigger_gallery_lo.jpg, 526x746; compiled at index
        // 4). An iPhone's camera feed is only 480x640, and in debug logs the
        // 526px-wide photo (02a) did most of the tracking; this copy of the
        // gallery photo at the same width added tracked time in some sessions.
        // Same content/aspect as 02d (boxHeight 4.25).
        type: "mesh-rain",
        src: "assets/models/flateye.glb",
        boxWidth: 3,
        boxHeight: 4.25,
        boxDepth: 0.8,
        rows: 7,
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
];
