import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../../database/database';
import { authenticateToken, requireAuth, requireSuperAdmin } from '../../middlewares/auth';
import { successResponse, errorResponse, paginatedResponse } from '../../utils/response';

export default async function referralRoutes(fastify: FastifyInstance) {
  // GET /api/referrals/me - Get user's referral stats
  fastify.get('/me', { preHandler: [authenticateToken, requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;

      // Get user's referral code
      const user = await queryOne<{ referral_code: string }>(
        'SELECT referral_code FROM users WHERE id = $1',
        [userId]
      );

      if (!user) {
        return reply.status(404).send(errorResponse('User not found'));
      }

      // Get referral stats
      const stats = await queryOne(
        `SELECT 
          COUNT(*) FILTER (WHERE status = 'clicked')::int as clicked,
          COUNT(*) FILTER (WHERE status = 'signed_up')::int as signed_up,
          COUNT(*) FILTER (WHERE status = 'paid')::int as paid,
          COUNT(*) FILTER (WHERE status = 'rewarded')::int as rewarded,
          COALESCE(SUM(reward_amount), 0) as total_rewards
         FROM referrals 
         WHERE referrer_user_id = $1`,
        [userId]
      );

      // Get referral list with details
      const referrals = await query(
        `SELECT r.*, u.full_name as referred_name, u.created_at as signup_date
         FROM referrals r
         JOIN users u ON r.referred_user_id = u.id
         WHERE r.referrer_user_id = $1
         ORDER BY r.created_at DESC`,
        [userId]
      );

      return reply.send(successResponse({
        referral_code: user.referral_code,
        referral_link: `${process.env.FRONTEND_URL}/register?ref=${user.referral_code}`,
        stats,
        referrals,
      }));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch referrals', error.message));
    }
  });

  // GET /api/referrals/leaderboard - Get top referrers
  fastify.get('/leaderboard', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { limit = '10' } = request.query as any;

      const leaders = await query(
        `SELECT 
          u.id,
          u.full_name,
          u.avatar_url,
          s.name as state_name,
          COUNT(r.id) FILTER (WHERE r.status = 'rewarded')::int as successful_referrals,
          COALESCE(SUM(r.reward_amount), 0) as total_rewards
         FROM users u
         LEFT JOIN referrals r ON r.referrer_user_id = u.id
         LEFT JOIN states s ON u.state_id = s.id
         WHERE r.status = 'rewarded' OR r.id IS NULL
         GROUP BY u.id, u.full_name, u.avatar_url, s.name
         HAVING COUNT(r.id) FILTER (WHERE r.status = 'rewarded') > 0
         ORDER BY successful_referrals DESC
         LIMIT $1`,
        [parseInt(limit)]
      );

      return reply.send(successResponse(leaders));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch leaderboard', error.message));
    }
  });

  // POST /api/referrals/track-click - Track referral link click
  fastify.post('/track-click', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { referral_code, ip_address, user_agent } = request.body as any;

      // Get referrer user
      const referrer = await queryOne<{ id: string }>(
        'SELECT id FROM users WHERE referral_code = $1',
        [referral_code]
      );

      if (!referrer) {
        return reply.status(404).send(errorResponse('Invalid referral code'));
      }

      // Track click
      await query(
        `INSERT INTO referral_clicks (referrer_user_id, ip_address, user_agent, clicked_at)
         VALUES ($1, $2, $3, $4)`,
        [referrer.id, ip_address || null, user_agent || null, new Date().toISOString()]
      );

      return reply.send(successResponse(null, 'Click tracked'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to track click', error.message));
    }
  });

  // GET /api/referrals/admin/stats - Admin referral stats
  fastify.get('/admin/stats', { preHandler: [authenticateToken, requireSuperAdmin] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await queryOne(
        `SELECT 
          COUNT(*) FILTER (WHERE status = 'clicked')::int as total_clicks,
          COUNT(*) FILTER (WHERE status = 'signed_up')::int as total_signups,
          COUNT(*) FILTER (WHERE status = 'paid')::int as total_paid,
          COUNT(*) FILTER (WHERE status = 'rewarded')::int as total_rewarded,
          COALESCE(SUM(reward_amount), 0) as total_rewards_given
         FROM referrals`
      );

      return reply.send(successResponse(stats));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch stats', error.message));
    }
  });
}
