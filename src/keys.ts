// Custom key binds for the single player (solo keyboard / trackpad and mouse modes).
import { KEYS, type KeyMap } from './config';

export type BindAction = 'up' | 'down' | 'left' | 'right' | 'jump' | 'high' | 'fast' | 'soft' | 'kill' | 'aimLeft' | 'aimRight';
export type KeyBinds = Partial<Record<BindAction, string>>;

/** In the order the editor lists them. `mouse`: also used in mouse mode (the mouse does the hitting there). */
export const BIND_ACTIONS: { action: BindAction; label: string; mouse: boolean }[] = [
  { action: 'up', label: 'Move forward', mouse: true },
  { action: 'down', label: 'Move back', mouse: true },
  { action: 'left', label: 'Move left', mouse: true },
  { action: 'right', label: 'Move right', mouse: true },
  { action: 'jump', label: 'Jump', mouse: true },
  { action: 'kill', label: 'Kill (instant full power)', mouse: true },
  { action: 'high', label: 'High shot (clear, lift)', mouse: false },
  { action: 'fast', label: 'Fast shot (smash, drive)', mouse: false },
  { action: 'soft', label: 'Soft shot (drop, net)', mouse: false },
  { action: 'aimLeft', label: 'Aim left', mouse: false },
  { action: 'aimRight', label: 'Aim right', mouse: false },
];

const MOVE: BindAction[] = ['up', 'down', 'left', 'right'];

/** Keys the game already uses for something else, and why. */
export const RESERVED: Record<string, string> = {
  Escape: 'pause / menu', Enter: 'start and skip', KeyH: 'challenge', KeyR: 'replay', KeyV: 'replay camera',
  KeyG: 'landing marker', KeyM: 'mute', KeyF: 'fullscreen', KeyQ: 'quit from pause', Tab: 'the browser',
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`Digit${i + 1}`, 'practice drills'])),
};

/** The default key for each action (solo keyboard map). */
export const defaultKey = (a: BindAction): string => KEYS.solo[a][0];

/** The key bound to an action right now. */
export const keyFor = (binds: KeyBinds | undefined, a: BindAction): string => binds?.[a] ?? defaultKey(a);

/** A base key map with the player's binds applied. Mouse mode only takes movement, jump and kill. */
export function applyBinds(base: KeyMap, binds: KeyBinds | undefined, mouse = false): KeyMap {
  const out: KeyMap = { ...base };
  for (const { action, mouse: inMouse } of BIND_ACTIONS) {
    if (mouse && !inMouse) continue;
    out[action] = [keyFor(binds, action)];
  }
  return out;
}

/**
 * Why a key can't go on an action (null if it can). Aim keys may never be movement keys:
 * moving and aiming on the same key collide.
 */
export function bindProblem(binds: KeyBinds | undefined, a: BindAction, code: string): string | null {
  if (RESERVED[code]) return `${keyLabel(code)} is used for ${RESERVED[code]}`;
  if (/^(Meta|OS|ContextMenu|CapsLock|Fn)/.test(code)) return `${keyLabel(code)} can’t be used`;
  const isAim = a === 'aimLeft' || a === 'aimRight';
  const holder = BIND_ACTIONS.find((b) => b.action !== a && keyFor(binds, b.action) === code)?.action;
  if (isAim && holder && MOVE.includes(holder)) return `${keyLabel(code)} moves you, so it can’t also aim`;
  if (MOVE.includes(a) && holder && (holder === 'aimLeft' || holder === 'aimRight')) return `${keyLabel(code)} aims, so it can’t also move you`;
  return null;
}

/** Bind a key, swapping with whichever action had it. Returns the new binds and the action it swapped with. */
export function bind(binds: KeyBinds | undefined, a: BindAction, code: string): { binds: KeyBinds; swapped: BindAction | null } {
  const next: KeyBinds = { ...binds };
  const old = keyFor(binds, a);
  const holder = BIND_ACTIONS.find((b) => b.action !== a && keyFor(binds, b.action) === code)?.action ?? null;
  next[a] = code;
  if (holder) next[holder] = old;
  // Drop entries that match the default, so the saved settings stay small.
  for (const { action } of BIND_ACTIONS) if (next[action] === defaultKey(action)) delete next[action];
  return { binds: next, swapped: holder };
}

const NAMES: Record<string, string> = {
  Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']',
  Minus: '-', Equal: '=', Backquote: '`', Backspace: 'Backspace', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab',
};

/** Short on-screen name for a key code: KeyJ → J, ArrowUp → ↑, Numpad4 → Num 4. */
export function keyLabel(code: string): string {
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}
