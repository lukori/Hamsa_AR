import { MindARThree } from "mindar-image-three";
import * as THREE from "three";
// The "?v=" query strings below are a manual cache-buster: GitHub Pages
// caches static files for 10 minutes (and phone browsers often longer), so
// without a unique URL per version, a device that already loaded the app
// once can keep running stale JS after a deploy. Bump this number whenever
// config.js or sceneBuilder.js changes.
import { triggers } from "./config.js?v=20";
import { buildAnchorContent } from "./sceneBuilder.js?v=14";

// Same problem, same fix, separate counter: targets.mind has no version in
// its own contents to detect staleness by, so every recompile needs this
// bumped too, or a device that already opened the app can keep matching
// against old trigger images (this bit us once - two brand new trigger
// images "didn't load" because the phone was still holding a cached
// targets.mind from before they existed).
const MIND_VERSION = 9;

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
    const members = [];

    // Triggers sharing a `group` in config.js (e.g. several photos of the
    // same print under different lighting, all leading to the same content)
    // would otherwise each show their own copy of it whenever more than one
    // image variant matches at once - they look nearly identical, so that's
    // likely. Only one member per group is allowed to show at a time. A member
    // that's actually tracked right now beats one that's only being held
    // through a lost-tracking grace period (see `lostGraceMs` below); among
    // equals, the one already showing keeps it, else the first one found.
    const groups = {};
    function refreshGroup(name) {
      const ms = groups[name];
      const winner =
        ms.find((m) => m.shown && m.live) ||
        ms.find((m) => m.live) ||
        ms.find((m) => m.shown && m.grace) ||
        ms.find((m) => m.grace);
      for (const m of ms) {
        m.shown = m === winner;
        m.content.visible = m.shown;
      }
    }

    function pauseIfConfigured(member) {
      if (member.config.onLost === "pause") member.videos.forEach((v) => v.pause());
    }

    for (const triggerConfig of triggers) {
      const anchor = mindarThree.addAnchor(triggerConfig.targetIndex);
      // Content goes in its own child group (not anchor.group directly) so
      // visibility can be toggled here without fighting MindAR, which
      // manages anchor.group's own visibility on found/lost.
      const content = new THREE.Group();
      anchor.group.add(content);
      const { videos, updaters, mixers } = await buildAnchorContent(content, triggerConfig);

      allVideos.push(...videos);
      allUpdaters.push(...updaters);
      allMixers.push(...mixers);

      const member = {
        anchor,
        content,
        videos,
        config: triggerConfig,
        graceMs: triggerConfig.lostGraceMs ?? 0,
        live: false, // MindAR is tracking this image right now
        grace: false, // tracking just dropped; content is held frozen for graceMs
        graceUntil: 0,
        lastMatrix: new THREE.Matrix4(),
        shown: false,
      };
      members.push(member);
      if (triggerConfig.group) {
        (groups[triggerConfig.group] ??= []).push(member);
        content.visible = false;
      }

      anchor.onTargetFound = () => {
        member.live = true;
        member.grace = false;
        if (triggerConfig.group) refreshGroup(triggerConfig.group);
        if (triggerConfig.onFound === "play") {
          videos.forEach((v) => v.play().catch(() => {}));
        }
      };
      anchor.onTargetLost = () => {
        member.live = false;
        if (member.graceMs > 0) {
          member.grace = true;
          member.graceUntil = performance.now() + member.graceMs;
        } else {
          pauseIfConfigured(member);
        }
        if (triggerConfig.group) refreshGroup(triggerConfig.group);
      };
    }

    // Lost-tracking grace period (`lostGraceMs` in config.js, off by default).
    // MindAR hides an anchor's content the instant tracking drops and resets
    // its pose, and an image with few trackable features (like the text
    // panel) drops tracking for a frame or two constantly even when it's
    // still in view - which reads as the content flickering away. For
    // members with a grace period, remember the last live pose each frame,
    // and for graceMs after a loss keep showing the content frozen at that
    // pose; if tracking comes back in time (onTargetFound) MindAR takes over
    // again, otherwise it disappears as normal once the time is up.
    function updateGrace() {
      const now = performance.now();
      for (const m of members) {
        if (m.live) {
          if (m.graceMs > 0) m.lastMatrix.copy(m.anchor.group.matrix);
        } else if (m.grace) {
          if (now < m.graceUntil) {
            m.anchor.group.visible = true;
            m.anchor.group.matrix.copy(m.lastMatrix);
          } else {
            m.grace = false;
            m.anchor.group.visible = false;
            pauseIfConfigured(m);
            if (m.config.group) refreshGroup(m.config.group);
          }
        }
      }
    }

    startScreen.classList.add("hidden");
    await mindarThree.start();

    clock.start();
    renderer.setAnimationLoop(() => {
      const elapsed = clock.getElapsedTime();
      const delta = clock.getDelta();
      allUpdaters.forEach((update) => update(elapsed));
      allMixers.forEach((mixer) => mixer.update(delta));
      updateGrace();
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
