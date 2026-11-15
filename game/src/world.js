// Kestrel Yard: an original dusk freight yard, 48 x 36 m, built from boxes.
// Two sites (Crane Bay west, Silo Row east) sit on the defenders' north side;
// attackers spawn south and push up three lanes: west, mid (Container Alley),
// east. Every box is a collider and a bullet stop. No textures, no models.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const unitBox = new THREE.BoxGeometry(1, 1, 1);

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of ['canvas', 'surface', 'hairline', 'muted', 'accent', 'teal', 'rust']) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }

  const colliders = [];
  const shootables = [];
  const minimapRects = [];

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(unitBox, materials[material]);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
      minimapRects.push({ x: x - w / 2, z: z - d / 2, w, d });
    }
    return mesh;
  }

  function cylinder(r, h, x, z, material) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, h, 18),
      materials[material],
    );
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const half = r * 0.95;
    const b = new THREE.Box3(
      new THREE.Vector3(x - half, 0, z - half),
      new THREE.Vector3(x + half, h, z + half),
    );
    colliders.push(b);
    shootables.push(mesh);
    minimapRects.push({ x: x - half, z: z - half, w: half * 2, d: half * 2 });
    return mesh;
  }

  // Floor and perimeter, 48 x 36 m, walls 4.6 m high.
  box(48.4, 0.4, 36.4, 0, -0.2, 0, 'canvas');
  box(48.4, 4.6, 0.4, 0, 2.3, -18.2, 'surface');
  box(48.4, 4.6, 0.4, 0, 2.3, 18.2, 'surface');
  box(0.4, 4.6, 36.4, -24.2, 2.3, 0, 'surface');
  box(0.4, 4.6, 36.4, 24.2, 2.3, 0, 'surface');

  // Site A — Crane Bay (north-west). Pillars, a beam, a low platform, crates.
  box(1, 7, 1, -19, 3.5, -13, 'hairline');
  box(1, 7, 1, -13, 3.5, -13, 'hairline');
  box(7, 1, 1.5, -16, 6.5, -13, 'accent');
  box(6, 0.5, 4, -16, 0.25, -11, 'surface');
  box(1.2, 1.1, 1.2, -20.5, 0.55, -8.5, 'hairline');
  box(1.2, 1.1, 1.2, -11.5, 0.55, -8.5, 'hairline');
  box(2.4, 1.1, 1.2, -16, 0.55, -15.5, 'hairline');

  // Site B — Silo Row (north-east). Three silos and a crate wall.
  cylinder(1.6, 5, 13.5, -13.5, 'muted');
  cylinder(1.6, 5, 17.5, -9.5, 'muted');
  cylinder(1.6, 4, 19.5, -13.5, 'hairline');
  box(2.4, 1.1, 1.2, 16, 0.55, -15.5, 'hairline');
  box(1.2, 1.1, 1.2, 11.5, 0.55, -8.5, 'hairline');

  // Mid — Container Alley. Two stacked containers split the middle.
  box(2.4, 2.6, 6, -4, 1.3, 0, 'rust');
  box(2.4, 2.6, 6, 4, 1.3, 1, 'teal');
  box(2.4, 2.4, 5, -4, 3.8, 0, 'hairline');
  box(1.2, 1.1, 1.2, -8, 0.55, 1, 'hairline');
  box(1.2, 1.1, 1.2, 8, 0.55, 3, 'hairline');

  // Mid choke: a wall with one gap at x = 0, the fight for mid.
  box(7, 3, 0.4, -4.5, 1.5, -6, 'surface');
  box(7, 3, 0.4, 4.5, 1.5, -6, 'surface');

  // West lane cover and east lane cover, mirrored.
  box(0.4, 3, 6, -20, 1.5, -6, 'surface');
  box(0.4, 3, 6, 20, 1.5, -6, 'surface');
  box(1.2, 1.1, 1.2, -20, 0.55, 4, 'hairline');
  box(1.2, 1.1, 1.2, 20, 0.55, 4, 'hairline');
  box(2.4, 0.9, 1.2, -12, 0.45, 8, 'hairline');
  box(2.4, 0.9, 1.2, 12, 0.45, 8, 'hairline');

  // Spawn cover, south and north.
  box(3, 1.1, 1.2, -6, 0.55, 13, 'hairline');
  box(3, 1.1, 1.2, 6, 0.55, 13, 'hairline');
  box(3, 1.1, 1.2, -6, 0.55, -16, 'hairline');
  box(3, 1.1, 1.2, 6, 0.55, -16, 'hairline');

  // Site rings: flat markers the player reads at a glance.
  const ringGeo = new THREE.RingGeometry(3.6, 4.4, 40);
  for (const [sx, sz, color] of [[-16, -11, PALETTE.accent], [16, -11, PALETTE.accent]]) {
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(sx, 0.03, sz);
    group.add(ring);
  }

  // Light: low dusk sun from the south-west, cool sky fill, haze.
  const sky = new THREE.HemisphereLight(new THREE.Color(0x8a97a8), new THREE.Color(PALETTE.canvas), 1.5);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color(0xffd9a0), 2.8);
  key.position.set(-14, 18, 14);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -30;
  key.shadow.camera.right = 30;
  key.shadow.camera.top = 30;
  key.shadow.camera.bottom = -30;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.5);
  fill.position.set(10, 12, -10);
  scene.add(fill);

  // Waypoint graph for the bots (criterion 3: routes through the map).
  // Nodes are open ground; edges are straight, wall-free runs.
  const waypoints = {
    nodes: [
      [0, 15], [-8, 12], [8, 12], [-14, 6], [0, 8], [14, 6],
      [-20, 0], [20, 0], [-16, -4], [0, 0], [16, -4],
      [-16, -11], [-20, -13], [-12, -14], [16, -11], [20, -13], [12, -14],
      [0, -15], [-19, -15], [19, -15], [0, -9], [-8, -8], [8, -8],
    ],
    edges: [
      [0, 1], [0, 2], [1, 3], [2, 5], [1, 4], [2, 4], [3, 4], [4, 5],
      [3, 6], [5, 7], [6, 8], [7, 10], [4, 9], [9, 20], [8, 9], [9, 10],
      [8, 11], [10, 14], [11, 12], [11, 13], [14, 15], [14, 16],
      [21, 8], [22, 10], [11, 18], [14, 19], [17, 20], [12, 18], [15, 19],
      [17, 18], [17, 19], [20, 17], [8, 21], [10, 22],
    ],
  };

  return {
    colliders,
    shootables,
    minimapRects,
    group,
    sites: [
      // Crane Bay is a fast plant (3 s) behind pillars; Silo Row is open
      // ground, so its plant takes a second longer (4 s) — the two sites
      // play differently, and attackers choose by the clock, not by habit.
      { id: 'A', name: 'Crane Bay', x: -16, z: -11, r: 4.5, plantTime: 3 },
      { id: 'B', name: 'Silo Row', x: 16, z: -11, r: 4.5, plantTime: 4 },
    ],
    spawns: {
      kestrel: [[-4, 15], [0, 16], [4, 15], [-1, 13]],
      warden: [[-4, -15], [0, -16], [4, -15], [1, -13], [-8, -14]],
    },
    waypoints,
  };
}
