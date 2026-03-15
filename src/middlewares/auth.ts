import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config';
import { JWTPayload, UserRole } from '../database/types';

// Extend Fastify types
declare module 'fastify' {
  interface FastifyRequest {
    user?: JWTPayload;
  }
}

// JWT authentication middleware
export async function authenticateToken(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const authHeader = request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        success: false,
        message: 'Access token required',
      });
    }
    
    const token = authHeader.substring(7);
    
    // Verify JWT using Fastify's JWT plugin
    const decoded = await request.jwtVerify<JWTPayload>();
    request.user = decoded;
    
  } catch (error) {
    return reply.status(401).send({
      success: false,
      message: 'Invalid or expired token',
    });
  }
}

// Role-based authorization middleware factory
export function requireRole(...allowedRoles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        message: 'Authentication required',
      });
    }
    
    if (!allowedRoles.includes(request.user.role as UserRole)) {
      return reply.status(403).send({
        success: false,
        message: 'Insufficient permissions',
      });
    }
  };
}

// Require authentication (any role)
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
) {
  if (!request.user) {
    return reply.status(401).send({
      success: false,
      message: 'Authentication required',
    });
  }
}

// Require member or higher role
export const requireMember = requireRole('member', 'premium_builder', 'state_admin', 'super_admin');

// Require premium builder or higher
export const requirePremium = requireRole('premium_builder', 'state_admin', 'super_admin');

// Require state admin or super admin
export const requireStateAdmin = requireRole('state_admin', 'super_admin');

// Require super admin only
export const requireSuperAdmin = requireRole('super_admin');

// Optional auth - sets user if token valid, doesn't fail if not
export async function optionalAuth(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const authHeader = request.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const decoded = await request.jwtVerify<JWTPayload>();
      request.user = decoded;
    }
  } catch (error) {
    // Silently ignore auth errors for optional auth
  }
}
