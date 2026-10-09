// Все секреты — только из переменных окружения сервера.
export const env = {
  PORT: Number(process.env.PORT || 3000),
  DATABASE_URL: process.env.DATABASE_URL || '',
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  // Публичный адрес приложения (https://xxx.up.railway.app) — для webhook и кнопки Mini App
  PUBLIC_URL: (process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')).replace(/\/$/, ''),
  SESSION_SECRET: process.env.SESSION_SECRET || '',
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || '',
  ADMIN_TG_IDS: (process.env.ADMIN_TG_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  TRIAL_DAYS: Number(process.env.TRIAL_DAYS || 7),
  // Только для локальной разработки вне Telegram. На проде не включать.
  DEV_AUTH: process.env.DEV_AUTH === '1',
  // ИИ (этап 4) — пока не подключён
  AI_PROVIDER: process.env.AI_PROVIDER || '',
};

export function assertEnv() {
  const missing: string[] = [];
  if (!env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!env.SESSION_SECRET && !env.DEV_AUTH) missing.push('SESSION_SECRET');
  if (!env.BOT_TOKEN && !env.DEV_AUTH) missing.push('BOT_TOKEN');
  if (missing.length) throw new Error(`Не заданы переменные окружения: ${missing.join(', ')}`);
}
