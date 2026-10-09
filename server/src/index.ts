import { env, assertEnv } from './env';
import { buildApp } from './app';
import { createBot, setupBot } from './bot';
import { seedPlans } from './routes/billing';
import { prisma } from './util';

async function main() {
  assertEnv();
  await seedPlans();
  const bot = createBot();
  if (bot) await bot.init();
  const app = await buildApp({ bot });
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  if (bot) {
    // Ошибка настройки бота не должна ронять приложение
    setupBot(bot).catch((e) => app.log.error({ err: e }, 'Не удалось настроить бота'));
  } else {
    app.log.warn('BOT_TOKEN не задан — бот и оплата отключены');
  }
  const stop = async () => { await app.close(); await prisma.$disconnect(); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => { console.error(e); process.exit(1); });
