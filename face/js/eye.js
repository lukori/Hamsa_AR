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

export const PUPIL_TRAVEL = EYE_WHITE_R - PUPIL_R - PUPIL_CLEARANCE;

// Colours of the hand + ring. The first face is always sky blue; further faces
// take the next colour of OTHER_COLORS that no one else is currently using.
// (Base colours, a bit more saturated than they look: the flat light lift and
// the shading make them read lighter.)
export const FIRST_COLOR = { name: "blue", hex: 0x87ceeb }; // CSS "skyblue"
export const OTHER_COLORS = [
  { name: "red", hex: 0xe5393b },
  { name: "yellow", hex: 0xf7c62a },
  { name: "green", hex: 0x4cc46a },
  { name: "orange", hex: 0xf5892a },
  { name: "purple", hex: 0x9a6ae0 },
];

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

// Loads the STL and builds the shared geometry/materials once; create(color)
// then makes one eye object per tracked face (sharing all of it except the
// colour of the hand).
export async function loadEye(stlUrl) {
  const plateGeometry = await new STLLoader().loadAsync(stlUrl);
  // STL axes -> eye axes: x' = -x, y' = -z, z' = -y. A proper rotation (det +1,
  // no mirroring): the fingers (STL -Z) point up and the ring (STL -Y) faces
  // the viewer.
  plateGeometry.applyMatrix4(new THREE.Matrix4().set(-1, 0, 0, 0, 0, 0, -1, 0, 0, -1, 0, 0, 0, 0, 0, 1));

  const eyeWhiteGeometry = new THREE.CircleGeometry(EYE_WHITE_R, 96);
  const eyeWhiteMaterial = new THREE.MeshStandardMaterial({ color: 0xd2d3db, roughness: 0.75 });

  const pupilGeometry = new THREE.CircleGeometry(PUPIL_R, 64);
  const pupilMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x050505,
    roughness: 0.55,
    metalness: 0,
    specularIntensity: 0.25,
    envMapIntensity: 0.15,
  });

  // Soft contact shading. Seen straight on, the ring has the same colour and
  // faces the same way as the base, so it would be invisible; a real piece reads
  // as raised because of the shadow it casts and the shade inside its wall. A
  // shadow map is too coarse for a 1.2mm step, so these are soft gradient
  // decals (always facing the same way, like the light in filter.js).
  const outerShadeGeometry = new THREE.CircleGeometry(34, 96);
  const outerShadeMaterial = new THREE.MeshBasicMaterial({
    map: radialShade([[0, 0], [27 / 34, 0], [27.2 / 34, 0.3], [31.5 / 34, 0.06], [1, 0]]),
    transparent: true,
    depthWrite: false,
  });
  const innerShadeMaterial = new THREE.MeshBasicMaterial({
    map: radialShade([[0, 0], [0.72, 0], [1, 0.34]]),
    transparent: true,
    depthWrite: false,
  });

  // Clear plastic dome: a spherical cap of base radius DOME_BASE_R and height
  // DOME_HEIGHT, rim on the plate (z=0), apex toward the viewer.
  const sphereR = (DOME_BASE_R ** 2 + DOME_HEIGHT ** 2) / (2 * DOME_HEIGHT);
  const domeGeometry = new THREE.SphereGeometry(sphereR, 96, 32, 0, Math.PI * 2, 0, Math.asin(DOME_BASE_R / sphereR));
  domeGeometry.rotateX(Math.PI / 2);
  domeGeometry.translate(0, 0, DOME_HEIGHT - sphereR);
  // Clear glass: no diffuse colour of its own, only the reflections/highlights
  // ADDED on top of what's behind it (a white translucent veil would turn the
  // black pupil grey).
  const domeMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    roughness: 0.04,
    metalness: 0,
    envMapIntensity: 0.22,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  function create(color) {
    const root = new THREE.Group();

    const plateMaterial = new THREE.MeshPhysicalMaterial({
      color,
      emissive: color, // a flat lift so the colour stays clean and light in shade
      emissiveIntensity: 0.2,
      roughness: 0.62,
      metalness: 0,
      clearcoat: 0.04,
      clearcoatRoughness: 0.6,
      envMapIntensity: 0.45,
    });
    const plate = new THREE.Mesh(plateGeometry, plateMaterial);
    plate.castShadow = true; // its shadow falls on the shadow catcher behind it (filter.js)
    root.add(plate);

    const eyeWhite = new THREE.Mesh(eyeWhiteGeometry, eyeWhiteMaterial);
    eyeWhite.position.z = 0.1;
    root.add(eyeWhite);

    const pupil = new THREE.Mesh(pupilGeometry, pupilMaterial);
    pupil.position.z = 0.35;
    root.add(pupil);

    const outerShade = new THREE.Mesh(outerShadeGeometry, outerShadeMaterial);
    outerShade.position.set(-0.5, -1.1, 0.03); // pushed away from the light, like the real shadow
    root.add(outerShade);
    const innerShade = new THREE.Mesh(eyeWhiteGeometry, innerShadeMaterial);
    innerShade.position.z = 0.15;
    root.add(innerShade);

    const dome = new THREE.Mesh(domeGeometry, domeMaterial);
    dome.renderOrder = 2;
    root.add(dome);

    return {
      root,
      // x, y in mm from the eye centre; callers keep it within PUPIL_TRAVEL.
      setPupil(x, y) {
        pupil.position.x = x;
        pupil.position.y = y;
      },
      setColor(hex) {
        plateMaterial.color.set(hex);
        plateMaterial.emissive.set(hex);
      },
    };
  }

  return { create };
}
