import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, plain, notFound, HttpError, DEFAULT_CATEGORIES, num } from '../util';

const ITEM_TYPES = ['work', 'material', 'equipment', 'service', 'other'] as const;
const money = z.coerce.number().min(0, 'не может быть отрицательной').max(1e11);

const itemSchema = z.object({
  priceListId: z.string(),
  name: z.string().trim().min(1, 'введите название').max(300),
  type: z.enum(ITEM_TYPES),
  category: z.string().trim().min(1).max(100),
  unit: z.string().trim().min(1, 'укажите единицу').max(30),
  price: money,
  costPrice: money.nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  params: z.any().optional(),
  active: z.boolean().optional(),
});

export async function catalogRoutes(app: FastifyInstance) {
  const ownList = async (userId: string, id: string) => {
    const l = await prisma.priceList.findFirst({ where: { id, userId } });
    if (!l) throw notFound('Прайс-лист');
    return l;
  };
  const ownItem = async (userId: string, id: string) => {
    const i = await prisma.catalogItem.findFirst({ where: { id, userId, deletedAt: null } });
    if (!i) throw notFound('Позиция');
    return i;
  };

  app.get('/api/categories', async (req) => {
    const rows = await prisma.catalogItem.findMany({ where: { userId: req.user.id, deletedAt: null }, distinct: ['category'], select: { category: true } });
    const set = new Set([...DEFAULT_CATEGORIES, ...rows.map((r) => r.category)]);
    return [...set];
  });

  // ---- Прайс-листы ----
  app.get('/api/pricelists', async (req) => {
    const lists = await prisma.priceList.findMany({
      where: { userId: req.user.id }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: { _count: { select: { items: { where: { deletedAt: null } } } } },
    });
    return plain(lists.map((l) => ({ id: l.id, name: l.name, isDefault: l.isDefault, itemsCount: l._count.items })));
  });

  app.post('/api/pricelists', async (req) => {
    const { name, copyFromId } = z.object({ name: z.string().trim().min(1).max(100), copyFromId: z.string().optional() }).parse(req.body);
    const list = await prisma.priceList.create({ data: { userId: req.user.id, name } });
    if (copyFromId) {
      await ownList(req.user.id, copyFromId);
      const items = await prisma.catalogItem.findMany({ where: { userId: req.user.id, priceListId: copyFromId, deletedAt: null } });
      for (const it of items) {
        const { id, createdAt, priceListId, ...rest } = it as any;
        await prisma.catalogItem.create({ data: { ...rest, params: rest.params ?? undefined, priceListId: list.id } });
      }
    }
    return plain(list);
  });

  app.patch('/api/pricelists/:id', async (req) => {
    const { id } = req.params as any;
    await ownList(req.user.id, id);
    const body = z.object({ name: z.string().trim().min(1).max(100).optional(), isDefault: z.literal(true).optional() }).parse(req.body);
    if (body.isDefault) await prisma.priceList.updateMany({ where: { userId: req.user.id }, data: { isDefault: false } });
    return plain(await prisma.priceList.update({ where: { id }, data: body }));
  });

  app.delete('/api/pricelists/:id', async (req) => {
    const { id } = req.params as any;
    const l = await ownList(req.user.id, id);
    const count = await prisma.priceList.count({ where: { userId: req.user.id } });
    if (count <= 1) throw new HttpError(400, 'Нельзя удалить единственный прайс-лист');
    await prisma.priceList.delete({ where: { id } });
    if (l.isDefault) {
      const first = await prisma.priceList.findFirst({ where: { userId: req.user.id }, orderBy: { createdAt: 'asc' } });
      if (first) await prisma.priceList.update({ where: { id: first.id }, data: { isDefault: true } });
    }
    return { ok: true };
  });

  // ---- Позиции ----
  app.get('/api/items', async (req) => {
    const q = z.object({
      priceListId: z.string().optional(), q: z.string().optional(), type: z.string().optional(),
      category: z.string().optional(), includeInactive: z.string().optional(),
    }).parse(req.query);
    let priceListId = q.priceListId;
    if (!priceListId) {
      const def = await prisma.priceList.findFirst({ where: { userId: req.user.id, isDefault: true } });
      priceListId = def?.id;
    }
    const items = await prisma.catalogItem.findMany({
      where: {
        userId: req.user.id, deletedAt: null, priceListId,
        ...(q.includeInactive ? {} : { active: true }),
        ...(q.type ? { type: q.type } : {}),
        ...(q.category ? { category: q.category } : {}),
        ...(q.q ? { name: { contains: q.q, mode: 'insensitive' as const } } : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    return plain(items);
  });

  app.post('/api/items', async (req) => {
    const body = itemSchema.parse(req.body);
    await ownList(req.user.id, body.priceListId);
    const item = await prisma.catalogItem.create({ data: { ...body, userId: req.user.id } });
    await prisma.priceHistory.create({ data: { itemId: item.id, price: item.price, costPrice: item.costPrice } });
    return plain(item);
  });

  app.patch('/api/items/:id', async (req) => {
    const { id } = req.params as any;
    const prev = await ownItem(req.user.id, id);
    const body = itemSchema.partial().parse(req.body);
    if (body.priceListId) await ownList(req.user.id, body.priceListId);
    const priceChanged = (body.price != null && body.price !== num(prev.price)) ||
      (body.costPrice !== undefined && (body.costPrice ?? null) !== (prev.costPrice == null ? null : num(prev.costPrice)));
    const item = await prisma.catalogItem.update({
      where: { id }, data: { ...body, ...(priceChanged ? { priceUpdatedAt: new Date() } : {}) },
    });
    // Изменение цены НЕ затрагивает сохранённые сметы: в строках сметы хранится копия цены.
    if (priceChanged) await prisma.priceHistory.create({ data: { itemId: id, price: item.price, costPrice: item.costPrice } });
    return plain(item);
  });

  app.delete('/api/items/:id', async (req) => {
    const { id } = req.params as any;
    await ownItem(req.user.id, id);
    await prisma.catalogItem.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  });

  app.get('/api/items/:id/history', async (req) => {
    const { id } = req.params as any;
    await ownItem(req.user.id, id);
    return plain(await prisma.priceHistory.findMany({ where: { itemId: id }, orderBy: { changedAt: 'desc' }, take: 100 }));
  });

  // Копирование / перенос позиций между прайс-листами
  app.post('/api/items/copy', async (req) => {
    const { itemIds, toPriceListId, move } = z.object({ itemIds: z.array(z.string()).min(1).max(1000), toPriceListId: z.string(), move: z.boolean().optional() }).parse(req.body);
    await ownList(req.user.id, toPriceListId);
    const items = await prisma.catalogItem.findMany({ where: { id: { in: itemIds }, userId: req.user.id, deletedAt: null } });
    if (move) {
      await prisma.catalogItem.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { priceListId: toPriceListId } });
    } else {
      for (const it of items) {
        const { id, createdAt, priceListId, ...rest } = it as any;
        await prisma.catalogItem.create({ data: { ...rest, params: rest.params ?? undefined, priceListId: toPriceListId } });
      }
    }
    return { ok: true, count: items.length };
  });
}
