import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// Shared by the page and by tests: renderer settings + the scene's base lighting
// (soft ambient light and an environment map for the gentle highlights).
// The key light that casts the object's shadow lives in filter.js, because it
// follows the head.
export function createScene(renderer) {
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap; // blurred (soft) edges
  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x666677, 0.5));
  return scene;
}
