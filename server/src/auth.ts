import crypto from 'node:crypto';

export interface TgUser { id: number; first_name?: string; username?: string }

/**
 * Проверка initData Telegram Mini App (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
 * secret = HMAC_SHA256(key="WebAppData", msg=botToken); hash = HMAC_SHA256(key=secret, msg=data_check_string)
 */
export function verifyInitData(initData: string, botToken: string, maxAgeSec = 24 * 3600): TgUser {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('Нет подписи initData');
  params.delete('hash');
  const dataCheck = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
  if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash)))
    throw new Error('Подпись initData неверна');
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) throw new Error('initData устарели, откройте приложение заново');
  const user = JSON.parse(params.get('user') || 'null');
  if (!user?.id) throw new Error('Нет данных пользователя');
  return user;
}

/** Подписанный токен сессии: base64url(payload).hmac */
export function signSession(userId: string, secret: string, ttlSec = 7 * 24 * 3600): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(token: string, secret: string): string | null {
  const [payload, sig] = (token || '').split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!uid || exp < Date.now() / 1000) return null;
    return uid;
  } catch { return null; }
}
