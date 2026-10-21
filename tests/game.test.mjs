import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as core from '../core.mjs';
import { createStorage } from '../storage.mjs';

// Headless simulation of the actual game module and pointer handlers. No production
// debug routes, state hooks or test currency are included in the shipped game.
async function gameHarness(initial = core.DEFAULT_SAVE) {
  const elements = new Map(), saved = new Map([['promalp_browser_save_v1', JSON.stringify(initial)]]);
  const gradient = { addColorStop() {} };
  const context2d = new Proxy({}, { get: (_, prop) => prop === 'createLinearGradient' ? () => gradient : () => {}, set: () => true });
  let failSave = false;
  class Element {
    constructor(id) { this.id = id; this.hidden = false; this.disabled = false; this.listeners = {}; this.classList = { add() {}, remove() {} }; }
    set innerHTML(html) {
      this.html = html;
      for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
        const el = new Element(match[1]); el.disabled = /\bdisabled\b/.test(match[0]); elements.set(el.id, el);
      }
    }
    get innerHTML() { return this.html || ''; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    focus() {}
    querySelector() { return null; }
    querySelectorAll() { return []; }
    getContext() { return context2d; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 600 }; }
    setPointerCapture(id) { this.captured = id; }
    hasPointerCapture(id) { return this.captured === id; }
    releasePointerCapture() { this.captured = null; }
  }
  const get = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  const localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => { if (failSave) throw new Error('offline'); saved.set(key, value); } };
  const mockMath = Object.create(Math); mockMath.random = () => .99;
  const scope = { ...core, descend: save => core.descend(save, () => .99), createStorage, console, Math: mockMath, Uint8Array, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, localStorage,
    matchMedia: () => ({ matches: false }), devicePixelRatio: 1, requestAnimationFrame() {}, ResizeObserver: class { observe() {} },
    document: { getElementById: get, addEventListener() {}, activeElement: null }, window: { addEventListener() {} }
  };
  const source = (await readFile(new URL('../game.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  vm.runInNewContext(source + `\nthis.gameTest = {
    startRun, update, pause, home, showShop,
    snapshot: () => ({state, floorIndex, earned, save: {...save}, helmetHits, pointer, coverage: panes.map(p => p.coverage), clean: panes.map(p => p.clean), player: {...player}}),
    quiet: () => {nextHazard = Infinity; hazards = []},
    hit: () => { invulnerable = 0; hazards = [{x:player.x-13, y:player.y+30, warning:0, speed:0, spin:0, type:'brick'}] },
    render: () => frame(16),
  };`, scope, { filename: 'game.js' });
  await new Promise(resolve => setImmediate(resolve));
  const game = scope.gameTest;
  return { game, saved, get, failSave: value => { failSave = value; }, flush: () => new Promise(resolve => setImmediate(resolve)),
    click(id) { const el = get(id); if (!el.disabled) el.listeners.click?.(); },
    pointer(type, x, y, id = 1) { get('game').listeners[type]?.({ clientX: x, clientY: y, pointerId: id, pointerType: 'touch', preventDefault() {} }); },
    tick(seconds) { for (let t = 0; t < seconds; t += .02) game.update(.02); }
  };
}
async function washFloor(h) {
  h.game.quiet();
  for (let pane = 0; pane < 3; pane++) {
    const x0 = 34 + pane * 114;
    h.pointer('pointerdown', x0, 192);
    for (let col = 0; col < 4; col++) {
      const x = x0 + 9 + col * 29;
      for (let row = 0; row < 10; row++) {
        const y = 199 + (col % 2 ? 9 - row : row) * 21;
        h.pointer('pointermove', x, y); h.tick(.15);
      }
    }
    assert.equal(h.game.snapshot().coverage[pane], 1);
    h.pointer('pointerup', x0, 192); h.tick(1.2); await h.flush();
  }
  h.tick(1.2); await h.flush();
}
test('complete game: drag, release, 18 windows, six descents, one payout and persisted purchase', async () => {
  const h = await gameHarness(); h.game.startRun(); h.game.render();
  for (let floor = 0; floor < 6; floor++) {
    await washFloor(h);
    assert.equal(h.game.snapshot().earned, (floor + 1) * 30);
    assert.equal(h.game.snapshot().save.ropeDurability, 19 - floor);
  }
  assert.equal(h.game.snapshot().state, 'finished');
  assert.equal(h.game.snapshot().save.balance, 0);
  h.click('submit'); h.click('submit'); await h.flush();
  assert.equal(h.game.snapshot().state, 'shop'); assert.equal(h.game.snapshot().save.balance, 180);
  h.click('buy-squeegee'); h.click('buy-squeegee'); await h.flush();
  assert.equal(h.game.snapshot().save.balance, 100); assert.equal(h.game.snapshot().save.squeegeeLevel, 2);
  const reloaded = JSON.parse(h.saved.get('promalp_browser_save_v1'));
  assert.equal(reloaded.balance, 100); assert.equal(reloaded.ropeDurability, 14); assert.equal(reloaded.squeegeeLevel, 2);
});
test('pointer cancel and pause stop cleaning; second pointer cannot hijack drag', async () => {
  const h = await gameHarness(); h.game.startRun(); h.game.quiet();
  h.pointer('pointerdown', 80, 250); h.tick(.5);
  const before = h.game.snapshot(); h.pointer('pointerdown', 300, 300, 2); h.pointer('pointermove', 300, 300, 2);
  assert.equal(h.game.snapshot().pointer, 1);
  h.pointer('pointercancel', 80, 250); assert.equal(h.game.snapshot().pointer, null);
  const coverage = h.game.snapshot().coverage[0]; h.tick(1); assert.equal(h.game.snapshot().coverage[0], coverage);
  h.pointer('pointerdown', 90, 270); h.game.pause(); const paused = h.game.snapshot(); h.tick(10);
  assert.equal(h.game.snapshot().state, 'paused'); assert.equal(h.game.snapshot().coverage[0], paused.coverage[0]);
  h.game.pause(); assert.equal(h.game.snapshot().state, 'playing'); assert.equal(before.earned, 0);
});
test('helmet absorbs first collision, second loses run money but not wallet; new run restores helmet', async () => {
  const h = await gameHarness({ ...core.DEFAULT_SAVE, balance: 75 }); h.game.startRun(); await washFloor(h);
  h.game.hit(); h.tick(.02); assert.equal(h.game.snapshot().helmetHits, 0); assert.equal(h.game.snapshot().state, 'playing');
  h.game.hit(); h.tick(.02); assert.equal(h.game.snapshot().state, 'falling'); assert.equal(h.game.snapshot().earned, 0);
  assert.equal(h.game.snapshot().save.balance, 75); h.tick(1); assert.equal(h.game.snapshot().state, 'fallen');
  h.game.startRun(); assert.equal(h.game.snapshot().helmetHits, 1); assert.equal(h.game.snapshot().floorIndex, 0);
});
test('failed purchase blocks play, retries exact debit, and leaves existing save intact until success', async () => {
  const h = await gameHarness({ ...core.DEFAULT_SAVE, balance: 180 }); h.game.showShop(); h.failSave(true);
  h.click('buy-insurance'); await h.flush(); assert.equal(h.game.snapshot().state, 'save-error');
  assert.equal(h.game.snapshot().save.balance, 180); assert.equal(JSON.parse(h.saved.get('promalp_browser_save_v1')).ropes, 1);
  h.failSave(false); h.click('retry-save'); h.click('retry-save'); await h.flush();
  assert.equal(h.game.snapshot().save.balance, 90); assert.equal(h.game.snapshot().save.ropes, 2); assert.equal(h.game.snapshot().state, 'shop');
});
test('fast pointer strokes cover the whole path even before animation catches up', async () => {
  const h = await gameHarness(); h.game.startRun(); h.game.quiet();
  h.pointer('pointerdown', 42, 198);
  for (const x of [42, 69, 96, 129]) {
    h.pointer('pointermove', x, 198); h.pointer('pointermove', x, 393);
  }
  assert.equal(h.game.snapshot().coverage[0], 1);
  h.pointer('pointerup', 129, 393); h.tick(1.2);
  assert.equal(h.game.snapshot().earned, 10);
});
