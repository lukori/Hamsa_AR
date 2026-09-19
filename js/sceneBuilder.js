import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const gltfLoader = new GLTFLoader();

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
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float alpha = smoothstep(1.0, 0.15, d);
    gl_FragColor = vec4(color, alpha);
  }
`;

function buildBackdropItem(item) {
  const geometry = new THREE.PlaneGeometry(item.width ?? 1, item.height ?? 1);
  const color = new THREE.Color(item.color ?? 0xffffff);
  const material = item.radial
    ? new THREE.ShaderMaterial({
        uniforms: { color: { value: color } },
        vertexShader: radialBackdropVertexShader,
        fragmentShader: radialBackdropFragmentShader,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    : new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  if (item.position) mesh.position.set(...item.position);
  if (item.rotation) mesh.rotation.set(...item.rotation);
  return { mesh };
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

  let mixer = null;
  if (gltf.animations && gltf.animations.length > 0) {
    mixer = new THREE.AnimationMixer(model);
    const clip =
      (item.animation && gltf.animations.find((a) => a.name === item.animation)) ||
      gltf.animations[0];
    if (clip) mixer.clipAction(clip).play();
  }
  return { mesh: model, mixer };
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
      const { mesh, mixer } = await buildModelItem(item);
      group.add(mesh);
      if (mixer) mixers.push(mixer);
    } else if (item.type === "points") {
      const { mesh, update } = await buildPointsItem(item);
      group.add(mesh);
      if (update) updaters.push(update);
    } else {
      console.warn(`Unknown content type "${item.type}" in ${triggerConfig.id}`);
    }
  }

  return { videos, updaters, mixers };
}
