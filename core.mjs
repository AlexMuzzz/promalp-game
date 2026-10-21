export const RULES = Object.freeze({ floors: 6, windows: 3, windowPay: 10, maxDurability: 20, breakChance: .02, maxLevel: 3 });
export const DEFAULT_SAVE = Object.freeze({ balance: 0, ropes: 1, ropeDurability: 20, helmetLevel: 1, squeegeeLevel: 1 });

// Reject corrupt data instead of silently replacing an existing player's progress.
export function parseSave(raw) {
  if (raw === '' || raw === null || raw === undefined) return { ...DEFAULT_SAVE };
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid save');
  const limits = { balance: [0, 1e9], ropes: [1, 2], ropeDurability: [0, 20], helmetLevel: [1, 3], squeegeeLevel: [1, 3] };
  const result = {};
  for (const [key, [min, max]] of Object.entries(limits)) {
    if (!Number.isInteger(data[key]) || data[key] < min || data[key] > max) throw new Error(`Invalid ${key}`);
    result[key] = data[key];
  }
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
