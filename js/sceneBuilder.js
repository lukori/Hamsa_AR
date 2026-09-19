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
    if (item.type === "video") {
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
    } else {
      console.warn(`Unknown content type "${item.type}" in ${triggerConfig.id}`);
    }
  }

  return { videos, updaters, mixers };
}
