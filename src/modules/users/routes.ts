import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../../database/database';
import { authenticateToken, requireAuth, requireSuperAdmin, requireStateAdmin } from '../../middlewares/auth';
import { validateBody, validateQuery } from '../../middlewares/validation';
import { successResponse, errorResponse, paginatedResponse } from '../../utils/response';
import { uploadImage } from '../../utils/cloudinary';

const updateProfileSchema = z.object({
  full_name: z.string().min(2).max(255).optional(),
  phone: z.string().min(10).max(20).optional(),
  profession: z.string().max(100).optional(),
  avatar_url: z.string().url().optional().nullable(),
});

const paginationSchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).default('20'),
  state_id: z.string().uuid().optional(),
  role: z.enum(['guest', 'member', 'premium_builder', 'state_admin', 'super_admin']).optional(),
});

export default async function userRoutes(fastify: FastifyInstance) {
  // GET /api/users - List users (admin only)
  fastify.get('/', { 
    preHandler: [authenticateToken, requireSuperAdmin, validateQuery(paginationSchema)] 
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { page, limit, state_id, role } = request.query as any;

      let sql = 'SELECT * FROM users WHERE 1=1';
      let countSql = 'SELECT COUNT(*)::int as count FROM users WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 0;

      if (state_id) {
        paramIndex++;
        sql += ` AND state_id = $${paramIndex}`;
        countSql += ` AND state_id = $${paramIndex}`;
        params.push(state_id);
      }

      if (role) {
        paramIndex++;
        sql += ` AND role = $${paramIndex}`;
        countSql += ` AND role = $${paramIndex}`;
        params.push(role);
      }

      sql += ` ORDER BY created_at DESC LIMIT $${++paramIndex} OFFSET $${++paramIndex}`;
      params.push(limit, (page - 1) * limit);

      const [users, countResult] = await Promise.all([
        query(sql, params),
        queryOne<{ count: number }>(countSql, params.slice(0, params.length - 2))
      ]);

      return reply.send(paginatedResponse(users || [], countResult?.count || 0, page, limit));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch users', error.message));
    }
  });

  // GET /api/users/profile - Get current user profile
  fastify.get('/profile', { preHandler: [authenticateToken, requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = await queryOne(
        `SELECT u.*, s.id as state_id_val, s.name as state_name, s.slug as state_slug
         FROM users u
         LEFT JOIN states s ON u.state_id = s.id
         WHERE u.id = $1`,
        [request.user!.userId]
      );

      if (!user) {
        return reply.status(404).send(errorResponse('User not found'));
      }

      // Get referral stats
      const referralStats = await queryOne(
        `SELECT 
          COUNT(*) FILTER (WHERE status = 'signed_up') as signed_up_count,
          COUNT(*) FILTER (WHERE status = 'paid') as paid_count,
          COUNT(*) FILTER (WHERE status = 'rewarded') as rewarded_count
         FROM referrals WHERE referrer_user_id = $1`,
        [user.id]
      );

      return reply.send(successResponse({
        ...user,
        membership_status: (user.status as any) === 'membership_active' ? 'active' : ((user.status as any) === 'pending_admin_approval' ? 'pending' : 'inactive'),
        membership_plan_type: user.membership_plan_type || 'standard_member',
        membership_expires_at: user.membership_expires_at || null,
        referral_stats: referralStats,
      }));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch profile', error.message));
    }
  });

  // PUT /api/users/profile - Update profile
  fastify.put('/profile', { preHandler: [authenticateToken, requireAuth, validateBody(updateProfileSchema)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = request.body as z.infer<typeof updateProfileSchema>;
      const userId = request.user!.userId;

      // Build dynamic update
      const updates: string[] = [];
      const params: any[] = [];
      let paramIndex = 0;

      if (data.full_name !== undefined) {
        updates.push(`full_name = $${++paramIndex}`);
        params.push(data.full_name);
      }
      if (data.phone !== undefined) {
        updates.push(`phone = $${++paramIndex}`);
        params.push(data.phone);
      }
      if (data.profession !== undefined) {
        updates.push(`profession = $${++paramIndex}`);
        params.push(data.profession);
      }
      if (data.avatar_url !== undefined) {
        updates.push(`avatar_url = $${++paramIndex}`);
        params.push(data.avatar_url);
      }

      if (updates.length === 0) {
        return reply.status(400).send(errorResponse('No fields to update'));
      }

      updates.push(`updated_at = $${++paramIndex}`);
      params.push(new Date().toISOString());
      params.push(userId);

      const user = await queryOne(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex + 1} RETURNING *`,
        params
      );

      if (!user) {
        return reply.status(404).send(errorResponse('User not found'));
      }

      return reply.send(successResponse(user, 'Profile updated successfully'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to update profile', error.message));
    }
  });

  // POST /api/users/avatar - Upload avatar
  fastify.post('/avatar', { preHandler: [authenticateToken, requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;

      // Get file from multipart request
      const file = await request.file();
      if (!file) {
        return reply.status(400).send(errorResponse('No file provided'));
      }

      // Only allow images
      if (!file.mimetype.startsWith('image/')) {
        return reply.status(400).send(errorResponse('Only image files are allowed'));
      }

      const buffer = await file.toBuffer();

      // Upload to Cloudinary
      const uploadResult = await uploadImage(buffer, 'avatars');

      // Update user avatar
      const user = await queryOne(
        'UPDATE users SET avatar_url = $1, updated_at = $2 WHERE id = $3 RETURNING id, avatar_url',
        [uploadResult.url, new Date().toISOString(), userId]
      );

      return reply.status(200).send(successResponse({ avatar_url: user?.avatar_url }, 'Avatar uploaded successfully'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to upload avatar', error.message));
    }
  });

  // GET /api/users/:id - Get user by ID
  fastify.get('/:id', { preHandler: authenticateToken }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };

      const user = await queryOne(
        `SELECT u.*, s.name as state_name
         FROM users u
         LEFT JOIN states s ON u.state_id = s.id
         WHERE u.id = $1`,
        [id]
      );

      if (!user) {
        return reply.status(404).send(errorResponse('User not found'));
      }

      return reply.send(successResponse(user));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch user', error.message));
    }
  });

  // GET /api/users/states - Get all states
  fastify.get('/states', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const states = await query(
        `SELECT s.*, COUNT(u.id)::int as user_count
         FROM states s
         LEFT JOIN users u ON u.state_id = s.id
         GROUP BY s.id
         ORDER BY s.name`
      );

      return reply.send(successResponse(states));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch states', error.message));
    }
  });

  // GET /api/users/state-hubs - Get all state hubs
  fastify.get('/state-hubs', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const hubs = await query(
        `SELECT sh.*, s.name as state_name
         FROM state_hubs sh
         JOIN states s ON sh.state_id = s.id
         ORDER BY s.name`
      );

      return reply.send(successResponse(hubs));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch state hubs', error.message));
    }
  });

  // GET /api/users/state-hubs/:slug - Get state hub by slug
  fastify.get('/state-hubs/:slug', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { slug } = request.params as { slug: string };

      const hub = await queryOne(
        `SELECT sh.*, s.name as state_name
         FROM state_hubs sh
         JOIN states s ON sh.state_id = s.id
         WHERE sh.slug = $1`,
        [slug]
      );

      if (!hub) {
        return reply.status(404).send(errorResponse('State hub not found'));
      }

      return reply.send(successResponse(hub));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch state hub', error.message));
    }
  });

  // GET /api/users/my-hub - Get current user's state hub
  fastify.get('/my-hub', { preHandler: authenticateToken }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;

      // Get user's state
      const user = await queryOne<{ state_id: string }>(
        'SELECT state_id FROM users WHERE id = $1',
        [userId]
      );

      if (!user) {
        return reply.status(404).send(errorResponse('User not found'));
      }

      // Get hub for user's state
      const hub = await queryOne(
        `SELECT sh.*, s.name as state_name
         FROM state_hubs sh
         JOIN states s ON sh.state_id = s.id
         WHERE sh.state_id = $1`,
        [user.state_id]
      );

      if (!hub) {
        return reply.status(404).send(errorResponse('Hub not found for your state'));
      }

      // Get member statistics for this state
      const stats = await queryOne(
        `SELECT 
           COUNT(*)::int as total_members,
           COUNT(CASE WHEN role = 'member' THEN 1 END)::int as active_members,
           COUNT(CASE WHEN role = 'guest' THEN 1 END)::int as guests,
           COUNT(CASE WHEN role = 'state_admin' THEN 1 END)::int as state_admins,
           COUNT(CASE WHEN status = 'membership_active' THEN 1 END)::int as paid_members
         FROM users 
         WHERE state_id = $1`,
        [user.state_id]
      );

      return reply.send(successResponse({
        ...hub,
        stats: stats || {
          total_members: 0,
          active_members: 0,
          guests: 0,
          state_admins: 0,
          paid_members: 0
        }
      }));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch your hub', error.message));
    }
  });

  // GET /api/users/state-members - Get all members in state (state admin only)
  fastify.get('/state-members', { 
    preHandler: [authenticateToken, requireStateAdmin] 
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stateId = request.user!.stateId;
      const { page = 1, limit = 50, role, status } = request.query as any;

      // Build WHERE clause
      let whereClause = 'WHERE u.state_id = $1';
      let params: any[] = [stateId];
      let paramIndex = 2;

      if (role) {
        whereClause += ` AND u.role = $${paramIndex}`;
        params.push(role);
        paramIndex++;
      }

      if (status) {
        whereClause += ` AND u.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      // Get members with pagination
      const members = await query(
        `SELECT 
           u.id,
           u.id_no,
           u.full_name,
           u.email,
           u.phone,
           u.role,
           u.status,
           u.profession,
           u.avatar_url,
           u.created_at,
           u.email_verified_at,
           s.name as state_name,
           m.plan_type,
           m.status as membership_status,
           m.expires_at as membership_expires_at
         FROM users u
         LEFT JOIN states s ON u.state_id = s.id
         LEFT JOIN memberships m ON u.id = m.user_id AND m.status = 'active'
         ${whereClause}
         ORDER BY u.created_at DESC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, limit, (page - 1) * limit]
      );

      // Get total count
      const countResult = await queryOne<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM users u ${whereClause}`,
        params
      );

      return reply.send(paginatedResponse(
        members || [], 
        countResult?.count || 0, 
        page, 
        limit
      ));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch state members', error.message));
    }
  });
}
