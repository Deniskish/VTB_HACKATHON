// Анонимная сессия браузера для серверного профиля компании и уведомлений.
// Она различает браузеры, но не подтверждает личность пользователя и полномочия.
// Внешнюю авторизацию можно подключить на сервере, не меняя запросы интерфейса.
export const sessionStorageKey = 'opora.session.v1';
export const sessionHeader = 'X-Opora-Session';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
let memoryToken = '';

function createToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function sessionToken(storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage) {
  try {
    const saved = storage?.getItem(sessionStorageKey);
    if (saved && tokenPattern.test(saved)) return saved;
  } catch { /* Storage is unavailable: keep the session for this page only. */ }
  memoryToken ||= createToken();
  try { storage?.setItem(sessionStorageKey, memoryToken); } catch { /* See above. */ }
  return memoryToken;
}

export function sessionHeaders(): Record<string, string> {
  return { [sessionHeader]: sessionToken() };
}
