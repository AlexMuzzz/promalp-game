import { createAudio } from './audio.mjs?v=2';
import { drawClimber } from './avatar.mjs?v=2';
import { RULES, DEFAULT_SAVE, priceFor, purchase, descend, deposit, createFoam, paintFoam, SKINS, buySkin, equipSkin, windowReward } from './core.mjs?v=2';
import { createStorage } from './storage.mjs?v=2';

const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const tg = window.Telegram?.WebApp;
const sound = createAudio({preferences:{getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)}});
const storage = createStorage(tg, { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) });
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let save = { ...DEFAULT_SAVE };
let state = 'loading', previousState = 'playing';
let W = 400, H = 600, scale = 1;
let floorIndex = 0, earned = 0, helmetHits = 1, camera = 0;
let panes = [], floorHistory = [], hazards = [];
let previewSkin = 'worker';
const controlHint = '← Води влево-вправо · спуск и мытьё автоматически →';
let pointer = null, target = { x: 200, y: 180 }, player = { ...target };
let nextHazard = 6, invulnerable = 0, fallTime = 0, time = 0;
let toastUntil = 0, lastFrame = 0, focusBeforeModal;
let shopOrigin = 'home';
const money = value => `$${value}`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const windowHeight = () => Math.min(205, H * .34);
const stride = () => windowHeight() + 110;
const playerLine = () => H * .40;
const windowTop = () => playerLine() + 60;

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
  $('helmet').textContent = ['playing', 'paused', 'saving'].includes(state) ? `${helmetHits} из ${save.helmetLevel} ударов` : `Уровень ${save.helmetLevel}`;
  $('squeegee').textContent = `Уровень ${save.squeegeeLevel}`;
  $('profile-button').disabled = !['home', 'shop', 'profile'].includes(state);
  $('pause').disabled = !['playing', 'paused'].includes(state);
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
function action(id, fn) { $(id).addEventListener('click', event => { if (id !== 'sound-button') sound.unlock(); fn(event); }); }
function home() {
  state = 'home'; floorIndex = 0; camera = 0; hazards = []; floorHistory = []; panes = []; earned = 0;
  player = { x: 290, y: H * .22 }; target = { ...player };
  $('run-hud').hidden = true; $('floor-progress').hidden = true; $('hint').hidden = true;
  updateHUD();
  modal(`<span class="kicker">Работа на высоте</span>
    <h1 id="panel-title">Чистая работа.<br><em>На высоте.</em></h1>
    <p class="intro">Спускайся на верёвке, мой окна на ходу и лавируй между опасностями.</p>
    <div class="mission"><span><b>6</b>этажей</span><span><b>18</b>окон</span><span><b>до $180</b>за объект</span></div>
    <button class="primary" id="start">На крышу <span aria-hidden="true">↗</span></button>
    <div class="home-actions"><button class="secondary" id="profile">Мой альпинист</button><button class="secondary" id="shop">Снаряжение</button></div>
    <button class="text-button" id="help">Как здесь работать?</button>
    <p class="meta-line">ТИХИЙ ДВОР · ОБЪЕКТ № 01</p>`, 'hero');
  action('profile', () => showProfile()); action('start', startRun); action('shop', () => showShop('home')); action('help', instructions);
}
function instructions() {
  modal(`<span class="kicker">Новый способ работать</span><h2 id="panel-title">Вниз по верёвке</h2>
    <ol class="steps"><li><b>Спуск идёт сам</b>Фасад движется вверх, альпинист плавно спускается. Останавливаться у каждого окна больше не нужно.</li>
    <li><b>Рули влево-вправо</b>Зажми палец или мышь в любом месте поля и двигай в стороны. Склиз сам оставляет чистую полосу. На клавиатуре — стрелки или A / D.</li>
    <li><b>Успей побольше</b>Мой несколько окон, пока проходишь этаж. За каждое — до $10, пропорционально очищенной площади. Пропущенное стекло остаётся грязным.</li>
    <li><b>Береги каску</b>Уклоняйся от кирпичей и чаек. На каждом этаже верёвка изнашивается. Падение сжигает заработок попытки.</li></ol>
    <button class="primary" id="understood">Погнали вниз ↓</button><button class="text-button" id="back">Назад</button>`);
  action('understood', startRun); action('back', home);
}
function createPanes() {
  panes = Array.from({ length: 3 }, (_, i) => ({ x: 34 + i * 114, y: windowTop(), w: 104, h: windowHeight(), foam: createFoam(), coverage: 0, clean: false, reward: 0 }));
}
function startRun() {
  heldKeys.clear(); sound.effect('start');
  state = 'playing'; floorIndex = 0; earned = 0; helmetHits = save.helmetLevel;
  hazards = []; floorHistory = []; camera = 0; nextHazard = 7; invulnerable = 1.5;
  createPanes(); player = { x: 200, y: playerLine() }; target = { ...player };
  $('run-hud').hidden = false; $('floor-progress').hidden = false; $('hint').hidden = false;
  $('hint').textContent = controlHint;
  closeModal(); updateHUD(); haptic();
  try { if (tg?.isVersionAtLeast('6.2')) tg.enableClosingConfirmation(); } catch { /* optional */ }
}
function showShop(origin = shopOrigin) {
  shopOrigin = origin; state = 'shop'; updateHUD();
  const rows = [
    ['rope', 'Свежая верёвка', `Прочность ${save.ropeDurability}/20 → 20/20. Замена основной.`, save.ropeDurability === 20 ? 'Как новая' : null],
    ['insurance', 'Вторая верёвка', 'Спасёт при одном обрыве. После подхвата: 20/20.', save.ropes === 2 ? 'Куплена' : null],
    ['helmet', `Каска · уровень ${save.helmetLevel}`, `Следующий уровень: ${Math.min(3, save.helmetLevel + 1)} удара за попытку.`, save.helmetLevel === 3 ? 'Максимум' : null],
    ['squeegee', `Склиз · уровень ${save.squeegeeLevel}`, 'Шире полоса очистки — больше денег на ходу.', save.squeegeeLevel === 3 ? 'Максимум' : null]
  ];
  modal(`<span class="kicker">Подготовка к смене</span><h2 id="panel-title">Снаряжение</h2><p class="shop-balance">В кошельке <b>${money(save.balance)}</b></p>
    ${rows.map(([id, title, text, tag]) => `<div class="shop-item"><div><b>${title}</b><p>${text}</p></div>${tag ? `<span class="tag">${tag}</span>` : `<button class="buy" id="buy-${id}" ${save.balance < priceFor(save, id) ? 'disabled' : ''} aria-label="Купить: ${title}, ${priceFor(save, id)} долларов">${money(priceFor(save, id))}</button>`}</div>`).join('')}
    <button class="primary" id="shop-start">${origin === 'home' ? 'На крышу ↗' : 'Следующий спуск ↗'}</button>
    <button class="secondary" id="shop-profile">Мой альпинист · скины</button><button class="text-button" id="shop-back">На главный экран</button>
    <p class="note">Каска восстанавливается перед каждой попыткой. После потери последней верёвки выдаём базовую бесплатно.</p>`);
  for (const [id] of rows) if ($(`buy-${id}`)) action(`buy-${id}`, () => {
    if (state !== 'shop') return;
    const next = purchase(save, id);
    persist(next, () => { haptic(); sound.effect('buy'); showShop(origin); }, 'Сохраняем покупку…');
  });
  action('shop-profile', () => showProfile()); action('shop-start', startRun); action('shop-back', home);
}

function drawProfilePortrait() {
  const portrait = $('portrait');
  if (!portrait) return;
  const g = portrait.getContext('2d');
  g.setTransform(2,0,0,2,0,0); g.clearRect(0,0,280,180);
  const glow = g.createLinearGradient(0,0,280,180); glow.addColorStop(0,'#335f59'); glow.addColorStop(1,'#203b43');
  g.fillStyle=glow; g.beginPath(); g.roundRect(0,0,280,180,18); g.fill();
  g.strokeStyle='#90b8a329'; g.lineWidth=1;
  for (let x=20;x<280;x+=30) { g.beginPath();g.moveTo(x,0);g.lineTo(x,180);g.stroke(); }
  for (let y=15;y<180;y+=30) { g.beginPath();g.moveTo(0,y);g.lineTo(280,y);g.stroke(); }
  g.strokeStyle='#dfd294';g.lineWidth=2;g.beginPath();g.moveTo(110,0);g.lineTo(143,130);g.stroke();
  if(save.ropes===2) {g.strokeStyle='#e79b77';g.beginPath();g.moveTo(167,0);g.lineTo(157,130);g.stroke();}
  drawClimber(g,{x:148,y:90,zoom:1.55,skinId:previewSkin,equipment:save,helmet:true,time:0,washing:false});
  g.fillStyle='#d9ee86';g.font='600 9px system-ui';g.textAlign='left';g.fillText('PROMALP / CREW',14,23);
  g.fillStyle='#b8cdbb';g.font='9px system-ui';g.fillText(save.ropes===2?'ДВОЙНАЯ СТРАХОВКА':'ГОТОВ К ВЫХОДУ',14,166);
}
function showProfile(id = save.equippedSkin) {
  previewSkin = id; state = 'profile'; updateHUD();
  const skin = SKINS.find(item => item.id === id) || SKINS[0];
  const owned = save.ownedSkins.includes(skin.id), equipped = save.equippedSkin === skin.id;
  modal(`<span class="kicker">Личное дело · высотная бригада</span>
    <div class="profile-title"><h2 id="panel-title">Мой альпинист</h2><span>${money(save.balance)}</span></div>
    <canvas id="portrait" width="560" height="360" aria-label="Примерка образа ${skin.name} с вашим снаряжением"></canvas>
    <div class="identity"><strong id="profile-name">Высотник</strong><span>${equipped ? 'На смене' : 'Примерка'} · ${skin.name}</span></div>
    <div class="kit-slots"><div><i>⌁</i><b>${save.ropes === 2 ? 'Две верёвки' : 'Верёвка'}</b><small>${save.ropeDurability}/20 · ${save.ropes === 2 ? 'страховка есть' : 'без страховки'}</small></div><div><i>◒</i><b>Каска Lv.${save.helmetLevel}</b><small>${save.helmetLevel} ${save.helmetLevel === 1 ? 'удар' : 'удара'}</small></div><div><i>⊤</i><b>Склиз Lv.${save.squeegeeLevel}</b><small>${['','Стандарт','Широкий','Профи'][save.squeegeeLevel]}</small></div></div>
    <div class="wardrobe-heading"><b>Гардероб</b><span>${save.ownedSkins.length} / ${SKINS.length} образа</span></div>
    <div class="skin-grid">${SKINS.map(item => `<button class="skin-card ${item.id === skin.id ? 'selected' : ''}" id="skin-${item.id}" aria-pressed="${item.id === skin.id}" aria-label="Примерить: ${item.name}"><canvas id="thumb-${item.id}" width="140" height="150" aria-hidden="true"></canvas><b>${item.name}</b><small>${item.id === save.equippedSkin ? 'Надет ✓' : save.ownedSkins.includes(item.id) ? 'Куплен' : money(item.price)}</small></button>`).join('')}</div>
    <p class="skin-description">${skin.subtitle}. Скины меняют внешность, а не характеристики.</p>
    <button class="primary" id="skin-action" ${equipped || (!owned && save.balance < skin.price) ? 'disabled' : ''}>${equipped ? 'Этот образ надет ✓' : owned ? 'Надеть образ' : save.balance < skin.price ? `Не хватает ${money(skin.price-save.balance)}` : `Купить и надеть · ${money(skin.price)}`}</button>
    <button class="secondary" id="profile-gear">Улучшить снаряжение</button><button class="text-button" id="profile-back">На главный экран</button>`, 'profile-panel');
  $('profile-name').textContent = tg?.initDataUnsafe?.user?.first_name || 'Высотник';
  drawProfilePortrait();
  for (const item of SKINS) {
    const g = $(`thumb-${item.id}`).getContext('2d');g.setTransform(2,0,0,2,0,0);
    drawClimber(g,{x:39,y:34,zoom:.64,skinId:item.id,equipment:save,helmet:true});
    action(`skin-${item.id}`, () => showProfile(item.id));
  }
  action('skin-action', () => {
    if(state !== 'profile' || equipped || (!owned && save.balance < skin.price)) return;
    persist(owned ? equipSkin(save,skin.id) : buySkin(save,skin.id), () => {haptic();sound.effect('buy');showProfile(skin.id);}, owned ? 'Надеваем образ…' : 'Сохраняем новый образ…');
  });
  action('profile-gear', () => showShop('home')); action('profile-back',home);
}

// A failed write retries exactly the same snapshot, never re-applies a reward/purchase.
async function persist(next, onSuccess, title = 'Сохраняем снаряжение…', keepPointer = false) {
  state = 'saving'; if (!keepPointer) releasePointer(); updateHUD();
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
  if (state !== 'playing') return;
  const outcome = descend(save);
  floorHistory[floorIndex] = panes;
  persist(outcome.save, () => {
    closeModal();
    if (outcome.event === 'fall') { fall('Верёвка оборвалась. Выдали новую — за наш счёт.'); return; }
    if (outcome.event === 'caught') { toast('Страховка поймала! Осталась одна верёвка.', 4); haptic('heavy'); }
    floorIndex++; camera = floorIndex * stride();
    if (floorIndex >= RULES.floors) { releasePointer(); finishRun(); }
    else { createPanes(); state = 'playing'; invulnerable = Math.max(invulnerable, .7); updateHUD(); $('hint').textContent = controlHint; }
  }, 'Закрепляем верёвку…', true);
}
let fallReason = '';
function fall(reason) {
  state = 'falling'; fallTime = 0; fallReason = reason; earned = 0; hazards = []; releasePointer();
  $('hint').textContent = 'Срыв! Заработок за спуск потерян.';
  updateHUD(); haptic('heavy'); sound.effect('fall');
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
  modal(`<span class="kicker">Все 6 этажей позади</span><h2 id="panel-title">Чистая работа!</h2><p class="description">Обе ноги на земле. Оплата за очищенную площадь — твоя после сдачи объекта.</p><div class="big-number">${money(earned)}</div><button class="primary" id="submit">Сдать объект · ${money(earned)}</button><p class="note">Зачислим в кошелёк и сохраним прогресс.</p>`);
  action('submit', () => {
    if (state !== 'finished') return;
    const amount = earned;
    persist(deposit(save, amount), () => {
      earned = 0; updateHUD(); haptic('medium'); sound.effect('finish');
      try { if (tg?.isVersionAtLeast('6.2')) tg.disableClosingConfirmation(); } catch { /* optional */ }
      showShop('completed'); toast(`Объект сдан. +${money(amount)} в кошельке!`, 4);
    }, 'Зачисляем заработок…');
  });
}
function pause() {
  if (!['playing', 'paused'].includes(state)) return;
  if (state === 'paused') { heldKeys.clear(); state = previousState; closeModal(); updateHUD(); return; }
  heldKeys.clear(); previousState = state; state = 'paused'; releasePointer(); updateHUD();
  modal(`<span class="kicker">Небольшой перекур</span><h2 id="panel-title">Висим. Отдыхаем.</h2><p class="description">Чайки тоже подождут. Намыто за спуск: ${money(earned)}.</p><button class="primary" id="resume">Продолжить</button><button class="secondary" id="quit">Завершить попытку</button>`);
  action('resume', pause); action('quit', () => {
    modal(`<h2 id="panel-title">Закончить спуск?</h2><p class="description">Несданный заработок ${money(earned)} пропадёт. Износ верёвки останется.</p><button class="primary" id="keep-playing">Продолжить работу</button><button class="secondary" id="confirm-quit">Уйти на главный экран</button>`);
    action('keep-playing', pause); action('confirm-quit', home);
  });
}
function updateSoundButton() {
  $('sound-button').textContent = sound.enabled ? '♫' : '♪̸';
  $('sound-button').setAttribute('aria-label', sound.enabled ? 'Выключить музыку и звуки' : 'Включить музыку и звуки');
  $('sound-button').setAttribute('aria-pressed', String(sound.enabled));
}
action('sound-button', async () => { await sound.toggle(); updateSoundButton(); if (!sound.supported) toast('Звук не поддерживается этим браузером.'); });
updateSoundButton();
action('pause', pause);
action('profile-button', () => showProfile());
window.addEventListener('pagehide', () => sound.update(state,true));
document.addEventListener('visibilitychange', () => { sound.update(state,document.hidden); if (document.hidden && ['playing'].includes(state)) pause(); });
window.addEventListener('blur', () => { if (['playing'].includes(state)) pause(); });
try { tg?.onEvent('deactivated', () => { if (['playing'].includes(state)) pause(); }); } catch { /* optional */ }
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
  return { x: clamp((event.clientX - rect.left) / rect.width * W, 18, W - 18), y: playerLine() };
}
canvas.addEventListener('pointerdown', event => {
  if (state !== 'playing' || pointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
  event.preventDefault(); sound.unlock(); pointer = event.pointerId; target = position(event); canvas.setPointerCapture(pointer);
});
canvas.addEventListener('pointermove', event => {
  if (event.pointerId !== pointer) return;
  event.preventDefault(); target = position(event);
});
function releasePointer() {
  const id = pointer; pointer = null;
  if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
}
canvas.addEventListener('pointerup', event => { if (event.pointerId === pointer) releasePointer(); });
canvas.addEventListener('pointercancel', event => { if (event.pointerId === pointer) releasePointer(); });
canvas.addEventListener('lostpointercapture', releasePointer);

function resize() {
  const oldStride = stride();
  const rect = canvas.getBoundingClientRect();
  H = W * rect.height / rect.width; scale = Math.min(devicePixelRatio || 1, 2) * rect.width / W;
  canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
  camera *= stride() / oldStride;
  for (const pane of [...panes, ...floorHistory.flat()]) { pane.y = windowTop(); pane.h = windowHeight(); }
  player.y = playerLine();
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
    for (let row = 0; row < 18; row++) for (let col = 0; col < 12; col++) {
      if (!pane.foam[row * 12 + col]) continue;
      const fy = y + row * h / 18;
      rect(x + col * w / 12, fy, w / 12 + .5, h / 18 + .5, (row + col) % 5 === 0 ? '#afe0d9' : '#91cdcf');
      // Foam stays near the moving squeegee; clear blue glass is left behind.
      if (state === 'playing' && Math.abs(fy - player.y) < 9) circle(x + (col + .5) * w / 12, fy, 4, '#f0f6e4');
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
        const p = active ? panes[i] : floorHistory[f]?.[i] || null;
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
  let x = player.x - 13, y = player.y + 40;
  if (state === 'falling') y += fallTime * fallTime * 700;
  if (state === 'fallen') return;
  const homeMode = ['home', 'loading', 'load-error', 'profile', 'shop'].includes(state);
  if (homeMode) { x = 280; y = H * .23 + Math.sin(time * 1.5) * 3; }
  if (invulnerable > 0 && Math.floor(time * 12) % 2 === 0 && !homeMode) ctx.globalAlpha = .6;
  if (state !== 'falling') {
    path([[180, -20], [x - 5, y + 23]], '#435844', 3);
    path([[180, -20], [x - 5, y + 23]], '#e3ca76', 1.4);
    if (save.ropes === 2) path([[224, -20], [x + 12, y + 25]], '#d5815a', 2.5);
  }
  drawClimber(ctx, {x,y,skinId:save.equippedSkin,equipment:save,helmet:helmetHits>0 || homeMode,time:reducedMotion ? 0 : time,washing:state==='playing'});
  ctx.globalAlpha = 1;
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
function washAlong(from, to, fromCamera, toCamera) {
  const distance = Math.hypot(to.x - from.x, toCamera - fromCamera);
  const steps = Math.max(1, Math.ceil(distance / 6));
  for (let step = 1; step <= steps; step++) {
    const x = from.x + (to.x - from.x) * step / steps;
    const y = playerLine() + fromCamera + (toCamera - fromCamera) * step / steps - floorIndex * stride();
    for (const pane of panes) if (!pane.clean) {
      pane.coverage = paintFoam(pane.foam, pane, x, y, 49 + save.squeegeeLevel * 8);
      pane.clean = pane.coverage === 1;
    }
  }
  for (const pane of panes) {
    const nextReward = windowReward(pane.coverage);
    if (nextReward > pane.reward) { const before = Math.floor(earned / 5); earned += nextReward - pane.reward; if (Math.floor(earned / 5) > before) sound.effect('coin'); pane.reward = nextReward; updateHUD(); }
  }
}
const heldKeys = new Set();
document.addEventListener('keydown', event => {
  if (state === 'playing' && ['ArrowLeft','ArrowRight','a','d','A','D'].includes(event.key)) { event.preventDefault(); heldKeys.add(event.key.toLowerCase()); }
});
document.addEventListener('keyup', event => heldKeys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => heldKeys.clear());
function update(dt) {
  if (document.hidden && state === 'playing') pause();
  sound.update(state,Boolean(document.hidden));
  time += dt;
  if (time > toastUntil) $('toast').classList.remove('visible');
  if (state === 'playing') {
    const before = {...player}, beforeCamera = camera;
    const left = heldKeys.has('arrowleft') || heldKeys.has('a'), right = heldKeys.has('arrowright') || heldKeys.has('d');
    if (left !== right) target.x = clamp(target.x + (right ? 1 : -1) * dt * 270, 18, W - 18);
    player.x += (target.x - player.x) * (1 - Math.exp(-14 * dt)); player.y = playerLine();
    camera = Math.min((floorIndex + 1) * stride(), camera + RULES.descentSpeed * dt);
    washAlong(before, player, beforeCamera, camera);
    invulnerable = Math.max(0, invulnerable - dt); nextHazard -= dt;
    if (nextHazard <= 0) { spawnHazard(); nextHazard = 5.5 + Math.random() * 2.8 - floorIndex * .25; }
    for (const hazard of hazards) {
      if (hazard.warning > 0) { hazard.warning -= dt; continue; }
      hazard.y += hazard.speed * dt; hazard.spin += dt * 3;
      if (invulnerable <= 0 && Math.abs(hazard.x - (player.x - 13)) < 27 && Math.abs(hazard.y - (player.y + 40)) < 40) {
        hazard.y = H + 100; invulnerable = 2;
        if (helmetHits > 0) { helmetHits--; haptic('heavy'); sound.effect('hit'); toast(helmetHits ? `Каска спасла. Осталось ударов: ${helmetHits}` : 'Каска слетела! Следующий удар — падение.', 3); updateHUD(); }
        else { fall('Не удалось увернуться от удара без каски.'); break; }
      }
    }
    hazards = hazards.filter(hazard => hazard.y < H + 70);
    if (state === 'playing' && camera >= (floorIndex + 1) * stride()) completeFloor();
  }
  if (state === 'falling') { fallTime += dt; if (fallTime > .85) fallenScreen(); }
}
function frame(now) {
  const dt = Math.min((now - (lastFrame || now)) / 1000, .04); lastFrame = now;
  update(dt); ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.clearRect(0, 0, W, H);
  drawScene(); drawHazards(); drawPlayer();
  requestAnimationFrame(frame);
}
async function boot() {
  state = 'loading';
  modal('<span class="kicker">Промальп · Стекломой</span><h2 id="panel-title">Готовим верёвки…</h2><p class="description loading-dot">Проверяем снаряжение и сохранения.</p>');
  try {
    save = await storage.load();
    $('storage-label').textContent = storage.mode === 'cloud' ? 'v2 · Прогресс сохраняется в Telegram' : 'v2 · Браузерная версия · отдельное сохранение';
    home();
  } catch {
    state = 'load-error';
    $('storage-label').textContent = 'Сохранение пока недоступно';
    modal('<span class="kicker">Нужна связь</span><h2 id="panel-title">Прогресс не загружен</h2><p class="description">Проверь интернет и обнови Telegram, если игра открыта в нём. Если ошибка остаётся, сохранение может быть повреждено. Мы не заменяем его пустым.</p><button class="primary" id="retry-load">Повторить загрузку</button>');
    action('retry-load', boot);
  }
}
resize(); requestAnimationFrame(frame); boot();
