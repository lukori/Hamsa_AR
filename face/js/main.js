import * as THREE from "three";
import { loadEye } from "./eye.js?v=4";
import { createFaceManager } from "./filter.js?v=5";
import { createScene } from "./scene.js?v=2";

// Pinned: the MediaPipe Tasks Vision bundle + its WASM, and the face model.
const MP_VERSION = "0.10.35";
const MP_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
// Hosted in this folder (a copy of Google's float16 face_landmarker.task, 3.7MB).
const MODEL_URL = "assets/face_landmarker.task?v=1";
// MediaPipe computes the head pose assuming a pinhole camera with this vertical
// field of view, so the 3D camera must use the same one to line up.
const CAMERA_FOV = 63;
// How many people get an eye at once (each is another face for the phone to track).
const MAX_FACES = 3;

const query = new URLSearchParams(location.search);
const debugEnabled = query.has("debug");
const params = {};
for (const [key, name] of [["s", "size"], ["dy", "dy"], ["dz", "dz"], ["gain", "gain"], ["gainy", "gainY"]]) {
  if (query.has(key) && Number.isFinite(parseFloat(query.get(key)))) params[name] = parseFloat(query.get(key));
}

const stage = document.getElementById("stage");
const video = document.getElementById("cam");
const canvas = document.getElementById("gl");
const startScreen = document.getElementById("start-screen");
const startButton = document.getElementById("start-button");
const errorScreen = document.getElementById("error-screen");
const errorMessage = document.getElementById("error-message");

function showError(message) {
  errorMessage.textContent = message;
  errorScreen.classList.remove("hidden");
  startScreen.classList.add("hidden");
}

let started = false;

async function loadLandmarker() {
  const { FaceLandmarker, FilesetResolver } = await import(MP_BUNDLE);
  const fileset = await FilesetResolver.forVisionTasks(MP_WASM);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numFaces: MAX_FACES,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
  try {
    return await FaceLandmarker.createFromOptions(fileset, options("GPU"));
  } catch (err) {
    console.warn("GPU delegate unavailable, falling back to CPU", err);
    return FaceLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  video.srcObject = stream;
  await video.play();
  if (!video.videoWidth) await new Promise((r) => video.addEventListener("loadedmetadata", r, { once: true }));
}

async function startExperience() {
  if (started) return;
  started = true;
  startButton.disabled = true;
  startButton.textContent = "Starting…";

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError("Camera access isn't available in this browser. Open this page in Safari (iOS) or Chrome (Android).");
    return;
  }

  try {
    const [landmarker, eyeFactory] = await Promise.all([
      loadLandmarker(),
      loadEye("assets/hamsa_base.stl?v=1"),
      startCamera(),
    ]);

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    const scene = createScene(renderer);

    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, video.videoWidth / video.videoHeight, 1, 1000);
    const faces = createFaceManager(eyeFactory, params, MAX_FACES);
    scene.add(faces.group);

    function layout() {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const scale = Math.max(innerWidth / vw, innerHeight / vh); // "cover"
      const w = Math.round(vw * scale);
      const h = Math.round(vh * scale);
      stage.style.width = w + "px";
      stage.style.height = h + "px";
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      camera.aspect = vw / vh;
      camera.updateProjectionMatrix();
    }
    layout();
    addEventListener("resize", layout);

    const dbg = debugEnabled ? createDebug({ faces, video }) : null;

    startScreen.classList.add("hidden");

    let lastVideoTime = -1;
    let lastFrame = performance.now();
    renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dt = (now - lastFrame) / 1000;
      lastFrame = now;
      let detectMs = null;
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const t0 = performance.now();
        const result = landmarker.detectForVideo(video, now);
        detectMs = performance.now() - t0;
        faces.setResult(result, now);
      }
      faces.step(dt, now);
      renderer.render(scene, camera);
      if (dbg) dbg.frame(now, dt, detectMs);
    });
  } catch (err) {
    console.error("Failed to start", err);
    const name = err && err.name;
    showError(
      name === "NotAllowedError" || name === "PermissionDeniedError"
        ? "Camera access was blocked. Allow the camera for this page, then reload and try again."
        : name === "NotFoundError" || name === "OverconstrainedError"
          ? "No camera was found on this device."
          : name === "NotReadableError"
            ? "The camera is being used by another app. Close it, then reload and try again."
            : "Couldn't start the face filter. Check your connection, then reload the page and try again."
    );
    started = false;
    startButton.disabled = false;
    startButton.textContent = "Start";
  }
}

// Hidden diagnostic overlay (?debug): live numbers, +/- buttons to tune the
// placement and gaze strength on the phone (the link in the address bar is
// updated so the tuned values can be copied), and Save/Copy log.
function createDebug({ faces, video }) {
  const lines = [];
  const MAX = 30000;
  const t0 = performance.now();
  const stamp = (now) => ((now - t0) / 1000).toFixed(2).padStart(7);
  let fpsFrames = 0;
  let fpsStart = t0;
  let fps = 0;
  let lastDetect = 0;
  let nextUi = 0;
  let nextSample = 0;

  const wrap = document.createElement("div");
  wrap.style.cssText =
    "position:fixed;top:4px;left:4px;z-index:30;max-width:96vw;font:11px/1.35 ui-monospace,Menlo,monospace;pointer-events:none;";
  const pre = document.createElement("pre");
  pre.style.cssText = "margin:0;padding:6px 8px;color:#0f0;background:rgba(0,0,0,0.65);white-space:pre-wrap;";
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;pointer-events:auto;";
  const status = document.createElement("span");
  status.style.cssText = "color:#0f0;background:rgba(0,0,0,0.65);padding:2px 6px;";

  const btn = (label, fn) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "font:600 12px -apple-system,sans-serif;padding:6px 10px;border-radius:8px;border:0;background:#0f0;color:#000;";
    b.addEventListener("click", fn);
    bar.append(b);
    return b;
  };
  const say = (t) => {
    status.textContent = t;
    setTimeout(() => status.textContent === t && (status.textContent = ""), 4000);
  };
  const urlKeys = { size: "s", dy: "dy", dz: "dz", gain: "gain", gainY: "gainy" };
  const adjust = (name, delta) => {
    faces.params[name] = Math.round((faces.params[name] + delta) * 100) / 100;
    faces.applyParams();
    const url = new URL(location.href);
    for (const k in urlKeys) url.searchParams.set(urlKeys[k], faces.params[k]);
    history.replaceState(null, "", url);
    push(`${stamp(performance.now())}s PARAM ${name}=${faces.params[name]}`);
  };
  for (const [name, step] of [["size", 0.1], ["dy", 0.25], ["dz", 0.25], ["gain", 0.2]]) {
    btn(`${name} -`, () => adjust(name, -step));
    btn(`${name} +`, () => adjust(name, step));
  }

  function push(line) {
    lines.push(line);
    if (lines.length > MAX) lines.shift();
  }
  function header() {
    return [
      "Eye filter debug log",
      `saved: ${new Date().toISOString()}`,
      `page: ${location.href}`,
      `userAgent: ${navigator.userAgent}`,
      `screen: ${screen.width}x${screen.height} @${window.devicePixelRatio}x, viewport ${innerWidth}x${innerHeight}`,
      `camera video: ${video.videoWidth}x${video.videoHeight}`,
      `params: ${JSON.stringify(faces.params)}`,
      `lines: ${lines.length}`,
      "",
      "Columns (every 0.25s): t | faces | fps | detect ms | then one block per tracked face (S0 = first, blue): colour gx gy (+ = subject looks right/up) | pupil nx ny (-1..1) | head yaw pitch roll (deg) | blink",
      "",
    ];
  }
  const text = () => header().concat(lines).join("\n") + "\n";

  btn("Save log", async () => {
    const name = `eye-filter-log-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    const file = new File([text()], name, { type: "text/plain" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return say(`shared ${lines.length} lines`);
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    say("downloaded " + name);
  });
  btn("Copy log", async () => {
    try {
      await navigator.clipboard.writeText(text());
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text();
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    say(`copied ${lines.length} lines`);
  });
  bar.append(status);
  wrap.append(pre, bar);
  document.body.appendChild(wrap);

  return {
    frame(now, dt, detectMs) {
      fpsFrames += 1;
      if (detectMs !== null) lastDetect = detectMs;
      if (now - fpsStart >= 1000) {
        fps = Math.round((fpsFrames * 1000) / (now - fpsStart));
        fpsFrames = 0;
        fpsStart = now;
      }
      const active = faces.slots.filter((x) => x.state.faceFound);
      if (now >= nextUi) {
        nextUi = now + 150;
        const rows = active.map((x) => {
          const s = x.state;
          const pm = x.pupilMm();
          return (
            `#${x.index} ${x.colorName.padEnd(6)} gaze ${s.gx.toFixed(2)},${s.gy.toFixed(2)} -> pupil ${s.nx.toFixed(2)},${s.ny.toFixed(2)} (${pm.x.toFixed(1)},${pm.y.toFixed(1)}mm)` +
            ` head ${s.yaw.toFixed(0)}/${s.pitch.toFixed(0)}/${s.roll.toFixed(0)}${s.blink > 0.55 ? " BLINK" : ""}`
          );
        });
        pre.textContent =
          `faces ${active.length}  fps ${fps}  detect ${lastDetect.toFixed(0)}ms  cam ${video.videoWidth}x${video.videoHeight}\n` +
          (rows.length ? rows.join("\n") + "\n" : "no face\n") +
          Object.entries(faces.params).map(([k, v]) => `${k} ${v}`).join("  ");
      }
      if (now >= nextSample) {
        nextSample = now + 250;
        const blocks = active.map((x) => {
          const s = x.state;
          return `S${x.index} ${x.colorName} ${s.gx.toFixed(2)} ${s.gy.toFixed(2)} | ${s.nx.toFixed(2)} ${s.ny.toFixed(2)} | ${s.yaw.toFixed(0)} ${s.pitch.toFixed(0)} ${s.roll.toFixed(0)} | ${s.blink.toFixed(2)}`;
        });
        push(`${stamp(now)}s ${active.length} | ${fps} | ${lastDetect.toFixed(0)}${blocks.length ? " || " + blocks.join(" || ") : ""}`);
      }
    },
  };
}

startButton.addEventListener("click", startExperience);
