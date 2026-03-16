import Fastify, { FastifyInstance, FastifyError } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';

import { config } from './config';

// Import route modules
import authRoutes from './modules/auth/routes';
import userRoutes from './modules/users/routes';
import paymentRoutes from './modules/payments/routes';
import referralRoutes from './modules/referrals/routes';
import communityRoutes from './modules/community/routes';
import moderationRoutes from './modules/moderation/routes';
import trainingRoutes from './modules/trainings/routes';
import programRoutes from './modules/program/routes';
import productRoutes from './modules/products/routes';
import notificationRoutes from './modules/notifications/routes';
import adminRoutes from './modules/admin/routes';

async function buildServer(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: config.logLevel,
    },
    trustProxy: true,
  });

  // Register plugins
  // CORS
  await fastify.register(cors, {
    origin: "*",
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Security headers
  await fastify.register(helmet, {
    contentSecurityPolicy: false,
  });

  // JWT
  await fastify.register(jwt, {
    secret: config.jwt.secret,
    sign: {
      expiresIn: config.jwt.expiresIn,
    },
  });

  // Rate limiting
  await fastify.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    skipOnError: true,
    keyGenerator: (req) => {
      return req.headers['x-forwarded-for'] as string || req.ip;
    },
    errorResponseBuilder: (req, context) => {
      return {
        success: false,
        message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
      };
    },
  });

  // Multipart for file uploads
  await fastify.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
      files: 5,
    },
  });

  // Health check endpoint
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // API version
  fastify.get('/', async () => {
    return {
      name: 'Nigerian AI Builders API',
      version: '1.0.0',
      status: 'running',
      documentation: '/docs',
    };
  });

  // Register route modules
  await fastify.register(authRoutes, { prefix: '/api/auth' });
  await fastify.register(userRoutes, { prefix: '/api/users' });
  await fastify.register(paymentRoutes, { prefix: '/api/payments' });
  await fastify.register(referralRoutes, { prefix: '/api/referrals' });
  await fastify.register(communityRoutes, { prefix: '/api/community' });
  await fastify.register(moderationRoutes, { prefix: '/api/moderation' });
  await fastify.register(trainingRoutes, { prefix: '/api/trainings' });
  await fastify.register(programRoutes, { prefix: '/api/program' });
  await fastify.register(productRoutes, { prefix: '/api/products' });
  await fastify.register(notificationRoutes, { prefix: '/api/notifications' });
  await fastify.register(adminRoutes, { prefix: '/api/admin' });

  // Global error handler
  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error(error);

    // Handle validation errors
    if (error.validation) {
      return reply.status(400).send({
        success: false,
        message: 'Validation error',
        error: error.message,
      });
    }

    // Handle JWT errors
    if (error.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER') {
      return reply.status(401).send({
        success: false,
        message: 'Authorization header required',
      });
    }

    // Default error response
    return reply.status(error.statusCode || 500).send({
      success: false,
      message: error.message || 'Internal server error',
      ...(config.env === 'development' && { stack: error.stack }),
    });
  });

  // 404 handler
  fastify.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      success: false,
      message: `Route ${request.method} ${request.url} not found`,
    });
  });

  return fastify;
}

async function start() {
  try {
    const server = await buildServer();

    await server.listen({
      port: config.port,
      host: config.host,
    });

    server.log.info(`Server running on http://${config.host}:${config.port}`);
    server.log.info(`Environment: ${config.env}`);
    server.log.info(`CORS enabled for: ${config.app.frontendUrl}`);

  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the server
if (require.main === module) {
  start();
}

export { buildServer };
