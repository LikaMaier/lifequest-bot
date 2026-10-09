import type { FastifyInstance } from 'fastify';
import { env } from '../env';
import { HttpError } from '../util';

/**
 * Интеграционный слой ИИ-сметчика (этап 4).
 * Сервер реально проверяет переключатель aiEnabled: при выключенном ИИ запросы не отправляются.
 * Пока провайдер не подключён (AI_PROVIDER пуст), эндпоинт честно возвращает 503 — без имитации ответа.
 */
export function assertAiAllowed(user: { aiEnabled: boolean }) {
  if (!user.aiEnabled) throw new HttpError(403, 'ИИ-помощник выключен в настройках', 'ai_disabled');
  if (!env.AI_PROVIDER) throw new HttpError(503, 'ИИ-сметчик ещё не подключён. Сметы, калькуляторы и финансы работают вручную.', 'ai_not_configured');
}

export async function aiRoutes(app: FastifyInstance) {
  app.post('/api/ai/message', async (req) => {
    assertAiAllowed(req.user);
    throw new HttpError(503, 'ИИ-сметчик ещё не подключён', 'ai_not_configured');
  });
}
