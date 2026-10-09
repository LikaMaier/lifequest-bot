import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { User } from '@prisma/client';
import { env } from './env';
import { prisma, handleError, HttpError, accessOf } from './util';
import { verifySession } from './auth';
import { authRoutes } from './routes/auth';
import { catalogRoutes } from './routes/catalog';
import { estimateRoutes } from './routes/estimates';
import { projectRoutes } from './routes/projects';
import { noteRoutes } from './routes/notes';
import { billingRoutes } from './routes/billing';
import { aiRoutes } from './routes/ai';

declare module 'fastify' {
  interface FastifyRequest { user: User }
}

// Маршруты, доступные без активной подписки (вход, настройки, оплата)
const OPEN_WRITE = [/^\/api\/auth\//, /^\/api\/me$/, /^\/api\/pay\//];

export async function buildApp(opts: { bot?: any; logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true, bodyLimit: 2 * 1024 * 1024 });
  app.decorateRequest('user', null as any);
  app.setErrorHandler((err, _req, reply) => handleError(err, reply));

  // Авторизация и проверка подписки для всех /api, кроме входа
  app.addHook('preHandler', async (req: FastifyRequest, reply) => {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/') || url.startsWith('/api/auth/') || url === '/api/health') return;
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const uid = verifySession(token, env.SESSION_SECRET || 'dev-secret');
    if (!uid) return reply.status(401).send({ error: 'Сессия истекла. Откройте приложение заново.', code: 'unauthorized' });
    const user = await prisma.user.findUnique({ where: { id: uid } });
    if (!user) return reply.status(401).send({ error: 'Пользователь не найден', code: 'unauthorized' });
    req.user = user;
    const isWrite = req.method !== 'GET';
    if (isWrite && !OPEN_WRITE.some((r) => r.test(url)) && !accessOf(user).active) {
      return reply.status(402).send({ error: 'Требуется подписка. Данные сохранены и доступны для просмотра.', code: 'subscription_required' });
    }
  });

  app.get('/api/health', async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(catalogRoutes);
  await app.register(estimateRoutes);
  await app.register(projectRoutes);
  await app.register(noteRoutes);
  await app.register(billingRoutes, { bot: opts.bot });
  await app.register(aiRoutes);

  // Telegram webhook
  if (opts.bot && env.PUBLIC_URL) {
    const { webhookCallback } = await import('grammy');
    const cb = webhookCallback(opts.bot, 'fastify', { secretToken: env.WEBHOOK_SECRET || undefined });
    app.post('/bot/webhook', cb as any);
  }

  // Статика Mini App
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(here, '../../web/dist');
  if (fs.existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Не найдено' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}

export function requireOwn<T extends { userId: string } | null>(row: T, what = 'Запись'): NonNullable<T> {
  if (!row) throw new HttpError(404, `${what} не найдена`, 'not_found');
  return row as NonNullable<T>;
}
