import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../env';
import { prisma, plain, accessOf, HttpError } from '../util';
import { verifyInitData, signSession } from '../auth';

async function upsertUser(tgId: number, firstName?: string, username?: string) {
  const existing = await prisma.user.findUnique({ where: { tgId: BigInt(tgId) } });
  if (existing) {
    return prisma.user.update({ where: { id: existing.id }, data: { firstName, username } });
  }
  return prisma.user.create({
    data: {
      tgId: BigInt(tgId), firstName, username,
      trialEndsAt: new Date(Date.now() + env.TRIAL_DAYS * 86400000),
      priceLists: { create: { name: 'Основной прайс', isDefault: true } },
    },
  });
}

export function meView(user: any) {
  return plain({
    id: user.id, tgId: user.tgId, firstName: user.firstName, username: user.username,
    companyName: user.companyName, contacts: user.contacts, aiEnabled: user.aiEnabled,
    aiAvailable: Boolean(env.AI_PROVIDER),
    access: accessOf(user),
    isAdmin: env.ADMIN_TG_IDS.includes(String(user.tgId)),
  });
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/telegram', async (req) => {
    const { initData } = z.object({ initData: z.string().min(1) }).parse(req.body);
    let tg;
    try { tg = verifyInitData(initData, env.BOT_TOKEN); } catch (e: any) { throw new HttpError(401, e.message, 'bad_init_data'); }
    const user = await upsertUser(tg.id, tg.first_name, tg.username);
    return { token: signSession(user.id, env.SESSION_SECRET), user: meView(user) };
  });

  // Только для разработки вне Telegram (DEV_AUTH=1)
  app.post('/api/auth/dev', async (req) => {
    if (!env.DEV_AUTH) throw new HttpError(404, 'Не найдено');
    const { tgId, name } = z.object({ tgId: z.number().int(), name: z.string().optional() }).parse(req.body);
    const user = await upsertUser(tgId, name || 'Тест');
    return { token: signSession(user.id, env.SESSION_SECRET || 'dev-secret'), user: meView(user) };
  });

  app.get('/api/me', async (req) => meView(req.user));

  app.patch('/api/me', async (req) => {
    const body = z.object({
      aiEnabled: z.boolean().optional(),
      companyName: z.string().max(200).nullable().optional(),
      contacts: z.string().max(500).nullable().optional(),
    }).parse(req.body);
    const user = await prisma.user.update({ where: { id: req.user.id }, data: body });
    return meView(user);
  });
}
