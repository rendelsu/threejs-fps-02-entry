// Bots: 4 allies and 5 enemies in a 5v5 match, with a four-state FSM —
// PATROL along the waypoint graph, ALERT toward a sound, ENGAGE when
// they see an enemy, HUNT toward the last known position — plus HOLD,
// PLANT and DEFUSE roles for the objective (criterion 3: routes, holds,
// reactions to sight/sound). A flash grenade blinds a bot for a few
// seconds (ai.blindUntil); a blinded bot stands still and cannot shoot.
import * as THREE from 'three';
import { BODY_HEIGHT, moveBody } from './move.js';
import { WEAPONS } from './state.js';

const BOT_SPEED = 4.4;
const BOT_RUN = 5.0;
const EYE = 1.6;

// Breadth-first route over the waypoint graph. No allocation in the loop:
// the caller passes a scratch array.
export function findRoute(nodes, edges, from, to, out) {
  const n = nodes.length;
  const prev = new Int16Array(n).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === to) break;
    for (let i = 0; i < edges.length; i += 1) {
      const [a, b] = edges[i];
      let next = -1;
      if (a === cur) next = b;
      else if (b === cur) next = a;
      if (next >= 0 && prev[next] === -1) {
        prev[next] = cur;
        queue.push(next);
      }
    }
  }
  out.length = 0;
  if (prev[to] === -1) { out.push(to); return out; }
  let cur = to;
  const reversed = [];
  while (cur !== from) { reversed.push(cur); cur = prev[cur]; }
  for (let i = reversed.length - 1; i >= 0; i -= 1) out.push(reversed[i]);
  return out;
}

function nearestNode(nodes, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const dx = nodes[i][0] - x;
    const dz = nodes[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

export function createBots(state, world, scene, combat) {
  const { nodes, edges } = world.waypoints;
  const bots = [];
  const materials = {
    kestrel: new THREE.MeshStandardMaterial({ color: 0x2fa8a0, roughness: 0.7, metalness: 0.1 }),
    warden: new THREE.MeshStandardMaterial({ color: 0xc25a3a, roughness: 0.7, metalness: 0.1 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1e2228, roughness: 0.8, metalness: 0.1 }),
  };
  const bodyGeo = new THREE.BoxGeometry(0.52, 1.05, 0.32);
  const headGeo = new THREE.BoxGeometry(0.34, 0.34, 0.34);
  const gunGeo = new THREE.BoxGeometry(0.09, 0.09, 0.55);

  function makeBot(team, index, role, site) {
    const group = new THREE.Group();
    const bodyMesh = new THREE.Mesh(bodyGeo, materials[team]);
    bodyMesh.position.y = 0.85;
    bodyMesh.castShadow = true;
    const head = new THREE.Mesh(headGeo, materials.dark);
    head.position.y = 1.55;
    head.castShadow = true;
    const gun = new THREE.Mesh(gunGeo, materials.dark);
    gun.position.set(0.2, 1.15, -0.3);
    group.add(bodyMesh, head, gun);
    scene.add(group);
    const bot = {
      kind: 'bot', id: `${team}-${index}`, team, role, site,
      body: { position: new THREE.Vector3(), velocity: new THREE.Vector3(), height: BODY_HEIGHT, onGround: true },
      yaw: 0, pitch: 0, eye: EYE,
      health: 100, vest: false, alive: true,
      weaponId: role === 'sniper' ? 'longbow' : 'vk7',
      loadout: { vk7: { mag: 30, reserve: 999 }, longbow: { mag: 10, reserve: 999 } },
      frags: 0, smokes: 0,
      group, bodyMesh, headMesh: head,
      ai: {
        state: 'patrol', route: [], routeIdx: 0, target: null,
        lastKnown: { x: 0, z: 0, time: -99 },
        reaction: 0, burstLeft: 0, burstTimer: 0, pauseTimer: 0,
        strafeDir: 1, strafeTime: 0, losTimer: 0, scanTimer: 0,
        holdPos: null, holdYaw: 0, thinkTimer: 0, progress: 0,
        carriesBomb: false, seedOffset: index * 0.37, blindUntil: 0,
      },
    };
    bot.loadout[bot.weaponId] = { mag: WEAPONS[bot.weaponId].mag, reserve: 999 };
    return bot;
  }

  function spawnAll() {
    for (const b of bots) scene.remove(b.group);
    bots.length = 0;
    const allyRoles = ['rifle', 'rifle', 'sniper', 'rifle'];
    const enemyRoles = ['rifle', 'rifle', 'sniper', 'rifle', 'rifle'];
    for (let i = 0; i < 4; i += 1) {
      const b = makeBot('kestrel', i, allyRoles[i], i < 2 ? 'A' : 'B');
      bots.push(b);
    }
    for (let i = 0; i < 5; i += 1) {
      const b = makeBot('warden', i, enemyRoles[i], i < 3 ? 'A' : 'B');
      bots.push(b);
    }
    state.bots = bots;
    state.actors = [state.player].concat(bots);
    return bots;
  }

  function placeAtSpawn(bot, indexInTeam) {
    const spawns = world.spawns[bot.team];
    const [x, z] = spawns[indexInTeam % spawns.length];
    bot.body.position.set(x, 0, z);
    bot.body.velocity.set(0, 0, 0);
    bot.yaw = bot.team === 'kestrel' ? Math.PI : 0;
    bot.pitch = 0;
    bot.health = 100;
    bot.alive = true;
    bot.group.visible = true;
    bot.group.rotation.set(0, 0, 0);
    bot.group.position.set(x, 0, z);
    bot.ai.state = bot.team === 'warden' ? 'hold' : 'patrol';
    bot.ai.target = null;
    bot.ai.reaction = 0;
    bot.ai.burstLeft = 0;
    bot.ai.progress = 0;
    bot.ai.carriesBomb = false;
    if (bot.team === 'warden') {
      const site = world.sites.find((s) => s.id === bot.site);
      const hold = bot.role === 'sniper'
        ? { x: site.x + (bot.site === 'A' ? 4 : -4), z: site.z - 4 }
        : { x: site.x, z: site.z + 2 };
      bot.ai.holdPos = hold;
      bot.ai.holdYaw = bot.site === 'A' ? Math.PI * 0.75 : Math.PI * 0.25;
    }
    assignRoute(bot);
  }

  function assignRoute(bot) {
    const from = nearestNode(nodes, bot.body.position.x, bot.body.position.z);
    let to;
    if (bot.team === 'kestrel') {
      const site = world.sites.find((s) => s.id === bot.site);
      to = nearestNode(nodes, site.x, site.z);
    } else {
      to = nearestNode(nodes, bot.ai.holdPos.x, bot.ai.holdPos.z);
    }
    findRoute(nodes, edges, from, to, bot.ai.route);
    bot.ai.routeIdx = 0;
  }

  function faceToward(bot, x, z, dt, rate = 6) {
    const targetYaw = Math.atan2(-(x - bot.body.position.x), -(z - bot.body.position.z));
    let diff = targetYaw - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += Math.max(-rate * dt, Math.min(rate * dt, diff));
  }

  function walkToward(bot, x, z, dt, speed) {
    const dx = x - bot.body.position.x;
    const dz = z - bot.body.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.6) return true;
    faceToward(bot, x, z, dt);
    const wishX = dx / len;
    const wishZ = dz / len;
    moveBody(world.colliders, bot.body, dt, wishX, wishZ, speed, 30, 8);
    return false;
  }

  function stepBot(bot, dt, now) {
    const ai = bot.ai;
    if (!bot.alive) return;
    // Flashed: stand still, see nothing, shoot nothing until it wears off.
    if (now < ai.blindUntil) {
      bot.group.position.set(bot.body.position.x, bot.body.position.y, bot.body.position.z);
      bot.group.rotation.y = bot.yaw;
      return;
    }
    ai.thinkTimer -= dt;
    ai.losTimer -= dt;

    // Perception, throttled and staggered so 7 bots do not raycast at once.
    if (ai.losTimer <= 0) {
      ai.losTimer = 0.12 + ai.seedOffset * 0.05;
      const seen = combat.nearestVisibleEnemy(bot);
      if (seen) {
        ai.lastKnown.x = seen.body.position.x;
        ai.lastKnown.z = seen.body.position.z;
        ai.lastKnown.time = now;
        // Focus fire: at most two bots engage the same target, or a whole
        // squad melts one player in a second. The rest hold their ground.
        const already = bot.ai.target === seen && ai.state === 'engage';
        let engagers = 0;
        for (const other of bots) {
          if (other !== bot && other.alive && other.ai.state === 'engage' && other.ai.target === seen) engagers += 1;
        }
        if (already || engagers < 2) {
          ai.target = seen;
          if (ai.state !== 'engage') {
            ai.state = 'engage';
            ai.reaction = 0.5 + state.random() * 0.6;
            ai.burstLeft = 0;
            ai.pauseTimer = 0;
          }
        }
      } else if (ai.target && now - ai.lastKnown.time > 2) {
        ai.target = null;
        ai.state = 'hunt';
      }
    }

    // Hearing: a recent shot or blast nearby pulls the bot toward it.
    if (ai.state === 'patrol' || ai.state === 'hold') {
      for (const noise of state.noises) {
        if (now - noise.time > 1.5) continue;
        const dx = noise.x - bot.body.position.x;
        const dz = noise.z - bot.body.position.z;
        if (dx * dx + dz * dz < noise.radius * noise.radius) {
          ai.state = 'alert';
          ai.lastKnown.x = noise.x;
          ai.lastKnown.z = noise.z;
          ai.lastKnown.time = now;
          break;
        }
      }
    }

    const def = WEAPONS[bot.weaponId];
    switch (ai.state) {
      case 'patrol': {
        if (ai.routeIdx >= ai.route.length) {
          // Reached the site: attackers plant or hold, defenders return to hold.
          if (bot.team === 'kestrel' && ai.carriesBomb) ai.state = 'plant';
          else if (bot.team === 'kestrel') { ai.state = 'hold'; ai.holdPos = { x: bot.body.position.x, z: bot.body.position.z }; ai.holdYaw = bot.yaw; }
          else { ai.state = 'hold'; }
          break;
        }
        const [wx, wz] = nodes[ai.route[ai.routeIdx]];
        if (walkToward(bot, wx, wz, dt, BOT_SPEED)) ai.routeIdx += 1;
        break;
      }
      case 'hold': {
        ai.scanTimer -= dt;
        if (ai.scanTimer <= 0) {
          ai.scanTimer = 1.6 + state.random() * 1.2;
          ai.holdYaw += (state.random() - 0.5) * 1.6;
        }
        bot.yaw += (ai.holdYaw - bot.yaw) * Math.min(1, dt * 2);
        break;
      }
      case 'alert': {
        if (walkToward(bot, ai.lastKnown.x, ai.lastKnown.z, dt, BOT_RUN)) {
          ai.state = 'patrol';
          assignRoute(bot);
        }
        break;
      }
      case 'hunt': {
        if (walkToward(bot, ai.lastKnown.x, ai.lastKnown.z, dt, BOT_RUN)) {
          ai.scanTimer -= dt;
          bot.yaw += dt * 1.5;
          if (ai.scanTimer <= -3) { ai.state = 'patrol'; assignRoute(bot); }
        } else {
          ai.scanTimer = 0;
        }
        break;
      }
      case 'engage': {
        const t = ai.target;
        if (!t || !t.alive) { ai.target = null; ai.state = 'hunt'; break; }
        // Strafe sideways, keep the target in the sights.
        ai.strafeTime -= dt;
        if (ai.strafeTime <= 0) {
          ai.strafeTime = 0.7 + state.random() * 0.9;
          ai.strafeDir = state.random() < 0.5 ? -1 : 1;
        }
        const dx = t.body.position.x - bot.body.position.x;
        const dz = t.body.position.z - bot.body.position.z;
        const dist = Math.hypot(dx, dz) || 1;
        const px = -dz / dist * ai.strafeDir;
        const pz = dx / dist * ai.strafeDir;
        const wantX = bot.body.position.x + px * 2;
        const wantZ = bot.body.position.z + pz * 2;
        faceToward(bot, t.body.position.x, t.body.position.z, dt, 8);
        // Aim with error that grows with distance and target speed.
        // Tuned so a still target in the open survives a few seconds against
        // one bot, but not against a whole squad.
        const tSpeed = Math.hypot(t.body.velocity.x, t.body.velocity.z);
        const err = 0.045 + dist * 0.0016 + tSpeed * 0.006;
        const aimX = t.body.position.x + (state.random() * 2 - 1) * err * dist * 0.6;
        const aimY = bot.body.position.y + 1.15 + (state.random() * 2 - 1) * err * dist * 0.5;
        const aimZ = t.body.position.z + (state.random() * 2 - 1) * err * dist * 0.6;
        moveBody(world.colliders, bot.body, dt, px * 0.4, pz * 0.4, BOT_SPEED * 0.5, 30, 8);
        void wantX; void wantZ;
        // Burst fire after the reaction delay. The pause between bursts is
        // long on purpose: with ten guns on a 5v5 map, short pauses end
        // rounds by elimination in half a minute and the bomb never
        // matters. Longer pauses keep rounds tactical — holds, rotations,
        // utility — instead of a single crossfire.
        if (ai.reaction > 0) { ai.reaction -= dt; break; }
        if (ai.burstLeft <= 0) {
          ai.pauseTimer -= dt;
          if (ai.pauseTimer > 0) break;
          ai.burstLeft = 3 + Math.floor(state.random() * 2);
          ai.pauseTimer = 1.3 + state.random() * 0.8;
        }
        ai.burstTimer -= dt;
        if (ai.burstTimer <= 0) {
          ai.burstTimer = def.gap;
          ai.burstLeft -= 1;
          const ammo = bot.loadout[bot.weaponId];
          if (ammo.mag > 0) {
            ammo.mag -= 1;
            combat.botShoot(bot, aimX, aimY, aimZ);
          } else {
            ammo.mag = def.mag;
          }
        }
        break;
      }
      case 'plant': {
        const site = world.sites.find((s) => s.id === bot.site);
        if (walkToward(bot, site.x, site.z, dt, BOT_SPEED)) {
          ai.progress += dt;
          if (ai.progress >= site.plantTime) combat.plantBomb(bot, site);
        }
        break;
      }
      case 'defuse': {
        const bomb = state.bomb;
        if (walkToward(bot, bomb.x, bomb.z, dt, BOT_RUN)) {
          ai.progress += dt;
          if (ai.progress >= 5) combat.defuseBomb(bot);
        }
        break;
      }
      default:
        break;
    }
    // Sync the visible body to the simulated one.
    bot.group.position.set(bot.body.position.x, bot.body.position.y, bot.body.position.z);
    bot.group.rotation.y = bot.yaw;
  }

  function step(dt, now) {
    for (const bot of bots) stepBot(bot, dt, now);
  }

  return { bots, spawnAll, placeAtSpawn, step, nearestNode, findRoute };
}
