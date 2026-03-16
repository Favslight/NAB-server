import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../../database/database';
import { authenticateToken, optionalAuth, requireMember, requireStateAdmin } from '../../middlewares/auth';
import { validateBody, validateQuery } from '../../middlewares/validation';
import { successResponse, paginatedResponse, errorResponse } from '../../utils/response';
import { uploadImage, uploadVideo, deleteFile } from '../../utils/cloudinary';
import { slugify } from '../../utils/helpers';

const createProductSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  category: z.string().max(50).optional(),
  website_url: z.string().url().optional(),
  demo_url: z.string().url().optional(),
});

const updateProductSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  category: z.string().max(50).optional(),
  website_url: z.string().url().optional().nullable(),
  demo_url: z.string().url().optional().nullable(),
});

const paginationSchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).default('20'),
  category: z.string().optional(),
  status: z.enum(['pending_review', 'approved', 'published']).optional(),
});

export default async function productRoutes(fastify: FastifyInstance) {
  // GET /api/products - List products
  fastify.get('/', { preHandler: [optionalAuth, validateQuery(paginationSchema)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { page, limit, category, status } = request.query as any;

      let sql = `SELECT p.*, u.full_name as user_name, u.avatar_url as user_avatar
                 FROM products p
                 JOIN users u ON p.user_id = u.id
                 WHERE p.status = $1`;
      let countSql = 'SELECT COUNT(*)::int as count FROM products WHERE status = $1';
      const params: any[] = [status || 'published'];
      let paramIndex = 1;

      if (category) {
        paramIndex++;
        sql += ` AND p.category = $${paramIndex}`;
        countSql += ` AND category = $${paramIndex}`;
        params.push(category);
      }

      sql += ` ORDER BY p.featured_at DESC NULLS LAST, p.created_at DESC LIMIT $${++paramIndex} OFFSET $${++paramIndex}`;
      params.push(limit, (page - 1) * limit);

      const [products, countResult] = await Promise.all([
        query(sql, params),
        queryOne<{ count: number }>(countSql, params.slice(0, params.length - 2))
      ]);

      return reply.send(paginatedResponse(products || [], countResult?.count || 0, page, limit));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch products', error.message));
    }
  });

  // GET /api/products/:slug - Get product by slug
  fastify.get('/:slug', { preHandler: optionalAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { slug } = request.params as { slug: string };

      const product = await queryOne(
        `SELECT p.*, u.full_name as user_name, u.avatar_url as user_avatar, s.name as state_name
         FROM products p
         JOIN users u ON p.user_id = u.id
         LEFT JOIN states s ON u.state_id = s.id
         WHERE p.slug = $1`,
        [slug]
      );

      if (!product) {
        return reply.status(404).send(errorResponse('Product not found'));
      }

      if (product.status !== 'published') {
        const user = request.user;
        if (!user || (user.userId !== product.user_id && !['state_admin', 'super_admin'].includes(user.role))) {
          return reply.status(404).send(errorResponse('Product not found'));
        }
      }

      // Get media
      const media = await query('SELECT * FROM product_media WHERE product_id = $1', [product.id]);

      // Increment view count
      await query('UPDATE products SET view_count = view_count + 1 WHERE id = $1', [product.id]);

      return reply.send(successResponse({ ...product, media: media || [] }));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to get product', error.message));
    }
  });

  // POST /api/products - Create product
  fastify.post('/', { 
    preHandler: [authenticateToken, requireMember, validateBody(createProductSchema)] 
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = request.body as z.infer<typeof createProductSchema>;
      const userId = request.user!.userId;

      // Generate unique slug
      let baseSlug = slugify(data.name);
      let slug = baseSlug;
      let counter = 1;
      
      while (true) {
        const existing = await queryOne('SELECT id FROM products WHERE slug = $1', [slug]);
        if (!existing) break;
        slug = `${baseSlug}-${counter}`;
        counter++;
      }

      const product = await queryOne(
        `INSERT INTO products (user_id, name, slug, description, category, website_url, demo_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_review')
         RETURNING *`,
        [
          userId,
          data.name,
          slug,
          data.description || null,
          data.category || null,
          data.website_url || null,
          data.demo_url || null,
        ]
      );

      return reply.status(201).send(successResponse(product, 'Product submitted for review'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to create product', error.message));
    }
  });

  // PUT /api/products/:id - Update product
  fastify.put('/:id', { 
    preHandler: [authenticateToken, requireMember, validateBody(updateProductSchema)] 
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const data = request.body as z.infer<typeof updateProductSchema>;
      const userId = request.user!.userId;
      const userRole = request.user!.role;

      // Check ownership
      const existing = await queryOne<{ user_id: string }>('SELECT user_id FROM products WHERE id = $1', [id]);

      if (!existing) {
        return reply.status(404).send(errorResponse('Product not found'));
      }

      if (existing.user_id !== userId && !['state_admin', 'super_admin'].includes(userRole)) {
        return reply.status(403).send(errorResponse('Not authorized to edit this product'));
      }

      // Build dynamic update
      const updates: string[] = [];
      const params: any[] = [];
      let paramIndex = 0;

      if (data.name !== undefined) {
        updates.push(`name = $${++paramIndex}`);
        params.push(data.name);
      }
      if (data.description !== undefined) {
        updates.push(`description = $${++paramIndex}`);
        params.push(data.description);
      }
      if (data.category !== undefined) {
        updates.push(`category = $${++paramIndex}`);
        params.push(data.category);
      }
      if (data.website_url !== undefined) {
        updates.push(`website_url = $${++paramIndex}`);
        params.push(data.website_url);
      }
      if (data.demo_url !== undefined) {
        updates.push(`demo_url = $${++paramIndex}`);
        params.push(data.demo_url);
      }

      if (updates.length === 0) {
        return reply.status(400).send(errorResponse('No fields to update'));
      }

      updates.push(`updated_at = $${++paramIndex}`);
      params.push(new Date().toISOString());
      params.push(id);

      const product = await queryOne(
        `UPDATE products SET ${updates.join(', ')} WHERE id = $${paramIndex + 1} RETURNING *`,
        params
      );

      return reply.send(successResponse(product, 'Product updated successfully'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to update product', error.message));
    }
  });

  // POST /api/products/:id/media - Upload product media
  fastify.post('/:id/media', { preHandler: [authenticateToken, requireMember] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const userId = request.user!.userId;
      const userRole = request.user!.role;

      // Check ownership
      const product = await queryOne<{ user_id: string }>('SELECT user_id FROM products WHERE id = $1', [id]);

      if (!product) {
        return reply.status(404).send(errorResponse('Product not found'));
      }

      if (product.user_id !== userId && !['state_admin', 'super_admin'].includes(userRole)) {
        return reply.status(403).send(errorResponse('Not authorized to upload media to this product'));
      }

      // Get file from multipart request
      const file = await request.file();
      if (!file) {
        return reply.status(400).send(errorResponse('No file provided'));
      }

      const buffer = await file.toBuffer();
      const mediaType = file.mimetype.startsWith('video/') ? 'video' : 'image';

      // Upload to Cloudinary
      const uploadResult = mediaType === 'video' 
        ? await uploadVideo(buffer, 'products')
        : await uploadImage(buffer, 'products');

      // Save to database
      const media = await queryOne(
        'INSERT INTO product_media (product_id, media_type, url) VALUES ($1, $2, $3) RETURNING *',
        [id, mediaType, uploadResult.url]
      );

      return reply.status(201).send(successResponse(media, 'Media uploaded successfully'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to upload media', error.message));
    }
  });
}
