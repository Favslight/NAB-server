import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../../database/database';
import { authenticateToken, optionalAuth, requireMember, requireStateAdmin, requireSuperAdmin } from '../../middlewares/auth';
import { validateQuery, validateBody } from '../../middlewares/validation';
import { successResponse, paginatedResponse, errorResponse } from '../../utils/response';
import { uploadImage, uploadVideo } from '../../utils/cloudinary';

const paginationSchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).default('20'),
  category: z.string().optional(),
});

const createTrainingSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  category: z.string().min(1).max(50),
  access_level: z.enum(['guest', 'member', 'premium_builder']).default('member'),
  duration_minutes: z.number().positive().optional(),
  is_published: z.boolean().default(false),
});

const updateTrainingSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  category: z.string().min(1).max(50).optional(),
  access_level: z.enum(['guest', 'member', 'premium_builder']).optional(),
  duration_minutes: z.number().positive().optional(),
  is_published: z.boolean().optional(),
});

const createLessonSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  order_index: z.number().int().nonnegative().default(0),
  duration_minutes: z.number().positive().optional(),
  is_published: z.boolean().default(false),
});

const updateLessonSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  order_index: z.number().int().nonnegative().optional(),
  duration_minutes: z.number().positive().optional(),
  is_published: z.boolean().optional(),
});

export default async function trainingRoutes(fastify: FastifyInstance) {
  // GET /api/trainings - List all trainings
  fastify.get('/', { preHandler: [optionalAuth, validateQuery(paginationSchema)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { page, limit, category } = request.query as any;
      const user = request.user;

      let sql = 'SELECT * FROM trainings WHERE is_published = true';
      let countSql = 'SELECT COUNT(*)::int as count FROM trainings WHERE is_published = false';
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

  // POST /api/trainings - Create new training (super admin only)
  fastify.post('/', { preHandler: [authenticateToken, requireSuperAdmin, validateBody(createTrainingSchema)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = request.body as z.infer<typeof createTrainingSchema>;
      
      // Generate slug from title
      const slug = data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      
      const training = await queryOne(
        `INSERT INTO trainings (title, slug, description, category, access_level, duration_minutes, is_published)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          data.title,
          slug,
          data.description || null,
          data.category,
          data.access_level,
          data.duration_minutes || null,
          data.is_published,
        ]
      );

      return reply.status(201).send(successResponse(training, 'Training created successfully'));

    } catch (error: any) {
      request.log.error(error);
      if (error.message?.includes('unique constraint')) {
        return reply.status(409).send(errorResponse('A training with this title/slug already exists'));
      }
      return reply.status(500).send(errorResponse('Failed to create training', error.message));
    }
  });

  // PUT /api/trainings/:id - Update training (super admin only)
  fastify.put('/:id', { preHandler: [authenticateToken, requireSuperAdmin, validateBody(updateTrainingSchema)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const data = request.body as z.infer<typeof updateTrainingSchema>;
      
      // Build dynamic update query
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 0;
      
      if (data.title !== undefined) {
        updates.push(`title = $${++paramIndex}`);
        values.push(data.title);
        // Update slug when title changes
        updates.push(`slug = $${++paramIndex}`);
        values.push(data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
      }
      if (data.description !== undefined) {
        updates.push(`description = $${++paramIndex}`);
        values.push(data.description);
      }
      if (data.category !== undefined) {
        updates.push(`category = $${++paramIndex}`);
        values.push(data.category);
      }
      if (data.access_level !== undefined) {
        updates.push(`access_level = $${++paramIndex}`);
        values.push(data.access_level);
      }
      if (data.duration_minutes !== undefined) {
        updates.push(`duration_minutes = $${++paramIndex}`);
        values.push(data.duration_minutes);
      }
      if (data.is_published !== undefined) {
        updates.push(`is_published = $${++paramIndex}`);
        values.push(data.is_published);
      }
      
      if (updates.length === 0) {
        return reply.status(400).send(errorResponse('No fields to update'));
      }
      
      updates.push(`updated_at = $${++paramIndex}`);
      values.push(new Date().toISOString());
      values.push(id);
      
      const training = await queryOne(
        `UPDATE trainings SET ${updates.join(', ')} WHERE id = $${paramIndex + 1} RETURNING *`,
        values
      );

      if (!training) {
        return reply.status(404).send(errorResponse('Training not found'));
      }

      return reply.send(successResponse(training, 'Training updated successfully'));

    } catch (error: any) {
      request.log.error(error);
      if (error.message?.includes('unique constraint')) {
        return reply.status(409).send(errorResponse('A training with this title/slug already exists'));
      }
      return reply.status(500).send(errorResponse('Failed to update training', error.message));
    }
  });

  // DELETE /api/trainings/:id - Delete training (super admin only)
  fastify.delete('/:id', { preHandler: [authenticateToken, requireSuperAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      
      const result = await queryOne(
        'DELETE FROM trainings WHERE id = $1 RETURNING id',
        [id]
      );

      if (!result) {
        return reply.status(404).send(errorResponse('Training not found'));
      }

      return reply.send(successResponse(null, 'Training deleted successfully'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to delete training', error.message));
    }
  });

  // POST /api/trainings/:id/lessons - Create lesson (super admin only)
  fastify.post('/:id/lessons', { preHandler: [authenticateToken, requireSuperAdmin, validateBody(createLessonSchema)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const data = request.body as z.infer<typeof createLessonSchema>;
      
      // Verify training exists
      const training = await queryOne<{ id: string }>('SELECT id FROM trainings WHERE id = $1', [id]);
      if (!training) {
        return reply.status(404).send(errorResponse('Training not found'));
      }
      
      const lesson = await queryOne(
        `INSERT INTO training_lessons (training_id, title, description, order_index, duration_minutes, is_published)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          id,
          data.title,
          data.description || null,
          data.order_index,
          data.duration_minutes || null,
          data.is_published,
        ]
      );

      return reply.status(201).send(successResponse(lesson, 'Lesson created successfully'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to create lesson', error.message));
    }
  });

  // PUT /api/trainings/:id/lessons/:lessonId - Update lesson (super admin only)
  fastify.put('/:id/lessons/:lessonId', { preHandler: [authenticateToken, requireSuperAdmin, validateBody(updateLessonSchema)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id, lessonId } = request.params as { id: string; lessonId: string };
      const data = request.body as z.infer<typeof updateLessonSchema>;
      
      // Build dynamic update query
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 0;
      
      if (data.title !== undefined) {
        updates.push(`title = $${++paramIndex}`);
        values.push(data.title);
      }
      if (data.description !== undefined) {
        updates.push(`description = $${++paramIndex}`);
        values.push(data.description);
      }
      if (data.order_index !== undefined) {
        updates.push(`order_index = $${++paramIndex}`);
        values.push(data.order_index);
      }
      if (data.duration_minutes !== undefined) {
        updates.push(`duration_minutes = $${++paramIndex}`);
        values.push(data.duration_minutes);
      }
      if (data.is_published !== undefined) {
        updates.push(`is_published = $${++paramIndex}`);
        values.push(data.is_published);
      }
      
      if (updates.length === 0) {
        return reply.status(400).send(errorResponse('No fields to update'));
      }
      
      updates.push(`updated_at = $${++paramIndex}`);
      values.push(new Date().toISOString());
      values.push(lessonId);
      values.push(id);
      
      const lesson = await queryOne(
        `UPDATE training_lessons SET ${updates.join(', ')} WHERE id = $${paramIndex + 1} AND training_id = $${paramIndex + 2} RETURNING *`,
        values
      );

      if (!lesson) {
        return reply.status(404).send(errorResponse('Lesson not found'));
      }

      return reply.send(successResponse(lesson, 'Lesson updated successfully'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to update lesson', error.message));
    }
  });

  // DELETE /api/trainings/:id/lessons/:lessonId - Delete lesson (super admin only)
  fastify.delete('/:id/lessons/:lessonId', { preHandler: [authenticateToken, requireSuperAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id, lessonId } = request.params as { id: string; lessonId: string };
      
      const result = await queryOne(
        'DELETE FROM training_lessons WHERE id = $1 AND training_id = $2 RETURNING id',
        [lessonId, id]
      );

      if (!result) {
        return reply.status(404).send(errorResponse('Lesson not found'));
      }

      return reply.send(successResponse(null, 'Lesson deleted successfully'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to delete lesson', error.message));
    }
  });

  // POST /api/trainings/:id/lessons/:lessonId/video - Upload lesson video (admin only)
  fastify.post('/:id/lessons/:lessonId/video', { preHandler: [authenticateToken, requireStateAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id, lessonId } = request.params as { id: string; lessonId: string };

      // Verify lesson exists
      const lesson = await queryOne<{ id: string }>(
        'SELECT id FROM training_lessons WHERE id = $1 AND training_id = $2',
        [lessonId, id]
      );

      if (!lesson) {
        return reply.status(404).send(errorResponse('Lesson not found'));
      }

      // Get file from multipart request
      const file = await request.file();
      if (!file) {
        return reply.status(400).send(errorResponse('No video file provided'));
      }

      if (!file.mimetype.startsWith('video/')) {
        return reply.status(400).send(errorResponse('Only video files are allowed'));
      }

      const buffer = await file.toBuffer();

      // Upload to Cloudinary
      const uploadResult = await uploadVideo(buffer, 'trainings');

      // Update lesson with video URL
      const updatedLesson = await queryOne(
        'UPDATE training_lessons SET video_url = $1, updated_at = $2 WHERE id = $3 RETURNING *',
        [uploadResult.url, new Date().toISOString(), lessonId]
      );

      return reply.status(200).send(successResponse(updatedLesson, 'Video uploaded successfully'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to upload video', error.message));
    }
  });

  // POST /api/trainings/:id/thumbnail - Upload training thumbnail (admin only)
  fastify.post('/:id/thumbnail', { preHandler: [authenticateToken, requireStateAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };

      // Verify training exists
      const training = await queryOne<{ id: string }>('SELECT id FROM trainings WHERE id = $1', [id]);

      if (!training) {
        return reply.status(404).send(errorResponse('Training not found'));
      }

      // Get file from multipart request
      const file = await request.file();
      if (!file) {
        return reply.status(400).send(errorResponse('No image file provided'));
      }

      if (!file.mimetype.startsWith('image/')) {
        return reply.status(400).send(errorResponse('Only image files are allowed'));
      }

      const buffer = await file.toBuffer();

      // Upload to Cloudinary
      const uploadResult = await uploadImage(buffer, 'trainings');

      // Update training with thumbnail URL
      const updatedTraining = await queryOne(
        'UPDATE trainings SET thumbnail_url = $1, updated_at = $2 WHERE id = $3 RETURNING *',
        [uploadResult.url, new Date().toISOString(), id]
      );

      return reply.status(200).send(successResponse(updatedTraining, 'Thumbnail uploaded successfully'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to upload thumbnail', error.message));
    }
  });
}
