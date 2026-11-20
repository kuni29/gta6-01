// input.js — keyboard and mouse state for the game: held keys are polled every frame,
// one-shot presses (interact, pause, shoot, horn, mute) are queued as flags and taken once
// by the loop, so a press between frames is never lost or counted twice.

export const ACT_INTERACT = 1;   // E
export const ACT_PAUSE = 2;      // P or Esc
export const ACT_SHOOT = 4;      // Space or mouse click
export const ACT_PUNCH = 8;      // F
export const ACT_HORN = 16;      // H
export const ACT_MUTE = 32;      // M
export const ACT_ENTER_KEY = 64; // Enter (menus)

const HELD = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
};
const ONESHOT = {
  KeyE: ACT_INTERACT,
  KeyP: ACT_PAUSE,
  Escape: ACT_PAUSE,
  Space: ACT_SHOOT,
  KeyF: ACT_PUNCH,
  KeyH: ACT_HORN,
  KeyM: ACT_MUTE,
  Enter: ACT_ENTER_KEY,
};

export function createInput(canvas) {
  const held = { forward: false, back: false, left: false, right: false, run: false };
  const codeToHeld = new Map();
  for (const [name, codes] of Object.entries(HELD)) for (const c of codes) codeToHeld.set(c, name);
  let actions = 0;
  let mouseDown = false;

  window.addEventListener('keydown', (event) => {
    const name = codeToHeld.get(event.code);
    if (name) { held[name] = true; event.preventDefault(); return; }
    const act = ONESHOT[event.code];
    if (act && !event.repeat) { actions |= act; event.preventDefault(); }
  });
  window.addEventListener('keyup', (event) => {
    const name = codeToHeld.get(event.code);
    if (name) held[name] = false;
  });
  window.addEventListener('blur', () => {
    for (const k of Object.keys(held)) held[k] = false;
    mouseDown = false;
  });
  canvas.addEventListener('pointerdown', () => { mouseDown = true; actions |= ACT_SHOOT; });
  window.addEventListener('pointerup', () => { mouseDown = false; });

  return {
    held,
    /** -1..1 steering from the held keys. */
    steer() { return (held.right ? 1 : 0) - (held.left ? 1 : 0); },
    /** -1..1 throttle from the held keys. */
    throttle() { return (held.forward ? 1 : 0) - (held.back ? 1 : 0); },
    get mouseDown() { return mouseDown; },
    /** The one-shot presses since the last call, as ACT_* flags. */
    takeActions() { const a = actions; actions = 0; return a; },
    /**
     * Drop any queued presses without reading them. A run start calls this so a stray
     * click on the title screen (which queues ACT_SHOOT) never fires Rico's gun — or
     * pauses the game — on the very first frame of play.
     */
    drain() { actions = 0; },
    /** Test/shots hook: force held keys from a script (used by the screenshot autopilot). */
    setHeld(patch) { Object.assign(held, patch); },
    press(act) { actions |= act; },
  };
}
