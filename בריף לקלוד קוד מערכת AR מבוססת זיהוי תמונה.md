# Brief for Claude Code: Image-Triggered AR System

2026-09-18 · @Someone

## Purpose and Scope

The system delivers an AR experience in the browser: a physical image acts as a trigger, the camera recognizes it in real time, and digital content (video, a 3D object, animation, or a combination) is displayed above it and stays anchored to it in space (6DoF tracking). When the user moves relative to the image, the content moves with it; it doesn't stay fixed on the screen.

Scope of the first version:

- Browser only (WebAR), including iOS Safari and Android Chrome, with no separate app to install.
- 1 to 5 fixed trigger images, each with its own AR content.
- No management tool (CMS) and no interface for an end user to upload new images or content. Adding a new trigger is done in code, by editing a configuration file.
- No GPS or geofencing. "Location" here means anchoring the content in space to the image itself (image anchoring), not a geographic location.

## Recommended Tech Stack

**MindAR.js + three.js**

- MindAR.js: an open-source library (MIT), free, fully self-hosted. No dependency on a license or an external service.
- Performs real feature-based image tracking: computes the image's position, angle, and scale relative to the camera every frame, not just a one-time detection.
- Supports multi-target: all 1 to 5 images are compiled into a single `.mind` file, and the system detects which one is in view.
- Works with three.js for 3D rendering (full control) or A-Frame (faster for prototyping). three.js is recommended given the need for precise control over placement and animations.
- Based on direct camera access (`getUserMedia`) rather than WebXR, so it works on both iOS Safari and Android Chrome.

**What not to use**

- WebXR (including its Image Tracking module): not supported on iOS Safari as of 2026, only on Chrome/Android and visionOS. Rules out cross-platform use in the browser.
- 8th Wall: in the process of shutting down (developer access closes February 2026), not a stable base for a new project.
- Adobe Aero: fully discontinued (November-December 2025), no longer relevant as a platform.

**Future alternative**: if commercial scale or more advanced features (world tracking, multi-project management) are needed later, the Zappar Universal AR SDK (`@zappar/zappar-threejs`) is the next direction, but it involves licensing above a certain usage threshold.

## Background: Timeline of the Landscape

| Date | Event |
| --- | --- |
| Nov-Dec 2025 | Adobe Aero is removed from app stores, its files stop working, data is deleted |
| Feb 2026 | 8th Wall (Niantic) closes new developer access; existing projects keep running until Feb 2027 |
| 2026 | ZapWorks/Zappar keep developing (Multi-Image Tracking, AI Assistant), remain a valid commercial option |

The practical conclusion: choosing a closed platform (Aero, 8th Wall) exposes the project to shutdown risk. MindAR.js, being open-source and self-hosted, does not depend on an external vendor's business decision.

## Configuration Architecture

Each trigger is defined as a single configuration object, instead of separate code for each image. This makes it possible to add a sixth trigger later without touching the core logic, and makes a future move to a management tool easier if ever needed.

Proposed structure for each trigger:

```js
{
  id: "trigger-01",
  targetIndex: 0, // index in the targets.mind file
  content: [
    { type: "video", src: "assets/videos/01.mp4", width: 1, height: 1, loop: true },
    { type: "model", src: "assets/models/01.glb", position: [0, 0, 0.2], scale: 0.3, animation: "idle" }
  ],
  onFound: "play",  // what happens when the image is detected
  onLost: "pause"    // what happens when the image leaves the frame
}
```

An array of 1 to 5 such objects is loaded at init, and each gets its own anchor group that receives the transform from the tracker. The scene-building logic (loading a model, creating a video texture, etc.) is written once, generically, and takes the relevant object as a parameter.

## Handling Content Types

**Video**

- Loaded as a texture on a plane sized to match the image.
- `muted` and `playsinline` are required for autoplay to work on mobile; sound requires an explicit user interaction (a button).
- Play/pause should be tied to the tracker's `targetFound` / `targetLost` events: stop when the image leaves the frame.

**3D object in space**

- The center of the image is the origin (0,0,0), the image plane is the XY plane, a positive Z value lifts the object above the image.
- Models (GLB/GLTF) need a low polygon count and compressed textures (Draco/Meshopt): the device is already busy tracking the image in real time, and a heavy model hurts both FPS and tracking accuracy itself.

**Animation**

- Skeletal animation inside a GLTF file: played through three.js's `AnimationMixer`.
- Procedural animation (rotation, hovering, scaling): written directly in code.
- A frame sequence / spritesheet: simplest to convert to a transparent video (WebM with an alpha channel) and handle it like the video section above.

**Combination**

- All content types are children of the same anchor group, so they move in full sync with each other. A video can sit on the image plane while a 3D model animates and floats above it at the same time.

## Critical Technical Constraints

- **HTTPS is required**: camera access in the browser requires a secure connection. Hosting on Vercel, Netlify, or GitHub Pages provides this automatically; don't build a dependency on a custom server without SSL.
- **Permissions on iOS**: there is a separate prompt for the camera and for motion sensors (DeviceMotion). An explicit "Start Experience" button that the user taps is required; don't try to start automatically on page load, since that silently gets stuck on iPhone.
- **Performance**: keep polygon count and texture resolution low for 3D models, so they don't hurt the frame rate of the image tracking itself.
- **Trigger image design**: the image needs to be rich in detail and contrast, not symmetric or repetitive, and not on a glossy or reflective surface. An image weak in features will drop out of tracking easily.

## Proposed File Structure

```
/
  index.html
  /js
    main.js        // MindAR init, camera, render loop
    config.js       // array of trigger configurations (see Configuration section)
    sceneBuilder.js  // generic logic: builds an anchor group from a configuration object
  /assets
    targets.mind     // compiled file of all trigger images
    /targets-source   // source images before compilation, kept for reference
    /models           // GLB files
    /videos           // MP4/WebM files
```

A fully static project, with no backend. Recommended hosting: Vercel or Netlify (automatic HTTPS, direct deploy from git).

## Preparing Trigger Images and Testing

- Capture/export each trigger image at high resolution, and test it in MindAR's compiler tool before integrating it into the code.
- Cannot be tested in a simulator: the trigger image needs to be printed or displayed physically and tested on a real device.
- Test checklist for each trigger: different lighting (strong, weak, mixed), different angles and distances from the image, partial occlusion of the image, and relatively fast movement relative to the image.
- Test on both iPhone and Android, since permission behavior (camera, motion) differs between them.
