import * as THREE from "three";
import { PUPIL_TRAVEL, FIRST_COLOR, OTHER_COLORS } from "./eye.js?v=4";

// Turns MediaPipe Face Landmarker results into, for each tracked face, (a) the
// head pose an eye object is attached to and (b) where the pupil sits inside
// the dome. Up to `maxFaces` faces at once, each with its own eye object.
//
// The pupil behaves like the loose disc in a real googly eye (but more
// energetic): gravity pulls it to the lowest point of the dome, head movement
// throws it around (shake the head and it bounces off the rim; move the head in
// circles and it orbits along the rim), and it can optionally also be pulled
// toward where the person is looking (`gaze`, off by default).
//
// Conventions (MediaPipe canonical face space, units cm): +X = image right in
// the UNMIRRORED camera frame (the subject's left), +Y up, +Z toward the
// camera. The page shows a mirrored selfie view by flipping everything with
// CSS, so the 3D scene is built in unmirrored camera space.

export const DEFAULT_PARAMS = {
  size: 2.9, // eye object size relative to the real piece (1 = 6.4cm wide)
  dy: -0.55, // cm up from the face model's origin
  dz: 8.5, // cm forward of the face model's origin (nose tip is ~7.5)
  shake: 2.2, // how strongly head acceleration throws the pupil (1 = physically accurate, more = more energetic)
  gravity: 1100, // mm/s^2 pulling the pupil toward the bottom of the dome (real gravity is 9810: too fast to see)
  bounce: 0.8, // share of its speed the pupil keeps when it hits the rim of the dome (0 = dead stop, 1 = perfectly bouncy)
  gaze: 0, // 0..1: how much the pupil is ALSO pulled toward where the person looks (0 = pure physics)
};

const SHADOW_OPACITY = 0.19; // how dark the soft shadow is (was 0.42; halved, then 10% less)
const SHADOW_BLUR = 10; // how soft (VSM blur radius)
const SHADOW_GAP = 2.25; // cm between the object and the surface it shadows (the shadow's offset/size scales with it; was 3.0, now 25% less)
const LIGHT_OFFSET = new THREE.Vector3(18, 30, 26); // key light relative to the faces, cm (above and to the side)
const HOLD_MS = 350; // keep showing the last pose this long after the face is lost
const RELEASE_MS = 900; // after this long without the face, its slot (and colour) is freed
const MATCH_MAX_CM = 35; // a detection this close to a slot's last position is the same person
const CATCHER_FOLLOW = 0.35; // how much of the head's rotation the shadow plane follows (0 = flat wall behind, 1 = turns with the head)
const POSE_TAU = 0.045; // pose smoothing time constant (s); lower = snappier

const PUPIL_DAMPING = 1.6; // 1/s: slow air-drag-like loss of speed (low = keeps bouncing a long time)
const REST_SPEED = 25; // mm/s: a hit slower than this doesn't bounce (so it can come to rest on the rim)
const ACCEL_WINDOW_S = 0.3; // head acceleration is fitted over this much recent history
const ACCEL_MIN_SPAN_S = 0.12; // ...and needs at least this much of it
const ACCEL_MIN_SAMPLES = 4;
const ACCEL_MAX_CM = 3000; // cm/s^2: ignore tracking glitches beyond ~3g
const ACCEL_DEADZONE_CM = 12; // cm/s^2 subtracted from the head's acceleration: tracking noise is ~4-9, a gentle sway ~40, so a still head leaves the pupil at rest
const ACCEL_TAU = 0.04; // s: smooths the acceleration between detections
const GAZE_SPRING_K = 240; // pull toward the gaze point when `gaze` is 1 (1/s^2)
const GAZE_AMP = 2.2; // gaze blendshape (0..1) -> -1..1 of the pupil's travel
const DEADZONE = 0.03;
const BLINK_HOLD = 0.55; // while blinking, gaze readings are unreliable: freeze

function dead(v) {
  const a = Math.abs(v);
  return a < DEADZONE ? 0 : Math.sign(v) * (a - DEADZONE);
}

// Solve the 3x3 system m * c = b (Cramer's rule); null if singular.
function solve3(m, b) {
  const det = (a) =>
    a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6]);
  const d = det(m);
  if (Math.abs(d) < 1e-30) return null;
  const col = (k) => {
    const a = m.slice();
    a[k] = b[0];
    a[k + 3] = b[1];
    a[k + 6] = b[2];
    return det(a) / d;
  };
  return [col(0), col(1), col(2)];
}

// Acceleration of a tracked point from its recent positions: fit
// pos(s) = c0 + c1*s + c2*s^2 (s = seconds before the newest sample) by least
// squares; the acceleration is 2*c2. Differentiating noisy positions twice
// directly would be mostly noise; fitting over ~0.3s smooths it. Returns
// { ax, ay } in cm/s^2, or null if there isn't enough history.
function fitAcceleration(samples) {
  const n = samples.length;
  if (n < ACCEL_MIN_SAMPLES) return null;
  const t0 = samples[n - 1].t;
  if (t0 - samples[0].t < ACCEL_MIN_SPAN_S) return null;
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, bx0 = 0, bx1 = 0, bx2 = 0, by0 = 0, by1 = 0, by2 = 0;
  for (const q of samples) {
    const s = q.t - t0;
    const ss = s * s;
    s1 += s;
    s2 += ss;
    s3 += ss * s;
    s4 += ss * ss;
    bx0 += q.x;
    bx1 += q.x * s;
    bx2 += q.x * ss;
    by0 += q.y;
    by1 += q.y * s;
    by2 += q.y * ss;
  }
  const m = [n, s1, s2, s1, s2, s3, s2, s3, s4];
  const cx = solve3(m, [bx0, bx1, bx2]);
  const cy = solve3(m, [by0, by1, by2]);
  if (!cx || !cy) return null;
  return { ax: 2 * cx[2], ay: 2 * cy[2] };
}

// One tracked face: its head pose, its eye object, its shadow plane, its pupil.
function createSlot(index, eyeFactory, p) {
  const eye = eyeFactory.create(FIRST_COLOR.hex);

  const anchor = new THREE.Group(); // = the head pose
  anchor.matrixAutoUpdate = false;
  anchor.visible = false;
  const placer = new THREE.Group(); // offset + size relative to the head
  anchor.add(placer);
  placer.add(eye.root);

  // Soft shadow of the object on the face/background behind it: an invisible
  // plane (it only shows shadows) a little behind the object. It follows the
  // head's position but only part of its rotation: a plane that turned fully
  // with a head turned 40 degrees would stretch the shadow into a long streak.
  const catcherRig = new THREE.Group();
  catcherRig.visible = false;
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: SHADOW_OPACITY }));
  catcher.receiveShadow = true;
  catcherRig.add(catcher);

  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3(1, 1, 1);
  const tmpM = new THREE.Matrix4();
  const tmpP = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const tmpEye = new THREE.Vector3();
  const invQ = new THREE.Quaternion();
  const gLocal = new THREE.Vector3();
  const aLocal = new THREE.Vector3();
  const euler = new THREE.Euler();

  const pendingPose = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1), set: false };
  let havePose = false;
  const target = { x: 0, y: 0 }; // where the person is looking, mm (only used if p.gaze > 0)
  const pupil = { x: 0, y: 0, vx: 0, vy: 0 };
  // Recent positions of the eye object (camera space, cm) and the acceleration
  // fitted from them (cm/s^2, camera x/y).
  let samples = [];
  const accelTarget = { x: 0, y: 0 };
  const accel = { x: 0, y: 0 };
  const state = {
    faceFound: false,
    gx: 0, // gaze readings, for the debug overlay (+ = subject looks right/up)
    gy: 0,
    px: 0, // where the pupil is, -1..1 of its travel
    py: 0,
    ax: 0, // total push on the pupil in the eye's own frame, mm/s^2 (gravity + head motion)
    ay: 0,
    blink: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
  };

  const slot = {
    index,
    anchor,
    catcherRig,
    catcher,
    pos, // smoothed head position (cm)
    lastPos: new THREE.Vector3(), // latest raw detection position, for matching
    lastSeen: -Infinity,
    reserved: false, // this slot currently belongs to a person
    colorName: FIRST_COLOR.name,
    state,
    applyParams,
    pupilMm: () => ({ x: pupil.x, y: pupil.y }),
  };

  function applyParams() {
    catcher.position.set(0, p.dy, p.dz - SHADOW_GAP);
    placer.position.set(0, p.dy, p.dz);
    placer.scale.setScalar(0.1 * p.size); // eye space is mm, face space is cm
  }
  applyParams();

  function resetMotion() {
    samples = [];
    accelTarget.x = accelTarget.y = accel.x = accel.y = 0;
  }

  slot.claim = (color) => {
    slot.reserved = true;
    slot.colorName = color.name;
    eye.setColor(color.hex);
    havePose = false;
    pendingPose.set = false;
    target.x = target.y = pupil.x = pupil.y = pupil.vx = pupil.vy = 0;
    resetMotion();
    slot.lastSeen = -Infinity;
  };

  slot.release = () => {
    slot.reserved = false;
    havePose = false;
    pendingPose.set = false;
    anchor.visible = false;
    state.faceFound = false;
    resetMotion();
  };

  slot.setMissing = () => {
    state.faceFound = false;
  };

  // det = { pos, data (4x4 head pose, 16 numbers), categories (blendshapes) }
  slot.setFace = (det, nowMs) => {
    state.faceFound = true;
    const reappeared = nowMs - slot.lastSeen > 1000;
    slot.lastSeen = nowMs;
    slot.lastPos.copy(det.pos);

    tmpM.fromArray(det.data);
    tmpM.decompose(tmpP, tmpQ, tmpS);
    // step() eases the displayed pose toward this every frame.
    pendingPose.p.copy(tmpP);
    pendingPose.q.copy(tmpQ);
    pendingPose.s.copy(tmpS);
    pendingPose.set = true;
    if (!havePose || reappeared) {
      pos.copy(tmpP);
      quat.copy(tmpQ);
      scl.copy(tmpS);
      havePose = true;
      resetMotion();
    }

    // The pupil is thrown by how the EYE OBJECT moves (not the head's centre):
    // turning or tilting the head swings the object, which is its lever arm.
    tmpEye.set(0, p.dy, p.dz).applyMatrix4(tmpM);
    const t = nowMs / 1000;
    samples.push({ t, x: tmpEye.x, y: tmpEye.y });
    while (samples.length && t - samples[0].t > ACCEL_WINDOW_S) samples.shift();
    const a = fitAcceleration(samples);
    if (a) {
      const mag = Math.hypot(a.ax, a.ay);
      const eff = Math.min(ACCEL_MAX_CM, Math.max(0, mag - ACCEL_DEADZONE_CM)); // ignore noise, clip glitches
      const k = mag > 0 ? eff / mag : 0; // keep the direction
      accelTarget.x = a.ax * k;
      accelTarget.y = a.ay * k;
    } else {
      accelTarget.x = accelTarget.y = 0;
    }

    const s = {};
    if (det.categories) for (const c of det.categories) s[c.categoryName] = c.score;
    const get = (k) => s[k] || 0;
    state.blink = Math.max(get("eyeBlinkLeft"), get("eyeBlinkRight"));
    if (state.blink < BLINK_HOLD) {
      // ARKit naming: "Left"/"Right" are the subject's own eyes; "In" looks
      // toward the nose. The subject looking to THEIR right = left eye In +
      // right eye Out.
      const right = (get("eyeLookInLeft") + get("eyeLookOutRight")) / 2;
      const left = (get("eyeLookOutLeft") + get("eyeLookInRight")) / 2;
      const up = (get("eyeLookUpLeft") + get("eyeLookUpRight")) / 2;
      const down = (get("eyeLookDownLeft") + get("eyeLookDownRight")) / 2;
      state.gx = right - left;
      state.gy = up - down;
    }
    // Face-space +X is the subject's LEFT, so looking right moves the pupil to -X.
    let nx = -dead(state.gx) * GAZE_AMP;
    let ny = dead(state.gy) * GAZE_AMP;
    const len = Math.hypot(nx, ny);
    if (len > 1) {
      nx /= len;
      ny /= len;
    }
    target.x = nx * PUPIL_TRAVEL;
    target.y = ny * PUPIL_TRAVEL;

    euler.setFromQuaternion(tmpQ, "YXZ");
    state.yaw = THREE.MathUtils.radToDeg(euler.y);
    state.pitch = THREE.MathUtils.radToDeg(euler.x);
    state.roll = THREE.MathUtils.radToDeg(euler.z);
  };

  // Call every rendered frame.
  slot.step = (dt, nowMs) => {
    if (pendingPose.set) {
      const k = 1 - Math.exp(-dt / POSE_TAU);
      pos.lerp(pendingPose.p, k);
      quat.slerp(pendingPose.q, k);
      scl.lerp(pendingPose.s, k);
    }
    anchor.visible = slot.reserved && havePose && nowMs - slot.lastSeen < HOLD_MS;
    catcherRig.visible = anchor.visible;
    if (anchor.visible) {
      anchor.matrix.compose(pos, quat, scl);
      catcherRig.position.copy(pos);
      catcherRig.quaternion.set(0, 0, 0, 1).slerp(quat, CATCHER_FOLLOW);
    }

    // Head acceleration, eased between detections; none if the face is gone.
    if (nowMs - slot.lastSeen > 200) accelTarget.x = accelTarget.y = 0;
    const ka = 1 - Math.exp(-dt / ACCEL_TAU);
    accel.x += (accelTarget.x - accel.x) * ka;
    accel.y += (accelTarget.y - accel.y) * ka;

    // Forces on the pupil, in the eye's own frame (the object turns with the
    // head, so "down" and the head's push are rotated into it): gravity pulls
    // toward world-down, and the container's acceleration pushes the other way.
    invQ.copy(quat).invert();
    gLocal.set(0, -1, 0).applyQuaternion(invQ);
    aLocal.set(accel.x, accel.y, 0).applyQuaternion(invQ);
    const fx = gLocal.x * p.gravity - aLocal.x * 10 * p.shake; // cm -> mm
    const fy = gLocal.y * p.gravity - aLocal.y * 10 * p.shake;
    state.ax = fx;
    state.ay = fy;

    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    const drag = Math.exp(-PUPIL_DAMPING * h);
    for (let i = 0; i < n; i++) {
      let ax = fx;
      let ay = fy;
      if (p.gaze > 0) {
        ax += GAZE_SPRING_K * p.gaze * (target.x - pupil.x);
        ay += GAZE_SPRING_K * p.gaze * (target.y - pupil.y);
      }
      pupil.vx = (pupil.vx + ax * h) * drag;
      pupil.vy = (pupil.vy + ay * h) * drag;
      pupil.x += pupil.vx * h;
      pupil.y += pupil.vy * h;
      const r = Math.hypot(pupil.x, pupil.y);
      if (r > PUPIL_TRAVEL) {
        // Hit the rim: put it back on the edge and bounce the outward part of
        // its velocity (a slow touch just stops, so it can rest there).
        const ux = pupil.x / r;
        const uy = pupil.y / r;
        pupil.x = ux * PUPIL_TRAVEL;
        pupil.y = uy * PUPIL_TRAVEL;
        const outward = pupil.vx * ux + pupil.vy * uy;
        if (outward > 0) {
          const e = outward > REST_SPEED ? p.bounce : 0;
          pupil.vx -= (1 + e) * outward * ux;
          pupil.vy -= (1 + e) * outward * uy;
        }
      }
    }
    state.px = pupil.x / PUPIL_TRAVEL;
    state.py = pupil.y / PUPIL_TRAVEL;
    eye.setPupil(pupil.x, pupil.y);
  };

  return slot;
}

export function createFaceManager(eyeFactory, params = {}, maxFaces = 3) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const group = new THREE.Group();
  const slots = [];
  for (let i = 0; i < maxFaces; i++) {
    const slot = createSlot(i, eyeFactory, p);
    slots.push(slot);
    group.add(slot.anchor, slot.catcherRig);
  }

  // ONE key light shared by all faces (separate lights would stack up and
  // over-brighten when several people are in frame). It follows the middle of
  // the visible heads; its shadow area grows to cover everyone.
  const lightRig = new THREE.Group();
  const key = new THREE.DirectionalLight(0xffffff, 0.95);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 200;
  key.shadow.radius = SHADOW_BLUR;
  key.shadow.blurSamples = 16;
  key.shadow.bias = -0.0004;
  key.position.copy(LIGHT_OFFSET);
  lightRig.add(key, key.target);
  group.add(lightRig);
  let shadowHalf = 0;
  const mean = new THREE.Vector3();

  // The first face is always blue; later ones take the next free colour.
  let colorCursor = 0;
  function pickColor(slot) {
    if (slot.index === 0) return FIRST_COLOR;
    const used = new Set(slots.filter((s) => s.reserved && s !== slot).map((s) => s.colorName));
    for (let i = 0; i < OTHER_COLORS.length; i++) {
      const c = OTHER_COLORS[(colorCursor + i) % OTHER_COLORS.length];
      if (!used.has(c.name)) {
        colorCursor = (colorCursor + i + 1) % OTHER_COLORS.length;
        return c;
      }
    }
    return OTHER_COLORS[0];
  }

  // Call with each NEW detection result. MediaPipe gives no face IDs, only a
  // list in arbitrary order, so each detection is matched to the person it is
  // closest to (in 3D) from the previous frames.
  function setResult(result, nowMs) {
    const mats = (result && result.facialTransformationMatrixes) || [];
    const dets = [];
    for (let i = 0; i < mats.length && i < maxFaces; i++) {
      const data = mats[i].data;
      dets.push({
        pos: new THREE.Vector3(data[12], data[13], data[14]),
        data,
        categories: result.faceBlendshapes && result.faceBlendshapes[i] && result.faceBlendshapes[i].categories,
      });
    }
    const owned = slots.filter((s) => s.reserved);
    const pairs = [];
    for (const s of owned) {
      for (let j = 0; j < dets.length; j++) {
        const dist = s.lastPos.distanceTo(dets[j].pos);
        if (dist < MATCH_MAX_CM) pairs.push({ s, j, dist });
      }
    }
    pairs.sort((a, b) => a.dist - b.dist);
    const slotDone = new Set();
    const detDone = new Set();
    for (const { s, j } of pairs) {
      if (slotDone.has(s) || detDone.has(j)) continue;
      slotDone.add(s);
      detDone.add(j);
      s.setFace(dets[j], nowMs);
    }
    for (const s of owned) if (!slotDone.has(s)) s.setMissing();
    // Anyone new takes the lowest free slot (so a free slot 0 is always blue).
    for (let j = 0; j < dets.length; j++) {
      if (detDone.has(j)) continue;
      const free = slots.find((s) => !s.reserved);
      if (!free) continue; // more people than slots: the extras are ignored
      free.claim(pickColor(free));
      free.setFace(dets[j], nowMs);
    }
  }

  // Call every rendered frame.
  function step(dt, nowMs) {
    dt = Math.min(dt, 0.1);
    for (const s of slots) {
      s.step(dt, nowMs);
      if (s.reserved && nowMs - s.lastSeen > RELEASE_MS) s.release();
    }
    const visible = slots.filter((s) => s.anchor.visible);
    lightRig.visible = visible.length > 0;
    if (visible.length) {
      mean.set(0, 0, 0);
      for (const s of visible) mean.add(s.pos);
      mean.multiplyScalar(1 / visible.length);
      lightRig.position.copy(mean); // follows head positions, not rotations
      let spread = 0;
      for (const s of visible) spread = Math.max(spread, s.pos.distanceTo(mean));
      const half = Math.ceil(Math.min(120, 24 + spread));
      if (half !== shadowHalf) {
        shadowHalf = half;
        const c = key.shadow.camera;
        c.left = c.bottom = -half;
        c.right = c.top = half;
        c.updateProjectionMatrix();
      }
    }
  }

  function applyParams() {
    for (const s of slots) s.applyParams();
  }

  return {
    group,
    slots,
    params: p,
    setResult,
    step,
    applyParams,
    faceCount: () => slots.filter((s) => s.state.faceFound).length,
  };
}
