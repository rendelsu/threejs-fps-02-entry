// Shared body movement: one axis at a time against the world's AABBs, so a
// wall never swallows a body. Used by the player and by every bot, so the
// same collision rules govern both (criterion 2: collision with the map).
import * as THREE from 'three';

export const BODY_RADIUS = 0.34;
export const BODY_HEIGHT = 1.72;
export const GRAVITY = 20;

const probe = new THREE.Box3();

function overlaps(colliders, x, y, z, height, lift) {
  probe.min.set(x - BODY_RADIUS, y + lift, z - BODY_RADIUS);
  probe.max.set(x + BODY_RADIUS, y + height - lift, z + BODY_RADIUS);
  for (let i = 0; i < colliders.length; i += 1) {
    if (probe.intersectsBox(colliders[i])) return colliders[i];
  }
  return null;
}

// body: { position: Vector3, velocity: Vector3, height, onGround }.
// wishX/wishZ: desired horizontal direction (already normalised, length 0..1).
// Returns nothing; mutates body in place. No allocation.
export function moveBody(colliders, body, dt, wishX, wishZ, speed, accel, friction) {
  const blend = Math.min(1, (accel * dt) / Math.max(0.01, speed));
  body.velocity.x += (wishX * speed - body.velocity.x) * blend;
  body.velocity.z += (wishZ * speed - body.velocity.z) * blend;
  if (body.onGround && wishX === 0 && wishZ === 0) {
    const damp = Math.max(0, 1 - friction * dt);
    body.velocity.x *= damp;
    body.velocity.z *= damp;
  }
  body.velocity.y -= GRAVITY * dt;

  const nextX = body.position.x + body.velocity.x * dt;
  if (!overlaps(colliders, nextX, body.position.y, body.position.z, body.height, 0.04)) {
    body.position.x = nextX;
  } else {
    body.velocity.x = 0;
  }
  const nextZ = body.position.z + body.velocity.z * dt;
  if (!overlaps(colliders, body.position.x, body.position.y, nextZ, body.height, 0.04)) {
    body.position.z = nextZ;
  } else {
    body.velocity.z = 0;
  }

  body.position.y += body.velocity.y * dt;
  body.onGround = false;
  const hit = overlaps(colliders, body.position.x, body.position.y, body.position.z, body.height, 0);
  if (hit && body.velocity.y <= 0) {
    body.position.y = hit.max.y;
    body.velocity.y = 0;
    body.onGround = true;
  } else if (hit) {
    body.position.y = hit.min.y - body.height;
    body.velocity.y = 0;
  }
  if (body.position.y < 0) {
    body.position.y = 0;
    body.velocity.y = 0;
    body.onGround = true;
  }
  body.velocity.y = Math.max(-30, body.velocity.y);
}

// Segment vs axis-aligned box: does the line from a to b cross the box?
// Used for grenade bounces and smoke checks. Reuses the caller's vectors.
export function segmentHitsBox(a, b, box) {
  const dirX = b.x - a.x;
  const dirY = b.y - a.y;
  const dirZ = b.z - a.z;
  let tmin = 0;
  let tmax = 1;
  const axes = [
    [a.x, dirX, box.min.x, box.max.x],
    [a.y, dirY, box.min.y, box.max.y],
    [a.z, dirZ, box.min.z, box.max.z],
  ];
  for (let i = 0; i < 3; i += 1) {
    const [o, d, lo, hi] = axes[i];
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return false;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
  }
  return true;
}
