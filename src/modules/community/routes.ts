import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../../database/database';
import { authenticateToken, optionalAuth, requireAuth, requireMember } from '../../middlewares/auth';
import { validateBody, validateQuery } from '../../middlewares/validation';
import { successResponse, errorResponse, paginatedResponse } from '../../utils/response';
import { uploadImage, uploadVideo } from '../../utils/cloudinary';
import { slugify } from '../../utils/helpers';

// Schema for multipart form data (file uploads)
const createPostSchema = z.object({
  title: z.string().min(1).max(300),
  content: z.string().max(10000),
  post_type: z.enum(['discussion', 'question', 'showcase', 'event', 'job']).default('discussion'),
  hub_id: z.union([z.string().uuid(), z.literal(''), z.null()]).optional().transform(val => val === '' || val === null ? undefined : val),
});

const createCommentSchema = z.object({
  content: z.string().min(1).max(5000),
  parent_comment_id: z.string().uuid().optional(),
});

const paginationSchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).default('20'),
  hub_id: z.string().uuid().optional(),
  post_type: z.enum(['discussion', 'question', 'showcase', 'event', 'job']).optional(),
});

export default async function communityRoutes(fastify: FastifyInstance) {
  // GET /api/community/posts - List posts
  fastify.get('/posts', { preHandler: [optionalAuth, validateQuery(paginationSchema)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { page, limit, hub_id, post_type } = request.query as any;

      let sql = `SELECT p.*, u.full_name as author_name, u.avatar_url as author_avatar, s.name as state_name
                 FROM community_posts p
                 JOIN users u ON p.author_user_id = u.id
                 LEFT JOIN state_hubs sh ON p.hub_id = sh.id
                 LEFT JOIN states s ON sh.state_id = s.id
                 WHERE p.is_hidden = false`;
      let countSql = 'SELECT COUNT(*)::int as count FROM community_posts WHERE is_hidden = false';
      const params: any[] = [];
      let paramIndex = 0;

      let effectiveHubId = hub_id;
      
      // If no hub_id provided and user is authenticated (and not super admin), 
      // default to their state's hub
      if (!effectiveHubId && request.user && request.user.role !== 'super_admin' && request.user.stateId) {
        const userHub = await queryOne<{ id: string }>(
          'SELECT id FROM state_hubs WHERE state_id = $1',
          [request.user.stateId]
        );
        if (userHub) {
          effectiveHubId = userHub.id;
        }
      }

      if (effectiveHubId) {
        paramIndex++;
        sql += ` AND p.hub_id = $${paramIndex}`;
        countSql += ` AND hub_id = $${paramIndex}`;
        params.push(effectiveHubId);
      }

      if (post_type) {
        paramIndex++;
        sql += ` AND p.category = $${paramIndex}`;
        countSql += ` AND category = $${paramIndex}`;
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

  // POST /api/community/posts - Create post (with optional file uploads)
  fastify.post('/posts', { preHandler: [authenticateToken, requireMember] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;

      let data: z.infer<typeof createPostSchema>;
      const mediaFiles: Array<{ url: string; publicId: string; type: string }> = [];

      // Check if request is multipart (has files) or JSON
      const contentType = request.headers['content-type'] || '';
      const isMultipart = contentType.includes('multipart/form-data');

      if (isMultipart) {
        // Handle multipart form data with files
        const parts = request.parts();
        const files: Array<{ buffer: Buffer; mimetype: string; filename: string }> = [];
        let fields: Record<string, string> = {};

        for await (const part of parts) {
          if (part.type === 'file') {
            const buffer = await part.toBuffer();
            files.push({
              buffer,
              mimetype: part.mimetype,
              filename: part.filename,
            });
          } else {
            fields[part.fieldname] = part.value as string;
          }
        }

        // Validate fields
        const validationResult = createPostSchema.safeParse(fields);
        if (!validationResult.success) {
          const errorMessages = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
          return reply.status(400).send(errorResponse('Validation failed', errorMessages));
        }
        data = validationResult.data;

        // Upload files to Cloudinary
        for (const file of files) {
          const isVideo = file.mimetype.startsWith('video/');
          const isImage = file.mimetype.startsWith('image/');

          if (!isVideo && !isImage) {
            return reply.status(400).send(errorResponse('Only image and video files are allowed'));
          }

          const uploadResult = isVideo
            ? await uploadVideo(file.buffer, 'community', file.filename)
            : await uploadImage(file.buffer, 'community', file.filename);

          mediaFiles.push({
            url: uploadResult.url,
            publicId: uploadResult.publicId,
            type: isVideo ? 'video' : 'image',
          });
        }
      } else {
        // Handle JSON request (text-only posts)
        const validationResult = createPostSchema.safeParse(request.body);
        if (!validationResult.success) {
          const errorMessages = validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
          return reply.status(400).send(errorResponse('Validation failed', errorMessages));
        }
        data = validationResult.data;
      }

      // Automatically assign hub_id if not provided, based on user's state
      if (!data.hub_id && request.user!.stateId) {
        const userHub = await queryOne<{ id: string }>(
          'SELECT id FROM state_hubs WHERE state_id = $1',
          [request.user!.stateId]
        );
        if (userHub) {
          data.hub_id = userHub.id;
        }
      }

      const post = await queryOne(
        `INSERT INTO community_posts (author_user_id, hub_id, category, title, body, media_files)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          userId,
          data.hub_id || null,
          data.post_type,
          data.title,
          data.content,
          JSON.stringify(mediaFiles),
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
         JOIN users u ON p.author_user_id = u.id
         LEFT JOIN state_hubs sh ON p.hub_id = sh.id
         LEFT JOIN states s ON sh.state_id = s.id
         WHERE p.id = $1 AND p.is_hidden = false`,
        [id]
      );

      if (!post) {
        return reply.status(404).send(errorResponse('Post not found'));
      }

      // Check visibility: if post belongs to a hub, user must be in that state (unless super admin)
      if (request.user && request.user.role !== 'super_admin' && (post as any).hub_id) {
        const userHub = await queryOne<{ id: string }>(
          'SELECT id FROM state_hubs WHERE state_id = $1',
          [request.user.stateId]
        );
        
        if (!userHub || userHub.id !== (post as any).hub_id) {
          return reply.status(403).send(errorResponse('This post belongs to another state and is not accessible to you.'));
        }
      }

      // Increment view count
      await query('UPDATE community_posts SET view_count = view_count + 1 WHERE id = $1', [id]);

      // Get comments
      const comments = await query(
        `SELECT c.*, u.full_name as author_name, u.avatar_url as author_avatar
         FROM community_comments c
         JOIN users u ON c.author_user_id = u.id
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
        `INSERT INTO community_comments (post_id, author_user_id, body, parent_comment_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [id, userId, data.content, data.parent_comment_id || null]
      );

      // Update post comment count
      await query('UPDATE community_posts SET comments_count = comments_count + 1 WHERE id = $1', [id]);

      // Notify post author
      const postAuthor = await queryOne('SELECT author_user_id FROM community_posts WHERE id = $1', [id]);
      if (postAuthor && postAuthor.author_user_id !== userId) {
        await query(
          'INSERT INTO notifications (user_id, type, title, body, data_json) VALUES ($1, $2, $3, $4, $5)',
          [postAuthor.author_user_id, 'post_comment', 'New Comment', 'Someone commented on your post', JSON.stringify({ post_id: id, comment_id: comment?.id })]
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
        await query('UPDATE community_posts SET likes_count = likes_count - 1 WHERE id = $1', [id]);
        return reply.send(successResponse(null, 'Like removed'));
      }

      // Like
      await query(
        'INSERT INTO post_reactions (post_id, user_id) VALUES ($1, $2)',
        [id, userId]
      );
      await query('UPDATE community_posts SET likes_count = likes_count + 1 WHERE id = $1', [id]);

      return reply.send(successResponse(null, 'Post liked'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to react', error.message));
    }
  });

}
