// Original 8-bit loop, synthesized locally: square lead, triangle bass and light ticks.
// No audio downloads, external tracks or autoplay before a deliberate interaction.
const MELODY = [
  72,76,79,0,76,74,72,0, 76,79,81,79,76,0,74,72,
  69,72,76,0,79,76,72,0, 69,72,74,76,74,0,72,0,
  77,81,84,0,81,79,77,0, 79,77,76,74,72,0,74,76,
  74,79,83,0,81,79,76,74, 72,0,76,79,76,74,72,0
];
const ROOTS = [48,48,45,45,53,53,55,55];
const STEP = 60 / 112 / 2;
export function createAudio({ Context = globalThis.AudioContext || globalThis.webkitAudioContext, preferences = globalThis.localStorage, interval = globalThis.setInterval, clear = globalThis.clearInterval } = {}) {
  let enabled = true;
  try { enabled = preferences?.getItem('promalp_sound') !== 'off'; } catch { /* optional local preference */ }
  let context, master, timer = null, unlocked = false, paused = false, hidden = false, nextTime = 0, step = 0;
  const sources = new Set();
  function tone(note, at, duration, type = 'square', volume = .12, endNote = null) {
    if (!context || !master) return;
    const osc = context.createOscillator(), gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(440 * 2 ** ((note - 69) / 12), at);
    if (endNote !== null) osc.frequency.exponentialRampToValueAtTime(440 * 2 ** ((endNote - 69) / 12), at + duration);
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.linearRampToValueAtTime(volume, at + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    osc.connect(gain); gain.connect(master); sources.add(osc);
    osc.onended = () => { sources.delete(osc); osc.disconnect(); gain.disconnect(); };
    osc.start(at); osc.stop(at + duration + .015);
  }
  function schedule() {
    if (!enabled || !unlocked || paused || hidden || context?.state !== 'running') return;
    if (nextTime < context.currentTime) nextTime = context.currentTime + .03;
    while (nextTime < context.currentTime + .35) {
      const index = step % 64, section = Math.floor(step / 64) % 2;
      const note = MELODY[index];
      if (note) tone(note + (section && index % 16 >= 12 ? 12 : 0), nextTime, STEP * .72, 'square', .075);
      const root = ROOTS[Math.floor(index / 8)];
      if (step % 2 === 0) tone(root + (step % 4 === 2 ? 7 : 0), nextTime, STEP * 1.3, 'triangle', .19);
      if (section && step % 2 === 1) tone(root + 24 + [0,4,7,12][step % 4], nextTime, STEP * .5, 'triangle', .06);
      // Soft pitched percussion avoids harsh white-noise hiss on phone speakers.
      if (step % 4 === 0) tone(43, nextTime, .10, 'sine', .22, 24);
      else if (step % 4 === 2) tone(76, nextTime, .035, 'triangle', .09, 48);
      tone(100, nextTime, .018, 'triangle', .018);
      nextTime += STEP; step = (step + 1) % 128;
    }
  }
  function stop() {
    if (timer !== null) { clear(timer); timer = null; }
    if (context && master) master.gain.setTargetAtTime(0, context.currentTime, .015);
    for (const source of sources) { try { source.stop(); } catch { /* already stopped */ } }
    sources.clear();
  }
  function sync() {
    if (!context || !unlocked || !enabled || paused || hidden) { stop(); return; }
    if (context.state !== 'running') return;
    master.gain.setTargetAtTime(.32, context.currentTime, .025);
    if (timer === null) { nextTime = context.currentTime + .035; schedule(); timer = interval(schedule, 100); }
  }
  async function unlock() {
    if (!enabled || !Context) return false;
    try {
      if (!context) { context = new Context(); master = context.createGain(); master.gain.value = 0; master.connect(context.destination); }
      if (context.state !== 'running') await context.resume();
      unlocked = true; sync(); return true;
    } catch { return false; }
  }
  function effect(kind) {
    if (!enabled || !unlocked || paused || hidden || context?.state !== 'running') return;
    const at = context.currentTime + .01;
    const notes = { coin:[84,91], buy:[72,76,79,84], finish:[72,76,79,84,88,91], hit:[47,35], fall:[60,55,48,36], start:[60,67,72] }[kind];
    if (!notes) return;
    notes.forEach((note,i) => tone(note,at+i*.075,kind==='finish' ? .22 : .12,kind==='hit'||kind==='fall' ? 'sawtooth' : 'square',.12));
  }
  return {
    get enabled() { return enabled; },
    get supported() { return Boolean(Context); },
    unlock, effect,
    async toggle() {
      enabled = !enabled;
      try { preferences?.setItem('promalp_sound', enabled ? 'on' : 'off'); } catch { /* optional */ }
      if (enabled) await unlock(); else stop();
      return enabled;
    },
    update(state, isHidden = false) {
      const nextPaused = state === 'paused' || state === 'loading' || state.endsWith('error');
      if (nextPaused === paused && isHidden === hidden) return;
      paused = nextPaused; hidden = isHidden; sync();
    },
    destroy() { stop(); context?.close?.(); }
  };
}
