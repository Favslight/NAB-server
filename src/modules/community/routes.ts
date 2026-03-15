import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../../database/database';
import { authenticateToken, optionalAuth, requireAuth, requireMember } from '../../middlewares/auth';
import { validateBody, validateQuery } from '../../middlewares/validation';
import { successResponse, errorResponse, paginatedResponse } from '../../utils/response';
import { slugify } from '../../utils/helpers';

const createPostSchema = z.object({
  title: z.string().min(1).max(300),
  content: z.string().max(10000),
  post_type: z.enum(['discussion', 'question', 'showcase', 'event', 'job']).default('discussion'),
  state_hub_id: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
  media_urls: z.array(z.string().url()).optional(),
});

const createCommentSchema = z.object({
  content: z.string().min(1).max(5000),
  parent_comment_id: z.string().uuid().optional(),
});

const paginationSchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).default('20'),
  state_hub_id: z.string().uuid().optional(),
  post_type: z.enum(['discussion', 'question', 'showcase', 'event', 'job']).optional(),
});

export default async function communityRoutes(fastify: FastifyInstance) {
  // GET /api/community/posts - List posts
  fastify.get('/posts', { preHandler: [optionalAuth, validateQuery(paginationSchema)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { page, limit, state_hub_id, post_type } = request.query as any;

      let sql = `SELECT p.*, u.full_name as author_name, u.avatar_url as author_avatar, s.name as state_name
                 FROM community_posts p
                 JOIN users u ON p.user_id = u.id
                 LEFT JOIN states s ON p.state_hub_id = s.id
                 WHERE p.is_hidden = false`;
      let countSql = 'SELECT COUNT(*)::int as count FROM community_posts WHERE is_hidden = false';
      const params: any[] = [];
      let paramIndex = 0;

      if (state_hub_id) {
        paramIndex++;
        sql += ` AND p.state_hub_id = $${paramIndex}`;
        countSql += ` AND state_hub_id = $${paramIndex}`;
        params.push(state_hub_id);
      }

      if (post_type) {
        paramIndex++;
        sql += ` AND p.post_type = $${paramIndex}`;
        countSql += ` AND post_type = $${paramIndex}`;
        params.push(post_type);
      }

      sql += ` ORDER BY p.is_featured DESC, p.created_at DESC LIMIT $${++paramIndex} OFFSET $${++paramIndex}`;
      params.push(limit, (page - 1) * limit);

      const [posts, countResult] = await Promise.all([
        query(sql, params),
        queryOne<{ count: number }>(countSql, params.slice(0, params.length - 2))
      ]);

      return reply.send(paginatedResponse(posts || [], countResult?.count || 0, page, limit));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch posts', error.message));
    }
  });

  // POST /api/community/posts - Create post
  fastify.post('/posts', { preHandler: [authenticateToken, requireMember, validateBody(createPostSchema)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = request.body as z.infer<typeof createPostSchema>;
      const userId = request.user!.userId;

      const slug = slugify(data.title) + '-' + Date.now().toString(36);

      const post = await queryOne(
        `INSERT INTO community_posts (user_id, state_hub_id, title, slug, content, post_type, tags, media_urls)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          userId,
          data.state_hub_id || null,
          data.title,
          slug,
          data.content,
          data.post_type,
          data.tags || null,
          data.media_urls || null,
        ]
      );

      return reply.status(201).send(successResponse(post, 'Post created successfully'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to create post', error.message));
    }
  });

  // GET /api/community/posts/:id - Get post by ID
  fastify.get('/posts/:id', { preHandler: optionalAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };

      const post = await queryOne(
        `SELECT p.*, u.full_name as author_name, u.avatar_url as author_avatar, s.name as state_name
         FROM community_posts p
         JOIN users u ON p.user_id = u.id
         LEFT JOIN states s ON p.state_hub_id = s.id
         WHERE p.id = $1 AND p.is_hidden = false`,
        [id]
      );

      if (!post) {
        return reply.status(404).send(errorResponse('Post not found'));
      }

      // Increment view count
      await query('UPDATE community_posts SET view_count = view_count + 1 WHERE id = $1', [id]);

      // Get comments
      const comments = await query(
        `SELECT c.*, u.full_name as author_name, u.avatar_url as author_avatar
         FROM community_comments c
         JOIN users u ON c.user_id = u.id
         WHERE c.post_id = $1 AND c.is_hidden = false
         ORDER BY c.created_at ASC`,
        [id]
      );

      return reply.send(successResponse({
        ...post,
        comments: comments || [],
      }));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch post', error.message));
    }
  });

  // POST /api/community/posts/:id/comments - Add comment
  fastify.post('/posts/:id/comments', { preHandler: [authenticateToken, requireMember, validateBody(createCommentSchema)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const data = request.body as z.infer<typeof createCommentSchema>;
      const userId = request.user!.userId;

      // Check post exists
      const post = await queryOne('SELECT id FROM community_posts WHERE id = $1 AND is_hidden = false', [id]);
      if (!post) {
        return reply.status(404).send(errorResponse('Post not found'));
      }

      const comment = await queryOne(
        `INSERT INTO community_comments (post_id, user_id, content, parent_comment_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [id, userId, data.content, data.parent_comment_id || null]
      );

      // Update post comment count
      await query('UPDATE community_posts SET comment_count = comment_count + 1 WHERE id = $1', [id]);

      // Notify post author
      const postAuthor = await queryOne('SELECT user_id FROM community_posts WHERE id = $1', [id]);
      if (postAuthor && postAuthor.user_id !== userId) {
        await query(
          'INSERT INTO notifications (user_id, type, title, body, data_json) VALUES ($1, $2, $3, $4, $5)',
          [postAuthor.user_id, 'post_comment', 'New Comment', 'Someone commented on your post', JSON.stringify({ post_id: id, comment_id: comment?.id })]
        );
      }

      return reply.status(201).send(successResponse(comment, 'Comment added'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to add comment', error.message));
    }
  });

  // POST /api/community/posts/:id/react - Like/unlike post
  fastify.post('/posts/:id/react', { preHandler: [authenticateToken, requireMember] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const userId = request.user!.userId;

      // Check if already liked
      const existing = await queryOne(
        'SELECT id FROM post_reactions WHERE post_id = $1 AND user_id = $2',
        [id, userId]
      );

      if (existing) {
        // Unlike
        await query('DELETE FROM post_reactions WHERE id = $1', [existing.id]);
        await query('UPDATE community_posts SET like_count = like_count - 1 WHERE id = $1', [id]);
        return reply.send(successResponse(null, 'Like removed'));
      }

      // Like
      await query(
        'INSERT INTO post_reactions (post_id, user_id) VALUES ($1, $2)',
        [id, userId]
      );
      await query('UPDATE community_posts SET like_count = like_count + 1 WHERE id = $1', [id]);

      return reply.send(successResponse(null, 'Post liked'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to react', error.message));
    }
  });
}
