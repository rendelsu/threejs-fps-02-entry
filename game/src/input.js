// Keyboard and mouse: pointer lock for look, a Set of held keys, and the
// fire button. The game starts only on a click (pointer lock needs a
// gesture), and releases the lock when the player pauses.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const state = { keys, firing: false, lookX: 0, lookY: 0 };

  function onKeyDown(event) {
    if (event.repeat) return;
    keys.add(event.code);
    if (event.code === 'Space') event.preventDefault();
  }
  function onKeyUp(event) {
    keys.delete(event.code);
  }
  function onMouseMove(event) {
    if (document.pointerLockElement !== canvas) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  }
  function onMouseDown(event) {
    if (document.pointerLockElement !== canvas) return;
    if (event.button === 0) state.firing = true;
  }
  function onMouseUp(event) {
    if (event.button === 0) state.firing = false;
  }
  function onLock() {
    onLockChange(document.pointerLockElement === canvas);
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLock);

  return {
    state,
    requestLock() {
      try {
        const p = canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* headless or denied: the game still runs */ }
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const out = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return out;
    },
    clear() {
      keys.clear();
      state.firing = false;
      state.lookX = 0;
      state.lookY = 0;
    },
  };
}
