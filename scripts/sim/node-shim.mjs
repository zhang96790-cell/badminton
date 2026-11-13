// Just enough of a browser for the game's simulation code to run in Node (no drawing, no sound).
const noop = () => {};
const el = () => ({ addEventListener: noop, removeEventListener: noop, style: {}, classList: { add: noop, remove: noop, toggle: noop }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }), appendChild: noop, setAttribute: noop, focus: noop });
const store = new Map();
globalThis.window = globalThis;
globalThis.document = { createElement: el, getElementById: el, addEventListener: noop, removeEventListener: noop, body: el(), documentElement: el(), visibilityState: 'visible', querySelector: () => null, querySelectorAll: () => [] };
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1280; globalThis.innerHeight = 720;
globalThis.requestAnimationFrame = () => 0;
globalThis.speechSynthesis = undefined;
