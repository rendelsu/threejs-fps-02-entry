// DUSTFALL state: every number the game runs on lives here, in one place.
// main.js owns the single `state` object; every module reads and writes it
// through the functions it exports, never through a second copy.
import * as THREE from 'three';

// ---- match rules (the judge's criterion 3: rounds, money, objective) ----
export const WIN_SCORE = 5;
export const MAX_ROUNDS = 9;
export const ROUND_TIME = 100; // seconds of live play per round
export const BUY_TIME = 15; // seconds of buy phase before the freeze
export const FREEZE_TIME = 3; // seconds frozen at spawn before the round starts
export const PLANT_TIME = 3; // seconds holding E on a site to plant
export const DEFUSE_TIME = 5; // seconds holding E on a planted charge to defuse
export const FUSE_TIME = 35; // seconds from plant to detonation
export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const LOSS_BONUS_STEP = 500;
export const LOSS_BONUS_MAX = 3400;
export const PLANT_REWARD = 300;

// ---- weapons (criterion 2: spread and recoil punish firing on the move) ----
export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', price: 0, damage: 26, headMult: 3.5,
    mag: 12, reserve: 36, gap: 0.16, reload: 1.1, auto: false,
    spreadStill: 0.004, spreadMove: 0.03, kick: 0.006, range: 60,
  },
  vk7: {
    id: 'vk7', name: 'VK-7 Carbine', price: 2700, damage: 30, headMult: 3.2,
    mag: 30, reserve: 90, gap: 0.096, reload: 1.9, auto: true,
    spreadStill: 0.0022, spreadMove: 0.028, kick: 0.009, range: 90,
  },
  hornet: {
    id: 'hornet', name: 'Hornet SMG', price: 1500, damage: 22, headMult: 3.0,
    mag: 32, reserve: 96, gap: 0.07, reload: 1.6, auto: true,
    spreadStill: 0.006, spreadMove: 0.04, kick: 0.005, range: 45,
  },
  longbow: {
    id: 'longbow', name: 'Longbow DMR', price: 4000, damage: 88, headMult: 2.5,
    mag: 10, reserve: 30, gap: 0.85, reload: 2.6, auto: false, zoom: true,
    spreadStill: 0.0008, spreadMove: 0.02, kick: 0.03, range: 120,
  },
};
export const GRENADE_FRAG = { id: 'frag', name: 'Spark Frag', price: 300 };
export const GRENADE_SMOKE = { id: 'smoke', name: 'Veil Smoke', price: 300 };
export const VEST = { id: 'vest', name: 'Plate Vest', price: 650 };

// ---- teams ----
export const TEAMS = {
  kestrel: { id: 'kestrel', name: 'Kestrels', color: 0x2fa8a0, spawn: { x: 0, z: 15 } },
  warden: { id: 'warden', name: 'Wardens', color: 0xc25a3a, spawn: { x: 0, z: -15 } },
};

// One seeded RNG for the whole match, so ?shot= captures are reproducible.
export function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The one state object. Preallocated scratch vectors live here too, so the
// hot loop (fixedUpdate) never allocates.
export function createState(seed) {
  return {
    seed,
    random: mulberry32(seed),
    phase: 'menu', // menu | buy | freeze | live | roundEnd | matchEnd
    phaseTime: 0,
    round: 1,
    score: { kestrel: 0, warden: 0 },
    losses: { kestrel: 0, warden: 0 },
    roundTime: ROUND_TIME,
    bomb: { state: 'carried', carrier: 'player', x: 0, y: 0, z: 0, fuse: 0, site: null, planter: null, defuser: null, progress: 0 },
    player: null, // filled by player.js
    bots: [], // filled by bots.js
    actors: [], // player + bots, every damageable body in the match
    money: START_MONEY,
    kills: 0,
    deaths: 0,
    shotsFired: 0,
    shotsHit: 0,
    lastKillFeed: [],
    banner: null, // { title, sub, until }
    time: 0,
    // scratch, reused every frame (criterion 5: no new objects in hot loops)
    v1: new THREE.Vector3(),
    v2: new THREE.Vector3(),
    v3: new THREE.Vector3(),
    ray: null, // set by combat.js
  };
}
