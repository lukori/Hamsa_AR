import * as THREE from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

// The physical object, modelled from the STL (hand-shaped base plate + ring)
// plus the parts the STL doesn't contain, measured from photos of the real
// piece. All units are millimetres, in "eye space": +X right, +Y up (fingers),
// +Z toward the viewer, origin at the centre of the eye.
//
// From the STL: base plate 2mm thick (front face at z=0), ring inner radius
// 25mm / outer 27mm, 1.2mm high, standing on the front face; plate outline
// 63.7mm wide x 80.1mm tall, eye centre 31.9mm above the bottom.
const DOME_BASE_R = 25; // clear dome fills the ring (ring inner radius)
const DOME_HEIGHT = 4.5; // estimated from the side-view photo
const EYE_WHITE_R = 24.4; // the white backing disc inside the dome
const PUPIL_R = 16; // measured from the front photo (~32mm black disc)
const PUPIL_CLEARANCE = 0.3;
const PLATE_COLOR = 0x87ceeb; // CSS "skyblue" // sky blue (hand + ring); lit it reads as ~#87CEEB

export const PUPIL_TRAVEL = EYE_WHITE_R - PUPIL_R - PUPIL_CLEARANCE;

// Black radial gradient (alpha stops, 0 = centre .. 1 = edge) as a texture.
function radialShade(stops) {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  for (const [at, alpha] of stops) gr.addColorStop(at, `rgba(0,0,0,${alpha})`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 512, 512);
  return new THREE.CanvasTexture(c);
}

export async function createEye(stlUrl) {
  const root = new THREE.Group();

  const plateGeometry = await new STLLoader().loadAsync(stlUrl);
  // STL axes -> eye axes: x' = -x, y' = -z, z' = -y. A proper rotation (det +1,
  // no mirroring): the fingers (STL -Z) point up and the ring (STL -Y) faces
  // the viewer.
  plateGeometry.applyMatrix4(new THREE.Matrix4().set(-1, 0, 0, 0, 0, 0, -1, 0, 0, -1, 0, 0, 0, 0, 0, 1));
  const plate = new THREE.Mesh(
    plateGeometry,
    new THREE.MeshPhysicalMaterial({
      color: PLATE_COLOR,
      emissive: PLATE_COLOR, // a flat lift so the blue stays clean and light in shade
      emissiveIntensity: 0.2,
      roughness: 0.62,
      metalness: 0,
      clearcoat: 0.04,
      clearcoatRoughness: 0.6,
      envMapIntensity: 0.45,
    })
  );
  plate.castShadow = true; // its shadow falls on the shadow catcher behind it (filter.js)
  root.add(plate);

  const eyeWhite = new THREE.Mesh(
    new THREE.CircleGeometry(EYE_WHITE_R, 96),
    new THREE.MeshStandardMaterial({ color: 0xd2d3db, roughness: 0.75 })
  );
  eyeWhite.position.z = 0.1;
  root.add(eyeWhite);

  const pupil = new THREE.Mesh(
    new THREE.CircleGeometry(PUPIL_R, 64),
    new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.55, metalness: 0, specularIntensity: 0.25, envMapIntensity: 0.15 })
  );
  pupil.position.z = 0.35;
  root.add(pupil);

  // Soft contact shading. Seen straight on, the ring has the same colour and
  // faces the same way as the base, so it would be invisible; a real piece reads
  // as raised because of the shadow it casts and the shade inside its wall. A
  // shadow map is too coarse for a 1.2mm step, so these are soft gradient
  // decals (always facing the same way, like the light in filter.js).
  const outerShade = new THREE.Mesh(
    new THREE.CircleGeometry(34, 96),
    new THREE.MeshBasicMaterial({
      map: radialShade([[0, 0], [27 / 34, 0], [27.2 / 34, 0.3], [31.5 / 34, 0.06], [1, 0]]),
      transparent: true,
      depthWrite: false,
    })
  );
  outerShade.position.set(-0.5, -1.1, 0.03); // pushed away from the light, like the real shadow
  root.add(outerShade);
  const innerShade = new THREE.Mesh(
    new THREE.CircleGeometry(EYE_WHITE_R, 96),
    new THREE.MeshBasicMaterial({
      map: radialShade([[0, 0], [0.72, 0], [1, 0.34]]),
      transparent: true,
      depthWrite: false,
    })
  );
  innerShade.position.z = 0.15;
  root.add(innerShade);

  // Clear plastic dome: a spherical cap of base radius DOME_BASE_R and height
  // DOME_HEIGHT, rim on the plate (z=0), apex toward the viewer.
  const sphereR = (DOME_BASE_R ** 2 + DOME_HEIGHT ** 2) / (2 * DOME_HEIGHT);
  const domeGeometry = new THREE.SphereGeometry(sphereR, 96, 32, 0, Math.PI * 2, 0, Math.asin(DOME_BASE_R / sphereR));
  domeGeometry.rotateX(Math.PI / 2);
  domeGeometry.translate(0, 0, DOME_HEIGHT - sphereR);
  const dome = new THREE.Mesh(
    domeGeometry,
    // Clear glass: no diffuse colour of its own, only the reflections/highlights
    // ADDED on top of what's behind it (a white translucent veil would turn the
    // black pupil grey).
    new THREE.MeshPhysicalMaterial({
      color: 0x000000,
      roughness: 0.04,
      metalness: 0,
      envMapIntensity: 0.22,
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  dome.renderOrder = 2;
  root.add(dome);

  return {
    root,
    // x, y in mm from the eye centre; callers keep it within PUPIL_TRAVEL.
    setPupil(x, y) {
      pupil.position.x = x;
      pupil.position.y = y;
    },
  };
}
