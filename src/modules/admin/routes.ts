import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../../database/database';
import { authenticateToken, requireSuperAdmin, requireStateAdmin } from '../../middlewares/auth';
import { validateBody, validateQuery } from '../../middlewares/validation';
import { successResponse, paginatedResponse, errorResponse } from '../../utils/response';

// Helper to build state filter for state admins
function getStateFilter(request: FastifyRequest): { clause: string; param: string | null } {
  const isSuperAdmin = request.user!.role === 'super_admin';
  if (isSuperAdmin) {
    return { clause: '', param: null };
  }
  return { clause: ' AND state_id = $X', param: request.user!.stateId };
}

const paginationSchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).default('20'),
});

const updateUserRoleSchema = z.object({
  role: z.enum(['guest', 'member', 'premium_builder', 'state_admin']),
});

const updateUserStatusSchema = z.object({
  status: z.enum(['pending_verification', 'verified', 'membership_inactive', 'membership_active', 'suspended']),
});

const createCohortSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  capacity: z.number().positive().optional(),
  application_opens_at: z.string().datetime().optional(),
  application_closes_at: z.string().datetime().optional(),
});

export default async function adminRoutes(fastify: FastifyInstance) {
  // GET /api/admin/dashboard - Admin dashboard stats
  fastify.get('/dashboard', { preHandler: [authenticateToken, requireStateAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const isSuperAdmin = request.user!.role === 'super_admin';
      const stateId = request.user!.stateId;
      
      // Build state filter for state admins
      const stateFilter = isSuperAdmin ? '' : "AND u.state_id = $1";
      const stateParam = isSuperAdmin ? [] : [stateId];

      const [
        totalUsers,
        totalMembers,
        pendingProducts,
        pendingApplications,
        totalPosts,
        recentTransactions
      ] = await Promise.all([
        queryOne<{ count: number }>(`SELECT COUNT(*)::int as count FROM users u WHERE 1=1 ${stateFilter}`, stateParam),
        queryOne<{ count: number }>(`SELECT COUNT(*)::int as count FROM users u WHERE role = 'member' ${stateFilter}`, stateParam),
        queryOne<{ count: number }>(`SELECT COUNT(*)::int as count FROM products WHERE status = 'pending_review'`),
        queryOne<{ count: number }>(`SELECT COUNT(*)::int as count FROM program_applications pa JOIN users u ON pa.user_id = u.id WHERE pa.status = 'pending' ${stateFilter.replace('u.', 'u.')}`),
        queryOne<{ count: number }>(`SELECT COUNT(*)::int as count FROM community_posts`),
        query<{ amount: number; status: string }>(`SELECT t.amount, t.status FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.status = 'success' ${stateFilter} ORDER BY t.created_at DESC LIMIT 100`, stateParam)
      ]);

      const totalRevenue = (recentTransactions || []).reduce((sum, t) => sum + (t.amount || 0), 0);

      return reply.send(successResponse({
        users: {
          total: totalUsers?.count || 0,
          members: totalMembers?.count || 0,
        },
        pending: {
          products: pendingProducts?.count || 0,
          applications: pendingApplications?.count || 0,
        },
        content: {
          posts: totalPosts?.count || 0,
        },
        revenue: {
          total: totalRevenue,
          recent_transactions: recentTransactions?.length || 0,
        },
        isStateAdmin: !isSuperAdmin,
        stateId: stateId,
      }));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch dashboard stats', error.message));
    }
  });

  // GET /api/admin/users - List all users (admin view)
  fastify.get('/users', { 
    preHandler: [authenticateToken, requireStateAdmin, validateQuery(paginationSchema)] 
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { page, limit } = request.query as any;
      const isSuperAdmin = request.user!.role === 'super_admin';
      const stateId = request.user!.stateId;

      // Build state filter
      const stateFilter = isSuperAdmin ? '' : 'WHERE u.state_id = $3';
      const countFilter = isSuperAdmin ? '' : 'WHERE state_id = $1';
      const params = isSuperAdmin ? [limit, (page - 1) * limit] : [limit, (page - 1) * limit, stateId];
      const countParams = isSuperAdmin ? [] : [stateId];

      const users = await query(
        `SELECT u.*, s.name as state_name, m.status as membership_status, m.expires_at as membership_expires
         FROM users u
         LEFT JOIN states s ON u.state_id = s.id
         LEFT JOIN memberships m ON u.id = m.user_id AND m.status = 'active'
         ${stateFilter}
         ORDER BY u.created_at DESC
         LIMIT $1 OFFSET $2`,
        params
      );

      const countResult = await queryOne<{ count: number }>(`SELECT COUNT(*)::int as count FROM users ${countFilter}`, countParams);

      return reply.send(paginatedResponse(users || [], countResult?.count || 0, page, limit));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch users', error.message));
    }
  });

  // PUT /api/admin/users/:id/role - Update user role (super admin only)
  fastify.put('/users/:id/role', { 
    preHandler: [authenticateToken, requireSuperAdmin, validateBody(updateUserRoleSchema)] 
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { role } = request.body as z.infer<typeof updateUserRoleSchema>;
      const adminId = request.user!.userId;

      const user = await queryOne(
        'UPDATE users SET role = $1 WHERE id = $2 RETURNING *',
        [role, id]
      );

      if (!user) {
        return reply.status(404).send(errorResponse('User not found'));
      }

      // Log audit
      await query(
        'INSERT INTO admin_audit_logs (admin_user_id, action, entity_type, entity_id, new_values_json) VALUES ($1, $2, $3, $4, $5)',
        [adminId, 'update_user_role', 'user', id, JSON.stringify({ role })]
      );

      return reply.send(successResponse(user, 'User role updated'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to update role', error.message));
    }
  });

  // PUT /api/admin/users/:id/status - Update user status
  fastify.put('/users/:id/status', { 
    preHandler: [authenticateToken, requireStateAdmin, validateBody(updateUserStatusSchema)] 
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { status } = request.body as z.infer<typeof updateUserStatusSchema>;
      const adminId = request.user!.userId;

      const user = await queryOne(
        'UPDATE users SET status = $1 WHERE id = $2 RETURNING *',
        [status, id]
      );

      if (!user) {
        return reply.status(404).send(errorResponse('User not found'));
      }

      // Log audit
      await query(
        'INSERT INTO admin_audit_logs (admin_user_id, action, entity_type, entity_id, new_values_json) VALUES ($1, $2, $3, $4, $5)',
        [adminId, 'update_user_status', 'user', id, JSON.stringify({ status })]
      );

      // Notify user
      await query(
        'INSERT INTO notifications (user_id, type, title, body) VALUES ($1, $2, $3, $4)',
        [id, 'general', 'Account Status Updated', `Your account status has been changed to: ${status}`]
      );

      return reply.send(successResponse(user, 'User status updated'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to update status', error.message));
    }
  });

  // GET /api/admin/applications - List program applications
  fastify.get('/applications', { 
    preHandler: [authenticateToken, requireStateAdmin, validateQuery(paginationSchema)] 
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { page, limit } = request.query as any;
      const isSuperAdmin = request.user!.role === 'super_admin';
      const stateId = request.user!.stateId;

      // Build state filter
      const stateJoin = isSuperAdmin ? '' : 'JOIN users u ON pa.user_id = u.id';
      const stateFilter = isSuperAdmin ? '' : 'AND u.state_id = $3';
      const countJoin = isSuperAdmin ? '' : 'JOIN users u ON pa.user_id = u.id';
      const countFilter = isSuperAdmin ? '' : 'AND u.state_id = $1';
      const params = isSuperAdmin ? [limit, (page - 1) * limit] : [limit, (page - 1) * limit, stateId];
      const countParams = isSuperAdmin ? [] : [stateId];

      const applications = await query(
        `SELECT pa.*, u.full_name as applicant_name, u.email as applicant_email, u.avatar_url as applicant_avatar,
                c.name as cohort_name, c.start_date
         FROM program_applications pa
         JOIN users u ON pa.user_id = u.id
         JOIN cohorts c ON pa.cohort_id = c.id
         WHERE pa.status = 'pending' ${stateFilter}
         ORDER BY pa.created_at ASC
         LIMIT $1 OFFSET $2`,
        params
      );

      const countResult = await queryOne<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM program_applications pa 
         JOIN users u ON pa.user_id = u.id 
         WHERE pa.status = 'pending' ${countFilter}`,
        countParams
      );

      return reply.send(paginatedResponse(applications || [], countResult?.count || 0, page, limit));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch applications', error.message));
    }
  });

  // POST /api/admin/applications/:id/review - Review application
  fastify.post('/applications/:id/review', { preHandler: [authenticateToken, requireStateAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { status, notes } = request.body as { status: 'accepted' | 'rejected' | 'waitlisted', notes?: string };
      const adminId = request.user!.userId;

      const application = await queryOne<{ user_id: string; cohort_id: string }>(
        `UPDATE program_applications 
         SET status = $1, reviewed_by_user_id = $2, reviewed_at = $3, review_notes = $4
         WHERE id = $5
         RETURNING user_id, cohort_id`,
        [status, adminId, new Date().toISOString(), notes || null, id]
      );

      if (!application) {
        return reply.status(404).send(errorResponse('Application not found'));
      }

      // If accepted, create enrollment
      if (status === 'accepted') {
        await query(
          'INSERT INTO program_enrollments (user_id, cohort_id, application_id) VALUES ($1, $2, $3)',
          [application.user_id, application.cohort_id, id]
        );

        // Update user status
        await query(
          "UPDATE users SET status = 'course_enrolled' WHERE id = $1",
          [application.user_id]
        );
      }

      // Notify applicant
      await query(
        'INSERT INTO notifications (user_id, type, title, body, data_json) VALUES ($1, $2, $3, $4, $5)',
        [
          application.user_id,
          status === 'accepted' ? 'course_accepted' : 'general',
          status === 'accepted' ? 'Application Accepted!' : 'Application Update',
          status === 'accepted' ? 'Congratulations! Your application has been accepted.' : `Your application has been ${status}.`,
          JSON.stringify({ application_id: id, status })
        ]
      );

      return reply.send(successResponse(null, `Application ${status}`));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to review application', error.message));
    }
  });

  // POST /api/admin/cohorts - Create new cohort
  fastify.post('/cohorts', { 
    preHandler: [authenticateToken, requireSuperAdmin, validateBody(createCohortSchema)] 
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = request.body as z.infer<typeof createCohortSchema>;

      const cohort = await queryOne(
        `INSERT INTO cohorts (name, description, start_date, end_date, capacity, application_opens_at, application_closes_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
         RETURNING *`,
        [
          data.name,
          data.description || null,
          data.start_date || null,
          data.end_date || null,
          data.capacity || null,
          data.application_opens_at || null,
          data.application_closes_at || null,
        ]
      );

      return reply.status(201).send(successResponse(cohort, 'Cohort created'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to create cohort', error.message));
    }
  });

  // GET /api/admin/audit-logs - View audit logs (super admin only)
  fastify.get('/audit-logs', { 
    preHandler: [authenticateToken, requireSuperAdmin, validateQuery(paginationSchema)] 
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { page, limit } = request.query as any;

      const logs = await query(
        `SELECT aal.*, u.full_name as admin_name
         FROM admin_audit_logs aal
         JOIN users u ON aal.admin_user_id = u.id
         ORDER BY aal.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, (page - 1) * limit]
      );

      const countResult = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM admin_audit_logs');

      return reply.send(paginatedResponse(logs || [], countResult?.count || 0, page, limit));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch audit logs', error.message));
    }
  });

  // GET /api/admin/settings - Get system settings
  fastify.get('/settings', { preHandler: [authenticateToken, requireSuperAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const settings = await query('SELECT * FROM system_settings ORDER BY key');
      return reply.send(successResponse(settings));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch settings', error.message));
    }
  });

  // PUT /api/admin/settings/:key - Update system setting
  fastify.put('/settings/:key', { preHandler: [authenticateToken, requireSuperAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { key } = request.params as { key: string };
      const { value } = request.body as { value: string };
      const adminId = request.user!.userId;

      const setting = await queryOne(
        'UPDATE system_settings SET value = $1, updated_by_user_id = $2, updated_at = $3 WHERE key = $4 RETURNING *',
        [value, adminId, new Date().toISOString(), key]
      );

      if (!setting) {
        return reply.status(404).send(errorResponse('Setting not found'));
      }

      return reply.send(successResponse(setting, 'Setting updated'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to update setting', error.message));
    }
  });
}
