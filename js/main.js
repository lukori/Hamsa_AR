import { MindARThree } from "mindar-image-three";
import * as THREE from "three";
// The "?v=" query strings below are a manual cache-buster: GitHub Pages
// caches static files for 10 minutes (and phone browsers often longer), so
// without a unique URL per version, a device that already loaded the app
// once can keep running stale JS after a deploy. Bump this number whenever
// config.js or sceneBuilder.js changes.
import { triggers } from "./config.js?v=22";
import { buildAnchorContent } from "./sceneBuilder.js?v=14";

// Same problem, same fix, separate counter: targets.mind has no version in
// its own contents to detect staleness by, so every recompile needs this
// bumped too, or a device that already opened the app can keep matching
// against old trigger images (this bit us once - two brand new trigger
// images "didn't load" because the phone was still holding a cached
// targets.mind from before they existed).
const MIND_VERSION = 10;

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

    // Hidden diagnostic overlay: open the page with ?debug to see, per
    // trigger, whether it's LIVE (tracked right now), HELD (frozen through the
    // lost-tracking hold), which one is SHOWN, how many times it has been
    // found/lost, and a log of recent switches - to tell which image variants
    // flip-flop in a real gallery.
    const debugEnabled = new URLSearchParams(location.search).has("debug");
    const debugEvents = [];
    function debugLog(text) {
      debugEvents.unshift(`${(performance.now() / 1000).toFixed(1)}s ${text}`);
      if (debugEvents.length > 12) debugEvents.pop();
    }
    let debugEl = null;
    let nextDebugUpdate = 0;
    if (debugEnabled) {
      debugEl = document.createElement("pre");
      debugEl.style.cssText =
        "position:fixed;top:4px;left:4px;z-index:30;margin:0;padding:6px 8px;font:11px/1.35 ui-monospace,Menlo,monospace;color:#0f0;background:rgba(0,0,0,0.65);pointer-events:none;max-width:96vw;white-space:pre-wrap;";
      document.body.appendChild(debugEl);
    }
    function updateDebug(now) {
      if (!debugEl || now < nextDebugUpdate) return;
      nextDebugUpdate = now + 150;
      const rows = members.map((m) => {
        const state = m.live ? "LIVE" : m.grace ? `HELD ${Math.max(0, m.graceUntil - now) | 0}ms` : "-";
        const shown = m.config.group ? m.shown : m.live;
        return `${m.config.id.padEnd(17)} ${state.padEnd(11)} ${shown ? "SHOWN" : "     "}${m.glide ? " glide" : ""}  found${m.founds}/lost${m.losts}`;
      });
      debugEl.textContent = rows.join("\n") + "\n--\n" + debugEvents.join("\n");
    }

    // Poses handed from one trigger's content to another's (a variant switch,
    // or tracking returning after a hold) would otherwise SNAP. `glide`
    // eases the content's world pose from where it was being displayed to the
    // live tracked pose over GLIDE_MS. Poses are compared as the CONTENT's
    // world matrix (anchor matrix x content's own transform), because
    // different triggers have different anchor frames (e.g. the title-block
    // crop has a contentTransform).
    const GLIDE_MS = 300;
    const tmpTarget = new THREE.Matrix4();
    const tmpOut = new THREE.Matrix4();
    const pA = new THREE.Vector3();
    const pB = new THREE.Vector3();
    const qA = new THREE.Quaternion();
    const qB = new THREE.Quaternion();
    const sA = new THREE.Vector3();
    const sB = new THREE.Vector3();
    function blendPose(from, to, t, out) {
      from.decompose(pA, qA, sA);
      to.decompose(pB, qB, sB);
      out.compose(pA.lerp(pB, t), qA.slerp(qB, t), sA.lerp(sB, t));
    }
    function poseWorld(m) {
      return m.shownMatrix.clone().multiply(m.content.matrix);
    }
    function startGlide(member, fromWorld) {
      member.glide = { t0: performance.now(), from: fromWorld };
    }

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
      const prev = ms.find((m) => m.shown);
      const winner =
        ms.find((m) => m.shown && m.live) ||
        ms.find((m) => m.live) ||
        ms.find((m) => m.shown && m.grace) ||
        ms.find((m) => m.grace);
      if (winner && prev && winner !== prev && (prev.live || prev.grace)) {
        startGlide(winner, poseWorld(prev));
        debugLog(`switch ${prev.config.id} -> ${winner.config.id}`);
      }
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
      // Optional `contentTransform` (config.js): for a trigger whose image is
      // only PART of the real print (e.g. a crop of the title block), content
      // authored in whole-print units is shifted/scaled so it still lands
      // centred on the whole print.
      if (triggerConfig.contentTransform) {
        const { position, scale } = triggerConfig.contentTransform;
        if (position) content.position.set(...position);
        if (scale) content.scale.setScalar(scale);
      }
      content.updateMatrix();
      const { videos, updaters, mixers } = await buildAnchorContent(content, triggerConfig);

      allVideos.push(...videos);
      allUpdaters.push(...updaters);
      allMixers.push(...mixers);

      const member = {
        anchor,
        content,
        contentInv: content.matrix.clone().invert(),
        videos,
        config: triggerConfig,
        graceMs: triggerConfig.lostGraceMs ?? 0,
        // Only triggers that opt into the hold or a group get the pose
        // handling below; everything else (the yellow poster) is left
        // exactly as MindAR drives it.
        managed: (triggerConfig.lostGraceMs ?? 0) > 0 || !!triggerConfig.group,
        live: false, // MindAR is tracking this image right now
        grace: false, // tracking just dropped; content is held frozen for graceMs
        graceUntil: 0,
        raw: new THREE.Matrix4(), // latest pose from MindAR while live
        shownMatrix: new THREE.Matrix4(), // pose last actually displayed
        glide: null,
        shown: false,
        founds: 0,
        losts: 0,
      };
      members.push(member);
      if (triggerConfig.group) {
        (groups[triggerConfig.group] ??= []).push(member);
        content.visible = false;
      }

      anchor.onTargetFound = () => {
        const wasHeld = member.grace;
        member.live = true;
        member.grace = false;
        member.founds += 1;
        member.raw.copy(anchor.group.matrix);
        if (triggerConfig.group) refreshGroup(triggerConfig.group);
        if (wasHeld && !member.glide && (!triggerConfig.group || member.shown)) {
          startGlide(member, poseWorld(member));
        }
        debugLog(`${triggerConfig.id} FOUND${wasHeld ? " (re-lock)" : ""}`);
        if (triggerConfig.onFound === "play") {
          videos.forEach((v) => v.play().catch(() => {}));
        }
      };
      anchor.onTargetUpdate = () => {
        if (member.live) member.raw.copy(anchor.group.matrix);
      };
      anchor.onTargetLost = () => {
        member.live = false;
        member.losts += 1;
        if (member.graceMs > 0) {
          member.grace = true;
          member.graceUntil = performance.now() + member.graceMs;
        } else {
          pauseIfConfigured(member);
        }
        debugLog(`${triggerConfig.id} LOST${member.graceMs > 0 ? " (holding)" : ""}`);
        if (triggerConfig.group) refreshGroup(triggerConfig.group);
      };
    }

    // Lost-tracking grace period (`lostGraceMs` in config.js, off by default).
    // MindAR hides an anchor's content the instant tracking drops and resets
    // its pose, and an image with few trackable features (like the text
    // panel) drops tracking for a frame or two constantly even when it's
    // still in view - which reads as the content flickering away. For
    // managed members, keep the last displayed pose, and for graceMs after a
    // loss keep showing the content frozen at that pose; if tracking comes
    // back in time (onTargetFound) it glides to the new pose, otherwise it
    // disappears as normal once the time is up. While live, the displayed
    // pose is the raw tracked pose, or the eased pose during a glide.
    function updatePoses() {
      const now = performance.now();
      for (const m of members) {
        if (!m.managed) continue;
        const g = m.anchor.group;
        if (m.live) {
          if (m.glide) {
            const t = (now - m.glide.t0) / GLIDE_MS;
            if (t >= 1) {
              m.glide = null;
              g.matrix.copy(m.raw);
            } else {
              tmpTarget.copy(m.raw).multiply(m.content.matrix);
              blendPose(m.glide.from, tmpTarget, 1 - Math.pow(1 - t, 3), tmpOut);
              g.matrix.copy(tmpOut).multiply(m.contentInv);
            }
          } else {
            g.matrix.copy(m.raw);
          }
          m.shownMatrix.copy(g.matrix);
        } else if (m.grace) {
          if (now < m.graceUntil) {
            g.visible = true;
            g.matrix.copy(m.shownMatrix);
          } else {
            m.grace = false;
            m.glide = null;
            g.visible = false;
            pauseIfConfigured(m);
            debugLog(`${m.config.id} hold expired`);
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
      updatePoses();
      updateDebug(performance.now());
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
