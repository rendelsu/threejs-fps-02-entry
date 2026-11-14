// Weapons: the view model, the fire rhythm and the spread that punishes
// firing on the move. One rig, rebuilt only when the weapon changes;
// the hot loop only ticks timers (criterion 5: no allocation per frame).
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS } from './state.js';

const MODEL_SPECS = {
  p9: { receiver: [0.07, 0.08, 0.24], barrel: [0.04, 0.04, 0.18], stock: null, color: 0x8a7f6c },
  vk7: { receiver: [0.09, 0.1, 0.42], barrel: [0.045, 0.045, 0.4], stock: [0.075, 0.08, 0.22], color: 0xe9e2d2 },
  hornet: { receiver: [0.08, 0.09, 0.34], barrel: [0.05, 0.05, 0.3], stock: [0.07, 0.07, 0.16], color: 0x2fa8a0 },
  longbow: { receiver: [0.08, 0.1, 0.6], barrel: [0.035, 0.035, 0.55], stock: [0.075, 0.09, 0.26], color: 0xc25a3a },
};

export function createWeaponRig(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const model = new THREE.Group();
  model.position.set(0.24, -0.2, -0.42);
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const state = { id: 'p9', cooldown: 0, reloadLeft: 0, reloadTotal: 1, flash: 0, kick: 0, zoomed: false };

  function buildModel(id) {
    while (model.children.length > 0) model.remove(model.children[0]);
    const spec = MODEL_SPECS[id];
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.color), roughness: 0.5, metalness: 0.35 });
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(spec.receiver[0], spec.receiver[1], spec.receiver[2]), mat);
    model.add(receiver);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(spec.barrel[0], spec.barrel[1], spec.barrel[2]), grip);
    barrel.position.set(0, 0.025, -spec.receiver[2] / 2 - spec.barrel[2] / 2 + 0.06);
    model.add(barrel);
    if (spec.stock) {
      const stock = new THREE.Mesh(new THREE.BoxGeometry(spec.stock[0], spec.stock[1], spec.stock[2]), grip);
      stock.position.set(0, -0.02, spec.receiver[2] / 2 + spec.stock[2] / 2 - 0.04);
      model.add(stock);
    }
    if (id === 'longbow') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 10), body);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.08, -0.05);
      model.add(scope);
    }
  }
  buildModel('p9');

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const def = WEAPONS[state.id];
      model.rotation.x = -0.55 * Math.sin((1 - state.reloadLeft / state.reloadTotal) * Math.PI);
      if (state.reloadLeft === 0 && state.onReloadDone) state.onReloadDone(def);
    }
  }

  return {
    state,
    step,
    setWeapon(id) {
      if (state.id === id) return;
      state.id = id;
      state.reloadLeft = 0;
      state.cooldown = 0;
      buildModel(id);
    },
    ready() {
      return state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      const def = WEAPONS[state.id];
      state.cooldown = def.gap;
      state.flash = 0.06;
      state.kick = 0.02 + def.kick;
    },
    reload() {
      const def = WEAPONS[state.id];
      if (state.reloadLeft > 0) return false;
      state.reloadLeft = def.reload;
      state.reloadTotal = def.reload;
      return true;
    },
    spread(speed, crouching, zoomed) {
      const def = WEAPONS[state.id];
      let s = def.spreadStill + Math.min(1, speed / 5.2) * def.spreadMove;
      if (crouching) s *= 0.7;
      if (zoomed) s *= 0.4;
      return s;
    },
  };
}
