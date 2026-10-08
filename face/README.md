# Eye filter (face tracking)

A selfie filter that runs in the browser: your front camera, a 3D copy of the
hamsa-with-googly-eye object placed over your face, and a loose pupil you play
with by moving your head. Fully separate from the image-tracking gallery app in the parent
folder - nothing outside `/face/` is used or changed.

- Live at `https://lukori.github.io/Hamsa_AR/face/`
- With the diagnostic tools: `.../face/?debug`

## How it works

- **Face tracking:** [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)
  (pinned `@mediapipe/tasks-vision@0.10.35`, code + WASM loaded from jsDelivr).
  The face model, a copy of Google's float16 `face_landmarker.task` (3.7MB), is
  hosted in `assets/` so the page doesn't depend on Google's storage server.
  Everything runs on the phone; no video is uploaded. It gives the head pose
  (a 4x4 matrix) and 52 blendshapes, including the eight eye-gaze ones.
- **The object** (`js/eye.js`): the STL of the hand + ring (`assets/hamsa_base.stl`,
  63.7 x 80.1 x 3.2mm, ring inner radius 25mm; sky blue, `PLATE_COLOR`) plus the
  parts the STL doesn't contain, measured from photos of the real piece: a clear
  dome (25mm base radius, ~4.5mm high; modelled as glass that only adds soft
  reflections), the white eye disc, and a 32mm black pupil that moves freely
  inside it (max travel ~8mm, like the real one). Reflections are kept low
  (`envMapIntensity` / `clearcoat` / pupil `specularIntensity`). Seen straight
  on, the ring has the same colour and faces the same way as the base, so it
  would be invisible; soft gradient "contact shade" decals around and inside the
  ring (`outerShade` / `innerShade`) make it read as raised, and the eye white is
  a light grey so it isn't clipped to pure white.
- **Soft shadow** (`js/filter.js`, `js/scene.js`): one light that follows the
  head(s) from above and to the side, and an invisible plane a few cm behind each
  object that only shows shadows (`SHADOW_OPACITY` 0.19, `SHADOW_BLUR`,
  `SHADOW_GAP` 2.25cm, `LIGHT_OFFSET`), so the object looks like it floats just above
  the face. The plane follows the head's position but only 35% of its rotation
  (`CATCHER_FOLLOW`), otherwise a strongly turned head stretches the shadow into
  a long streak.
- **Up to 3 people at once** (`MAX_FACES` in `js/main.js`): MediaPipe returns the
  faces in arbitrary order with no IDs, so each detection is matched to the
  nearest person from the previous frames (3D distance, under 35cm) - each person
  keeps their own eye, smoothing and pupil, and nobody swaps when the order
  changes. The first person is always sky blue; the others take the next unused
  colour from red / yellow / green / orange / purple (`OTHER_COLORS` in
  `js/eye.js`). Colours stick to a person while they're in frame; a person who
  has been gone for ~0.9s frees their slot, and a newcomer takes the lowest free
  one (so a free first slot is always blue). A 4th person is ignored. All
  people share one light (separate lights would stack up and over-brighten).
  More faces = more work per frame; check `detect` ms in `?debug` with 2-3
  people. MediaPipe only finds reasonably large faces, so people far from the
  camera, or heavily overlapping faces, may not get an eye.
- **Placement** (`js/filter.js`): the object is attached to the head pose,
  smoothed, and sized to cover the face.
- **The pupil is a physical object, not a gaze pointer** (`js/filter.js`). It is a
  free disc in the dome, like a real googly eye, only more energetic:
  - *gravity* pulls it toward world-down, rotated into the object's own frame,
    so it rests at the bottom of the dome and slides around the rim when you
    tilt your head (ear to shoulder: it falls to that side);
  - *head motion* throws it: the acceleration of the eye object (from its
    tracked position, so turning or tilting the head counts, via the object's
    lever arm) pushes the pupil the opposite way, exaggerated by `shake` (2.2;
    1 = physically accurate). Acceleration is fitted over the last ~0.3s
    (differentiating noisy positions twice directly would be mostly noise), a
    12 cm/s^2 soft dead-zone keeps a still head from twitching it, and tracking
    glitches above ~3g are clipped;
  - *the rim*: it bounces off the edge of the dome (`bounce` 0.8: keeps 80% of
    its speed; a slow touch just rests) and loses speed slowly (`PUPIL_DAMPING`),
    so shaking the head from side to side throws it from rim to rim, and moving
    the head in circles sends it orbiting around the rim in step with the head;
  - *gravity strength* is `gravity` mm/s^2 (1100; real gravity, 9810, would make
    it fall too fast to see);
  - *where you look* is still measured (eye-gaze blendshapes) and shown in
    `?debug`, but only affects the pupil if you set `gaze` above 0 (0 = pure
    physics, 1 = also pulled toward your gaze point). It was the original
    behaviour, but looking sideways means not looking at the screen, so it was
    rarely seen (git tag `checkpoint-eye-filter-gaze-follow` has that version).
- **The page** (`index.html`, `js/main.js`): start button (required for the
  camera on iPhone), front camera, mirrored selfie view (video and 3D canvas are
  flipped together with CSS), render loop.

Signs/axes were checked on real photos: a portrait looking up and to one side
gave the expected `gx`/`gy` signs and the object turned with the head.

## Tuning

URL parameters (also set by the +/- buttons in `?debug`, which update the
address bar so you can copy the tuned link): `s` (size, 1 = real size, default
2.9), `dy` (cm up, default -0.55), `dz` (cm forward, default 8.5), `shake`
(2.2), `grav` (gravity, 1100), `bounce` (0.8) and `gaze` (0). Defaults live in
`js/filter.js`.

`?debug` also shows live pupil/push/head/gaze numbers, FPS and detection time, and
has **Save log** / **Copy log** (a timestamped sample every 0.25s, with a block
per tracked face) to send back for tuning.

## Caching

Same trick as the main app: `?v=N` on the script/asset URLs in `index.html`,
`js/main.js` and the STL. Bump N for a file whenever it changes, otherwise a
phone that already opened the page can keep running the old copy. `js/eye.js`
is imported (with its version) by both `main.js` and `filter.js`: bump it in
both places.

## Not verified here

Everything above was exercised in a desktop browser (real MediaPipe model on
face photos, and the full page with a fake camera built from a photo). **Not**
tested: an actual phone camera, iOS Safari specifics (GPU delegate, front
camera orientation), and how well gaze tracking holds up on a phone at arm's
length. The physics is tuned on synthetic head movements (still, shaking,
circling, tilting, noisy tracking), not on a real person: expect to tune
`shake` / `gravity` / `bounce` from a real session.

Still loaded from jsDelivr at run time: the MediaPipe JS bundle and WASM (about
9MB) and three.js.
