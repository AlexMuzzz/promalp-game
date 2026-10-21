import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SAVE, parseSave, purchase, descend, deposit, createFoam, paintFoam, buySkin, equipSkin, windowReward } from '../core.mjs';
import { createStorage } from '../storage.mjs';

test('missing save starts fresh; corrupt data is rejected without resetting', () => {
  assert.deepEqual(parseSave(''), DEFAULT_SAVE);
  for (const raw of ['{}', '{broken', 'null', JSON.stringify({ ...DEFAULT_SAVE, balance: -1 }), JSON.stringify({ ...DEFAULT_SAVE, ropes: 9 })]) assert.throws(() => parseSave(raw));
});
test('all upgrades debit once, respect caps and do not mutate original state', () => {
  const start = { ...DEFAULT_SAVE, balance: 1000, ropeDurability: 8 };
  let s = purchase(start, 'rope'); assert.equal(s.balance, 960); assert.equal(s.ropeDurability, 20);
  s = purchase(s, 'insurance'); assert.equal(s.ropes, 2); assert.equal(s.balance, 870);
  assert.throws(() => purchase(s, 'insurance'));
  s = purchase(purchase(s, 'helmet'), 'helmet'); assert.equal(s.helmetLevel, 3); assert.equal(s.balance, 590);
  assert.throws(() => purchase(s, 'helmet'));
  s = purchase(purchase(s, 'squeegee'), 'squeegee'); assert.equal(s.squeegeeLevel, 3); assert.equal(s.balance, 360);
  assert.throws(() => purchase(s, 'squeegee')); assert.throws(() => purchase(DEFAULT_SAVE, 'helmet'));
  assert.equal(start.balance, 1000); assert.equal(start.ropeDurability, 8);
});
test('rope risk boundary, wear, insurance consumption and free recovery', () => {
  assert.equal(descend(DEFAULT_SAVE, () => .02).event, 'safe');
  assert.equal(descend(DEFAULT_SAVE, () => .019).event, 'fall');
  const safe = descend(DEFAULT_SAVE, () => .5); assert.equal(safe.save.ropeDurability, 19);
  const caught = descend({ ...DEFAULT_SAVE, ropes: 2 }, () => 0);
  assert.equal(caught.event, 'caught'); assert.equal(caught.save.ropes, 1); assert.equal(caught.save.ropeDurability, 20);
  const worn = descend({ ...DEFAULT_SAVE, ropeDurability: 1 }, () => .9);
  assert.equal(worn.event, 'fall'); assert.equal(worn.save.ropeDurability, 20);
  assert.equal(descend({ ...DEFAULT_SAVE, ropeDurability: 1, ropes: 2 }, () => .9).event, 'caught');
});
test('six safe floors cost six durability and payout is $180', () => {
  let s = { ...DEFAULT_SAVE };
  for (let i = 0; i < 6; i++) s = descend(s, () => 1).save;
  assert.equal(s.ropeDurability, 14); assert.equal(s.balance, 0);
  assert.equal(deposit(s, 180).balance, 180); assert.throws(() => deposit(s, 181));
});
test('foam needs spatial coverage; repeating a spot cannot wash the whole pane', () => {
  const pane = { x: 34, y: 190, w: 104, h: 200 }, cells = createFoam();
  for (let i = 0; i < 100; i++) paintFoam(cells, pane, 80, 290, 28);
  assert.ok(cells.reduce((a, b) => a + b, 0) < cells.length / 4);
  let coverage = 0;
  for (let y = 190; y <= 390; y += 20) for (let x = 34; x <= 138; x += 20) coverage = paintFoam(cells, pane, x, y, 28);
  assert.equal(coverage, 1);
});
function fakeLocal() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
test('browser saves are isolated from the Telegram key', async () => {
  const local = fakeLocal(), store = createStorage(null, local);
  assert.equal(store.mode, 'local'); await store.save({ ...DEFAULT_SAVE, balance: 180 });
  assert.equal((await store.load()).balance, 180); assert.equal(local.values.has('promalp_save'), false);
});
test('cloud load failure never falls back or creates an empty save', async () => {
  let writes = 0;
  const local = fakeLocal();
  const tg = { initData: 'test', isVersionAtLeast: () => true, CloudStorage: { getItem: (_, cb) => cb('offline'), setItem: () => writes++ } };
  const store = createStorage(tg, local);
  await assert.rejects(store.load()); assert.equal(writes, 0); assert.equal(local.values.size, 0);
});
test('cloud false result and timeout reject; same snapshot retry is idempotent', async () => {
  let succeed = false, stored = '', keyUsed;
  const tg = { initData: 'test', isVersionAtLeast: () => true, CloudStorage: {
    getItem: (_, cb) => cb(null, stored),
    setItem: (key, value, cb) => { keyUsed = key; if (succeed) stored = value; cb(null, succeed); }
  } };
  const store = createStorage(tg, fakeLocal()); const snapshot = deposit(DEFAULT_SAVE, 180);
  await assert.rejects(store.save(snapshot)); succeed = true;
  await store.save(snapshot); await store.save(snapshot);
  assert.equal((await store.load()).balance, 180); assert.equal(keyUsed, 'promalp_save');
  tg.CloudStorage.getItem = () => {};
  await assert.rejects(createStorage(tg, fakeLocal(), 5).load(), /Telegram/);
});
test('unsupported Telegram cannot silently use local storage', async () => {
  const store = createStorage({ initData: 'test', isVersionAtLeast: () => false }, fakeLocal());
  assert.equal(store.mode, 'cloud'); await assert.rejects(store.load(), /Обновите/);
});

test('legacy save migration preserves money, wear and upgrades and adds a free worker skin',()=>{
  const legacy={balance:321,ropes:2,ropeDurability:7,helmetLevel:3,squeegeeLevel:2};
  const migrated=parseSave(JSON.stringify(legacy));
  for(const key of Object.keys(legacy))assert.equal(migrated[key],legacy[key]);
  assert.deepEqual(migrated.ownedSkins,['worker']);assert.equal(migrated.equippedSkin,'worker');
});
test('skin ownership validates and purchases cannot duplicate, overspend or equip unowned skins',()=>{
  const initial={...DEFAULT_SAVE,balance:400};const bought=buySkin(initial,'neon');
  assert.equal(bought.balance,280);assert.equal(bought.equippedSkin,'neon');assert.deepEqual(initial.ownedSkins,['worker']);
  assert.throws(()=>buySkin(bought,'neon'));assert.throws(()=>buySkin(DEFAULT_SAVE,'foam'));assert.throws(()=>equipSkin(initial,'neon'));
  assert.equal(equipSkin(bought,'worker').balance,280);
  assert.throws(()=>parseSave({...initial,ownedSkins:['worker','unknown']}));
  assert.throws(()=>parseSave({...initial,equippedSkin:'foam'}));
});
test('partial cleaning pays proportionally, never more than a complete pane',()=>{
  assert.equal(windowReward(0),0);assert.equal(windowReward(.5),5);assert.equal(windowReward(1),10);assert.throws(()=>windowReward(2));
});
