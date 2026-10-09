import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, plain, notFound } from '../util';

const noteSchema = z.object({
  title: z.string().trim().min(1, 'введите заголовок').max(200),
  body: z.string().max(20000).optional(),
  projectId: z.string().nullable().optional(),
});

export async function noteRoutes(app: FastifyInstance) {
  const own = async (userId: string, id: string) => {
    const n = await prisma.note.findFirst({ where: { id, userId, deletedAt: null } });
    if (!n) throw notFound('Заметка');
    return n;
  };
  const checkProject = async (userId: string, projectId?: string | null) => {
    if (projectId && !(await prisma.project.findFirst({ where: { id: projectId, userId, deletedAt: null } }))) throw notFound('Объект');
  };

  app.get('/api/notes', async (req) => {
    const q = z.object({ q: z.string().optional(), projectId: z.string().optional() }).parse(req.query);
    return plain(await prisma.note.findMany({
      where: {
        userId: req.user.id, deletedAt: null,
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' as const } }, { body: { contains: q.q, mode: 'insensitive' as const } }] } : {}),
      },
      include: { project: { select: { id: true, name: true } } },
      orderBy: { updatedAt: 'desc' }, take: 500,
    }));
  });

  app.post('/api/notes', async (req) => {
    const body = noteSchema.parse(req.body);
    await checkProject(req.user.id, body.projectId);
    return plain(await prisma.note.create({ data: { ...body, userId: req.user.id } }));
  });

  app.patch('/api/notes/:id', async (req) => {
    const { id } = req.params as any;
    await own(req.user.id, id);
    const body = noteSchema.partial().parse(req.body);
    await checkProject(req.user.id, body.projectId);
    return plain(await prisma.note.update({ where: { id }, data: body }));
  });

  app.delete('/api/notes/:id', async (req) => {
    const { id } = req.params as any;
    await own(req.user.id, id);
    await prisma.note.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  });
}
