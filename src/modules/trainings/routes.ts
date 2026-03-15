import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../../database/database';
import { authenticateToken, optionalAuth, requireMember } from '../../middlewares/auth';
import { validateQuery } from '../../middlewares/validation';
import { successResponse, paginatedResponse, errorResponse } from '../../utils/response';

const paginationSchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).default('20'),
  category: z.string().optional(),
});

export default async function trainingRoutes(fastify: FastifyInstance) {
  // GET /api/trainings - List all trainings
  fastify.get('/', { preHandler: [optionalAuth, validateQuery(paginationSchema)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { page, limit, category } = request.query as any;
      const user = request.user;

      let sql = 'SELECT * FROM trainings WHERE is_published = true';
      let countSql = 'SELECT COUNT(*)::int as count FROM trainings WHERE is_published = true';
      const params: any[] = [];
      let paramIndex = 0;

      // Apply visibility filters based on user role
      if (!user || user.role === 'guest') {
        sql += " AND access_level = 'guest'";
        countSql += " AND access_level = 'guest'";
      } else if (user.role === 'member') {
        sql += " AND access_level IN ('guest', 'member')";
        countSql += " AND access_level IN ('guest', 'member')";
      }

      if (category) {
        paramIndex++;
        sql += ` AND category = $${paramIndex}`;
        countSql += ` AND category = $${paramIndex}`;
        params.push(category);
      }

      sql += ` ORDER BY created_at DESC LIMIT $${++paramIndex} OFFSET $${++paramIndex}`;
      params.push(limit, (page - 1) * limit);

      const [trainings, countResult] = await Promise.all([
        query(sql, params),
        queryOne<{ count: number }>(countSql, params.slice(0, params.length - 2))
      ]);

      // If user is logged in, get progress for each training
      let trainingsWithProgress = trainings || [];
      if (user) {
        const progress = await query(
          'SELECT training_id, progress_percent, completed_at FROM training_progress WHERE user_id = $1',
          [user.userId]
        );
        const progressMap = new Map((progress || []).map((p: any) => [p.training_id, p]));
        trainingsWithProgress = (trainings || []).map((t: any) => ({
          ...t,
          progress: progressMap.get(t.id) || null,
        }));
      }

      return reply.send(paginatedResponse(trainingsWithProgress, countResult?.count || 0, page, limit));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch trainings', error.message));
    }
  });

  // GET /api/trainings/:id - Get training details with lessons
  fastify.get('/:id', { preHandler: optionalAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const user = request.user;

      const training = await queryOne(
        'SELECT * FROM trainings WHERE id = $1 AND is_published = true',
        [id]
      );

      if (!training) {
        return reply.status(404).send(errorResponse('Training not found'));
      }

      // Check access permissions
      const accessLevels: Record<string, number> = { guest: 1, member: 2, premium_builder: 3, state_admin: 3, super_admin: 3 };
      const userLevel = user ? accessLevels[user.role] || 0 : 0;
      const requiredLevel = accessLevels[training.access_level] || 3;

      if (userLevel < requiredLevel) {
        return reply.status(403).send(errorResponse('You need a higher membership tier to access this training'));
      }

      // Get lessons
      const lessons = await query(
        'SELECT * FROM training_lessons WHERE training_id = $1 AND is_published = true ORDER BY order_index ASC',
        [id]
      );

      // Get user's progress if logged in
      let progress = null;
      if (user) {
        progress = await queryOne(
          'SELECT * FROM training_progress WHERE user_id = $1 AND training_id = $2',
          [user.userId, id]
        );
      }

      return reply.send(successResponse({
        ...training,
        lessons: lessons || [],
        progress,
      }));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to get training', error.message));
    }
  });

  // POST /api/trainings/:id/progress - Update progress
  fastify.post('/:id/progress', { preHandler: [authenticateToken, requireMember] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { lesson_id, progress_percent, completed } = request.body as any;
      const userId = request.user!.userId;

      // Check training exists and user has access
      const training = await queryOne<{ access_level: string }>(
        'SELECT access_level FROM trainings WHERE id = $1',
        [id]
      );

      if (!training) {
        return reply.status(404).send(errorResponse('Training not found'));
      }

      const accessLevels: Record<string, number> = { guest: 1, member: 2, premium_builder: 3, state_admin: 3, super_admin: 3 };
      const userLevel = accessLevels[request.user!.role] || 0;
      const requiredLevel = accessLevels[training.access_level] || 3;

      if (userLevel < requiredLevel) {
        return reply.status(403).send(errorResponse('Insufficient permissions'));
      }

      const now = new Date().toISOString();

      // Upsert progress
      const progress = await queryOne(
        `INSERT INTO training_progress (user_id, training_id, lesson_id, progress_percent, completed_at, last_accessed_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, training_id, lesson_id) DO UPDATE SET
           progress_percent = $4,
           completed_at = COALESCE(training_progress.completed_at, $5),
           last_accessed_at = $6
         RETURNING *`,
        [userId, id, lesson_id || null, progress_percent || 0, completed ? now : null, now]
      );

      return reply.send(successResponse(progress, 'Progress updated'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to update progress', error.message));
    }
  });

  // GET /api/trainings/categories - Get all categories
  fastify.get('/categories', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const categories = await query(
        "SELECT DISTINCT category FROM trainings WHERE is_published = true AND category IS NOT NULL"
      );

      return reply.send(successResponse((categories || []).map((c: any) => c.category)));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch categories', error.message));
    }
  });
}
