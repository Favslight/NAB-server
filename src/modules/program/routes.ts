import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../../database/database';
import { authenticateToken, requireAuth, requireMember } from '../../middlewares/auth';
import { validateBody, validateQuery } from '../../middlewares/validation';
import { successResponse, paginatedResponse, errorResponse } from '../../utils/response';

const applicationSchema = z.object({
  cohort_id: z.string().uuid(),
  experience_level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  motivation: z.string().max(2000).optional(),
  portfolio_url: z.string().url().optional(),
  github_url: z.string().url().optional(),
  resume_url: z.string().url().optional(),
});

const paginationSchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).default('20'),
  status: z.enum(['draft', 'open', 'in_progress', 'closed', 'completed']).optional(),
});

export default async function programRoutes(fastify: FastifyInstance) {
  // GET /api/program/cohorts - List available cohorts
  fastify.get('/cohorts', { preHandler: validateQuery(paginationSchema) }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { page, limit, status } = request.query as any;

      let sql = "SELECT * FROM cohorts WHERE status IN ('open', 'in_progress')";
      let countSql = "SELECT COUNT(*)::int as count FROM cohorts WHERE status IN ('open', 'in_progress')";
      const params: any[] = [];

      if (status) {
        sql = 'SELECT * FROM cohorts WHERE status = $1';
        countSql = 'SELECT COUNT(*)::int as count FROM cohorts WHERE status = $1';
        params.push(status);
      }

      sql += ' ORDER BY application_opens_at ASC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
      params.push(limit, (page - 1) * limit);

      const [cohorts, countResult] = await Promise.all([
        query(sql, params),
        queryOne<{ count: number }>(countSql, params.slice(0, params.length - 2))
      ]);

      return reply.send(paginatedResponse(cohorts || [], countResult?.count || 0, page, limit));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch cohorts', error.message));
    }
  });

  // GET /api/program/cohorts/:id - Get cohort details
  fastify.get('/cohorts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };

      const cohort = await queryOne('SELECT * FROM cohorts WHERE id = $1', [id]);

      if (!cohort) {
        return reply.status(404).send(errorResponse('Cohort not found'));
      }

      // Get enrollment count
      const enrolledCount = await queryOne<{ count: number }>(
        'SELECT COUNT(*)::int as count FROM program_enrollments WHERE cohort_id = $1',
        [id]
      );

      return reply.send(successResponse({
        ...cohort,
        enrolled_count: enrolledCount?.count || 0,
      }));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to get cohort', error.message));
    }
  });

  // POST /api/program/apply - Apply to a cohort
  fastify.post('/apply', { 
    preHandler: [authenticateToken, requireMember, validateBody(applicationSchema)] 
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = request.body as z.infer<typeof applicationSchema>;
      const userId = request.user!.userId;

      // Check cohort exists and is accepting applications
      const cohort = await queryOne<{ status: string; application_closes_at: string; capacity: number }>(
        'SELECT status, application_closes_at, capacity FROM cohorts WHERE id = $1',
        [data.cohort_id]
      );

      if (!cohort) {
        return reply.status(404).send(errorResponse('Cohort not found'));
      }

      if (cohort.status !== 'open') {
        return reply.status(400).send(errorResponse('This cohort is not accepting applications'));
      }

      if (cohort.application_closes_at && new Date(cohort.application_closes_at) < new Date()) {
        return reply.status(400).send(errorResponse('Applications are closed for this cohort'));
      }

      // Check if user already applied
      const existingApplication = await queryOne(
        'SELECT id, status FROM program_applications WHERE user_id = $1 AND cohort_id = $2',
        [userId, data.cohort_id]
      );

      if (existingApplication) {
        return reply.status(409).send(errorResponse('You have already applied to this cohort'));
      }

      // Check if user already enrolled
      const existingEnrollment = await queryOne(
        'SELECT id FROM program_enrollments WHERE user_id = $1 AND cohort_id = $2',
        [userId, data.cohort_id]
      );

      if (existingEnrollment) {
        return reply.status(409).send(errorResponse('You are already enrolled in this cohort'));
      }

      // Create application
      const application = await queryOne(
        `INSERT INTO program_applications (user_id, cohort_id, experience_level, motivation, portfolio_url, github_url, resume_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
         RETURNING *`,
        [
          userId,
          data.cohort_id,
          data.experience_level || null,
          data.motivation || null,
          data.portfolio_url || null,
          data.github_url || null,
          data.resume_url || null,
        ]
      );

      // Update user status
      await query("UPDATE users SET status = 'course_applicant' WHERE id = $1", [userId]);

      // Create notification
      await query(
        'INSERT INTO notifications (user_id, type, title, body, data_json) VALUES ($1, $2, $3, $4, $5)',
        [userId, 'course_application', 'Application Submitted', 'Your application has been submitted and is under review.', JSON.stringify({ application_id: application?.id })]
      );

      return reply.status(201).send(successResponse(application, 'Application submitted successfully'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to submit application', error.message));
    }
  });

  // GET /api/program/applications/me - Get user's applications
  fastify.get('/applications/me', { preHandler: [authenticateToken, requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;

      const applications = await query(
        `SELECT pa.*, c.name as cohort_name, c.start_date, c.end_date
         FROM program_applications pa
         JOIN cohorts c ON pa.cohort_id = c.id
         WHERE pa.user_id = $1
         ORDER BY pa.created_at DESC`,
        [userId]
      );

      return reply.send(successResponse(applications));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch applications', error.message));
    }
  });

  // GET /api/program/enrollments/me - Get user's enrollments
  fastify.get('/enrollments/me', { preHandler: [authenticateToken, requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;

      const enrollments = await query(
        `SELECT pe.*, c.name as cohort_name, c.start_date, c.end_date
         FROM program_enrollments pe
         JOIN cohorts c ON pe.cohort_id = c.id
         WHERE pe.user_id = $1
         ORDER BY pe.enrolled_at DESC`,
        [userId]
      );

      return reply.send(successResponse(enrollments));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch enrollments', error.message));
    }
  });
}
