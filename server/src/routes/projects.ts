import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma, plain, notFound, audit, num, HttpError } from '../util';
import { calcProjectFinance } from '../../../shared/finance';
import { estimateTotals } from './estimates';

const STATUSES = ['draft', 'estimated', 'negotiation', 'in_progress', 'paused', 'done', 'archived'] as const;
const nonneg = z.coerce.number().min(0, 'не может быть отрицательным');

const projectSchema = z.object({
  name: z.string().trim().min(1, 'введите название').max(200),
  customer: z.string().max(200).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  status: z.enum(STATUSES).optional(),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  contractAmount: nonneg.max(1e11).optional(),
  completionPct: z.coerce.number().min(0).max(100).optional(),
  budget: z.record(z.string(), nonneg).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

const opSchema = z.object({
  kind: z.enum(['income', 'expense']),
  incomeType: z.enum(['advance', 'interim', 'final', 'extra_work', 'contract_change']).nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
  title: z.string().trim().min(1, 'введите название').max(300),
  qty: z.coerce.number().min(0).nullable().optional(),
  unit: z.string().max(30).nullable().optional(),
  unitPrice: z.coerce.number().min(0).nullable().optional(),
  amount: z.coerce.number().max(1e11).refine((v) => Number.isFinite(v), 'введите сумму'),
  paidAmount: nonneg.max(1e11).optional(),
  counterparty: z.string().max(200).nullable().optional(),
  date: z.coerce.date().optional(),
  note: z.string().max(2000).nullable().optional(),
}).superRefine((v, ctx) => {
  if (v.kind === 'income' && !v.incomeType) ctx.addIssue({ code: 'custom', path: ['incomeType'], message: 'выберите тип поступления' });
  if (v.kind === 'expense' && !v.category) ctx.addIssue({ code: 'custom', path: ['category'], message: 'выберите категорию расхода' });
  // Отрицательная сумма допустима только для изменения стоимости договора (уменьшение)
  if (v.amount < 0 && !(v.kind === 'income' && v.incomeType === 'contract_change'))
    ctx.addIssue({ code: 'custom', path: ['amount'], message: 'сумма не может быть отрицательной' });
  if (v.kind === 'expense' && v.paidAmount != null && v.paidAmount > v.amount)
    ctx.addIssue({ code: 'custom', path: ['paidAmount'], message: 'оплачено больше начисленного' });
});

/** Плановый бюджет: вручную заданный или из себестоимости связанных смет */
function plannedBudget(p: any): { budget: Record<string, number>; source: 'manual' | 'estimates' } {
  if (p.budget && Object.keys(p.budget).length) return { budget: p.budget, source: 'manual' };
  const b: Record<string, number> = {};
  for (const e of p.estimates || []) {
    const t = estimateTotals(e);
    for (const [g, v] of Object.entries(t.costByGroup)) b[g] = Math.round(((b[g] || 0) + v) * 100) / 100;
  }
  return { budget: b, source: 'estimates' };
}

export function projectFinance(p: any) {
  const { budget, source } = plannedBudget(p);
  const fin = calcProjectFinance({
    contractAmount: num(p.contractAmount), completionPct: num(p.completionPct), plannedBudget: budget,
    ops: (p.financeOps || []).map((o: any) => ({ kind: o.kind, incomeType: o.incomeType, category: o.category, amount: num(o.amount), paidAmount: num(o.paidAmount) })),
  });
  return { ...fin, budgetSource: source };
}

const projectInclude = (userId: string) => ({
  estimates: { where: { deletedAt: null, userId }, include: { lines: true } },
  financeOps: { where: { deletedAt: null, userId } },
});

async function loadProject(userId: string, id: string) {
  const p = await prisma.project.findFirst({ where: { id, userId, deletedAt: null }, include: projectInclude(userId) });
  if (!p) throw notFound('Объект');
  return p;
}

function closingChecklist(p: any, fin: ReturnType<typeof projectFinance>) {
  const ops = p.financeOps || [];
  const has = (cat: string) => ops.some((o: any) => o.kind === 'expense' && o.category === cat);
  return [
    { key: 'income', label: 'Все доходы внесены', ok: ops.some((o: any) => o.kind === 'income'), hint: 'Нет ни одного поступления' },
    { key: 'expenses', label: 'Все расходы внесены', ok: ops.some((o: any) => o.kind === 'expense'), hint: 'Нет ни одного расхода' },
    { key: 'materials', label: 'Материалы учтены', ok: has('materials'), hint: 'Нет расходов на материалы' },
    { key: 'equipment', label: 'Техника учтена', ok: has('equipment'), hint: 'Нет расходов на технику (если не было — отметьте вручную)' },
    { key: 'labor', label: 'Расчёты с рабочими проверены', ok: has('labor') && !ops.some((o: any) => o.kind === 'expense' && o.category === 'labor' && num(o.paidAmount) < num(o.amount)), hint: 'Есть невыплаченные суммы рабочим или нет записей' },
    { key: 'unpaid', label: 'Неоплаченные счета проверены', ok: fin.unpaidObligations <= 0, hint: `Не оплачено: ${fin.unpaidObligations} ₽` },
    { key: 'debt', label: 'Долг заказчика проверен', ok: fin.customerDebt <= 0, hint: `Долг заказчика: ${fin.customerDebt} ₽` },
  ];
}

const view = (p: any) => {
  const fin = projectFinance(p);
  const { financeOps, estimates, ...rest } = plain(p);
  return {
    ...rest, finance: fin,
    estimates: (p.estimates || []).map((e: any) => ({ id: e.id, title: e.title, status: e.status, total: estimateTotals(e).total })),
    checklist: closingChecklist(p, fin),
  };
};

export async function projectRoutes(app: FastifyInstance) {
  app.get('/api/projects', async (req) => {
    const q = z.object({ status: z.string().optional(), q: z.string().optional() }).parse(req.query);
    const list = await prisma.project.findMany({
      where: {
        userId: req.user.id, deletedAt: null,
        ...(q.status ? { status: q.status } : {}),
        ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' as const } }, { customer: { contains: q.q, mode: 'insensitive' as const } }] } : {}),
      },
      include: projectInclude(req.user.id), orderBy: { updatedAt: 'desc' }, take: 300,
    });
    return list.map((p) => {
      const f = projectFinance(p);
      const { financeOps, estimates, ...rest } = plain(p);
      return { ...rest, finance: { contractTotal: f.contractTotal, plannedProfit: f.plannedProfit, currentProfit: f.currentProfit, forecastProfit: f.forecastProfit, customerDebt: f.customerDebt, received: f.received, expensesAccrued: f.expensesAccrued } };
    });
  });

  app.post('/api/projects', async (req) => {
    const body = projectSchema.extend({ estimateId: z.string().optional() }).parse(req.body);
    const { estimateId, ...data } = body;
    const p = await prisma.project.create({ data: { ...data, budget: data.budget ?? undefined, userId: req.user.id } });
    if (estimateId) await linkEstimate(req.user.id, p.id, estimateId);
    await audit(req.user.id, 'project', p.id, 'create');
    return view(await loadProject(req.user.id, p.id));
  });

  app.get('/api/projects/:id', async (req) => view(await loadProject(req.user.id, (req.params as any).id)));

  app.patch('/api/projects/:id', async (req) => {
    const { id } = req.params as any;
    const prev = await loadProject(req.user.id, id);
    const body = projectSchema.partial().parse(req.body);
    await prisma.project.update({ where: { id }, data: { ...body, budget: body.budget === null ? Prisma.DbNull : body.budget ?? undefined } });
    const changes: any = {};
    for (const k of Object.keys(body)) changes[k] = { from: plain((prev as any)[k]), to: (body as any)[k] };
    await audit(req.user.id, 'project', id, 'update', changes);
    return view(await loadProject(req.user.id, id));
  });

  app.delete('/api/projects/:id', async (req) => {
    const { id } = req.params as any;
    await loadProject(req.user.id, id);
    await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(req.user.id, 'project', id, 'delete');
    return { ok: true };
  });

  async function linkEstimate(userId: string, projectId: string, estimateId: string) {
    const e = await prisma.estimate.findFirst({ where: { id: estimateId, userId, deletedAt: null, isTemplate: false }, include: { lines: true } });
    if (!e) throw notFound('Смета');
    const p = await prisma.project.findFirst({ where: { id: projectId, userId } });
    if (!p) throw notFound('Объект');
    await prisma.estimate.update({ where: { id: estimateId }, data: { projectId } });
    if (num(p.contractAmount) === 0) {
      await prisma.project.update({ where: { id: projectId }, data: { contractAmount: estimateTotals(e).total, status: p.status === 'draft' ? 'estimated' : p.status } });
    }
  }

  app.post('/api/projects/:id/link-estimate', async (req) => {
    const { id } = req.params as any;
    const { estimateId, unlink } = z.object({ estimateId: z.string(), unlink: z.boolean().optional() }).parse(req.body);
    if (unlink) {
      const e = await prisma.estimate.findFirst({ where: { id: estimateId, userId: req.user.id, projectId: id } });
      if (!e) throw notFound('Смета');
      await prisma.estimate.update({ where: { id: estimateId }, data: { projectId: null } });
    } else {
      await linkEstimate(req.user.id, id, estimateId);
    }
    await audit(req.user.id, 'project', id, unlink ? 'unlink_estimate' : 'link_estimate', { estimateId });
    return view(await loadProject(req.user.id, id));
  });

  app.post('/api/projects/:id/close', async (req) => {
    const { id } = req.params as any;
    const p = await loadProject(req.user.id, id);
    const { confirm } = z.object({ confirm: z.boolean().optional() }).parse(req.body || {});
    const v = view(p);
    if (!confirm) return { needConfirm: true, checklist: v.checklist };
    await prisma.project.update({ where: { id }, data: { status: 'done', closedAt: new Date() } });
    await audit(req.user.id, 'project', id, 'close', { checklist: v.checklist.map((c: any) => ({ key: c.key, ok: c.ok })) });
    return view(await loadProject(req.user.id, id));
  });

  app.post('/api/projects/:id/reopen', async (req) => {
    const { id } = req.params as any;
    await loadProject(req.user.id, id);
    await prisma.project.update({ where: { id }, data: { status: 'in_progress', closedAt: null } });
    await audit(req.user.id, 'project', id, 'reopen');
    return view(await loadProject(req.user.id, id));
  });

  app.get('/api/projects/:id/history', async (req) => {
    const { id } = req.params as any;
    await loadProject(req.user.id, id);
    return plain(await prisma.auditLog.findMany({ where: { userId: req.user.id, OR: [{ entity: 'project', entityId: id }, { entity: 'finance', data: { path: ['projectId'], equals: id } }] }, orderBy: { createdAt: 'desc' }, take: 200 }));
  });

  // ---- Финансовые операции ----
  app.get('/api/projects/:id/ops', async (req) => {
    const { id } = req.params as any;
    await loadProject(req.user.id, id);
    const q = z.object({ kind: z.string().optional(), category: z.string().optional(), paid: z.enum(['paid', 'unpaid']).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }).parse(req.query);
    let ops = await prisma.financeOp.findMany({
      where: {
        userId: req.user.id, projectId: id, deletedAt: null,
        ...(q.kind ? { kind: q.kind } : {}), ...(q.category ? { category: q.category } : {}),
        ...(q.from || q.to ? { date: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
      },
      orderBy: { date: 'desc' },
    });
    if (q.paid) ops = ops.filter((o) => (o.kind !== 'expense') || (q.paid === 'paid' ? num(o.paidAmount) >= num(o.amount) : num(o.paidAmount) < num(o.amount)));
    return plain(ops);
  });

  app.post('/api/projects/:id/ops', async (req) => {
    const { id } = req.params as any;
    await loadProject(req.user.id, id);
    const body = opSchema.parse(req.body);
    const op = await prisma.financeOp.create({ data: { ...body, paidAmount: body.kind === 'expense' ? body.paidAmount ?? 0 : 0, userId: req.user.id, projectId: id } });
    await audit(req.user.id, 'finance', op.id, 'create', { projectId: id, kind: op.kind, amount: num(op.amount), title: op.title });
    return plain(op);
  });

  app.patch('/api/ops/:id', async (req) => {
    const { id } = req.params as any;
    const prev = await prisma.financeOp.findFirst({ where: { id, userId: req.user.id, deletedAt: null } });
    if (!prev) throw notFound('Операция');
    const merged = { ...plain(prev), ...(req.body as any) };
    const body = opSchema.parse(merged);
    const op = await prisma.financeOp.update({ where: { id }, data: { ...body, paidAmount: body.kind === 'expense' ? body.paidAmount ?? 0 : 0 } });
    await audit(req.user.id, 'finance', id, 'update', { projectId: prev.projectId, before: { amount: num(prev.amount), paid: num(prev.paidAmount) }, after: { amount: num(op.amount), paid: num(op.paidAmount) } });
    return plain(op);
  });

  app.delete('/api/ops/:id', async (req) => {
    const { id } = req.params as any;
    const prev = await prisma.financeOp.findFirst({ where: { id, userId: req.user.id, deletedAt: null } });
    if (!prev) throw notFound('Операция');
    await prisma.financeOp.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(req.user.id, 'finance', id, 'delete', { projectId: prev.projectId, amount: num(prev.amount), title: prev.title });
    return { ok: true };
  });

  // Сводка по всем объектам
  app.get('/api/finance/summary', async (req) => {
    const q = z.object({ status: z.string().optional() }).parse(req.query);
    const list = await prisma.project.findMany({
      where: { userId: req.user.id, deletedAt: null, ...(q.status ? { status: q.status } : { status: { not: 'archived' } }) },
      include: projectInclude(req.user.id),
    });
    const rows = list.map((p) => ({ id: p.id, name: p.name, status: p.status, ...projectFinance(p) }));
    const sum = (k: string) => Math.round(rows.reduce((a, r: any) => a + (r[k] || 0), 0) * 100) / 100;
    return {
      projects: rows.map(({ planFact, ...r }) => r),
      totals: {
        contractTotal: sum('contractTotal'), received: sum('received'), customerDebt: sum('customerDebt'),
        expensesAccrued: sum('expensesAccrued'), expensesPaid: sum('expensesPaid'), unpaidObligations: sum('unpaidObligations'),
        plannedProfit: sum('plannedProfit'), currentProfit: sum('currentProfit'), forecastProfit: sum('forecastProfit'), cashBalance: sum('cashBalance'),
      },
      activeCount: list.filter((p) => ['in_progress', 'negotiation', 'estimated', 'paused'].includes(p.status)).length,
    };
  });
}

export { HttpError };
