import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../../database/database';
import { authenticateToken, requireStateAdmin } from '../../middlewares/auth';
import { successResponse, errorResponse, paginatedResponse } from '../../utils/response';

const moderationActionSchema = z.object({
  action: z.enum(['hide', 'feature', 'unfeature', 'mark_spam', 'delete']),
  reason: z.string().optional(),
});

export default async function moderationRoutes(fastify: FastifyInstance) {
  // POST /api/moderation/posts/:id/action - Moderate a post
  fastify.post('/posts/:id/action', { preHandler: [authenticateToken, requireStateAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { action, reason } = request.body as z.infer<typeof moderationActionSchema>;
      const moderatorId = request.user!.userId;
      const isSuperAdmin = request.user!.role === 'super_admin';
      const stateId = request.user!.stateId;

      // For state admins, verify the post author is from their state
      if (!isSuperAdmin) {
        const post = await queryOne<{ author_state_id: string }>(
          `SELECT u.state_id as author_state_id 
           FROM community_posts cp 
           JOIN users u ON cp.author_user_id = u.id 
           WHERE cp.id = $1`,
          [id]
        );
        
        if (!post) {
          return reply.status(404).send(errorResponse('Post not found'));
        }
        
        if (post.author_state_id !== stateId) {
          return reply.status(403).send(errorResponse('You can only moderate posts from your state'));
        }
      }

      const updates: Record<string, any> = {};

      switch (action) {
        case 'hide':
          updates.is_hidden = true;
          break;
        case 'feature':
          updates.is_featured = true;
          break;
        case 'unfeature':
          updates.is_featured = false;
          break;
        case 'mark_spam':
          updates.is_hidden = true;
          updates.is_spam = true;
          break;
        case 'delete':
          await query('DELETE FROM community_posts WHERE id = $1', [id]);
          break;
      }

      if (action !== 'delete') {
        const setClause = Object.entries(updates).map(([key], idx) => `${key} = $${idx + 1}`).join(', ');
        await query(`UPDATE community_posts SET ${setClause} WHERE id = $${Object.keys(updates).length + 1}`, [...Object.values(updates), id]);
      }

      // Log moderation action
      await query(
        'INSERT INTO moderation_logs (moderator_user_id, entity_type, entity_id, action, reason) VALUES ($1, $2, $3, $4, $5)',
        [moderatorId, 'post', id, action, reason || null]
      );

      return reply.send(successResponse(null, `Post ${action}d successfully`));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to moderate post', error.message));
    }
  });

  // POST /api/moderation/comments/:id/hide - Hide a comment
  fastify.post('/comments/:id/hide', { preHandler: [authenticateToken, requireStateAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const moderatorId = request.user!.userId;
      const isSuperAdmin = request.user!.role === 'super_admin';
      const stateId = request.user!.stateId;

      // For state admins, verify the comment author is from their state
      if (!isSuperAdmin) {
        const comment = await queryOne<{ author_state_id: string }>(
          `SELECT u.state_id as author_state_id 
           FROM community_comments cc 
           JOIN users u ON cc.author_user_id = u.id 
           WHERE cc.id = $1`,
          [id]
        );
        
        if (!comment) {
          return reply.status(404).send(errorResponse('Comment not found'));
        }
        
        if (comment.author_state_id !== stateId) {
          return reply.status(403).send(errorResponse('You can only moderate comments from your state'));
        }
      }

      await query('UPDATE community_comments SET is_hidden = true WHERE id = $1', [id]);

      // Log moderation action
      await query(
        'INSERT INTO moderation_logs (moderator_user_id, entity_type, entity_id, action, reason) VALUES ($1, $2, $3, $4, $5)',
        [moderatorId, 'comment', id, 'hide', null]
      );

      return reply.send(successResponse(null, 'Comment hidden'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to hide comment', error.message));
    }
  });

  // GET /api/moderation/logs - Get moderation logs
  fastify.get('/logs', { preHandler: [authenticateToken, requireStateAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { page = '1', limit = '20' } = request.query as any;
      const isSuperAdmin = request.user!.role === 'super_admin';
      const stateId = request.user!.stateId;

      // Build state filter for state admins - show only logs where moderator is from their state
      const stateFilter = isSuperAdmin ? '' : 'WHERE u.state_id = $3';
      const countFilter = isSuperAdmin ? '' : 'WHERE u.state_id = $1';
      const params = isSuperAdmin 
        ? [parseInt(limit), (parseInt(page) - 1) * parseInt(limit)] 
        : [parseInt(limit), (parseInt(page) - 1) * parseInt(limit), stateId];
      const countParams = isSuperAdmin ? [] : [stateId];

      const logs = await query(
        `SELECT ml.*, u.full_name as moderator_name
         FROM moderation_logs ml
         JOIN users u ON ml.moderator_user_id = u.id
         ${stateFilter}
         ORDER BY ml.created_at DESC
         LIMIT $1 OFFSET $2`,
        params
      );

      const countResult = await queryOne<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM moderation_logs ml JOIN users u ON ml.moderator_user_id = u.id ${countFilter}`,
        countParams
      );

      return reply.send(paginatedResponse(logs || [], countResult?.count || 0, parseInt(page), parseInt(limit)));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch logs', error.message));
    }
  });
}
