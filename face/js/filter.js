import * as THREE from "three";
import { PUPIL_TRAVEL } from "./eye.js";

// Turns MediaPipe Face Landmarker results into (a) the head pose the eye
// object is attached to and (b) where the pupil sits inside the dome.
//
// Conventions (MediaPipe canonical face space, units cm): +X = image right in
// the UNMIRRORED camera frame (the subject's left), +Y up, +Z toward the
// camera. The page shows a mirrored selfie view by flipping everything with
// CSS, so the 3D scene is built in unmirrored camera space.

export const DEFAULT_PARAMS = {
  size: 2.9, // eye object size relative to the real piece (1 = 6.4cm wide)
  dy: -0.55, // cm up from the face model's origin
  dz: 8.5, // cm forward of the face model's origin (nose tip is ~7.5)
  gain: 2.2, // horizontal gaze amplification (blendshape 0..1 -> -1..1)
  gainY: 2.2, // vertical
};

const SHADOW_OPACITY = 0.42; // how dark the soft shadow is
const SHADOW_BLUR = 10; // how soft (VSM blur radius)
const SHADOW_GAP = 3.4; // cm between the object and the surface it shadows
const LIGHT_OFFSET = new THREE.Vector3(14, 30, 30); // key light relative to the head, cm (above-front)
const HOLD_MS = 350; // keep showing the last pose this long after the face is lost
const POSE_TAU = 0.045; // pose smoothing time constant (s); lower = snappier
const SPRING_K = 240; // pupil spring stiffness
const SPRING_DAMPING = 0.62; // damping ratio (<1 = a little googly wobble)
const DEADZONE = 0.03;
const BLINK_HOLD = 0.55; // while blinking, gaze readings are unreliable: freeze

function categoryMap(result) {
  const out = {};
  const cats = result.faceBlendshapes && result.faceBlendshapes[0] && result.faceBlendshapes[0].categories;
  if (cats) for (const c of cats) out[c.categoryName] = c.score;
  return out;
}

export function createFilter(eye, params = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };

  const anchor = new THREE.Group(); // = the head pose
  anchor.matrixAutoUpdate = false;
  anchor.visible = false;
  const placer = new THREE.Group(); // offset + size relative to the head
  anchor.add(placer);
  placer.add(eye.root);

  // Soft shadow of the object on the face/background behind it: an invisible
  // plane (it only shows shadows) a little behind the object, and a light that
  // follows the head from above-front so the shadow falls below the object.
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: SHADOW_OPACITY }));
  catcher.receiveShadow = true;
  anchor.add(catcher);
  const lightRig = new THREE.Group();
  const key = new THREE.DirectionalLight(0xffffff, 1.05);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -24;
  key.shadow.camera.right = key.shadow.camera.top = 24;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 150;
  key.shadow.radius = SHADOW_BLUR;
  key.shadow.blurSamples = 16;
  key.shadow.bias = -0.0004;
  key.position.copy(LIGHT_OFFSET);
  lightRig.add(key, key.target);

  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3(1, 1, 1);
  const tmpM = new THREE.Matrix4();
  const tmpP = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const euler = new THREE.Euler();

  const pendingPose = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1), set: false };
  let havePose = false;
  let lastSeen = -Infinity;
  const target = { x: 0, y: 0 }; // pupil target, mm
  const pupil = { x: 0, y: 0, vx: 0, vy: 0 };
  const state = {
    faceFound: false,
    gx: 0,
    gy: 0,
    nx: 0,
    ny: 0,
    blink: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    shapes: {},
  };

  function applyParams() {
    catcher.position.set(0, p.dy, p.dz - SHADOW_GAP);
    placer.position.set(0, p.dy, p.dz);
    placer.scale.setScalar(0.1 * p.size); // eye space is mm, face space is cm
  }
  applyParams();

  // Call with each NEW detection result (or null when no face was found).
  function setResult(result, nowMs) {
    const matrices = result && result.facialTransformationMatrixes;
    if (!matrices || !matrices.length) {
      state.faceFound = false;
      return;
    }
    state.faceFound = true;
    const reappeared = nowMs - lastSeen > 1000;
    lastSeen = nowMs;

    tmpM.fromArray(matrices[0].data);
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
    }

    const s = categoryMap(result);
    state.shapes = s;
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
    let nx = -dead(state.gx) * p.gain;
    let ny = dead(state.gy) * p.gainY;
    const len = Math.hypot(nx, ny);
    if (len > 1) {
      nx /= len;
      ny /= len;
    }
    state.nx = nx;
    state.ny = ny;
    target.x = nx * PUPIL_TRAVEL;
    target.y = ny * PUPIL_TRAVEL;

    euler.setFromQuaternion(tmpQ, "YXZ");
    state.yaw = THREE.MathUtils.radToDeg(euler.y);
    state.pitch = THREE.MathUtils.radToDeg(euler.x);
    state.roll = THREE.MathUtils.radToDeg(euler.z);
  }

  function dead(v) {
    const a = Math.abs(v);
    return a < DEADZONE ? 0 : Math.sign(v) * (a - DEADZONE);
  }

  // Call every rendered frame.
  function step(dt, nowMs) {
    dt = Math.min(dt, 0.1);
    if (pendingPose.set) {
      const k = 1 - Math.exp(-dt / POSE_TAU);
      pos.lerp(pendingPose.p, k);
      quat.slerp(pendingPose.q, k);
      scl.lerp(pendingPose.s, k);
    }
    anchor.visible = havePose && nowMs - lastSeen < HOLD_MS;
    lightRig.visible = anchor.visible;
    if (anchor.visible) {
      anchor.matrix.compose(pos, quat, scl);
      lightRig.position.copy(pos); // the light follows the head's position, not its rotation
    }

    // Pupil: damped spring toward the gaze target, kept inside the dome.
    const damping = 2 * SPRING_DAMPING * Math.sqrt(SPRING_K);
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      pupil.vx += (SPRING_K * (target.x - pupil.x) - damping * pupil.vx) * h;
      pupil.vy += (SPRING_K * (target.y - pupil.y) - damping * pupil.vy) * h;
      pupil.x += pupil.vx * h;
      pupil.y += pupil.vy * h;
      const r = Math.hypot(pupil.x, pupil.y);
      if (r > PUPIL_TRAVEL) {
        const f = PUPIL_TRAVEL / r;
        pupil.x *= f;
        pupil.y *= f;
        const radial = (pupil.vx * pupil.x + pupil.vy * pupil.y) / PUPIL_TRAVEL ** 2;
        if (radial > 0) {
          pupil.vx -= radial * pupil.x;
          pupil.vy -= radial * pupil.y;
        }
      }
    }
    eye.setPupil(pupil.x, pupil.y);
  }

  return {
    anchor,
    lightRig,
    catcher,
    key,
    params: p,
    state,
    setResult,
    step,
    applyParams,
    pupilMm: () => ({ x: pupil.x, y: pupil.y }),
  };
}
