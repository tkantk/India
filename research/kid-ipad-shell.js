/* ---------- 1. AUDIO UNLOCK (must run inside a real touchend/click) ---------- */
const Narration = (() => {
  let ctx = null, unlocked = false;
  const buffers = new Map();          // url -> AudioBuffer (LRU-capped)
  let current = null;

  function ensureCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  // Call from the "Start" button's click handler. iOS requires the resume()
  // to happen synchronously inside a touchend/click/keydown handler.
  async function unlock() {
    const c = ensureCtx();
    if (c.state === 'suspended') await c.resume();
    // play one silent sample so iOS marks the context as user-activated
    const b = c.createBuffer(1, 1, 22050);
    const s = c.createBufferSource();
    s.buffer = b; s.connect(c.destination); s.start(0);
    unlocked = true;
    return c.state === 'running';
  }

  async function load(url) {
    if (buffers.has(url)) return buffers.get(url);
    const res = await fetch(url);
    const buf = await ensureCtx().decodeAudioData(await res.arrayBuffer());
    if (buffers.size > 12) buffers.delete(buffers.keys().next().value); // LRU-ish
    buffers.set(url, buf);
    return buf;
  }

  async function play(url, { onStart, onEnd } = {}) {
    if (!unlocked) return false;
    stop();
    const buf = await load(url);
    const src = ensureCtx().createBufferSource();
    src.buffer = buf;
    src.connect(ensureCtx().destination);
    src.onended = () => { current = null; onEnd && onEnd(); };
    src.start(0);
    current = src;
    onStart && onStart();
    return true;
  }

  function stop() { if (current) { try { current.onended = null; current.stop(); } catch (e) {} current = null; } }

  // iPad has no ringer switch, but Control Center mute silences this.
  // There is no web API to detect it -> verify with a "did you hear that?" step.
  return { unlock, play, stop, get running() { return ctx && ctx.state === 'running'; } };
})();

/* ---------- 2. BLOCK PAGE PINCH-ZOOM (Safari ignores user-scalable=no) ------ */
['gesturestart', 'gesturechange', 'gestureend'].forEach(t =>
  document.addEventListener(t, e => e.preventDefault(), { passive: false })
);
// Belt and braces: kill any multi-touch that isn't on the map surface.
document.addEventListener('touchmove', e => {
  if (e.touches.length > 1 && !e.target.closest('.map-surface')) e.preventDefault();
}, { passive: false });

/* ---------- 3. ORIENTATION (no lock exists on iPadOS) ----------------------- */
const portraitMQ = window.matchMedia('(orientation: portrait)');
function handleOrientation(e) {
  document.body.classList.toggle('is-portrait', e.matches);
  if (e.matches) Narration.stop();          // don't narrate behind the overlay
}
portraitMQ.addEventListener('change', handleOrientation);
handleOrientation(portraitMQ);

/* ---------- 4. DURABLE PROGRESS -------------------------------------------- */
const Progress = (() => {
  const KEY = 'india-map-progress-v1';
  let mem = {};                              // always works, even in Private Browsing

  async function requestPersistence() {
    if (!navigator.storage || !navigator.storage.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return navigator.storage.persist();      // WebKit grants heuristically; a
  }                                          // Home Screen web app is favoured

  function read() {
    try { mem = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { mem = {}; }
    return mem;
  }
  function write(obj) {
    mem = obj;
    try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch (e) { /* quota / private mode */ }
    mirrorToIDB(obj);                        // second copy, different eviction path
  }

  let idb = null;
  function openIDB() {
    return new Promise(res => {
      const r = indexedDB.open('india-map', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
  }
  async function mirrorToIDB(obj) {
    idb = idb || await openIDB();
    if (!idb) return;
    try { idb.transaction('kv', 'readwrite').objectStore('kv').put(obj, KEY); } catch (e) {}
  }

  // Human-recoverable escape hatch: a short code the parent can write down.
  function exportCode(obj) { return btoa(JSON.stringify(obj)).replace(/=+$/, ''); }
  function importCode(code) { try { return JSON.parse(atob(code)); } catch (e) { return null; } }

  return { read, write, requestPersistence, exportCode, importCode };
})();

// Save on the events iOS actually fires. 'unload'/'beforeunload' are unreliable.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') Progress.write(Progress.read());
});
window.addEventListener('pagehide', () => Progress.write(Progress.read()));

/* ---------- 5. TAP HANDLING WITH FORGIVENESS -------------------------------- */
// Small states are physically smaller than a 6-year-old's fingertip. Don't
// require a hit on the polygon: snap to the nearest target within a radius.
const SNAP_RADIUS = 60;                       // CSS px
function nearestTarget(x, y, targets) {
  let best = null, bestD = SNAP_RADIUS;
  for (const t of targets) {
    const r = t.el.getBoundingClientRect();
    const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}
