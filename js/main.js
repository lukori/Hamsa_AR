import { MindARThree } from "mindar-image-three";
import * as THREE from "three";
// The "?v=" query strings below are a manual cache-buster: GitHub Pages
// caches static files for 10 minutes (and phone browsers often longer), so
// without a unique URL per version, a device that already loaded the app
// once can keep running stale JS after a deploy. Bump this number whenever
// config.js or sceneBuilder.js changes.
import { triggers } from "./config.js?v=13";
import { buildAnchorContent } from "./sceneBuilder.js?v=13";

// Same problem, same fix, separate counter: targets.mind has no version in
// its own contents to detect staleness by, so every recompile needs this
// bumped too, or a device that already opened the app can keep matching
// against old trigger images (this bit us once - two brand new trigger
// images "didn't load" because the phone was still holding a cached
// targets.mind from before they existed).
const MIND_VERSION = 4;

const startScreen = document.getElementById("start-screen");
const startButton = document.getElementById("start-button");
const errorScreen = document.getElementById("error-screen");
const errorMessage = document.getElementById("error-message");
const container = document.getElementById("ar-container");

const clock = new THREE.Clock();
let started = false;

function showError(message) {
  errorMessage.textContent = message;
  errorScreen.classList.remove("hidden");
  startScreen.classList.add("hidden");
}

async function startExperience() {
  if (started) return;
  started = true;
  startButton.disabled = true;
  startButton.textContent = "Starting…";

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError(
      "Camera access isn't available in this browser. Open this page in Safari (iOS) or Chrome (Android)."
    );
    started = false;
    startButton.disabled = false;
    startButton.textContent = "Start Experience";
    return;
  }

  try {
    const mindarThree = new MindARThree({
      container,
      imageTargetSrc: `assets/targets.mind?v=${MIND_VERSION}`,
      maxTrack: triggers.length,
      uiLoading: "no",
      uiScanning: "no",
      uiError: "no",
      // MindAR smooths tracked pose with a OneEuroFilter; its defaults
      // (filterMinCF: 0.001, filterBeta: 1000) favor responsiveness over
      // smoothness, which reads as jitter/shake on anchored content -
      // especially noticeable on trigger-05's model since it's also
      // spinning, so any pose noise compounds with real rotation. Lowering
      // both trades a bit of lag (when you move the phone quickly) for a
      // much steadier hold. Tune further here if it still feels off.
      filterMinCF: 0.0001,
      filterBeta: 10,
    });
    const { renderer, scene, camera } = mindarThree;

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.2));
    scene.add(new THREE.DirectionalLight(0xffffff, 0.8));

    const allVideos = [];
    const allUpdaters = [];
    const allMixers = [];

    for (const triggerConfig of triggers) {
      const anchor = mindarThree.addAnchor(triggerConfig.targetIndex);
      const { videos, updaters, mixers } = await buildAnchorContent(anchor.group, triggerConfig);

      allVideos.push(...videos);
      allUpdaters.push(...updaters);
      allMixers.push(...mixers);

      anchor.onTargetFound = () => {
        if (triggerConfig.onFound === "play") {
          videos.forEach((v) => v.play().catch(() => {}));
        }
      };
      anchor.onTargetLost = () => {
        if (triggerConfig.onLost === "pause") {
          videos.forEach((v) => v.pause());
        }
      };
    }

    startScreen.classList.add("hidden");
    await mindarThree.start();

    clock.start();
    renderer.setAnimationLoop(() => {
      const elapsed = clock.getElapsedTime();
      const delta = clock.getDelta();
      allUpdaters.forEach((update) => update(elapsed));
      allMixers.forEach((mixer) => mixer.update(delta));
      renderer.render(scene, camera);
    });
  } catch (err) {
    console.error("Failed to start AR experience", err);
    showError(
      "Couldn't start the camera. Make sure you allowed camera access, then reload the page and try again."
    );
    started = false;
    startButton.disabled = false;
    startButton.textContent = "Start Experience";
  }
}

startButton.addEventListener("click", startExperience);
