import { parseSave } from './core.mjs';

export function createStorage(tg, local, timeout = 10000) {
  // Never redirect a Telegram user's failed cloud operation into browser storage.
  const cloudMode = Boolean(tg?.initData) || /(?:^|[&#?])tgWebApp(?:Data|Platform)=/.test(globalThis.location?.hash || '');
  const supported = tg?.isVersionAtLeast?.('6.9') && tg?.CloudStorage;
  const key = 'promalp_save';
  const localKey = 'promalp_browser_save_v1';
  function cloud(method, value) {
    return new Promise((resolve, reject) => {
      if (!supported) return reject(new Error('Обновите Telegram: для сохранений нужна версия с поддержкой CloudStorage.'));
      let settled = false;
      const timer = setTimeout(() => { settled = true; reject(new Error('Telegram не ответил. Проверьте интернет и повторите.')); }, timeout);
      const callback = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error || (method === 'setItem' && result !== true)) reject(new Error('Не удалось связаться с облаком Telegram. Повторите попытку.'));
        else resolve(result);
      };
      try {
        if (method === 'getItem') tg.CloudStorage.getItem(key, callback);
        else tg.CloudStorage.setItem(key, value, callback);
      } catch (error) { clearTimeout(timer); settled = true; reject(error); }
    });
  }
  return {
    mode: cloudMode ? 'cloud' : 'local',
    async load() {
      const raw = cloudMode ? await cloud('getItem') : local.getItem(localKey);
      return parseSave(raw);
    },
    async save(data) {
      const value = JSON.stringify(parseSave(data));
      if (cloudMode) await cloud('setItem', value);
      else local.setItem(localKey, value);
    }
  };
}
