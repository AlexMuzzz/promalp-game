import { RULES, DEFAULT_SAVE, priceFor, purchase, descend, deposit, createFoam, paintFoam } from './core.mjs';
import { createStorage } from './storage.mjs';

const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const tg = window.Telegram?.WebApp;
const storage = createStorage(tg, { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) });
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let save = { ...DEFAULT_SAVE };
let state = 'loading', previousState = 'playing';
let W = 400, H = 600, scale = 1;
let floorIndex = 0, earned = 0, helmetHits = 1, camera = 0;
let panes = [], hazards = [], sparks = [];
let pointer = null, target = { x: 200, y: 180 }, player = { ...target };
let nextHazard = 6, invulnerable = 0, transition = 0, fallTime = 0, time = 0;
let toastUntil = 0, lastFrame = 0, focusBeforeModal;
let shopOrigin = 'home';
const money = value => `$${value}`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const windowHeight = () => Math.min(205, H * .34);
const stride = () => windowHeight() + 110;
const windowTop = () => Math.max(155, H * .32);

try {
  tg?.ready(); tg?.expand();
  if (tg?.isVersionAtLeast('6.1')) { tg.setHeaderColor('#132c30'); tg.setBackgroundColor('#132c30'); }
  if (tg?.isVersionAtLeast('7.7')) tg.disableVerticalSwipes();
} catch (error) { console.warn('Telegram setup:', error); }

function haptic(kind = 'light') {
  try { if (tg?.isVersionAtLeast('6.1')) tg.HapticFeedback.impactOccurred(kind); } catch { /* optional */ }
}
function toast(message, seconds = 3) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  toastUntil = time + seconds;
}
function updateHUD() {
  $('balance').textContent = money(save.balance);
  $('earned').textContent = money(earned);
  $('floor').textContent = `Этаж ${Math.max(1, 6 - floorIndex)} / 6`;
  $('rope').textContent = `${save.ropeDurability} / 20${save.ropes === 2 ? ' + страховка' : ''}`;
  $('helmet').textContent = ['playing', 'wiping', 'descending', 'paused', 'saving'].includes(state) ? `${helmetHits} из ${save.helmetLevel} ударов` : `Уровень ${save.helmetLevel}`;
  $('squeegee').textContent = `Уровень ${save.squeegeeLevel}`;
  $('pause').disabled = !['playing', 'wiping', 'paused'].includes(state);
  $('pause').textContent = state === 'paused' ? '▶' : 'Ⅱ';
  $('floor-progress').innerHTML = Array.from({ length: 6 }, (_, i) => `<i class="${i < floorIndex ? 'done' : i === floorIndex ? 'active' : ''}"></i>`).join('');
}
function modal(html, className = '') {
  releasePointer();
  if ($('overlay').hidden) focusBeforeModal = document.activeElement;
  $('overlay').hidden = false;
  $('panel').className = `panel ${className}`;
  $('panel').innerHTML = html;
  $('panel').querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}
function closeModal() {
  $('overlay').hidden = true;
  focusBeforeModal?.focus?.({ preventScroll: true });
}
function action(id, fn) { $(id).addEventListener('click', fn); }
function home() {
  state = 'home'; floorIndex = 0; camera = 0; hazards = []; earned = 0;
  player = { x: 290, y: H * .22 }; target = { ...player };
  $('run-hud').hidden = true; $('floor-progress').hidden = true; $('hint').hidden = true;
  updateHUD();
  modal(`<span class="kicker">Работа на высоте</span>
    <h1 id="panel-title">Чистая работа.<br><em>На высоте.</em></h1>
    <p class="intro">Намывай стёкла, береги каску и не доверяй чайкам. Город сам себя не отмоет.</p>
    <div class="mission"><span><b>6</b>этажей</span><span><b>18</b>окон</span><span><b>$180</b>за объект</span></div>
    <button class="primary" id="start">На крышу <span aria-hidden="true">↗</span></button>
    <button class="secondary" id="shop">Снаряжение</button>
    <button class="text-button" id="help">Как здесь работать?</button>
    <p class="meta-line">ТИХИЙ ДВОР · ОБЪЕКТ № 01</p>`, 'hero');
  action('start', startRun); action('shop', () => showShop('home')); action('help', instructions);
}
function instructions() {
  modal(`<span class="kicker">Инструктаж перед сменой</span><h2 id="panel-title">Держись крепче</h2>
    <ol class="steps"><li><b>Наведи чистоту</b>Зажми палец или мышь и закрась пеной всё стекло. На 100% отпусти — склиз сделает остальное.</li>
    <li><b>Смотри наверх</b>Метка «!» предупреждает об опасности. Уведи альпиниста в сторону. Каска принимает удар, без каски — падение.</li>
    <li><b>Дойди до земли</b>Три чистых окна — спуск на этаж. Верёвка теряет 1 прочность; риск обрыва — 2% за переход. На нуле она рвётся.</li>
    <li><b>Сдай объект</b>Намытые $180 станут твоими только после сдачи. При падении заработок за попытку сгорает.</li></ol>
    <button class="primary" id="understood">Понятно, на крышу</button><button class="text-button" id="back">Назад</button>`);
  action('understood', startRun); action('back', home);
}
function createPanes() {
  panes = Array.from({ length: 3 }, (_, i) => ({ x: 34 + i * 114, y: windowTop(), w: 104, h: windowHeight(), foam: createFoam(), coverage: 0, clean: false, wipe: -1 }));
}
function startRun() {
  state = 'playing'; floorIndex = 0; earned = 0; helmetHits = save.helmetLevel;
  hazards = []; sparks = []; camera = 0; nextHazard = 7; invulnerable = 1.5;
  createPanes(); player = { x: 205, y: windowTop() - 45 }; target = { ...player };
  $('run-hud').hidden = false; $('floor-progress').hidden = false; $('hint').hidden = false;
  $('hint').textContent = 'Води по стеклу → отпусти, когда будет 100%';
  closeModal(); updateHUD(); haptic();
  try { if (tg?.isVersionAtLeast('6.2')) tg.enableClosingConfirmation(); } catch { /* optional */ }
}
function showShop(origin = shopOrigin) {
  shopOrigin = origin; state = 'shop'; updateHUD();
  const rows = [
    ['rope', 'Свежая верёвка', `Прочность ${save.ropeDurability}/20 → 20/20. Замена основной.`, save.ropeDurability === 20 ? 'Как новая' : null],
    ['insurance', 'Вторая верёвка', 'Спасёт при одном обрыве. После подхвата: 20/20.', save.ropes === 2 ? 'Куплена' : null],
    ['helmet', `Каска · уровень ${save.helmetLevel}`, `Следующий уровень: ${Math.min(3, save.helmetLevel + 1)} удара за попытку.`, save.helmetLevel === 3 ? 'Максимум' : null],
    ['squeegee', `Склиз · уровень ${save.squeegeeLevel}`, 'Шире полоса пены, быстрее финальная стяжка.', save.squeegeeLevel === 3 ? 'Максимум' : null]
  ];
  modal(`<span class="kicker">Подготовка к смене</span><h2 id="panel-title">Снаряжение</h2><p class="shop-balance">В кошельке <b>${money(save.balance)}</b></p>
    ${rows.map(([id, title, text, tag]) => `<div class="shop-item"><div><b>${title}</b><p>${text}</p></div>${tag ? `<span class="tag">${tag}</span>` : `<button class="buy" id="buy-${id}" ${save.balance < priceFor(save, id) ? 'disabled' : ''} aria-label="Купить: ${title}, ${priceFor(save, id)} долларов">${money(priceFor(save, id))}</button>`}</div>`).join('')}
    <button class="primary" id="shop-start">${origin === 'home' ? 'На крышу ↗' : 'Следующий спуск ↗'}</button>
    <button class="text-button" id="shop-back">На главный экран</button>
    <p class="note">Каска восстанавливается перед каждой попыткой. После потери последней верёвки выдаём базовую бесплатно.</p>`);
  for (const [id] of rows) if ($(`buy-${id}`)) action(`buy-${id}`, () => {
    if (state !== 'shop') return;
    const next = purchase(save, id);
    persist(next, () => { haptic(); showShop(origin); }, 'Сохраняем покупку…');
  });
  action('shop-start', startRun); action('shop-back', home);
}

// A failed write retries exactly the same snapshot, never re-applies a reward/purchase.
async function persist(next, onSuccess, title = 'Сохраняем снаряжение…') {
  state = 'saving'; releasePointer(); updateHUD();
  $('hint').textContent = title;
  if (!$('overlay').hidden) modal(`<span class="kicker">Сохранение</span><h2 id="panel-title">${title}</h2><p class="description loading-dot">Секунду, закрепляем результат.</p>`);
  try {
    await storage.save(next);
    save = { ...next }; updateHUD(); onSuccess();
  } catch {
    state = 'save-error';
    modal(`<span class="kicker">Связь прервалась</span><h2 id="panel-title">Не удалось сохранить</h2><p class="description">Результат этой операции ждёт здесь. Проверь интернет и повтори сохранение. Не закрывай игру до подтверждения.</p><button class="primary" id="retry-save">Повторить сохранение</button>`);
    action('retry-save', () => persist(next, onSuccess, title));
  }
}
function completeFloor() {
  if (state !== 'wiping' && state !== 'playing') return;
  const outcome = descend(save);
  hazards = []; releasePointer();
  persist(outcome.save, () => {
    closeModal();
    if (outcome.event === 'fall') { fall('Верёвка оборвалась. Выдали новую — за наш счёт.'); return; }
    if (outcome.event === 'caught') { toast('Страховка поймала! Осталась одна верёвка.', 4); haptic('heavy'); }
    state = 'descending'; transition = 0;
    $('hint').textContent = outcome.event === 'caught' ? 'Страховка сработала. Продолжаем!' : 'Этаж готов. Спускаемся ниже…';
  });
}
let fallReason = '';
function fall(reason) {
  state = 'falling'; fallTime = 0; fallReason = reason; earned = 0; hazards = []; releasePointer();
  $('hint').textContent = 'Срыв! Заработок за спуск потерян.';
  updateHUD(); haptic('heavy');
}
function fallenScreen() {
  state = 'fallen';
  modal(`<span class="kicker">Бывает. Держись!</span><h2 id="panel-title">Не твой спуск</h2><p class="description">${fallReason} Намытые деньги потеряны, кошелёк цел.</p><div class="big-number">${money(save.balance)}</div><button class="primary" id="retry-run" disabled>Перевести дух · 3</button><button class="secondary" id="fall-shop" disabled>Проверить снаряжение</button><p class="note">Каску восстановим перед новой попыткой.</p>`);
  let remaining = 3;
  const interval = setInterval(() => {
    if (state !== 'fallen') { clearInterval(interval); return; }
    remaining--;
    $('retry-run').textContent = remaining > 0 ? `Перевести дух · ${remaining}` : 'Ещё одна попытка ↗';
    if (remaining <= 0) {
      clearInterval(interval); $('retry-run').disabled = false; $('fall-shop').disabled = false; $('retry-run').focus({ preventScroll: true });
    }
  }, 1000);
  action('retry-run', startRun); action('fall-shop', () => showShop('fallen'));
}
function finishRun() {
  state = 'finished'; updateHUD();
  $('hint').hidden = true;
  modal(`<span class="kicker">Все 18 окон сияют</span><h2 id="panel-title">Чистая работа!</h2><p class="description">Обе ноги на земле. Осталось сдать объект — и деньги твои.</p><div class="big-number">${money(earned)}</div><button class="primary" id="submit">Сдать объект · ${money(earned)}</button><p class="note">Зачислим в кошелёк и сохраним прогресс.</p>`);
  action('submit', () => {
    if (state !== 'finished') return;
    const amount = earned;
    persist(deposit(save, amount), () => {
      earned = 0; updateHUD(); haptic('medium');
      try { if (tg?.isVersionAtLeast('6.2')) tg.disableClosingConfirmation(); } catch { /* optional */ }
      showShop('completed'); toast(`Объект сдан. +${money(amount)} в кошельке!`, 4);
    }, 'Зачисляем заработок…');
  });
}
function pause() {
  if (!['playing', 'wiping', 'paused'].includes(state)) return;
  if (state === 'paused') { state = previousState; closeModal(); updateHUD(); return; }
  previousState = state; state = 'paused'; releasePointer(); updateHUD();
  modal(`<span class="kicker">Небольшой перекур</span><h2 id="panel-title">Висим. Отдыхаем.</h2><p class="description">Чайки тоже подождут. Намыто за спуск: ${money(earned)}.</p><button class="primary" id="resume">Продолжить</button><button class="secondary" id="quit">Завершить попытку</button>`);
  action('resume', pause); action('quit', () => {
    modal(`<h2 id="panel-title">Закончить спуск?</h2><p class="description">Несданный заработок ${money(earned)} пропадёт. Износ верёвки останется.</p><button class="primary" id="keep-playing">Продолжить работу</button><button class="secondary" id="confirm-quit">Уйти на главный экран</button>`);
    action('keep-playing', pause); action('confirm-quit', home);
  });
}
action('pause', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden && ['playing', 'wiping'].includes(state)) pause(); });
window.addEventListener('blur', () => { if (['playing', 'wiping'].includes(state)) pause(); });
try { tg?.onEvent('deactivated', () => { if (['playing', 'wiping'].includes(state)) pause(); }); } catch { /* optional */ }
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') pause();
  if (event.key === 'Tab' && !$('overlay').hidden) {
    const focusable = [...$('panel').querySelectorAll('button:not(:disabled),a[href]')];
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
function position(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: clamp((event.clientX - rect.left) / rect.width * W, 18, W - 18), y: clamp((event.clientY - rect.top) / rect.height * H, 110, H - 55) };
}
canvas.addEventListener('pointerdown', event => {
  if (state !== 'playing' || pointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
  event.preventDefault(); pointer = event.pointerId; target = position(event); canvas.setPointerCapture(pointer);
  applyStroke(target, target);
});
canvas.addEventListener('pointermove', event => {
  if (event.pointerId !== pointer) return;
  event.preventDefault(); const next = position(event); applyStroke(target, next); target = next;
});
function releasePointer() {
  const id = pointer; pointer = null;
  if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
}
canvas.addEventListener('pointerup', event => {
  if (event.pointerId !== pointer) return;
  releasePointer();
  if (state !== 'playing') return;
  let wiping = false;
  for (const pane of panes) if (!pane.clean && pane.coverage === 1) { pane.wipe = 0; wiping = true; }
  if (wiping) { state = 'wiping'; updateHUD(); haptic(); $('hint').textContent = 'Склиз идёт вниз. Красота!'; }
});
canvas.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('lostpointercapture', releasePointer);

function resize() {
  const oldStride = stride(), oldTop = windowTop(), oldHeight = windowHeight();
  const rect = canvas.getBoundingClientRect();
  H = W * rect.height / rect.width; scale = Math.min(devicePixelRatio || 1, 2) * rect.width / W;
  canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
  camera *= stride() / oldStride;
  for (const pane of panes) { pane.y = windowTop(); pane.h = windowHeight(); }
  player.y = clamp(windowTop() + (player.y - oldTop) / oldHeight * windowHeight(), 110, H - 55);
  target = { ...player }; releasePointer();
}
new ResizeObserver(resize).observe(canvas);

function path(points, color, width = 3) {
  ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
}
function rect(x, y, w, h, fill, radius = 0) { ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill(); }
function circle(x, y, radius, fill) { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); }
function label(text, x, y, size, fill, align = 'center', weight = 600) { ctx.fillStyle = fill; ctx.font = `${weight} ${size}px 'Golos Text',system-ui,sans-serif`; ctx.textAlign = align; ctx.fillText(text, x, y); }
function drawWindow(x, y, w, h, pane, floor) {
  rect(x - 6, y - 7, w + 12, h + 18, '#657e76', 3);
  rect(x - 3, y - 5, w + 6, h + 10, '#d6d9b9', 2);
  const clean = pane?.clean;
  const glass = ctx.createLinearGradient(x, y, x + w, y + h);
  glass.addColorStop(0, clean ? '#bce3dd' : '#7d9990'); glass.addColorStop(1, clean ? '#4d9ead' : '#536f65');
  rect(x, y, w, h, glass, 1);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  if (!clean) {
    for (let j = 0; j < 18; j++) {
      const sx = x + ((j * 37 + floor * 11) % 99) / 100 * w;
      const sy = y + ((j * 61 + floor * 23) % 97) / 100 * h;
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(.3); ctx.scale(1, 1.6); circle(0, 0, 5 + (j % 4) * 2, '#3f5c4950'); ctx.restore();
    }
    path([[x + w * .3, y], [x + w * .3 - 8, y + h]], '#bdc6a31a', 7);
  } else {
    ctx.fillStyle = '#e9f5db55'; ctx.beginPath(); ctx.moveTo(x + 8, y); ctx.lineTo(x + 40, y); ctx.lineTo(x + w - 8, y + h); ctx.lineTo(x + w - 38, y + h); ctx.fill();
  }
  if (pane && !clean) {
    const wipeY = pane.wipe < 0 ? y : y + pane.wipe * h;
    if (pane.wipe >= 0) { rect(x, y, w, pane.wipe * h, '#9fd4d2'); path([[x + 8, y], [x + w * .55, wipeY]], '#e3f0d850', 15); }
    for (let row = 0; row < 18; row++) for (let col = 0; col < 12; col++) {
      if (!pane.foam[row * 12 + col]) continue;
      const fy = y + row * h / 18;
      if (fy + h / 18 < wipeY) continue;
      rect(x + col * w / 12 - .3, Math.max(fy - .3, wipeY), w / 12 + .6, Math.max(0, fy + h / 18 + .6 - Math.max(fy - .3, wipeY)), (row + col) % 4 === 0 ? '#f8f7e9' : '#e4eee5', 3);
      if ((row * 3 + col) % 7 === 0) circle(x + (col + .5) * w / 12, Math.max(fy + 4, wipeY + 3), 2, '#c7ddd3');
    }
    if (pane.wipe >= 0) {
      rect(x - 3, wipeY - 4, w + 6, 7, '#233c39', 2); rect(x + w / 2 - 3, wipeY - 4, 6, 23, '#e8b565', 3);
    }
  }
  ctx.restore();
  // Slim frames keep the whole glass reachable for the foam brush.
  rect(x - 8, y + h + 4, w + 16, 8, '#e2dfbf', 2); rect(x - 8, y + h + 12, w + 16, 4, '#6a8172', 1);
  if (clean) {
    const sx = x + w - 20, sy = y + 25;
    path([[sx - 7, sy], [sx + 7, sy]], '#f6ffdc', 2); path([[sx, sy - 9], [sx, sy + 9]], '#f6ffdc', 2);
  }
  if (pane && !clean && state !== 'home') {
    const pct = Math.floor(pane.coverage * 100);
    rect(x + w / 2 - 26, y + h + 24, 52, 22, pct === 100 ? '#d9ee86' : '#24483ed9', 11);
    label(pct === 100 ? 'ГОТОВО' : `${pct}%`, x + w / 2, y + h + 39, pct === 100 ? 8 : 11, pct === 100 ? '#2c4837' : '#e0e6cf');
  }
}
function drawScene() {
  const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#aecbc1'); sky.addColorStop(1, '#678f85'); rect(0, 0, W, H, sky);
  // Neighbouring roofs frame a warm, hand-drawn facade.
  for (let i = 0; i < 8; i++) { rect(i * 65 - 30, 75 + (i % 3) * 33, 55, H, '#739b9170', 3); }
  rect(15, 0, 370, H, '#b4baa0');
  rect(15, 0, 10, H, '#d6d4b2'); rect(375, 0, 10, H, '#839884');
  for (let y = -camera % 24; y < H; y += 24) {
    path([[25, y], [375, y]], '#94a38a44', 1);
    for (let x = 25 + (Math.round((y + camera) / 24) % 2) * 42; x < 375; x += 84) path([[x, y], [x, y + 24]], '#94a38a33', 1);
  }
  for (let f = -1; f <= 6; f++) {
    const y = windowTop() + f * stride() - camera;
    if (y > H + 50 || y + windowHeight() < -100) continue;
    rect(25, y - 33, 350, 9, '#cfd1af'); rect(25, y - 24, 350, 3, '#8a9e85');
    if (f >= 0 && f < 6) {
      for (let i = 0; i < 3; i++) {
        const active = f === floorIndex && !['home', 'loading', 'load-error'].includes(state);
        const p = active ? panes[i] : f < floorIndex ? { clean: true } : null;
        drawWindow(34 + i * 114, y, 104, windowHeight(), p, f);
      }
      rect(2, y + 12, 24, 31, '#284d43', 4); label(String(6 - f).padStart(2, '0'), 14, y + 33, 11, '#d9dfbc');
    }
  }
  const roofY = windowTop() - 85 - camera;
  if (roofY > -90) {
    rect(6, roofY, 388, 21, '#536e60', 3); rect(6, roofY, 388, 6, '#e2dfbe', 2);
    rect(50, roofY - 43, 70, 43, '#879d87'); rect(42, roofY - 48, 86, 8, '#d6d7b8', 2);
    rect(305, roofY - 29, 23, 29, '#637e6f'); rect(300, roofY - 34, 33, 7, '#d1d6b6', 2);
    path([[175, roofY - 8], [175, roofY - 32], [225, roofY - 32], [225, roofY - 8]], '#405e53', 5);
  }
  const groundY = windowTop() + 6 * stride() - camera - 45;
  if (groundY < H) {
    rect(0, groundY, W, H - groundY, '#6b8873'); rect(0, groundY, W, 8, '#e1d7b4');
    for (let i = 0; i < 7; i++) path([[i * 75, groundY + 12], [i * 75 - 30, H]], '#536f5e', 2);
    rect(153, groundY - 105, 94, 105, '#426a60', 5); rect(163, groundY - 95, 74, 82, '#7ca294', 3); path([[200, groundY - 95], [200, groundY]], '#c2cdb0', 3);
  }
  // Downpipe and ivy at the edge of the building.
  path([[389, 0], [389, H]], '#567e6c', 5);
  for (let y = 35; y < H; y += 115) path([[384, y], [394, y]], '#d1d6b4', 3);
  for (let j = 0; j < 12; j++) { const y = H - j * 13; circle(10 + Math.sin(j * 2) * 7, y, 9, j % 2 ? '#4e7859' : '#668956'); }
}
function drawPlayer() {
  let x = player.x - 13, y = player.y + 30;
  if (state === 'falling') y += fallTime * fallTime * 700;
  if (state === 'fallen') return;
  const homeMode = ['home', 'loading', 'load-error'].includes(state);
  if (homeMode) { x = 280; y = H * .23 + Math.sin(time * 1.5) * 3; }
  if (invulnerable > 0 && Math.floor(time * 12) % 2 === 0 && !homeMode) ctx.globalAlpha = .6;
  const sway = reducedMotion ? 0 : Math.sin(time * 2.4) * 3;
  if (state !== 'falling') {
    path([[180, -20], [x - 5, y + 23]], '#435844', 3);
    path([[180, -20], [x - 5, y + 23]], '#e3ca76', 1.4);
    if (save.ropes === 2) path([[224, -20], [x + 12, y + 25]], '#d5815a', 2.5);
  }
  ctx.save(); ctx.translate(x, y); ctx.rotate(sway / 100);
  // Boots, bent knees, work jacket and harness.
  path([[-8, 22], [-18, 42], [-5, 51]], '#264a4a', 12); path([[9, 22], [19, 37], [27, 48]], '#315957', 12);
  path([[-8, 51], [2, 52]], '#173f3d', 9); path([[23, 48], [33, 48]], '#173f3d', 9);
  rect(-16, -8, 32, 37, '#e5a14e', 9); rect(-16, 3, 32, 5, '#f4d07b', 1);
  path([[-11, -4], [-3, 22], [10, -4]], '#31524a', 4); path([[-15, 23], [15, 23]], '#31524a', 5); circle(0, 22, 4, '#d6dcaa');
  path([[-13, 0], [-28, 7], [-31, -10]], '#e9b26a', 9);
  path([[13, 0], [25, -13], [13, -26]], '#e9b26a', 9);
  circle(13, -27, 5, '#f3c897'); circle(-31, -12, 5, '#f3c897');
  circle(0, -20, 12, '#f0c38e'); rect(-12, -26, 8, 10, '#654b3c', 3);
  circle(6, -21, 1.6, '#294b42'); path([[7, -14], [3, -13]], '#996a4e', 1.3);
  if (helmetHits > 0 || homeMode) {
    ctx.fillStyle = '#f3c85b'; ctx.beginPath(); ctx.arc(0, -26, 15, Math.PI, 0); ctx.fill(); rect(-17, -28, 35, 5, '#f6d775', 2); path([[0, -40], [0, -30]], '#d89b42', 2);
  }
  // Bucket and a little foam on the tool.
  path([[-24, 21], [-27, 10], [-35, 10], [-38, 22]], '#c4cfb1', 2); rect(-42, 19, 21, 23, '#547f78', 4); rect(-44, 18, 25, 5, '#a0c0a4', 2);
  const toolWidth = 20 + save.squeegeeLevel * 8;
  path([[13, -25], [13, -38]], '#b88a51', 4); rect(13 - toolWidth / 2, -42, toolWidth, 7, '#375b53', 2);
  if (pointer !== null) for (let j = 0; j < 5; j++) circle(13 - toolWidth / 2 + 4 + j * (toolWidth - 8) / 4, -43, 4, '#eef2df');
  ctx.restore(); ctx.globalAlpha = 1;
}
function drawHazards() {
  for (const hazard of hazards) {
    if (hazard.warning > 0) {
      const alpha = reducedMotion ? 1 : .65 + Math.sin(time * 10) * .3;
      ctx.globalAlpha = alpha; rect(hazard.x - 16, 95, 32, 32, '#f7c779', 11); label('!', hazard.x, 118, 23, '#684735');
      path([[hazard.x, 134], [hazard.x, 162]], '#a64f3b80', 2); ctx.globalAlpha = 1;
    } else if (hazard.type === 'brick') {
      ctx.save(); ctx.translate(hazard.x, hazard.y); ctx.rotate(hazard.spin); rect(-13, -9, 26, 18, '#aa6246', 3); rect(-13, -9, 26, 5, '#d58c65', 2); path([[-5, -2], [4, -2]], '#703d31', 2); ctx.restore();
    } else {
      const flap = Math.sin(time * 15) * 12;
      path([[hazard.x - 25, hazard.y - 8 - flap], [hazard.x - 11, hazard.y - 12], [hazard.x, hazard.y], [hazard.x + 13, hazard.y - 12], [hazard.x + 27, hazard.y - 8 - flap]], '#f4f1d9', 7);
      circle(hazard.x, hazard.y, 7, '#f8f3dc'); path([[hazard.x - 2, hazard.y + 5], [hazard.x + 2, hazard.y + 13]], '#d79a48', 4); circle(hazard.x + 2, hazard.y, 1.4, '#37594b');
    }
  }
}
function spawnHazard() {
  const aimed = Math.random() < .65;
  hazards.push({ type: Math.random() < .55 ? 'brick' : 'gull', x: clamp(aimed ? player.x - 13 + (Math.random() - .5) * 38 : 30 + Math.random() * 340, 26, 374), y: -25, warning: 1.35, speed: 115 + floorIndex * 12 + Math.random() * 30, spin: 0 });
}
function applyStroke(from, to) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 7));
  for (let step = 1; step <= steps; step++) {
    const x = from.x + (to.x - from.x) * step / steps;
    const y = from.y + (to.y - from.y) * step / steps;
    for (const pane of panes) if (!pane.clean) {
      const wasFull = pane.coverage === 1;
      pane.coverage = paintFoam(pane.foam, pane, x, y, 21 + save.squeegeeLevel * 7);
      if (!wasFull && pane.coverage === 1) { haptic(); toast('100%! Отпусти — и окно засияет.', 2); }
    }
  }
}
function update(dt) {
  if (document.hidden && ['playing', 'wiping'].includes(state)) pause();
  time += dt;
  if (time > toastUntil) $('toast').classList.remove('visible');
  if (state === 'playing') {
    const lerp = 1 - Math.exp(-20 * dt);
    player.x += (target.x - player.x) * lerp; player.y += (target.y - player.y) * lerp;
  }
  if (state === 'wiping') {
    let active = false;
    for (const pane of panes) if (pane.wipe >= 0 && !pane.clean) {
      pane.wipe += dt * (.7 + save.squeegeeLevel * .35);
      if (pane.wipe >= 1) {
        pane.clean = true; pane.wipe = 1; earned += RULES.windowPay; updateHUD();
        sparks.push({ x: pane.x + pane.w / 2, y: pane.y + pane.h / 2, life: 1 });
      } else active = true;
    }
    if (!active) {
      if (panes.every(pane => pane.clean)) completeFloor();
      else { state = 'playing'; $('hint').textContent = 'Води по стеклу → отпусти, когда будет 100%'; updateHUD(); }
    }
  }
  // Hazards pause during the short automatic wipe: the player cannot drag then.
  if (state === 'playing') {
    invulnerable = Math.max(0, invulnerable - dt); nextHazard -= dt;
    if (nextHazard <= 0) { spawnHazard(); nextHazard = 4.6 + Math.random() * 2.8 - floorIndex * .25; }
    for (const hazard of hazards) {
      if (hazard.warning > 0) { hazard.warning -= dt; continue; }
      hazard.y += hazard.speed * dt; hazard.spin += dt * 3;
      if (invulnerable <= 0 && Math.abs(hazard.x - (player.x - 13)) < 27 && Math.abs(hazard.y - (player.y + 30)) < 40) {
        hazard.y = H + 100; invulnerable = 2;
        if (helmetHits > 0) { helmetHits--; haptic('heavy'); toast(helmetHits ? `Каска спасла. Осталось ударов: ${helmetHits}` : 'Каска слетела! Следующий удар — падение.', 3); updateHUD(); }
        else { fall('Не удалось увернуться от удара без каски.'); break; }
      }
    }
    hazards = hazards.filter(hazard => hazard.y < H + 70);
  }
  if (state === 'descending') {
    transition = Math.min(1, transition + dt / (reducedMotion ? .15 : 1));
    const ease = transition * transition * (3 - 2 * transition);
    camera = (floorIndex + ease) * stride();
    player.y += (windowTop() - 40 - player.y) * (1 - Math.exp(-5 * dt));
    if (transition >= 1) {
      floorIndex++; camera = floorIndex * stride();
      if (floorIndex >= 6) finishRun();
      else { createPanes(); state = 'playing'; target = { ...player }; nextHazard = 3.5; invulnerable = 1; updateHUD(); $('hint').textContent = 'Води по стеклу → отпусти, когда будет 100%'; }
    }
  }
  if (state === 'falling') { fallTime += dt; if (fallTime > .85) fallenScreen(); }
  if (!['paused', 'saving', 'save-error'].includes(state)) for (const spark of sparks) { spark.life -= dt; spark.y -= dt * 25; }
  sparks = sparks.filter(spark => spark.life > 0);
}
function frame(now) {
  const dt = Math.min((now - (lastFrame || now)) / 1000, .04); lastFrame = now;
  update(dt); ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.clearRect(0, 0, W, H);
  drawScene(); drawHazards(); drawPlayer();
  for (const spark of sparks) { ctx.globalAlpha = spark.life; label('+$10', spark.x, spark.y, 22, '#f4ffd3', 'center', 800); ctx.globalAlpha = 1; }
  requestAnimationFrame(frame);
}
async function boot() {
  state = 'loading';
  modal('<span class="kicker">Промальп · Стекломой</span><h2 id="panel-title">Готовим верёвки…</h2><p class="description loading-dot">Проверяем снаряжение и сохранения.</p>');
  try {
    save = await storage.load();
    $('storage-label').textContent = storage.mode === 'cloud' ? 'Прогресс сохраняется в Telegram' : 'Браузерная версия · отдельное сохранение на этом устройстве';
    home();
  } catch {
    state = 'load-error';
    $('storage-label').textContent = 'Сохранение пока недоступно';
    modal('<span class="kicker">Нужна связь</span><h2 id="panel-title">Прогресс не загружен</h2><p class="description">Проверь интернет и обнови Telegram, если игра открыта в нём. Если ошибка остаётся, сохранение может быть повреждено. Мы не заменяем его пустым.</p><button class="primary" id="retry-load">Повторить загрузку</button>');
    action('retry-load', boot);
  }
}
resize(); requestAnimationFrame(frame); boot();
