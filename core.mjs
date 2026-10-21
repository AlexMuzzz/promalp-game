export const RULES = Object.freeze({ floors: 6, windows: 3, windowPay: 10, maxDurability: 20, breakChance: .02, maxLevel: 3, descentSpeed: 23 });
export const SKINS = Object.freeze([
  { id: 'worker', name: 'Сменщик', subtitle: 'Классика высотных работ', price: 0, jacket: '#e5a14e', trim: '#f4d07b', trousers: '#264a4a', helmet: '#f3c85b', bucket: '#547f78' },
  { id: 'neon', name: 'Ночная смена', subtitle: 'Неон, визор и полный стиль', price: 120, jacket: '#7059b4', trim: '#87f4df', trousers: '#303758', helmet: '#9581de', bucket: '#8267c4' },
  { id: 'foam', name: 'Капитан Пена', subtitle: 'Плащ героя. Чистота — суперсила', price: 220, jacket: '#57c2b5', trim: '#f9e6a4', trousers: '#285b68', helmet: '#f0d176', bucket: '#e2ae64' }
]);
export const DEFAULT_SAVE = Object.freeze({ balance: 0, ropes: 1, ropeDurability: 20, helmetLevel: 1, squeegeeLevel: 1, ownedSkins: Object.freeze(['worker']), equippedSkin: 'worker' });

// Reject corrupt data instead of silently replacing an existing player's progress.
export function parseSave(raw) {
  if (raw === '' || raw === null || raw === undefined) return { ...DEFAULT_SAVE, ownedSkins: [...DEFAULT_SAVE.ownedSkins] };
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid save');
  const limits = { balance: [0, 1e9], ropes: [1, 2], ropeDurability: [0, 20], helmetLevel: [1, 3], squeegeeLevel: [1, 3] };
  const result = {};
  for (const [key, [min, max]] of Object.entries(limits)) {
    if (!Number.isInteger(data[key]) || data[key] < min || data[key] > max) throw new Error(`Invalid ${key}`);
    result[key] = data[key];
  }
  // Old MVP saves gain a free base outfit without changing money or equipment.
  const owned = data.ownedSkins === undefined ? ['worker'] : data.ownedSkins;
  const selected = data.equippedSkin === undefined ? 'worker' : data.equippedSkin;
  if (!Array.isArray(owned) || !owned.includes('worker') || new Set(owned).size !== owned.length || owned.some(id => !SKINS.some(skin => skin.id === id)) || !owned.includes(selected)) throw new Error('Invalid skins');
  result.ownedSkins = [...owned]; result.equippedSkin = selected;
  return result;
}

export function priceFor(save, item) {
  if (item === 'rope') return save.ropeDurability < 20 ? 40 : null;
  if (item === 'insurance') return save.ropes < 2 ? 90 : null;
  if (item === 'helmet') return save.helmetLevel < 3 ? [0, 100, 180][save.helmetLevel] : null;
  if (item === 'squeegee') return save.squeegeeLevel < 3 ? [0, 80, 150][save.squeegeeLevel] : null;
  return null;
}

export function purchase(save, item) {
  const price = priceFor(save, item);
  if (price === null || save.balance < price) throw new Error('Purchase unavailable');
  const next = { ...save, balance: save.balance - price };
  if (item === 'rope') next.ropeDurability = 20;
  if (item === 'insurance') next.ropes = 2;
  if (item === 'helmet') next.helmetLevel++;
  if (item === 'squeegee') next.squeegeeLevel++;
  return next;
}

// One wear/risk check per completed floor, including the descent to the ground.
// The reserve is a fresh rope; once it catches the player it becomes the main rope.
export function descend(save, random = Math.random) {
  const next = { ...save, ropeDurability: Math.max(0, save.ropeDurability - 1) };
  const broken = next.ropeDurability === 0 || random() < RULES.breakChance;
  if (!broken) return { save: next, event: 'safe' };
  if (next.ropes === 2) return { save: { ...next, ropes: 1, ropeDurability: 20 }, event: 'caught' };
  // A replacement is issued after a fall so a zero balance can never deadlock play.
  return { save: { ...next, ropes: 1, ropeDurability: 20 }, event: 'fall' };
}

export function deposit(save, amount) {
  if (!Number.isInteger(amount) || amount < 0 || amount > RULES.floors * RULES.windows * RULES.windowPay) throw new Error('Invalid payout');
  return parseSave({ ...save, balance: save.balance + amount });
}

export function createFoam() { return new Uint8Array(12 * 18); }
export function paintFoam(cells, window, x, y, radius) {
  for (let row = 0; row < 18; row++) for (let col = 0; col < 12; col++) {
    const dx = window.x + (col + .5) * window.w / 12 - x;
    const dy = window.y + (row + .5) * window.h / 18 - y;
    if (dx * dx + dy * dy <= radius * radius) cells[row * 12 + col] = 1;
  }
  return cells.reduce((sum, value) => sum + value, 0) / cells.length;
}

export function buySkin(save, id) {
  const skin = SKINS.find(item => item.id === id);
  if (!skin || save.ownedSkins.includes(id) || save.balance < skin.price) throw new Error('Skin unavailable');
  return parseSave({ ...save, balance: save.balance - skin.price, ownedSkins: [...save.ownedSkins, id], equippedSkin: id });
}
export function equipSkin(save, id) {
  if (!save.ownedSkins.includes(id)) throw new Error('Skin not owned');
  return parseSave({ ...save, equippedSkin: id });
}
export function windowReward(coverage) {
  if (!Number.isFinite(coverage) || coverage < 0 || coverage > 1) throw new Error('Invalid coverage');
  return Math.round(coverage * RULES.windowPay);
}
