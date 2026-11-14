// The player: one damageable body with acceleration, friction, gravity,
// crouch and jump, a loadout of owned weapons, health and a plate vest.
// Movement is the shared moveBody (see move.js); the same rules move bots.
import * as THREE from 'three';
import { BODY_HEIGHT, moveBody } from './move.js';
import { WEAPONS } from './state.js';

const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const JUMP_SPEED = 6.2;

export function createPlayer(colliders) {
  const body = {
    position: new THREE.Vector3(0, 0, 15),
    velocity: new THREE.Vector3(),
    height: STAND_HEIGHT,
    onGround: true,
  };
  const actor = {
    kind: 'player',
    id: 'player',
    team: 'kestrel',
    body,
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    health: 100,
    vest: false,
    alive: true,
    crouching: false,
    loadout: {},
    weaponId: 'p9',
    frags: 0,
    smokes: 0,
    plantProgress: 0,
    defuseProgress: 0,
  };
  resetLoadout(actor);

  function resetLoadout(a) {
    a.loadout = { p9: { mag: WEAPONS.p9.mag, reserve: WEAPONS.p9.reserve } };
    a.weaponId = 'p9';
    a.frags = 0;
    a.smokes = 0;
    a.vest = false;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    actor.yaw -= dx * sensitivity;
    actor.pitch = Math.max(-1.45, Math.min(1.45, actor.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    actor.pitch = Math.min(1.45, actor.pitch + pitchKick);
    actor.yaw += yawKick;
  }

  function step(dt, keys) {
    if (!actor.alive) return;
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !actor.crouching) {
      actor.crouching = true;
      body.height = CROUCH_HEIGHT;
    } else if (!crouching && actor.crouching) {
      actor.crouching = false;
      body.height = STAND_HEIGHT;
    }
    const eyeTarget = actor.crouching ? CROUCH_EYE : STAND_EYE;
    actor.eye += (eyeTarget - actor.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    let wishX = 0;
    let wishZ = 0;
    if (forward || strafe) {
      const sin = Math.sin(actor.yaw);
      const cos = Math.cos(actor.yaw);
      wishX = -sin * forward + cos * strafe;
      wishZ = -cos * forward - sin * strafe;
      const len = Math.hypot(wishX, wishZ) || 1;
      wishX /= len;
      wishZ /= len;
    }
    const speed = actor.crouching ? CROUCH_SPEED : WALK_SPEED;
    if (keys.has('Space') && body.onGround) {
      body.velocity.y = JUMP_SPEED;
      body.onGround = false;
    }
    moveBody(colliders, body, dt, wishX, wishZ, speed, body.onGround ? GROUND_ACCEL : AIR_ACCEL, FRICTION);
  }

  function groundSpeed() {
    return Math.hypot(body.velocity.x, body.velocity.z);
  }

  // Vest absorbs half the damage; returns true when this damage killed.
  function damage(amount) {
    if (!actor.alive) return false;
    let dealt = amount;
    if (actor.vest) dealt = Math.round(amount * 0.5);
    actor.health -= dealt;
    if (actor.health <= 0) {
      actor.health = 0;
      actor.alive = false;
      return true;
    }
    return false;
  }

  function healFull() {
    actor.health = 100;
    actor.alive = true;
  }

  function spawnAt(x, z, yaw) {
    body.position.set(x, 0, z);
    body.velocity.set(0, 0, 0);
    actor.yaw = yaw;
    actor.pitch = 0;
    actor.eye = STAND_EYE;
    actor.crouching = false;
    body.height = STAND_HEIGHT;
  }

  return {
    actor, body, look, recoil, step, damage, healFull, spawnAt, groundSpeed,
    resetLoadout: () => resetLoadout(actor),
  };
}
