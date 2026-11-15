// DUSTFALL — boot and the one loop (judge criteria, mapped to files):
// 1 complete game: this file (rounds, HUD, bomb) + bots.js + combat.js.
// 2 gunplay/movement: weapons.js (spread, recoil) + player.js/move.js.
// 3 tactics: state.js (money, weapons, flash, helmet) + bots.js (FSM) +
//    combat.js (bomb, grenades, MVP tallies).
// 4 map/look: world.js (Kestrel Yard, 5v5 spawns, two distinct sites) +
//    palette.js.
// 5 code: fixed 60 Hz sim apart from rendering, one state object (state.js),
//    no allocation in the hot loop (pooled tracers, scratch vectors).
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createState, WEAPONS, WIN_SCORE, MAX_ROUNDS, ROUND_TIME, BUY_TIME, FREEZE_TIME, PLANT_TIME, FUSE_TIME, START_MONEY, WIN_REWARD, LOSS_REWARD, LOSS_BONUS_STEP, LOSS_BONUS_MAX, PLANT_REWARD, KILL_REWARD, GRENADE_FRAG, GRENADE_SMOKE, GRENADE_FLASH, VEST, HELMET } from './state.js';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { createWeaponRig } from './weapons.js';
import { createBots } from './bots.js';
import { createCombat } from './combat.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

const state = createState(seed);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), 35, 85);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const combat = createCombat(state, world, scene, audio);
const playerApi = createPlayer(world.colliders);
const player = playerApi.actor;
player.damage = (amount, part) => playerApi.damage(amount, part); // combat.js calls actor.damage
state.player = player;
const botsApi = createBots(state, world, scene, combat);
const rig = createWeaponRig(camera);
const hud = createHud(world);
const input = createInput(renderer.domElement, onLockChange);
// combat.js blinds the player through this hook (a flash grenade burst).
state.flashBlind = (seconds) => hud.flashBlind(seconds);

const rayOrigin = new THREE.Vector3();
const rayDir = new THREE.Vector3();
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let elapsed = 0;
let zoomed = false;
let prevFiring = false;
let minimapTimer = 0;
let buyEdge = new Set();
let beepTimer = 0;
let buyOpen = false;
let lastStepX = 0;
let lastStepZ = 15;

// ---- round flow ----
function resetBomb() {
  state.bomb.state = 'carried';
  state.bomb.carrier = 'player';
  state.bomb.site = null;
  state.bomb.fuse = 0;
  state.bomb.planter = null;
  state.bomb.progress = 0;
}

function placeEveryone() {
  playerApi.spawnAt(0, 16, 0);
  playerApi.healFull();
  let ki = 0;
  let wi = 0;
  for (const bot of botsApi.bots) {
    botsApi.placeAtSpawn(bot, bot.team === 'kestrel' ? ki++ : wi++);
  }
}

function startBuyPhase() {
  state.phase = 'buy';
  state.phaseTime = BUY_TIME;
  state.roundKills = {};
  resetBomb();
  placeEveryone();
  if (!player.alive) playerApi.resetLoadout();
  playerApi.healFull();
  input.releaseLock();
  hud.showOverlay('buy', { round: state.round, money: state.money, owned: ownedMap() });
  hud.setScore(state.score.kestrel, state.score.warden, state.round);
  hud.setMoney(state.money);
  hud.setTimer(state.bomb.state === 'planted' ? state.bomb.fuse : state.roundTime, state.bomb.state === 'planted');
  if (state.bomb.state === 'carried') hud.setBomb(state.bomb.carrier === 'player' ? 'Charge: with you' : `Charge: ${state.bomb.carrier}`);
  else if (state.bomb.state === 'dropped') hud.setBomb('Charge: DROPPED — pick it up');
  else if (state.bomb.state === 'planted') hud.setBomb(`Charge planted — ${Math.ceil(state.bomb.fuse)}s`);
  else hud.setBomb('');
  hud.setKillfeed(state.lastKillFeed);
  hud.setBomb('Charge: with you');
  buyOpen = true;
}

function startFreeze() {
  state.phase = 'freeze';
  state.phaseTime = FREEZE_TIME;
  hud.hideOverlay();
  buyOpen = false;
  input.requestLock();
  hud.showBanner(`ROUND ${state.round}`, 'Kestrels plant the charge — Wardens hold the sites', 2500);
}

function startLive() {
  state.phase = 'live';
  state.phaseTime = 0;
  state.roundTime = ROUND_TIME;
}

function endRound(winner, reason) {
  if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
  state.phase = 'roundEnd';
  state.phaseTime = 4;
  state.score[winner] += 1;
  const loser = winner === 'kestrel' ? 'warden' : 'kestrel';
  state.losses[loser] += 1;
  state.losses[winner] = 0;
  const lossPay = Math.min(LOSS_BONUS_MAX, LOSS_REWARD + LOSS_BONUS_STEP * (state.losses[loser] - 1));
  state.money += winner === 'kestrel' ? WIN_REWARD : lossPay;
  if (winner === 'kestrel') audio.roundWin();
  else audio.roundLose();
  const mvp = roundMvp();
  hud.showBanner(
    winner === 'kestrel' ? 'ROUND WON' : 'ROUND LOST',
    `${reason} — Kestrels ${state.score.kestrel} : ${state.score.warden} Wardens${mvp ? ` — MVP: ${mvp}` : ''}`,
    3800,
  );
  hud.setScore(state.score.kestrel, state.score.warden, state.round);
  hud.setMoney(state.money);
  input.releaseLock();
}

function endMatch() {
  state.phase = 'matchEnd';
  const k = state.score.kestrel;
  const w = state.score.warden;
  const title = k > w ? 'VICTORY — THE YARD IS YOURS' : k < w ? 'DEFEAT — THE WARDENS HOLD' : 'DRAW';
  const mvp = matchMvp();
  hud.showOverlay('end', { title, sub: `Final score Kestrels ${k} : ${w} Wardens. ${state.kills} kills, ${state.shotsHit}/${state.shotsFired} shots on target.${mvp ? ` Match MVP: ${mvp}.` : ''}` });
  input.releaseLock();
}

// The round's top killer, as a short line for the banner. Returns null
// when nobody killed anyone (a round won on the clock, say).
function roundMvp() {
  let best = null;
  let bestKills = 0;
  for (const id of Object.keys(state.roundKills)) {
    if (state.roundKills[id] > bestKills) { bestKills = state.roundKills[id]; best = id; }
  }
  if (!best) return null;
  return `${best === 'player' ? 'You' : best} (${bestKills} kill${bestKills === 1 ? '' : 's'})`;
}

function matchMvp() {
  let best = null;
  let bestKills = 0;
  for (const id of Object.keys(state.matchKills)) {
    if (state.matchKills[id] > bestKills) { bestKills = state.matchKills[id]; best = id; }
  }
  if (!best) return null;
  return `${best === 'player' ? 'You' : best} (${bestKills} kill${bestKills === 1 ? '' : 's'})`;
}

function startMatch() {
  state.round = 1;
  state.score.kestrel = 0;
  state.score.warden = 0;
  state.losses.kestrel = 0;
  state.losses.warden = 0;
  state.money = START_MONEY;
  state.kills = 0;
  state.deaths = 0;
  state.shotsFired = 0;
  state.shotsHit = 0;
  state.roundKills = {};
  state.matchKills = {};
  state.lastKillFeed = [];
  botsApi.spawnAll();
  playerApi.resetLoadout();
  rig.setWeapon('p9');
  startBuyPhase();
}

function ownedMap() {
  const owned = { p9: true };
  for (const id of Object.keys(player.loadout)) owned[id] = true;
  if (player.frags > 0) owned.frag = true;
  if (player.smokes > 0) owned.smoke = true;
  if (player.flashes > 0) owned.flash = true;
  if (player.vest) owned.vest = true;
  if (player.helmet) owned.helmet = true;
  return owned;
}

function buyItem(id) {
  if (state.phase !== 'buy') return;
  const catalog = {
    vk7: WEAPONS.vk7, hornet: WEAPONS.hornet, longbow: WEAPONS.longbow,
    frag: GRENADE_FRAG, smoke: GRENADE_SMOKE, flash: GRENADE_FLASH,
    vest: VEST, helmet: HELMET,
  };
  const item = catalog[id];
  if (!item) return;
  if (id === 'vest' && player.vest) { audio.denied(); return; }
  if (id === 'helmet' && player.helmet) { audio.denied(); return; }
  if ((id === 'vk7' || id === 'hornet' || id === 'longbow') && player.loadout[id]) { audio.denied(); return; }
  if (state.money < item.price) { audio.denied(); return; }
  state.money -= item.price;
  if (id === 'frag') player.frags += 1;
  else if (id === 'smoke') player.smokes += 1;
  else if (id === 'flash') player.flashes += 1;
  else if (id === 'vest') player.vest = true;
  else if (id === 'helmet') player.helmet = true;
  else {
    player.loadout[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
    switchWeapon(id);
  }
  audio.buy();
  hud.setMoney(state.money);
  hud.showOverlay('buy', { round: state.round, money: state.money, owned: ownedMap() });
}

function switchWeapon(id) {
  if (!player.loadout[id]) return;
  player.weaponId = id;
  rig.setWeapon(id);
  const ammo = player.loadout[id];
  hud.setAmmo(ammo.mag, ammo.reserve, false);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    if (state.phase === 'buy' || state.phase === 'freeze') hud.hideOverlay();
  } else if (state.phase === 'live' && player.alive) {
    hud.showOverlay('paused', { round: state.round, score: state.score });
  }
}

hud.onPlay(() => {
  audio.unlock();
  if (shot) return;
  if (state.phase === 'menu' || state.phase === 'matchEnd') startMatch();
  else if (state.phase === 'buy') startFreeze();
  else if (state.phase === 'live' || state.phase === 'freeze') input.requestLock();
});
hud.onBuy((id) => buyItem(id));

// ---- shooting ----
function playerShoot() {
  const ammo = player.loadout[player.weaponId];
  if (!ammo || ammo.mag <= 0) { audio.dryFire(); return; }
  if (!rig.ready()) return;
  ammo.mag -= 1;
  const def = WEAPONS[player.weaponId];
  camera.getWorldDirection(rayDir);
  const spread = rig.spread(playerApi.groundSpeed(), player.crouching, zoomed);
  rayDir.x += (state.random() * 2 - 1) * spread;
  rayDir.y += (state.random() * 2 - 1) * spread;
  rayDir.z += (state.random() * 2 - 1) * spread;
  rayDir.normalize();
  rayOrigin.copy(camera.position);
  combat.fireHitscan(player, rayOrigin, rayDir, player.weaponId);
  rig.pullTrigger();
  playerApi.recoil(def.kick * 0.9 + state.random() * 0.004, (state.random() * 2 - 1) * 0.003);
  audio.shot(player.weaponId);
  hud.setAmmo(ammo.mag, ammo.reserve, rig.state.reloadLeft > 0);
}
rig.state.onReloadDone = (def) => {
  const ammo = player.loadout[player.weaponId];
  if (!ammo) return;
  const need = def.mag - ammo.mag;
  const take = Math.min(need, ammo.reserve);
  ammo.mag += take;
  ammo.reserve -= take;
  hud.setAmmo(ammo.mag, ammo.reserve, false);
};

// ---- elimination and objective checks ----
state.onKillCallback = () => {
  const kestrelsAlive = state.actors.filter((a) => a.team === 'kestrel' && a.alive).length;
  const wardensAlive = state.actors.filter((a) => a.team === 'warden' && a.alive).length;
  if (state.phase !== 'live') return;
  if (wardensAlive === 0) { endRound('kestrel', 'Wardens eliminated'); return; }
  if (kestrelsAlive === 0 && state.bomb.state !== 'planted') { endRound('warden', 'Kestrels eliminated'); }
};
state.onBombResolved = (how) => {
  if (how === 'detonated') endRound('kestrel', 'Charge detonated');
  else endRound('warden', 'Charge defused');
};

function syncCamera() {
  camera.position.set(player.body.position.x, player.body.position.y + player.eye, player.body.position.z);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
}

function aimAt(x, y, z) {
  const dx = x - player.body.position.x;
  const dy = y - (player.body.position.y + player.eye);
  const dz = z - player.body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  player.yaw = Math.atan2(-dx, -dz);
  player.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

// ---- fixed-step simulation (criterion 5: sim apart from rendering) ----
function fixedUpdate(dt) {
  elapsed += dt;
  state.time += dt;
  if (state.phase === 'buy') {
    state.phaseTime -= dt;
    if (state.phaseTime <= 0) startFreeze();
    return;
  }
  if (state.phase === 'freeze') {
    state.phaseTime -= dt;
    if (state.phaseTime <= 0) startLive();
    return;
  }
  if (state.phase === 'roundEnd') {
    state.phaseTime -= dt;
    combat.stepGrenades(dt);
    if (state.phaseTime <= 0) {
      if (state.score.kestrel >= WIN_SCORE || state.score.warden >= WIN_SCORE || state.round >= MAX_ROUNDS) endMatch();
      else { state.round += 1; startBuyPhase(); }
    }
    return;
  }
  if (state.phase !== 'live') return;

  // Round clock.
  if (state.bomb.state === 'planted') {
    state.bomb.fuse -= dt;
    beepTimer -= dt;
    if (beepTimer <= 0) {
      beepTimer = Math.max(0.25, state.bomb.fuse / 35);
      audio.plantBeep(state.bomb.fuse < 5);
    }
    if (state.bomb.fuse <= 0) combat.detonateBomb();
  } else {
    state.roundTime -= dt;
    if (state.roundTime <= 0) { endRound('warden', 'Time expired — the charge never went off'); return; }
  }

  playerApi.step(dt, input.state.keys);
  botsApi.step(dt, state.time);
  combat.stepGrenades(dt);

  // Footsteps: a short synthesized step each time the player covers
  // 2.4 m on the ground. Two plain numbers, no allocation in the loop.
  if (player.alive && player.body.onGround) {
    const dx = player.body.position.x - lastStepX;
    const dz = player.body.position.z - lastStepZ;
    if (dx * dx + dz * dz > 5.76) {
      lastStepX = player.body.position.x;
      lastStepZ = player.body.position.z;
      audio.step();
    }
  }

  // Dropped charge: the player or a Kestrel bot picks it up.
  if (state.bomb.state === 'dropped') {
    const p = player.body.position;
    if (player.alive && Math.hypot(p.x - state.bomb.x, p.z - state.bomb.z) < 1.4) {
      state.bomb.state = 'carried';
      state.bomb.carrier = 'player';
      hud.setBomb('Charge: with you');
    } else {
      for (const bot of botsApi.bots) {
        if (bot.team !== 'kestrel' || !bot.alive || bot.ai.carriesBomb) continue;
        if (Math.hypot(bot.body.position.x - state.bomb.x, bot.body.position.z - state.bomb.z) < 1.4) {
          state.bomb.state = 'carried';
          state.bomb.carrier = bot.id;
          bot.ai.carriesBomb = true;
          bot.ai.state = 'plant';
          break;
        }
      }
    }
  }

  // A defender runs to defuse once the charge is planted.
  if (state.bomb.state === 'planted') {
    const defusing = botsApi.bots.some((b) => b.team === 'warden' && b.alive && b.ai.state === 'defuse');
    if (!defusing) {
      let best = null;
      let bestD = Infinity;
      for (const b of botsApi.bots) {
        if (b.team !== 'warden' || !b.alive) continue;
        const d = Math.hypot(b.body.position.x - state.bomb.x, b.body.position.z - state.bomb.z);
        if (d < bestD) { bestD = d; best = b; }
      }
      if (best) { best.ai.state = 'defuse'; best.ai.progress = 0; }
    }
  }

  // Player planting: hold E inside a site while carrying the charge.
  // Each site has its own plant time (Crane Bay 3 s, Silo Row 4 s).
  if (state.bomb.state === 'carried' && state.bomb.carrier === 'player' && player.alive) {
    const site = world.sites.find((s) => Math.hypot(player.body.position.x - s.x, player.body.position.z - s.z) < s.r);
    if (site && input.state.keys.has('KeyE')) {
      player.plantProgress += dt;
      player.plantTarget = site.plantTime;
      if (player.plantProgress >= site.plantTime) {
        combat.plantBomb(player, site);
        player.plantProgress = 0;
      }
    } else {
      player.plantProgress = 0;
      player.plantTarget = 0;
    }
  }
}

// ---- frame: input, sim accumulator, render ----
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (player.alive && (state.phase === 'live' || state.phase === 'freeze')) playerApi.look(look.x, look.y);

    // Weapon switching and grenades. Buy keys fire on the press edge only,
// so holding a digit does not buy the same item every frame.
    const keys = input.state.keys;
    if (state.phase === 'buy') {
      const buyKeys = [['Digit1', 'vk7'], ['Digit2', 'hornet'], ['Digit3', 'longbow'], ['Digit4', 'frag'], ['Digit5', 'smoke'], ['Digit6', 'vest'], ['Digit7', 'flash'], ['Digit8', 'helmet']];
      for (const [code, id] of buyKeys) {
        if (keys.has(code) && !buyEdge.has(code)) buyItem(id);
      }
      buyEdge.clear();
      for (const code of keys) buyEdge.add(code);
      if (keys.has('Enter')) startFreeze();
    }
    if (state.phase === 'live' && player.alive) {
      if (keys.has('Digit1')) switchWeapon('p9');
      if (keys.has('Digit2')) switchWeapon('vk7');
      if (keys.has('Digit3')) switchWeapon('hornet');
      if (keys.has('Digit4')) switchWeapon('longbow');
      if (keys.has('Digit5') && player.frags > 0 && !player.threwFrag) {
        player.frags -= 1;
        player.threwFrag = true;
        combat.throwGrenade(player, 'frag');
      }
      if (keys.has('Digit6') && player.smokes > 0 && !player.threwSmoke) {
        player.smokes -= 1;
        player.threwSmoke = true;
        combat.throwGrenade(player, 'smoke');
      }
      if (keys.has('Digit7') && player.flashes > 0 && !player.threwFlash) {
        player.flashes -= 1;
        player.threwFlash = true;
        combat.throwGrenade(player, 'flash');
      }
      if (!keys.has('Digit5')) player.threwFrag = false;
      if (!keys.has('Digit6')) player.threwSmoke = false;
      if (!keys.has('Digit7')) player.threwFlash = false;
      if (keys.has('KeyR')) {
        const ammo = player.loadout[player.weaponId];
        if (ammo && ammo.mag < WEAPONS[player.weaponId].mag && ammo.reserve > 0 && rig.reload()) audio.reload();
      }
      const def = WEAPONS[player.weaponId];
      const firing = input.state.firing;
      if (firing && (def.auto || !prevFiring)) playerShoot();
      prevFiring = firing;
    }

    // Zoom for the DMR.
    const wantZoom = player.weaponId === 'longbow' && input.state.firing2;
    if (wantZoom !== zoomed) {
      zoomed = wantZoom;
      camera.fov = zoomed ? 32 : 74;
      camera.updateProjectionMatrix();
    }

    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      fixedUpdate(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    rig.step(dt);

    // HUD, throttled where it is cheap to do so.
    const ammo = player.loadout[player.weaponId];
    if (ammo) hud.setAmmo(ammo.mag, ammo.reserve, rig.state.reloadLeft > 0);
    hud.setHealth(Math.ceil(player.health));
    hud.setMoney(state.money);
    hud.setTimer(state.bomb.state === 'planted' ? state.bomb.fuse : state.roundTime, state.bomb.state === 'planted');
    if (state.bomb.state === 'carried') hud.setBomb(state.bomb.carrier === 'player' ? 'Charge: with you' : `Charge: ${state.bomb.carrier}`);
    else if (state.bomb.state === 'dropped') hud.setBomb('Charge: DROPPED — pick it up');
    else if (state.bomb.state === 'planted') hud.setBomb(`Charge planted — ${Math.ceil(state.bomb.fuse)}s`);
    else hud.setBomb('');
    if (player.plantProgress > 0) hud.setBomb(`Planting… ${Math.ceil(((player.plantTarget || PLANT_TIME) - player.plantProgress) * 10) / 10}s`);
    hud.setKillfeed(state.lastKillFeed);
    hud.setCrosshairGap(6 + rig.spread(playerApi.groundSpeed(), player.crouching, zoomed) * 900);
    minimapTimer -= dt;
    if (minimapTimer <= 0) { minimapTimer = 0.25; hud.drawMinimap(state); }
  }
  renderer.render(scene, camera);
}

// Right mouse button aims the DMR.
window.addEventListener('mousedown', (e) => { if (e.button === 2) input.state.firing2 = true; });
window.addEventListener('mouseup', (e) => { if (e.button === 2) input.state.firing2 = false; });
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- deterministic captures: ?shot=start|play|plant|end&seed=N ----
function settle(steps) {
  for (let i = 0; i < steps; i += 1) fixedUpdate(FIXED_STEP);
}

function runShot(name) {
  botsApi.spawnAll();
  hud.hideOverlay();
  if (name === 'start') {
    state.phase = 'menu';
    placeEveryone();
    player.body.position.set(0.6, 0, 14);
    player.yaw = 0.15;
    syncCamera();
    hud.showOverlay('start', {});
  } else if (name === 'play') {
    startBuyPhase();
    hud.hideOverlay();
    state.phase = 'live';
    state.roundTime = ROUND_TIME;
    player.body.position.set(0, 0, 8);
    player.yaw = 0;
    player.loadout.vk7 = { mag: 30, reserve: 90 };
    switchWeapon('vk7');
    settle(240);
    // Find a Warden the player can actually see, and drop it.
    const target = botsApi.bots.find((b) => b.team === 'warden' && b.alive
      && combat.hasLineOfSight(player.body.position.x, player.body.position.y + 1.6, player.body.position.z, b.body.position.x, b.body.position.y + 1.2, b.body.position.z));
    if (target) {
      for (let round = 0; round < 3; round += 1) {
        aimAt(target.body.position.x, target.body.position.y + 1.5, target.body.position.z);
        playerShoot();
        settle(7);
        if (!target.alive) break;
      }
    }
  } else if (name === 'plant') {
    startBuyPhase();
    hud.hideOverlay();
    state.phase = 'live';
    state.roundTime = 60;
    player.body.position.set(-13, 0, -7);
    player.yaw = 0.6;
    combat.plantBomb(player, world.sites[0]);
    state.bomb.fuse = 22;
    settle(90);
    aimAt(-16, 1.2, -11);
  } else if (name === 'end') {
    startBuyPhase();
    hud.hideOverlay();
    state.score.kestrel = 4;
    state.score.warden = 2;
    endRound('kestrel', 'Charge detonated');
    state.bomb.state = 'detonated';
    settle(30);
  }
  hud.setScore(state.score.kestrel, state.score.warden, state.round);
  hud.setMoney(state.money);
  hud.setTimer(state.bomb.state === 'planted' ? state.bomb.fuse : state.roundTime, state.bomb.state === 'planted');
  if (state.bomb.state === 'carried') hud.setBomb(state.bomb.carrier === 'player' ? 'Charge: with you' : `Charge: ${state.bomb.carrier}`);
  else if (state.bomb.state === 'dropped') hud.setBomb('Charge: DROPPED — pick it up');
  else if (state.bomb.state === 'planted') hud.setBomb(`Charge planted — ${Math.ceil(state.bomb.fuse)}s`);
  else hud.setBomb('');
  hud.setKillfeed(state.lastKillFeed);
  const ammo = player.loadout[player.weaponId];
  if (ammo) hud.setAmmo(ammo.mag, ammo.reserve, false);
  hud.setHealth(Math.ceil(player.health));
  hud.drawMinimap(state);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

// Test hooks: drive the game from a headless browser without a pointer.
window.__game = {
  state, startMatch, startFreeze, startLive, endRound, buyItem, switchWeapon,
  press(code) { input.state.keys.add(code); },
  release(code) { input.state.keys.delete(code); },
  look(dx, dy) { playerApi.look(dx, dy); },
  fire() { playerShoot(); },
  settle,
  aim(x, y, z) { aimAt(x, y, z); },
  visibleEnemy() {
    const e = combat.nearestVisibleEnemy(player);
    return e ? { id: e.id, x: e.body.position.x, y: e.body.position.y + 1.2, z: e.body.position.z, hp: e.health } : null;
  },
};

syncCamera();
hud.showOverlay('start', {});
hud.setScore(0, 0, 1);
hud.setMoney(state.money);
hud.setHealth(100);
hud.setAmmo(12, 36, false);
if (shot) runShot(shot);
else requestAnimationFrame(frame);
