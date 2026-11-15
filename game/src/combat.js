// Combat: hitscan shots, damage with headshots and range falloff, grenades
// (frag and smoke), pooled tracers, the bomb plant/defuse, and the noise
// events bots hear. One Raycaster, reused by every shot (no allocation).
import * as THREE from 'three';
import { WEAPONS } from './state.js';
import { segmentHitsBox } from './move.js';

const TRACER_COUNT = 16;
const TRACER_LIFE = 0.07;
const SMOKE_RADIUS = 2.4;
const SMOKE_TIME = 12;

export function createCombat(state, world, scene, audio) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 140;
  state.ray = raycaster;
  state.noises = [];
  state.smokes = [];

  // Pooled tracers: 16 lines, reused in order, never created in the loop.
  const tracers = [];
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xf0a830, transparent: true, opacity: 0.9 });
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, tracerMat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIdx = 0;

  // Pooled explosion flash and smoke puffs.
  const flashMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xf0a830, transparent: true, opacity: 0 }),
  );
  flashMesh.visible = false;
  scene.add(flashMesh);
  let flashLife = 0;
  const smokeMat = new THREE.MeshBasicMaterial({ color: 0x8a7f6c, transparent: true, opacity: 0.55, depthWrite: false });
  const smokePuffs = [];
  for (let i = 0; i < 10; i += 1) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 8), smokeMat);
    puff.visible = false;
    scene.add(puff);
    smokePuffs.push(puff);
  }

  const grenades = [];
  const grenadeGeo = new THREE.SphereGeometry(0.09, 8, 6);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x1e2228, roughness: 0.6, metalness: 0.4 });
  for (let i = 0; i < 4; i += 1) {
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.visible = false;
    scene.add(mesh);
    grenades.push({ mesh, active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0, kind: 'frag', owner: null });
  }

  const tmpDir = new THREE.Vector3();
  const tmpOrigin = new THREE.Vector3();
  const tmpTarget = new THREE.Vector3();
  // The player has no visible body mesh (first person), so bot shots test
  // the ray against the player's box directly.
  const playerBox = new THREE.Box3();
  const playerRay = new THREE.Ray();
  const playerHitPoint = new THREE.Vector3();

  function shootables() {
    // A fresh list per shot: never push into world.shootables, or it would
    // grow on every trigger pull.
    const list = world.shootables.slice();
    for (const bot of state.bots) {
      if (!bot.alive) continue;
      list.push(bot.bodyMesh, bot.headMesh);
    }
    return list;
  }

  function spawnTracer(a, b) {
    const t = tracers[tracerIdx];
    tracerIdx = (tracerIdx + 1) % TRACER_COUNT;
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, a.x, a.y, a.z);
    pos.setXYZ(1, b.x, b.y, b.z);
    pos.needsUpdate = true;
    t.line.visible = true;
    t.life = TRACER_LIFE;
  }

  function emitNoise(x, z, radius) {
    state.noises.push({ x, z, radius, time: state.time });
    if (state.noises.length > 8) state.noises.shift();
  }

  function hitMeshes() {
    // Bot meshes carry their actor in userData; set once per frame is cheap
    // because the list is tiny, and it survives mesh reuse.
    for (const bot of state.bots) {
      bot.bodyMesh.userData.actor = bot;
      bot.bodyMesh.userData.part = 'body';
      bot.headMesh.userData.actor = bot;
      bot.headMesh.userData.part = 'head';
    }
  }

  // The one shot function, shared by the player and every bot.
  // Returns the actor hit, or null. dir is already spread; spread is unused
  // here because callers bake it into dir.
  function fireHitscan(shooter, origin, dir, weaponId) {
    const def = WEAPONS[weaponId];
    hitMeshes();
    scene.updateMatrixWorld(true); // bots move in the sim; the render may lag.
    raycaster.far = 140; // hasLineOfSight narrows far; every shot resets it.
    raycaster.set(origin, dir);
    const hits = raycaster.intersectObjects(shootables(), false);
    const end = tmpTarget.copy(origin).addScaledVector(dir, def.range);
    let hitActor = null;
    let hitPart = 'body';
    let hitPoint = end;
    let hitDist = def.range;
    if (hits.length > 0) {
      const hit = hits[0];
      hitPoint = hit.point;
      hitDist = hit.distance;
      if (hit.object.userData.actor) {
        hitActor = hit.object.userData.actor;
        hitPart = hit.object.userData.part || 'body';
      }
    }
    // The player's box: a bot's ray can hit the player even though the
    // player has no mesh. A nearer box hit overrides the mesh hit.
    const p = state.player;
    if (p && p.alive && shooter !== p) {
      playerBox.min.set(p.body.position.x - 0.34, p.body.position.y, p.body.position.z - 0.34);
      playerBox.max.set(p.body.position.x + 0.34, p.body.position.y + p.body.height, p.body.position.z + 0.34);
      playerRay.origin.copy(origin);
      playerRay.direction.copy(dir);
      const boxHit = playerRay.intersectBox(playerBox, playerHitPoint);
      if (boxHit) {
        const d = origin.distanceTo(playerHitPoint);
        if (d < hitDist) {
          hitActor = p;
          hitPart = playerHitPoint.y > p.body.position.y + 1.38 ? 'head' : 'body';
          hitPoint = playerHitPoint;
          hitDist = d;
        }
      }
    }
    spawnTracer(origin, hitPoint);
    if (hitActor && hitActor !== shooter && hitActor.alive) {
      const dist = origin.distanceTo(hitPoint);
      const falloff = dist > 30 ? Math.max(0.6, 1 - (dist - 30) / 200) : 1;
      const amount = Math.round(def.damage * (hitPart === 'head' ? def.headMult : 1) * falloff);
      damageActor(hitActor, amount, hitPart, shooter);
      if (shooter.kind === 'player') {
        state.shotsHit += 1;
        audio.hit();
        if (hitPart === 'head') state.lastHitHead = true;
      }
    }
    if (shooter.kind === 'player') state.shotsFired += 1;
    emitNoise(origin.x, origin.z, 26);
    return hitActor;
  }

  function damageActor(target, amount, part, attacker) {
    if (!target.alive) return;
    // No friendly fire on hitscan: a teammate in the line of fire blocks
    // the shot but takes no damage.
    if (attacker && attacker.team === target.team) return;
    // Bots shoot softer at the player than at each other: without the
    // scale, one headshot (96) plus a body hit ends a round in a second.
    if (attacker && attacker.kind === 'bot' && target.kind === 'player') {
      amount = Math.round(amount * 0.55);
    }
    let died = false;
    if (target.kind === 'player') {
      died = target.damage ? target.damage(amount, part) : false;
    } else {
      target.health -= amount;
      if (target.health <= 0) { target.health = 0; target.alive = false; died = true; }
    }
    if (died) onKill(target, attacker, part);
  }

  function onKill(victim, attacker, part) {
    if (victim.kind === 'bot') {
      victim.group.rotation.x = -Math.PI / 2;
      victim.group.position.y = 0.25;
    }
    const feed = `${attacker.kind === 'player' ? 'You' : attacker.id} ${part === 'head' ? '◉' : '×'} ${victim.kind === 'player' ? 'You' : victim.id}`;
    state.lastKillFeed.unshift(feed);
    if (state.lastKillFeed.length > 5) state.lastKillFeed.pop();
    // Round and match kill tallies, for the round MVP banner.
    if (attacker) {
      const id = attacker.kind === 'player' ? 'player' : attacker.id;
      state.roundKills[id] = (state.roundKills[id] || 0) + 1;
      state.matchKills[id] = (state.matchKills[id] || 0) + 1;
    }
    if (attacker.kind === 'player') {
      state.kills += 1;
      state.money += 300;
      audio.kill();
    }
    if (victim.kind === 'player') {
      state.deaths += 1;
      audio.hurt();
    }
    // The bomb drops where its carrier fell.
    if (state.bomb.state === 'carried' && state.bomb.carrier === victim.id) {
      state.bomb.state = 'dropped';
      state.bomb.x = victim.body.position.x;
      state.bomb.z = victim.body.position.z;
      state.bomb.carrier = null;
      for (const bot of state.bots) bot.ai.carriesBomb = false;
    }
    state.onKillCallback?.(victim, attacker);
  }

  function botShoot(bot, aimX, aimY, aimZ) {
    tmpOrigin.set(bot.body.position.x, bot.body.position.y + 1.5, bot.body.position.z);
    tmpDir.set(aimX - tmpOrigin.x, aimY - tmpOrigin.y, aimZ - tmpOrigin.z).normalize();
    fireHitscan(bot, tmpOrigin, tmpDir, bot.weaponId);
    const dp = state.player.body.position;
    audio.enemyShot(Math.hypot(dp.x - tmpOrigin.x, dp.z - tmpOrigin.z));
  }

  function nearestVisibleEnemy(bot) {
    let best = null;
    let bestD = Infinity;
    const eyeY = bot.body.position.y + 1.5;
    for (const other of state.actors) {
      if (other === bot || !other.alive || other.team === bot.team) continue;
      const dx = other.body.position.x - bot.body.position.x;
      const dz = other.body.position.z - bot.body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 48 || dist > bestD) continue;
      // Field of view: bots see a 110-degree cone ahead.
      const fwdX = -Math.sin(bot.yaw);
      const fwdZ = -Math.cos(bot.yaw);
      const dot = (dx * fwdX + dz * fwdZ) / (dist || 1);
      if (dot < 0.35) continue;
      if (!hasLineOfSight(bot.body.position.x, eyeY, bot.body.position.z, other.body.position.x, other.body.position.y + 1.2, other.body.position.z, dist)) continue;
      best = other;
      bestD = dist;
    }
    return best;
  }

  function hasLineOfSight(x1, y1, z1, x2, y2, z2, maxDist) {
    tmpOrigin.set(x1, y1, z1);
    tmpDir.set(x2 - x1, y2 - y1, z2 - z1);
    const dist = tmpDir.length();
    tmpDir.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(tmpOrigin, tmpDir);
    raycaster.far = Math.min(dist, maxDist || dist);
    const hits = raycaster.intersectObjects(world.shootables, false);
    if (hits.length > 0) return false;
    return !smokeBlocks(x1, y1, z1, x2, y2, z2);
  }

  function smokeBlocks(x1, y1, z1, x2, y2, z2) {
    for (const cloud of state.smokes) {
      // Distance from the segment to the cloud centre.
      const cx = cloud.x;
      const cy = cloud.y;
      const cz = cloud.z;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const dz = z2 - z1;
      const lenSq = dx * dx + dy * dy + dz * dz || 1;
      let t = ((cx - x1) * dx + (cy - y1) * dy + (cz - z1) * dz) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const px = x1 + dx * t - cx;
      const py = y1 + dy * t - cy;
      const pz = z1 + dz * t - cz;
      if (px * px + py * py + pz * pz < SMOKE_RADIUS * SMOKE_RADIUS) return true;
    }
    return false;
  }

  function throwGrenade(actor, kind) {
    const g = grenades.find((item) => !item.active);
    if (!g) return false;
    const yaw = actor.yaw;
    const pitch = actor.pitch || 0;
    g.pos.set(actor.body.position.x, actor.body.position.y + 1.4, actor.body.position.z);
    g.vel.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch) + 0.35, -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(13);
    g.fuse = kind === 'frag' ? 1.6 : 1.2;
    g.kind = kind;
    g.owner = actor;
    g.active = true;
    g.mesh.visible = true;
    audio.throwGrenade();
    return true;
  }

  // A flash detonation: the player is blinded in proportion to how close
  // they are and how squarely they face the blast; bots that can see the
  // burst freeze for a couple of seconds. Looking away is a real defence.
  function explodeFlash(g) {
    const p = state.player;
    if (p && p.alive) {
      const dx = g.pos.x - p.body.position.x;
      const dz = g.pos.z - p.body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 26) {
        const fwdX = -Math.sin(p.yaw);
        const fwdZ = -Math.cos(p.yaw);
        const facing = (dx * fwdX + dz * fwdZ) / (dist || 1);
        if (facing > 0.15) {
          const dur = Math.max(0.4, Math.min(2.8, 2.8 * (1 - dist / 26) * (0.5 + facing)));
          if (state.flashBlind) state.flashBlind(dur);
        }
      }
    }
    for (const bot of state.bots) {
      if (!bot.alive) continue;
      const dx = g.pos.x - bot.body.position.x;
      const dz = g.pos.z - bot.body.position.z;
      if (Math.hypot(dx, dz) > 20) continue;
      if (!hasLineOfSight(bot.body.position.x, bot.body.position.y + 1.5, bot.body.position.z, g.pos.x, g.pos.y, g.pos.z)) continue;
      bot.ai.blindUntil = state.time + 2.2;
    }
    emitNoise(g.pos.x, g.pos.z, 30);
    audio.flashPop();
  }

  function explodeGrenade(g) {
    g.active = false;
    g.mesh.visible = false;
    if (g.kind === 'flash') { explodeFlash(g); return; }
    if (g.kind === 'frag') {
      flashMesh.position.copy(g.pos);
      flashMesh.visible = true;
      flashLife = 0.25;
      audio.explosion();
      emitNoise(g.pos.x, g.pos.z, 40);
      for (const actor of state.actors) {
        if (!actor.alive) continue;
        const d = Math.hypot(actor.body.position.x - g.pos.x, actor.body.position.z - g.pos.z);
        if (d < 7) {
          const amount = Math.round(120 * (1 - d / 7) + 10);
          damageActor(actor, amount, 'body', g.owner);
        }
      }
    } else {
      state.smokes.push({ x: g.pos.x, y: 1.2, z: g.pos.z, until: state.time + SMOKE_TIME });
      const base = state.smokes.length - 1;
      for (let i = 0; i < 5; i += 1) {
        const puff = smokePuffs[(base * 5 + i) % smokePuffs.length];
        puff.visible = true;
        puff.position.set(g.pos.x + (state.random() * 2 - 1) * 1.6, 1.1 + state.random() * 0.8, g.pos.z + (state.random() * 2 - 1) * 1.6);
      }
    }
  }

  function stepGrenades(dt) {
    for (const g of grenades) {
      if (!g.active) continue;
      g.fuse -= dt;
      g.vel.y -= 12 * dt;
      const nx = g.pos.x + g.vel.x * dt;
      const ny = g.pos.y + g.vel.y * dt;
      const nz = g.pos.z + g.vel.z * dt;
      // Bounce off the world: test the segment against every collider.
      let bounced = false;
      for (const box of world.colliders) {
        if (segmentHitsBox(g.pos, { x: nx, y: ny, z: nz }, box)) {
          if (Math.abs(g.vel.x) > Math.abs(g.vel.z)) g.vel.x *= -0.4;
          else g.vel.z *= -0.4;
          g.vel.y *= 0.4;
          bounced = true;
          break;
        }
      }
      if (!bounced) {
        g.pos.set(nx, ny, nz);
        if (g.pos.y < 0.09) { g.pos.y = 0.09; g.vel.y = Math.abs(g.vel.y) * 0.35; g.vel.x *= 0.7; g.vel.z *= 0.7; }
      }
      g.mesh.position.copy(g.pos);
      if (g.fuse <= 0) explodeGrenade(g);
    }
    if (flashLife > 0) {
      flashLife -= dt;
      const s = 1 + (0.25 - flashLife) * 14;
      flashMesh.scale.set(s, s, s);
      flashMesh.material.opacity = Math.max(0, flashLife * 3);
      if (flashLife <= 0) flashMesh.visible = false;
    }
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        if (t.life <= 0) t.line.visible = false;
      }
    }
    // Expire smoke clouds and hide their puffs.
    for (let i = state.smokes.length - 1; i >= 0; i -= 1) {
      if (state.time > state.smokes[i].until) {
        state.smokes.splice(i, 1);
        for (const puff of smokePuffs) puff.visible = false;
      }
    }
  }

  function plantBomb(planter, site) {
    state.bomb.state = 'planted';
    state.bomb.site = site.id;
    state.bomb.x = site.x;
    state.bomb.z = site.z;
    state.bomb.fuse = 35;
    state.bomb.planter = planter.id;
    state.bomb.carrier = null;
    if (planter.kind === 'player') state.money += 300;
    audio.plantBeep(true);
    state.banner = { title: 'CHARGE PLANTED', sub: `Site ${site.id} — 35 seconds to detonation`, until: state.time + 3 };
  }

  function defuseBomb(defuser) {
    state.bomb.state = 'defused';
    state.banner = { title: 'CHARGE DEFUSED', sub: `${defuser.id} saved the yard`, until: state.time + 3 };
    state.onBombResolved?.('defused');
  }

  function detonateBomb() {
    state.bomb.state = 'detonated';
    flashMesh.position.set(state.bomb.x, 1, state.bomb.z);
    flashMesh.visible = true;
    flashLife = 0.4;
    audio.explosion();
    state.onBombResolved?.('detonated');
  }

  return {
    fireHitscan, damageActor, botShoot, nearestVisibleEnemy, hasLineOfSight,
    throwGrenade, stepGrenades, plantBomb, defuseBomb, detonateBomb, emitNoise, smokeBlocks,
    grenades, tracers,
  };
}
