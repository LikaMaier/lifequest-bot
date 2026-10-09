import type { FastifyInstance } from 'fastify';
import { prisma, plain, HttpError } from '../util';

/**
 * Тарифы хранятся в БД (таблица Plan) и меняются без деплоя.
 * Стартовые значения цен — ЗАГЛУШКИ, их нужно уточнить (см. README).
 */
export const DEFAULT_PLANS = [
  { code: 'master_month', title: 'Мастер — 1 месяц', months: 1, starsPrice: 1, aiLimit: 100, sort: 1 },
  { code: 'master_year', title: 'Мастер — 12 месяцев', months: 12, starsPrice: 10, aiLimit: 100, sort: 2 },
  { code: 'pro_month', title: 'PRO — 1 месяц', months: 1, starsPrice: 2, aiLimit: 500, sort: 3 },
  { code: 'pro_year', title: 'PRO — 12 месяцев', months: 12, starsPrice: 20, aiLimit: 500, sort: 4 },
];

export async function seedPlans() {
  const count = await prisma.plan.count();
  if (count === 0) await prisma.plan.createMany({ data: DEFAULT_PLANS });
}

/** Продление подписки после ПОДТВЕРЖДЁННОЙ оплаты (вызывается только из обработчика successful_payment бота) */
export async function applyPayment(userId: string, planCode: string, stars: number, chargeId: string) {
  const exists = await prisma.payment.findUnique({ where: { telegramChargeId: chargeId } });
  if (exists) return; // идемпотентность: повторное уведомление не продлевает дважды
  const plan = await prisma.plan.findUnique({ where: { code: planCode } });
  if (!plan) throw new Error(`Неизвестный тариф ${planCode}`);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const base = user.subscriptionUntil && user.subscriptionUntil > new Date() ? user.subscriptionUntil : new Date();
  const until = new Date(base);
  until.setMonth(until.getMonth() + plan.months);
  await prisma.$transaction([
    prisma.payment.create({ data: { userId, planCode, stars, telegramChargeId: chargeId } }),
    prisma.user.update({ where: { id: userId }, data: { subscriptionUntil: until } }),
  ]);
}

export async function billingRoutes(app: FastifyInstance, opts: { bot?: any }) {
  app.get('/api/plans', async () => plain(await prisma.plan.findMany({ where: { active: true }, orderBy: { sort: 'asc' } })));

  app.get('/api/payments', async (req) => plain(await prisma.payment.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' } })));

  // Создать ссылку на оплату в Telegram Stars. Доступ выдаётся только после successful_payment.
  app.post('/api/pay/:code', async (req) => {
    const { code } = req.params as any;
    const plan = await prisma.plan.findFirst({ where: { code, active: true } });
    if (!plan) throw new HttpError(404, 'Тариф не найден');
    if (!opts.bot) throw new HttpError(503, 'Оплата не настроена: бот не подключён', 'payments_unavailable');
    const url = await opts.bot.api.createInvoiceLink(
      plan.title, 'Подписка СМЕТА PRO: сметы, справочники, калькуляторы, финансы объектов',
      `${req.user.id}:${plan.code}`, '', 'XTR', [{ label: plan.title, amount: plan.starsPrice }],
    );
    return { url };
  });
}
