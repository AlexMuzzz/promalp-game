import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as core from '../core.mjs';
import { createAudio } from '../audio.mjs';
import { drawClimber } from '../avatar.mjs';
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
    setAttribute(key,value) {this[key]=value;}
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
  const scope = { ...core, drawClimber, createAudio, descend: save => core.descend(save, () => .99), createStorage, console, Math: mockMath, Uint8Array, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, localStorage,
    matchMedia: () => ({ matches: false }), devicePixelRatio: 1, requestAnimationFrame() {}, ResizeObserver: class { observe() {} },
    document: { getElementById: get, addEventListener() {}, activeElement: null }, window: { addEventListener() {} }
  };
  const source = (await readFile(new URL('../game.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  vm.runInNewContext(source + `\nthis.gameTest = {
    startRun, update, pause, home, showShop, showProfile,
    snapshot: () => ({state, floorIndex, camera, earned, save: {...save}, helmetHits, pointer, coverage: panes.map(p => p.coverage), clean: panes.map(p => p.clean), player: {...player}}),
    quiet: () => {nextHazard = Infinity; hazards = []},
    hit: () => { invulnerable = 0; hazards = [{x:player.x-13, y:player.y+40, warning:0, speed:0, spin:0, type:'brick'}] },
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
async function passFloor(h) {
  h.game.quiet();
  const floor = h.game.snapshot().floorIndex;
  for (let t = 0; t < 20 && h.game.snapshot().state === 'playing'; t += .1) h.tick(.1);
  assert.equal(h.game.snapshot().state, 'saving');
  await h.flush();
  assert.equal(h.game.snapshot().floorIndex, floor + 1);
}
test('automatic descent passes unwashed windows and completes six floors without releasing a finger', async () => {
  const h = await gameHarness(); h.game.startRun(); h.game.render();
  h.pointer('pointerdown',200,150);
  for (let floor = 0; floor < 6; floor++) {
    await passFloor(h);
    assert.equal(h.game.snapshot().earned, (floor + 1) * 10);
    assert.equal(h.game.snapshot().save.ropeDurability, 19 - floor);
    if (floor < 5) assert.equal(h.game.snapshot().pointer, 1);
  }
  assert.equal(h.game.snapshot().state, 'finished'); assert.equal(h.game.snapshot().save.balance, 0);
  h.click('submit'); h.click('submit'); await h.flush();
  assert.equal(h.game.snapshot().state, 'shop'); assert.equal(h.game.snapshot().save.balance, 60);
  h.click('buy-rope'); h.click('buy-rope'); await h.flush();
  const reloaded = JSON.parse(h.saved.get('promalp_browser_save_v1'));
  assert.equal(reloaded.balance, 20); assert.equal(reloaded.ropeDurability, 20);
});
test('horizontal steering ignores finger height; release continues descent; pause freezes it', async () => {
  const h = await gameHarness(); h.game.startRun(); h.game.quiet();
  const y = h.game.snapshot().player.y;
  h.pointer('pointerdown',80,500); h.tick(.5);
  assert.equal(h.game.snapshot().player.y,y); assert.ok(h.game.snapshot().player.x<100);
  h.pointer('pointerdown',300,100,2); h.pointer('pointermove',300,100,2); h.pointer('pointercancel',300,100,2);
  assert.equal(h.game.snapshot().pointer,1);
  h.pointer('pointercancel',80,500); assert.equal(h.game.snapshot().pointer,null);
  const camera = h.game.snapshot().camera; h.tick(1); assert.ok(h.game.snapshot().camera>camera);
  h.game.pause(); const paused = h.game.snapshot(); h.tick(10);
  assert.equal(h.game.snapshot().state,'paused'); assert.equal(h.game.snapshot().camera,paused.camera);
  assert.equal(h.game.snapshot().earned,paused.earned);
  h.game.pause(); assert.equal(h.game.snapshot().state,'playing');
});
test('helmet absorbs one collision; next collision loses run money, keeps wallet and restores on restart', async () => {
  const h = await gameHarness({...core.DEFAULT_SAVE,balance:75});h.game.startRun();await passFloor(h);
  h.game.hit();h.tick(.02);assert.equal(h.game.snapshot().helmetHits,0);
  h.game.hit();h.tick(.02);assert.equal(h.game.snapshot().state,'falling');assert.equal(h.game.snapshot().earned,0);
  assert.equal(h.game.snapshot().save.balance,75);h.tick(1);assert.equal(h.game.snapshot().state,'fallen');
  h.game.startRun();assert.equal(h.game.snapshot().helmetHits,1);
});
test('profile previews do not charge; purchase and equipment survive saving; owned outfit switches for free', async () => {
  const h = await gameHarness({...core.DEFAULT_SAVE,balance:400});h.game.showProfile();h.click('skin-neon');
  assert.equal(h.game.snapshot().save.equippedSkin,'worker');assert.equal(h.game.snapshot().save.balance,400);
  h.click('skin-action');h.click('skin-action');await h.flush();
  assert.equal(h.game.snapshot().save.equippedSkin,'neon');assert.equal(h.game.snapshot().save.balance,280);
  h.click('skin-worker');h.click('skin-action');await h.flush();
  assert.equal(h.game.snapshot().save.equippedSkin,'worker');assert.equal(h.game.snapshot().save.balance,280);
  h.click('skin-foam');h.click('skin-action');await h.flush();
  assert.equal(h.game.snapshot().save.balance,60);assert.equal(h.game.snapshot().save.equippedSkin,'foam');
  const loaded=JSON.parse(h.saved.get('promalp_browser_save_v1'));assert.deepEqual(loaded.ownedSkins,['worker','neon','foam']);
  h.game.startRun();h.game.render();assert.equal(h.game.snapshot().save.equippedSkin,'foam');
});
test('failed skin purchase retries the same debit without losing old equipment or balance', async () => {
  const h=await gameHarness({...core.DEFAULT_SAVE,balance:180,helmetLevel:2});h.game.showProfile('neon');h.failSave(true);
  h.click('skin-action');await h.flush();assert.equal(h.game.snapshot().state,'save-error');assert.equal(h.game.snapshot().save.balance,180);
  h.failSave(false);h.click('retry-save');await h.flush();
  assert.equal(h.game.snapshot().save.balance,60);assert.equal(h.game.snapshot().save.equippedSkin,'neon');assert.equal(h.game.snapshot().save.helmetLevel,2);
});
test('moving across more panes earns more than one stationary lane', async () => {
  const h=await gameHarness();h.game.startRun();h.game.quiet();h.pointer('pointerdown',200,200);
  for(let t=0;t<20 && h.game.snapshot().state==='playing';t+=.04){h.pointer('pointermove',200+Math.sin(t*2.8)*155,200);h.tick(.04);}
  await h.flush();assert.ok(h.game.snapshot().earned>10);assert.ok(h.game.snapshot().earned<=30);
});
