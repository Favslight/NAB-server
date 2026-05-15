import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../../database/database';
import { User } from '../../database/types';
import { authenticateToken, requireSuperAdmin, requireStateAdmin } from '../../middlewares/auth';
import { validateBody, validateQuery } from '../../middlewares/validation';
import { successResponse, paginatedResponse, errorResponse } from '../../utils/response';
import { sendEmail } from '../../utils/email';

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
  status: z.enum(['pending_verification', 'verified', 'membership_inactive', 'membership_active', 'suspended', 'pending_admin_approval']),
});

const reviewUserSchema = z.object({
  action: z.enum(['approve', 'reject']),
  notes: z.string().optional(),
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

const paymentReviewSchema = z.object({
  action: z.enum(['approve', 'reject']),
  notes: z.string().optional(),
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
        pendingUsers,
        totalPosts,
        recentTransactions
      ] = await Promise.all([
        queryOne<{ count: number }>(`SELECT COUNT(*)::int as count FROM users u WHERE 1=1 ${stateFilter}`, stateParam),
        queryOne<{ count: number }>(`SELECT COUNT(*)::int as count FROM users u WHERE role = 'member' ${stateFilter}`, stateParam),
        queryOne<{ count: number }>(`SELECT COUNT(*)::int as count FROM products WHERE status = 'pending_review'`),
        queryOne<{ count: number }>(`SELECT COUNT(*)::int as count FROM program_applications pa JOIN users u ON pa.user_id = u.id WHERE pa.status = 'pending' ${stateFilter.replace('u.', 'u.')}`),
        queryOne<{ count: number }>(`SELECT COUNT(*)::int as count FROM users u WHERE status = 'pending_admin_approval' ${stateFilter}`, stateParam),
        queryOne<{ count: number }>(`SELECT COUNT(*)::int as count FROM community_posts`),
        query<{ amount: number; status: string }>(`SELECT t.amount, t.status FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.status = 'success' ${stateFilter} ORDER BY t.created_at DESC LIMIT 100`, stateParam)
      ]);

      const totalRevenue = (recentTransactions || []).reduce((sum, t) => sum + (t.amount || 0), 0);

      return reply.send(successResponse({
        users: {
          total: totalUsers?.count || 0,
          members: totalMembers?.count || 0,
          pending_approval: pendingUsers?.count || 0,
        },
        pending: {
          products: pendingProducts?.count || 0,
          applications: pendingApplications?.count || 0,
          users: pendingUsers?.count || 0,
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

  // GET /api/admin/pending-users - List users pending admin approval
  fastify.get('/pending-users', { 
    preHandler: [authenticateToken, requireStateAdmin, validateQuery(paginationSchema)] 
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { page, limit } = request.query as any;
      const isSuperAdmin = request.user!.role === 'super_admin';
      const stateId = request.user!.stateId;

      // Build state filter
      const stateFilter = isSuperAdmin ? '' : 'AND u.state_id = $3';
      const countFilter = isSuperAdmin ? '' : 'AND state_id = $1';
      const params = isSuperAdmin ? [limit, (page - 1) * limit] : [limit, (page - 1) * limit, stateId];
      const countParams = isSuperAdmin ? [] : [stateId];

      const users = await query(
        `SELECT u.*, s.name as state_name
         FROM users u
         LEFT JOIN states s ON u.state_id = s.id
         WHERE u.status = 'pending_admin_approval' ${stateFilter}
         ORDER BY u.created_at ASC
         LIMIT $1 OFFSET $2`,
        params
      );

      const countResult = await queryOne<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM users WHERE status = 'pending_admin_approval' ${countFilter}`,
        countParams
      );

      return reply.send(paginatedResponse(users || [], countResult?.count || 0, page, limit));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch pending users', error.message));
    }
  });

  // POST /api/admin/pending-users/:id/review - Approve or reject a pending user
  fastify.post('/pending-users/:id/review', { 
    preHandler: [authenticateToken, requireStateAdmin, validateBody(reviewUserSchema)] 
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { action, notes } = request.body as z.infer<typeof reviewUserSchema>;
      const adminId = request.user!.userId;
      const isSuperAdmin = request.user!.role === 'super_admin';
      const stateId = request.user!.stateId;

      // Get user and verify state access
      const userQuery = isSuperAdmin 
        ? 'SELECT * FROM users WHERE id = $1 AND status = $2'
        : 'SELECT * FROM users WHERE id = $1 AND status = $2 AND state_id = $3';
      const userParams = isSuperAdmin ? [id, 'pending_admin_approval'] : [id, 'pending_admin_approval', stateId];

      const user = await queryOne<User>(userQuery, userParams);

      if (!user) {
        return reply.status(404).send(errorResponse('Pending user not found or you do not have access'));
      }

      if (action === 'approve') {
        // Approve user: set status to pending_verification and create membership if free
        const feeEnabled = await queryOne<{ value: string }>("SELECT value FROM system_settings WHERE key = 'enable_membership_fee'");
        const isFeeEnabled = feeEnabled?.value === 'true';

        const newStatus = 'pending_verification';
        const newRole = isFeeEnabled ? 'guest' : 'member';

        await queryOne(
          'UPDATE users SET status = $1, role = $2 WHERE id = $3 RETURNING *',
          [newStatus, newRole, id]
        );

        // Create membership record if free
        if (!isFeeEnabled) {
          await query(
            `INSERT INTO memberships (user_id, plan_type, amount_paid, status, starts_at, expires_at)
             VALUES ($1, 'standard_member', 0, 'active', $2, $3)`,
            [id, new Date().toISOString(), new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()]
          );
        }

        // Log audit
        await query(
          'INSERT INTO admin_audit_logs (admin_user_id, action, entity_type, entity_id, new_values_json) VALUES ($1, $2, $3, $4, $5)',
          [adminId, 'approve_user', 'user', id, JSON.stringify({ status: newStatus, role: newRole, notes })]
        );

        // Notify user
        await query(
          'INSERT INTO notifications (user_id, type, title, body) VALUES ($1, $2, $3, $4)',
          [id, 'general', 'Account Approved!', 'Your account has been approved by an admin. You can now log in.']
        );

        return reply.send(successResponse(null, 'User approved successfully'));

      } else {
        // Reject user: delete the user account
        await query('DELETE FROM users WHERE id = $1', [id]);

        // Log audit
        await query(
          'INSERT INTO admin_audit_logs (admin_user_id, action, entity_type, entity_id, old_values_json) VALUES ($1, $2, $3, $4, $5)',
          [adminId, 'reject_user', 'user', id, JSON.stringify({ user: user, notes })]
        );

        return reply.send(successResponse(null, 'User rejected and removed'));
      }

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to review user', error.message));
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

  // GET /api/admin/payments - List payments (pending, success, failed)
  fastify.get('/payments', { 
    preHandler: [authenticateToken, requireSuperAdmin, validateQuery(paginationSchema.extend({ status: z.enum(['pending', 'success', 'failed']).optional() }))] 
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { page, limit, status } = request.query as any;

      let statusFilter = '';
      let countFilter = '';
      const params: any[] = [limit, (page - 1) * limit];
      const countParams: any[] = [];

      if (status) {
        statusFilter = 'WHERE t.status = $3';
        countFilter = 'WHERE status = $1';
        params.push(status);
        countParams.push(status);
      }

      const payments = await query(
        `SELECT t.*, u.full_name as user_name, u.email as user_email
         FROM transactions t
         JOIN users u ON t.user_id = u.id
         ${statusFilter}
         ORDER BY t.created_at DESC
         LIMIT $1 OFFSET $2`,
        params
      );

      const countResult = await queryOne<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM transactions t ${countFilter}`,
        countParams
      );

      return reply.send(paginatedResponse(payments || [], countResult?.count || 0, page, limit));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch payments', error.message));
    }
  });

  // POST /api/admin/payments/:id/review - Approve or reject a manual payment
  fastify.post('/payments/:id/review', { 
    preHandler: [authenticateToken, requireSuperAdmin, validateBody(paymentReviewSchema)] 
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { action, notes } = request.body as z.infer<typeof paymentReviewSchema>;
      const adminId = request.user!.userId;

      const transactionData = await queryOne<{ id: string; user_id: string; status: string; amount: number; provider_payload_json: any; reference: string; user_email: string; user_name: string }>(
        'SELECT t.*, u.email as user_email, u.full_name as user_name FROM transactions t JOIN users u ON t.user_id = u.id WHERE t.id = $1',
        [id]
      );

      if (!transactionData) {
        return reply.status(404).send(errorResponse('Transaction not found'));
      }

      if (transactionData.status !== 'pending') {
        return reply.status(400).send(errorResponse(`Transaction is already ${transactionData.status}`));
      }

      const payload = transactionData.provider_payload_json || {};
      const membershipType = payload.membership_type || 'basic';
      const referralCode = payload.referral_code;
      const userId = transactionData.user_id;
      const amount = transactionData.amount;

      if (action === 'approve') {
        // Approve payment
        await query(
          'UPDATE transactions SET status = $1, paid_at = $2, provider_payload_json = jsonb_set(COALESCE(provider_payload_json::jsonb, \'{}\'), \'{admin_notes}\', $3) WHERE id = $4',
          ['success', new Date().toISOString(), JSON.stringify(notes || ''), id]
        );

        // Calculate membership expiry
        const now = new Date();
        let expiresAt = new Date();
        if (membershipType === 'basic') {
          expiresAt.setMonth(now.getMonth() + 1);
        } else if (membershipType === 'premium') {
          expiresAt.setMonth(now.getMonth() + 3);
        } else {
          expiresAt.setFullYear(now.getFullYear() + 100); // Lifetime
        }

        // Create or update membership
        await query(
          `INSERT INTO memberships (user_id, status, plan_type, amount_paid, starts_at, expires_at)
           VALUES ($1, $2, 'standard_member', $3, $4, $5)
           ON CONFLICT (user_id) DO UPDATE SET
             status = $2,
             plan_type = 'standard_member',
             amount_paid = $3,
             starts_at = $4,
             expires_at = $5`,
          [userId, 'active', amount, now.toISOString(), expiresAt.toISOString()]
        );

        // Update user role to member
        await query(
          "UPDATE users SET role = CASE WHEN role = 'guest' THEN 'member'::user_role ELSE role END, status = 'membership_active' WHERE id = $1",
          [userId]
        );

        // Handle referral reward if applicable
        if (referralCode) {
          const referrer = await queryOne<{ id: string }>(
            'SELECT id FROM users WHERE referral_code = $1',
            [referralCode]
          );

          if (referrer) {
            // Update referral status to rewarded
            await query(
              "UPDATE referrals SET status = 'rewarded', rewarded_at = $1 WHERE referred_user_id = $2",
              [new Date().toISOString(), userId]
            );

            // Credit referrer
            await query(
              'UPDATE users SET referral_reward_balance = COALESCE(referral_reward_balance, 0) + 500 WHERE id = $1',
              [referrer.id]
            );
          }
        }

        // Create notification
        await query(
          'INSERT INTO notifications (user_id, type, title, body, data_json) VALUES ($1, $2, $3, $4, $5)',
          [userId, 'membership_activated', 'Payment Approved & Membership Activated', `Your manual payment has been approved. Your ${membershipType} membership is now active.`, JSON.stringify({ membership_type: membershipType, reference: transactionData.reference })]
        );

        // Log audit
        await query(
          'INSERT INTO admin_audit_logs (admin_user_id, action, entity_type, entity_id, new_values_json) VALUES ($1, $2, $3, $4, $5)',
          [adminId, 'approve_payment', 'transaction', id, JSON.stringify({ notes })]
        );

        // Send Email
        if (transactionData.user_email) {
          await sendEmail({
            to: transactionData.user_email,
            subject: 'Payment Approved - Membership Activated',
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>Congratulations, ${transactionData.user_name}!</h2>
                <p>Your manual payment of ₦${amount} for the ${membershipType} membership has been approved.</p>
                <p>Your membership is now active. You can log in and access your dashboard.</p>
                <p>Invoice Reference: <strong>${transactionData.reference}</strong></p>
                <br/>
                <p>Thank you,<br/>Nigerian AI Builders Team</p>
              </div>
            `
          }).catch(err => request.log.error('Failed to send approval email', err));
        }

        return reply.send(successResponse(null, 'Payment approved successfully'));

      } else {
        // Reject payment
        await query(
          'UPDATE transactions SET status = $1, provider_payload_json = jsonb_set(COALESCE(provider_payload_json::jsonb, \'{}\'), \'{admin_notes}\', $2) WHERE id = $3',
          ['failed', JSON.stringify(notes || ''), id]
        );

        // Create notification
        await query(
          'INSERT INTO notifications (user_id, type, title, body, data_json) VALUES ($1, $2, $3, $4, $5)',
          [userId, 'general', 'Payment Rejected', `Your manual payment (Invoice: ${transactionData.reference}) could not be verified and has been rejected. Notes: ${notes || 'No notes provided.'}`, JSON.stringify({ reference: transactionData.reference })]
        );

        // Log audit
        await query(
          'INSERT INTO admin_audit_logs (admin_user_id, action, entity_type, entity_id, new_values_json) VALUES ($1, $2, $3, $4, $5)',
          [adminId, 'reject_payment', 'transaction', id, JSON.stringify({ notes })]
        );

        // Send Email
        if (transactionData.user_email) {
          await sendEmail({
            to: transactionData.user_email,
            subject: 'Payment Verification Failed',
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>Hello ${transactionData.user_name},</h2>
                <p>We could not verify your manual payment for invoice <strong>${transactionData.reference}</strong>.</p>
                <p><strong>Admin Notes:</strong> ${notes || 'No specific notes provided.'}</p>
                <p style="padding: 15px; background: #fff3f3; border-left: 4px solid #ff4d4f;">
                  Please contact us at <strong>08104880331</strong> for assistance and to resolve this issue.
                </p>
                <br/>
                <p>Thank you,<br/>Nigerian AI Builders Team</p>
              </div>
            `
          }).catch(err => request.log.error('Failed to send rejection email', err));
        }

        return reply.send(successResponse(null, 'Payment rejected'));
      }

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to review payment', error.message));
    }
  });
}
