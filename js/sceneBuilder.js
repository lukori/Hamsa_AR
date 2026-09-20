import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

const BLENDING_MODES = {
  additive: THREE.AdditiveBlending,
  multiply: THREE.MultiplyBlending,
  subtract: THREE.SubtractiveBlending,
  normal: THREE.NormalBlending,
};

// Shader that splits a side-by-side packed video (RGB on the left half,
// grayscale alpha mask on the right half) into a proper transparent texture.
const alphaVideoVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const alphaVideoFragmentShader = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  void main() {
    vec2 colorUv = vec2(vUv.x * 0.5, vUv.y);
    vec2 alphaUv = vec2(vUv.x * 0.5 + 0.5, vUv.y);
    vec3 color = texture2D(map, colorUv).rgb;
    float alpha = texture2D(map, alphaUv).r;
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

function makeVideoElement(src, loop) {
  const video = document.createElement("video");
  video.src = src;
  video.crossOrigin = "anonymous";
  video.loop = loop !== false;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.preload = "auto";
  return video;
}

function buildVideoItem(item) {
  const video = makeVideoElement(item.src, item.loop);
  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(item.width ?? 1, item.height ?? 1);
  const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const mesh = new THREE.Mesh(geometry, material);
  if (item.position) mesh.position.set(...item.position);
  if (item.rotation) mesh.rotation.set(...item.rotation);
  return { mesh, video };
}

function buildAlphaVideoItem(item) {
  const video = makeVideoElement(item.src, item.loop);
  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(item.width ?? 1, item.height ?? 1);
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: texture } },
    vertexShader: alphaVideoVertexShader,
    fragmentShader: alphaVideoFragmentShader,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  if (item.position) mesh.position.set(...item.position);
  if (item.rotation) mesh.rotation.set(...item.rotation);
  return { mesh, video };
}

// A soft-edged vignette instead of a hard-edged rectangle: fades to fully
// transparent well before the plane's actual bounds, so it reads as an
// ambient glow/void behind other content rather than a visible "screen" -
// a hard rectangle behind a rotating object reads as "video playing in a
// frame" even when the object itself has real depth.
const radialBackdropVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const radialBackdropFragmentShader = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  uniform float softness;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float alpha = smoothstep(1.0, softness, d);
    gl_FragColor = vec4(color, alpha * opacity);
  }
`;

// Reused for the vignette backdrop and for the cheap eye-rain "shadow"
// decals below - a soft circular falloff with no sprite texture needed.
function makeRadialGlowMaterial(color, opacity = 1, softness = 0.15) {
  return new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(color) },
      opacity: { value: opacity },
      softness: { value: softness },
    },
    vertexShader: radialBackdropVertexShader,
    fragmentShader: radialBackdropFragmentShader,
    transparent: true,
    depthWrite: false,
  });
}

function buildBackdropItem(item) {
  const geometry = new THREE.PlaneGeometry(item.width ?? 1, item.height ?? 1);
  const color = new THREE.Color(item.color ?? 0xffffff);
  const material = item.radial
    ? makeRadialGlowMaterial(color, 1, 0.15)
    : new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  if (item.position) mesh.position.set(...item.position);
  if (item.rotation) mesh.rotation.set(...item.rotation);
  return { mesh };
}

// A field of camera-facing sprites (same source image, varying size and 3D
// position) filling an imaginary box in front of the trigger image - e.g.
// "a rain of eyes". The box's back face sits on the image plane (the image
// is "one wall of the box"); everything else floats in front of it, toward
// the viewer. Arranged on a jittered 3D grid (not pure random) so it reads
// as an organized, immersive scatter rather than a messy cloud - a
// stratified/jittered grid is the standard way to get "random-looking but
// not clumpy" placement. Each sprite optionally gets a soft circular
// "shadow" decal on the wall behind it (a small offset dark blob, not a
// real dynamic shadow - camera-facing billboards don't have normals for
// real shadow-mapping to work with, and it isn't worth the render cost
// here anyway), suggesting a light source in front of the box.
//
// `fallSpeed` (box-height units/sec) makes every instance continuously
// drop and wrap back to the top once it passes the bottom, like a
// perpetual rain/Matrix-code effect - each instance keeps its own fixed
// starting phase, so they wrap independently rather than in lockstep, and
// `fallSpeedVariance` randomizes each instance's rate a bit so they don't
// all move in unison either.
function buildSpriteRainItem(item) {
  const group = new THREE.Group();

  const texture = new THREE.TextureLoader().load(item.src);
  texture.colorSpace = THREE.SRGBColorSpace;

  const boxWidth = item.boxWidth ?? 1;
  const boxHeight = item.boxHeight ?? 3;
  const boxDepth = item.boxDepth ?? 0.8;
  const rows = item.rows ?? 6;
  const cols = item.cols ?? 3;
  const depthLayers = item.depthLayers ?? 2;
  const minScale = item.minScale ?? 0.09;
  const maxScale = item.maxScale ?? 0.22;
  const wallZ = item.wallZ ?? 0.02; // just in front of the image plane, avoids z-fighting
  const jitter = item.jitter ?? 0.55; // fraction of cell size
  const castShadow = item.shadow !== false;
  const shadowOpacity = item.shadowOpacity ?? 0.3;
  const shadowOffset = item.shadowOffset ?? [0.02, -0.025];
  const fallSpeed = item.fallSpeed ?? 0; // 0 = static, no animation
  const fallSpeedVariance = item.fallSpeedVariance ?? 0.25; // +/- fraction of fallSpeed

  const cellW = boxWidth / cols;
  const cellH = boxHeight / rows;
  const cellD = boxDepth / depthLayers;
  const topY = boxHeight / 2;

  const shadowMaterial = castShadow ? makeRadialGlowMaterial(0x000000, shadowOpacity, 0.05) : null;
  const shadowGeometry = castShadow ? new THREE.PlaneGeometry(1, 1) : null;
  // Shared across every sprite instance - they're visually identical, only
  // position/scale differ (those live on the Object3D, not the material),
  // so one instance avoids needless material/texture duplication.
  const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });

  const instances = [];

  for (let k = 0; k < depthLayers; k++) {
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const cx = -boxWidth / 2 + cellW * (j + 0.5);
        const cy = topY - cellH * (i + 0.5); // top row first = rain falls top to bottom
        const cz = wallZ + cellD * (k + 0.5);

        const x = cx + (Math.random() - 0.5) * cellW * jitter;
        const y0 = cy + (Math.random() - 0.5) * cellH * jitter;
        const z = cz + (Math.random() - 0.5) * cellD * jitter;

        // Slightly smaller the further back, on top of independent random
        // size variance - both size AND depth vary, per the brief for this.
        const depthT = (z - wallZ) / boxDepth;
        const scale = (minScale + Math.random() * (maxScale - minScale)) * (1 - depthT * 0.25);

        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.setScalar(scale);
        sprite.position.set(x, y0, z);
        group.add(sprite);

        let shadowMesh = null;
        if (castShadow) {
          shadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial);
          shadowMesh.scale.setScalar(scale * 1.4);
          shadowMesh.position.set(x + shadowOffset[0], y0 + shadowOffset[1], wallZ * 0.4);
          group.add(shadowMesh);
        }

        if (fallSpeed > 0) {
          instances.push({
            sprite,
            shadowMesh,
            phase: topY - y0, // how far below the top this instance starts
            speed: fallSpeed * (1 + (Math.random() * 2 - 1) * fallSpeedVariance),
          });
        }
      }
    }
  }

  if (item.position) group.position.set(...item.position);
  if (item.rotation) group.rotation.set(...item.rotation);

  const update =
    fallSpeed > 0
      ? (elapsed) => {
          for (const inst of instances) {
            const fallen = (inst.phase + elapsed * inst.speed) % boxHeight;
            const y = topY - fallen;
            inst.sprite.position.y = y;
            if (inst.shadowMesh) inst.shadowMesh.position.y = y + shadowOffset[1];
          }
        }
      : null;

  return { mesh: group, update };
}

const PRIMITIVE_GEOMETRIES = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  sphere: () => new THREE.SphereGeometry(0.6, 32, 32),
  torusKnot: () => new THREE.TorusKnotGeometry(0.4, 0.14, 128, 16),
  icosahedron: () => new THREE.IcosahedronGeometry(0.6, 0),
  octahedron: () => new THREE.OctahedronGeometry(0.6, 0),
};

function buildPrimitiveItem(item) {
  const makeGeometry = PRIMITIVE_GEOMETRIES[item.geometry] || PRIMITIVE_GEOMETRIES.box;
  const geometry = makeGeometry();
  const material = new THREE.MeshStandardMaterial({
    color: item.color ?? 0xffffff,
    metalness: 0.2,
    roughness: 0.35,
  });
  const mesh = new THREE.Mesh(geometry, material);
  const scale = item.scale ?? 1;
  mesh.scale.setScalar(scale);
  if (item.position) mesh.position.set(...item.position);
  const baseY = item.position ? item.position[1] : 0;
  const update =
    item.animation === "spin-bob"
      ? (elapsed) => {
          mesh.rotation.y = elapsed * 1.2;
          mesh.rotation.x = Math.sin(elapsed * 0.8) * 0.2;
          mesh.position.y = baseY + Math.sin(elapsed * 1.6) * 0.03;
        }
      : null;
  return { mesh, update };
}

// Per-particle "shift" data (phase/phase/frequency/amplitude) drives a tiny
// circular drift for every point, so the cloud shimmers in place instead of
// looking like a rigid object when it spins, and an optional core/outer
// color gradient by distance from center - technique and default palette
// (amber core -> violet outer) adapted from a reference particle-galaxy demo
// (onBeforeCompile injection into PointsMaterial's built-in shader).
// `blending: "additive"` matches that reference's glow look (bright colors
// on a dark backdrop); leave it unset for a flat, opaque color on a light
// backdrop instead, since additive washes out against white.
function buildPointsMaterial(item, gradientRadius) {
  const gu = { time: { value: 0 } };
  const useGradient = !!(item.colorCore && item.colorOuter);
  const additive = item.blending === "additive";

  const materialOptions = {
    size: item.pointSize ?? 0.01,
    sizeAttenuation: true,
    transparent: true,
    opacity: item.opacity ?? 1,
    depthWrite: item.depthWrite ?? false,
    depthTest: item.depthTest ?? !additive,
  };
  if (additive) materialOptions.blending = THREE.AdditiveBlending;
  if (!useGradient) materialOptions.color = item.color ?? 0x000000;
  const material = new THREE.PointsMaterial(materialOptions);

  material.onBeforeCompile = (shader) => {
    shader.uniforms.time = gu.time;

    let vertexShader = `
      uniform float time;
      attribute float sizes;
      attribute vec4 shift;
      ${shader.vertexShader}
    `;
    if (useGradient) {
      shader.uniforms.colorCore = { value: new THREE.Color(item.colorCore) };
      shader.uniforms.colorOuter = { value: new THREE.Color(item.colorOuter) };
      shader.uniforms.gradientRadius = { value: gradientRadius };
      vertexShader = `
        uniform vec3 colorCore;
        uniform vec3 colorOuter;
        uniform float gradientRadius;
        varying vec3 vGradColor;
        ${vertexShader}
      `.replace(
        "#include <color_vertex>",
        `#include <color_vertex>
          float d = clamp(length(position) / gradientRadius, 0.0, 1.0);
          vGradColor = mix(colorCore, colorOuter, d);
        `
      );
    }
    shader.vertexShader = vertexShader
      .replace("gl_PointSize = size;", "gl_PointSize = size * sizes;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
          float moveT = mod(shift.x + shift.z * time, PI2);
          float moveS = mod(shift.y + shift.z * time, PI2);
          transformed += vec3(cos(moveS) * sin(moveT), cos(moveT), sin(moveS) * sin(moveT)) * shift.w;
        `
      );

    // Soft circular sprite instead of a hard square dot, via alpha falloff
    // from the point's center - no sprite texture needed.
    let fragmentShader = useGradient
      ? `varying vec3 vGradColor;\n${shader.fragmentShader}`
      : shader.fragmentShader;
    fragmentShader = fragmentShader.replace(
      "vec4 diffuseColor = vec4( diffuse, opacity );",
      useGradient
        ? `
            float d = length(gl_PointCoord.xy - 0.5);
            vec4 diffuseColor = vec4( vGradColor, opacity * smoothstep(0.5, 0.15, d) );
          `
        : `
            float d = length(gl_PointCoord.xy - 0.5);
            vec4 diffuseColor = vec4( diffuse, opacity * smoothstep(0.5, 0.15, d) );
          `
    );
    shader.fragmentShader = fragmentShader;
  };

  return { material, gu };
}

async function buildPointsItem(item) {
  const buffer = await fetch(item.src).then((r) => r.arrayBuffer());
  const positions = new Float32Array(buffer);
  const count = positions.length / 3;

  const sizes = new Float32Array(count);
  const shift = new Float32Array(count * 4);
  const driftAmount = item.driftAmount ?? 0.015;
  for (let i = 0; i < count; i++) {
    sizes[i] = Math.random() * 0.6 + 0.6; // 0.6 - 1.2x per-point size variance
    shift[i * 4 + 0] = Math.random() * Math.PI; // phase T
    shift[i * 4 + 1] = Math.random() * Math.PI * 2; // phase S
    shift[i * 4 + 2] = (Math.random() * 0.9 + 0.1) * 0.3; // drift frequency
    shift[i * 4 + 3] = (Math.random() * 0.7 + 0.3) * driftAmount; // drift amplitude
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("sizes", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("shift", new THREE.BufferAttribute(shift, 4));
  geometry.computeBoundingSphere();

  const gradientRadius = item.gradientRadius ?? geometry.boundingSphere.radius;
  const { material, gu } = buildPointsMaterial(item, gradientRadius);
  const points = new THREE.Points(geometry, material);
  const scale = item.scale ?? 1;
  points.scale.setScalar(scale);
  if (item.position) points.position.set(...item.position);
  if (item.rotation) points.rotation.set(...item.rotation);

  const spinSpeed = item.animation === "spin" ? item.spinSpeed ?? 0.6 : 0;
  const driftSpeed = item.driftSpeed ?? 0.2;
  const update = (elapsed) => {
    gu.time.value = elapsed * Math.PI * driftSpeed;
    if (spinSpeed) points.rotation.y = elapsed * spinSpeed;
  };
  return { mesh: points, update };
}

async function buildModelItem(item) {
  const gltf = await gltfLoader.loadAsync(item.src);
  const model = gltf.scene;
  const scale = item.scale ?? 1;
  model.scale.setScalar(scale);
  if (item.position) model.position.set(...item.position);
  if (item.rotation) model.rotation.set(...item.rotation);

  if (item.blending && BLENDING_MODES[item.blending]) {
    model.traverse((obj) => {
      if (!obj.isMesh) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach((m) => {
        m.blending = BLENDING_MODES[item.blending];
        m.transparent = true;
        m.depthWrite = item.depthWrite ?? false;
      });
    });
  }

  let mixer = null;
  let update = null;
  if (item.animation === "spin") {
    // Procedural spin, same convention as "primitive"/"points" - used when
    // the GLB has no baked-in animation of its own (or you just want a
    // simple turntable regardless of what clips it has).
    const spinSpeed = item.spinSpeed ?? 0.6;
    update = (elapsed) => {
      model.rotation.y = elapsed * spinSpeed;
    };
  } else if (gltf.animations && gltf.animations.length > 0) {
    mixer = new THREE.AnimationMixer(model);
    const clip =
      (item.animation && gltf.animations.find((a) => a.name === item.animation)) ||
      gltf.animations[0];
    if (clip) mixer.clipAction(clip).play();
  }
  return { mesh: model, mixer, update };
}

// Builds every content item for one trigger, adds them to the anchor group,
// and returns handles used by main.js to play/pause media and drive the
// per-frame update loop (procedural animation, AnimationMixer ticks, etc).
export async function buildAnchorContent(group, triggerConfig) {
  const videos = [];
  const updaters = [];
  const mixers = [];

  for (const item of triggerConfig.content) {
    if (item.type === "backdrop") {
      const { mesh } = buildBackdropItem(item);
      group.add(mesh);
    } else if (item.type === "video") {
      const { mesh, video } = buildVideoItem(item);
      group.add(mesh);
      videos.push(video);
    } else if (item.type === "alpha-video") {
      const { mesh, video } = buildAlphaVideoItem(item);
      group.add(mesh);
      videos.push(video);
    } else if (item.type === "primitive") {
      const { mesh, update } = buildPrimitiveItem(item);
      group.add(mesh);
      if (update) updaters.push(update);
    } else if (item.type === "model") {
      const { mesh, mixer, update } = await buildModelItem(item);
      group.add(mesh);
      if (mixer) mixers.push(mixer);
      if (update) updaters.push(update);
    } else if (item.type === "points") {
      const { mesh, update } = await buildPointsItem(item);
      group.add(mesh);
      if (update) updaters.push(update);
    } else if (item.type === "sprite-rain") {
      const { mesh, update } = buildSpriteRainItem(item);
      group.add(mesh);
      if (update) updaters.push(update);
    } else {
      console.warn(`Unknown content type "${item.type}" in ${triggerConfig.id}`);
    }
  }

  return { videos, updaters, mixers };
}
