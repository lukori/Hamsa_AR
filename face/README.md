# Eye filter (face tracking)

A selfie filter that runs in the browser: your front camera, a 3D copy of the
hamsa-with-googly-eye object placed over your face, and a pupil that looks where
you look. Fully separate from the image-tracking gallery app in the parent
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
- **Soft shadow** (`js/filter.js`, `js/scene.js`): a light that follows the head
  from above-front and an invisible plane a few cm behind the object that only
  shows shadows (`SHADOW_OPACITY`, `SHADOW_BLUR`, `SHADOW_GAP`, `LIGHT_OFFSET`),
  so the object looks like it floats just above the face.
- **Placement and gaze** (`js/filter.js`): the object is attached to the head
  pose, smoothed, and sized to cover the face. Gaze = left/right and up/down
  blendshapes combined into a direction, amplified (`gain`), and drives the
  pupil through a slightly under-damped spring so it wobbles a little like a
  real googly eye. While blinking the gaze is frozen (readings are unreliable).
- **The page** (`index.html`, `js/main.js`): start button (required for the
  camera on iPhone), front camera, mirrored selfie view (video and 3D canvas are
  flipped together with CSS), render loop.

Signs/axes were checked on real photos: a portrait looking up and to one side
gave the expected `gx`/`gy` signs and the object turned with the head.

## Tuning

URL parameters (also set by the +/- buttons in `?debug`, which update the
address bar so you can copy the tuned link): `s` (size, 1 = real size, default
2.9), `dy` (cm up, default -0.55), `dz` (cm forward, default 8.5), `gain` and
`gainy` (gaze strength, default 2.2). Defaults live in `js/filter.js`.

`?debug` also shows live face/gaze/head numbers, FPS and detection time, and
has **Save log** / **Copy log** (a timestamped sample every 0.25s) to send back
for tuning.

## Caching

Same trick as the main app: `?v=N` on the script/asset URLs in `index.html`,
`js/main.js` and the STL. Bump N for a file whenever it changes, otherwise a
phone that already opened the page can keep running the old copy.

## Not verified here

Everything above was exercised in a desktop browser (real MediaPipe model on
face photos, and the full page with a fake camera built from a photo). **Not**
tested: an actual phone camera, iOS Safari specifics (GPU delegate, front
camera orientation), and how well gaze tracking holds up on a phone at arm's
length. Expect to tune `gain` / placement from a real session's log.

Still loaded from jsDelivr at run time: the MediaPipe JS bundle and WASM (about
9MB) and three.js.
