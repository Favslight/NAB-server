import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../../database/database';
import { authenticateToken, requireAuth, requireSuperAdmin } from '../../middlewares/auth';
import { validateBody, validateQuery } from '../../middlewares/validation';
import { successResponse, errorResponse, paginatedResponse } from '../../utils/response';
import { config } from '../../config';
import { canAccessTool, getEffectiveToolPlan } from '../../services/toolAccess.service';
import { getAllTools, getAllCategories, getToolBySlug, getMyAccessTools } from '../../services/tools.service';
import { ensureUserSyncedToDealAi, logToolLaunch, getLaunchAnalytics } from '../../services/toolLaunch.service';

// ── Schemas ──────────────────────────────────────────────────────────────────

const paginationSchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).default('20'),
});

const adminToolsPaginationSchema = paginationSchema.extend({
  limit: z.string().regex(/^\d+$/).transform(Number).default('100'),
});

const createToolSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  icon: z.string().optional(),
  category: z.string().optional(),
  required_plan: z.enum(['ai_explorer', 'ai_builder', 'ai_product_founder']),
  featured: z.boolean().default(false),
  active: z.boolean().default(true),
});

const updateToolSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  category: z.string().optional(),
  required_plan: z.enum(['ai_explorer', 'ai_builder', 'ai_product_founder']).optional(),
  featured: z.boolean().optional(),
  active: z.boolean().optional(),
});

// ── Route handler ─────────────────────────────────────────────────────────────

export default async function toolRoutes(fastify: FastifyInstance) {

  // ── GET /api/tools ─────────────────────────────────────────────────────────
  // Public: returns all tools. locked=true computed from user membership.
  fastify.get('/', { preHandler: [authenticateToken, requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;

      // Fetch user's active membership plan from users table
      const user = await queryOne<{ status: string, membership_plan_type: string }>(
        "SELECT status, membership_plan_type FROM users WHERE id = $1",
        [userId]
      );

      const userPlan = getEffectiveToolPlan(user?.status, user?.membership_plan_type);
      const tools = await getAllTools(userPlan);
      return reply.send(successResponse(tools));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch tools', error.message));
    }
  });

  // ── GET /api/tools/categories ──────────────────────────────────────────────
  fastify.get('/categories', { preHandler: [authenticateToken, requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const categories = await getAllCategories();
      return reply.send(successResponse(categories));
    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch categories', error.message));
    }
  });

  // ── GET /api/tools/analytics ───────────────────────────────────────────────
  fastify.get('/analytics', { preHandler: [authenticateToken, requireSuperAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const analytics = await getLaunchAnalytics();
      return reply.send(successResponse(analytics));
    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch analytics', error.message));
    }
  });

  // ── GET /api/tools/my-access ───────────────────────────────────────────────
  // Returns only tools the requesting user can actually launch
  fastify.get('/my-access', { preHandler: [authenticateToken, requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;

      const user = await queryOne<{ status: string, membership_plan_type: string }>(
        "SELECT status, membership_plan_type FROM users WHERE id = $1",
        [userId]
      );

      if (!user) {
  return reply.send(
    successResponse([], 'User not found')
  );
}

const userPlan = getEffectiveToolPlan(user.status, user.membership_plan_type);
if (!userPlan) {
  return reply.send(
    successResponse([], 'No tool access available')
  );
}

const tools = await getMyAccessTools(userPlan);

return reply.send(
  successResponse(tools)
);

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch accessible tools', error.message));
    }
  });

  // ── POST /api/tools/:slug/launch ───────────────────────────────────────────
  fastify.post('/:slug/launch', { preHandler: [authenticateToken, requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { slug } = request.params as { slug: string };
      const userId = request.user!.userId;

      // 1. Validate tool exists
      const tool = await getToolBySlug(slug);
      if (!tool) {
        return reply.status(404).send(errorResponse('Tool not found'));
      }

      // 2. Fetch user's active membership from users table
      const user = await queryOne<{ status: string, membership_plan_type: string }>(
        "SELECT status, membership_plan_type FROM users WHERE id = $1",
        [userId]
      );

      if (!user) {
  return reply.status(404).send(
    errorResponse('User not found')
  );
}

const userPlan = getEffectiveToolPlan(user.status, user.membership_plan_type);
if (!userPlan) {
  return reply.status(403).send(
    errorResponse(
      'Your account is not eligible to use AI tools yet.'
    )
  );
}

      // 3. Check tool access
      if (!canAccessTool(userPlan, tool.required_plan)) {
        return reply.status(403).send(errorResponse(`Your current plan (${userPlan}) does not include access to ${tool.name}. Please upgrade.`));
      }

      // 4. Log the launch
      await logToolLaunch(
        userId,
        tool.id,
        request.ip || null,
        request.headers['user-agent'] || null
      );

      // 5. Return launch URL
      return reply.send(successResponse({
        launchUrl: config.dealAi.launchUrl,
        tool: {
          name: tool.name,
          slug: tool.slug,
        },
      }, `Launching ${tool.name}`));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to launch tool', error.message));
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SUPER ADMIN ROUTES
  // ─────────────────────────────────────────────────────────────────────────

  // ── POST /api/tools/admin/tools ────────────────────────────────────────────
  fastify.post('/admin/tools', { preHandler: [authenticateToken, requireSuperAdmin, validateBody(createToolSchema)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = request.body as z.infer<typeof createToolSchema>;
      const adminId = request.user!.userId;

      // Check slug uniqueness
      const existing = await queryOne('SELECT id FROM tools WHERE slug = $1', [data.slug]);
      if (existing) {
        return reply.status(409).send(errorResponse('A tool with this slug already exists'));
      }

      const tool = await queryOne(
        `INSERT INTO tools (name, slug, description, icon, category, required_plan, featured, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          data.name, data.slug, data.description || null, data.icon || null,
          data.category || null, data.required_plan, data.featured, data.active,
        ]
      );

      await query(
        'INSERT INTO admin_audit_logs (admin_user_id, action, entity_type, entity_id, new_values_json) VALUES ($1, $2, $3, $4, $5)',
        [adminId, 'create_tool', 'tool', (tool as any).id, JSON.stringify(data)]
      );

      return reply.status(201).send(successResponse(tool, 'Tool created'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to create tool', error.message));
    }
  });

  // ── PATCH /api/tools/admin/tools/:id ──────────────────────────────────────
  fastify.patch('/admin/tools/:id', { preHandler: [authenticateToken, requireSuperAdmin, validateBody(updateToolSchema)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const data = request.body as z.infer<typeof updateToolSchema>;
      const adminId = request.user!.userId;

      // Dynamically build SET clause
      const fields: string[] = [];
      const values: any[] = [];
      let idx = 1;

      for (const [key, val] of Object.entries(data)) {
        if (val !== undefined) {
          fields.push(`${key} = $${idx}`);
          values.push(val);
          idx++;
        }
      }

      if (fields.length === 0) {
        return reply.status(400).send(errorResponse('No fields to update'));
      }

      values.push(id);
      const tool = await queryOne(
        `UPDATE tools SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );

      if (!tool) {
        return reply.status(404).send(errorResponse('Tool not found'));
      }

      await query(
        'INSERT INTO admin_audit_logs (admin_user_id, action, entity_type, entity_id, new_values_json) VALUES ($1, $2, $3, $4, $5)',
        [adminId, 'update_tool', 'tool', id, JSON.stringify(data)]
      );

      return reply.send(successResponse(tool, 'Tool updated'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to update tool', error.message));
    }
  });

  // ── DELETE /api/tools/admin/tools/:id ─────────────────────────────────────
  fastify.delete('/admin/tools/:id', { preHandler: [authenticateToken, requireSuperAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const adminId = request.user!.userId;

      const tool = await queryOne('DELETE FROM tools WHERE id = $1 RETURNING id, name', [id]);
      if (!tool) {
        return reply.status(404).send(errorResponse('Tool not found'));
      }

      await query(
        'INSERT INTO admin_audit_logs (admin_user_id, action, entity_type, entity_id, old_values_json) VALUES ($1, $2, $3, $4, $5)',
        [adminId, 'delete_tool', 'tool', id, JSON.stringify(tool)]
      );

      return reply.send(successResponse(null, 'Tool deleted'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to delete tool', error.message));
    }
  });

  // ── GET /api/tools/admin/tools ─────────────────────────────────────────────
  // Admin: list all tools including inactive
  fastify.get('/admin/tools', { preHandler: [authenticateToken, requireSuperAdmin, validateQuery(adminToolsPaginationSchema)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { page, limit } = request.query as any;

      const tools = await query(
        `SELECT t.*, tc.name as category_name
         FROM tools t
         LEFT JOIN tool_categories tc ON t.category = tc.slug
         ORDER BY t.featured DESC, t.name ASC
         LIMIT $1 OFFSET $2`,
        [limit, (page - 1) * limit]
      );

      const countResult = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM tools');

      return reply.send(paginatedResponse(tools || [], countResult?.count || 0, page, limit));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch tools', error.message));
    }
  });

  // ── GET /api/tools/admin/deal-ai-users ─────────────────────────────────────
  fastify.get('/admin/deal-ai-users', { preHandler: [authenticateToken, requireSuperAdmin, validateQuery(paginationSchema)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { page, limit } = request.query as any;

      const rows = await query(
        `SELECT d.*, u.full_name, u.email
         FROM deal_ai_users d
         JOIN users u ON d.user_id = u.id
         ORDER BY d.synced_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, (page - 1) * limit]
      );

      const countResult = await queryOne<{ count: number }>('SELECT COUNT(*)::int as count FROM deal_ai_users');

      return reply.send(paginatedResponse(rows || [], countResult?.count || 0, page, limit));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch Deal.ai users', error.message));
    }
  });
}
