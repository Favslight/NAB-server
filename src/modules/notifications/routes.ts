import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../../database/database';
import { authenticateToken, requireAuth } from '../../middlewares/auth';
import { validateQuery } from '../../middlewares/validation';
import { successResponse, paginatedResponse, errorResponse } from '../../utils/response';

const paginationSchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).default('20'),
  unread_only: z.string().transform((v: string) => v === 'true').default('false'),
});

export default async function notificationRoutes(fastify: FastifyInstance) {
  // GET /api/notifications - Get user's notifications
  fastify.get('/', { preHandler: [authenticateToken, requireAuth, validateQuery(paginationSchema)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { page, limit, unread_only } = request.query as any;
      const userId = request.user!.userId;

      let sql = 'SELECT * FROM notifications WHERE user_id = $1';
      let countSql = 'SELECT COUNT(*)::int as count FROM notifications WHERE user_id = $1';
      const params: any[] = [userId];

      if (unread_only) {
        sql += ' AND is_read = false';
        countSql += ' AND is_read = false';
      }

      sql += ' ORDER BY created_at DESC LIMIT $2 OFFSET $3';
      params.push(limit, (page - 1) * limit);

      const [notifications, countResult] = await Promise.all([
        query(sql, params),
        queryOne<{ count: number }>(countSql, [userId])
      ]);

      return reply.send(paginatedResponse(notifications || [], countResult?.count || 0, page, limit));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch notifications', error.message));
    }
  });

  // GET /api/notifications/unread-count - Get unread count
  fastify.get('/unread-count', { preHandler: [authenticateToken, requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;

      const result = await queryOne<{ count: number }>(
        'SELECT COUNT(*)::int as count FROM notifications WHERE user_id = $1 AND is_read = false',
        [userId]
      );

      return reply.send(successResponse({ count: result?.count || 0 }));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to count notifications', error.message));
    }
  });

  // POST /api/notifications/:id/read - Mark notification as read
  fastify.post('/:id/read', { preHandler: [authenticateToken, requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const userId = request.user!.userId;

      await query(
        'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      return reply.send(successResponse(null, 'Notification marked as read'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to mark as read', error.message));
    }
  });

  // POST /api/notifications/read-all - Mark all notifications as read
  fastify.post('/read-all', { preHandler: [authenticateToken, requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;

      await query(
        'UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false',
        [userId]
      );

      return reply.send(successResponse(null, 'All notifications marked as read'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to mark all as read', error.message));
    }
  });

  // DELETE /api/notifications/:id - Delete notification
  fastify.delete('/:id', { preHandler: [authenticateToken, requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const userId = request.user!.userId;

      await query(
        'DELETE FROM notifications WHERE id = $1 AND user_id = $2',
        [id, userId]
      );

      return reply.send(successResponse(null, 'Notification deleted'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to delete notification', error.message));
    }
  });
}
