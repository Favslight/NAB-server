import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, queryOne, transaction, getClient } from '../../database/database';
import { authenticateToken, requireAuth, requireMember } from '../../middlewares/auth';
import { validateBody } from '../../middlewares/validation';
import { successResponse, errorResponse } from '../../utils/response';
import { config } from '../../config';

const initiatePaymentSchema = z.object({
  membership_type: z.enum(['basic', 'premium', 'lifetime']),
  referral_code: z.string().optional(),
});

// Verify Paystack webhook signature
function verifyPaystackSignature(payload: string, signature: string, secret: string): boolean {
  const crypto = require('crypto');
  const hash = crypto.createHmac('sha512', secret).update(payload).digest('hex');
  return hash === signature;
}

// Get membership amount based on type
function getMembershipAmount(type: string): number {
  const amounts: Record<string, number> = {
    basic: 5000,
    premium: 15000,
    lifetime: 50000,
  };
  return amounts[type] || 5000;
}

export default async function paymentRoutes(fastify: FastifyInstance) {
  // POST /api/payments/initiate - Initiate a payment
  fastify.post('/initiate', { preHandler: [authenticateToken, requireAuth, validateBody(initiatePaymentSchema)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { membership_type, referral_code } = request.body as z.infer<typeof initiatePaymentSchema>;
      const userId = request.user!.userId;

      // Get user details
      const user = await queryOne<{ id: string; email: string; full_name: string }>(
        'SELECT id, email, full_name FROM users WHERE id = $1',
        [userId]
      );

      if (!user) {
        return reply.status(404).send(errorResponse('User not found'));
      }

      // Check if user already has an active membership
      const existingMembership = await queryOne(
        'SELECT id FROM memberships WHERE user_id = $1 AND status = $2 AND expires_at > NOW()',
        [userId, 'active']
      );

      if (existingMembership) {
        return reply.status(400).send(errorResponse('User already has an active membership'));
      }

      const amount = getMembershipAmount(membership_type);
      const reference = `NAB-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      // Create pending transaction
      await query(
        `INSERT INTO transactions (user_id, reference, amount, currency, status, metadata_json, payment_method, transaction_type)
         VALUES ($1, $2, $3, 'NGN', 'pending', $4, 'paystack', 'membership')`,
        [userId, reference, amount, JSON.stringify({ membership_type, referral_code: referral_code || null })]
      );

      // Initialize Paystack transaction
      const response = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.paystack.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: user.email,
          amount: amount * 100, // Paystack uses kobo
          reference,
          callback_url: `${config.app.frontendUrl}/payment/verify`,
          metadata: {
            user_id: userId,
            membership_type,
            referral_code: referral_code || null,
          },
        }),
      });

      const paystackData = await response.json() as { status: boolean; message?: string; data?: { authorization_url: string; access_code: string } };

      if (!paystackData.status || !paystackData.data) {
        return reply.status(400).send(errorResponse('Failed to initialize payment', paystackData.message));
      }

      return reply.send(successResponse({
        authorization_url: paystackData.data!.authorization_url,
        reference,
        access_code: paystackData.data!.access_code,
      }, 'Payment initiated'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to initiate payment', error.message));
    }
  });

  // POST /api/payments/webhook/paystack - Paystack webhook
  fastify.post('/webhook/paystack', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const signature = request.headers['x-paystack-signature'] as string;
      const payload = JSON.stringify(request.body);

      // Verify webhook signature
      if (!verifyPaystackSignature(payload, signature, config.paystack.webhookSecret)) {
        return reply.status(401).send(errorResponse('Invalid webhook signature'));
      }

      const event = request.body as any;

      if (event.event === 'charge.success') {
        const { reference, metadata, customer } = event.data;
        const userId = metadata?.user_id;
        const membershipType = metadata?.membership_type || 'basic';
        const referralCode = metadata?.referral_code;

        await transaction(async (client) => {
          // Update transaction status
          await client.query(
            'UPDATE transactions SET status = $1, gateway_response_json = $2, paid_at = $3 WHERE reference = $4',
            ['success', JSON.stringify(event.data), new Date().toISOString(), reference]
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
          await client.query(
            `INSERT INTO memberships (user_id, status, type, amount_paid, starts_at, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (user_id) DO UPDATE SET
               status = $2,
               type = $3,
               amount_paid = $4,
               starts_at = $5,
               expires_at = $6`,
            [userId, 'active', membershipType, event.data.amount / 100, now.toISOString(), expiresAt.toISOString()]
          );

          // Update user role to member
          await client.query(
            "UPDATE users SET role = CASE WHEN role = 'guest' THEN 'member' ELSE role END, status = 'membership_active' WHERE id = $1",
            [userId]
          );

          // Handle referral reward if applicable
          if (referralCode) {
            const referrer = await client.query(
              'SELECT id FROM users WHERE referral_code = $1',
              [referralCode]
            );

            if (referrer.rows[0]) {
              // Update referral status to rewarded
              await client.query(
                "UPDATE referrals SET status = 'rewarded', rewarded_at = $1 WHERE referred_user_id = $2",
                [new Date().toISOString(), userId]
              );

              // Credit referrer (simplified - you might want to add proper reward logic)
              await client.query(
                'UPDATE users SET referral_reward_balance = referral_reward_balance + 500 WHERE id = $1',
                [referrer.rows[0].id]
              );
            }
          }

          // Create notification
          await client.query(
            'INSERT INTO notifications (user_id, type, title, body, data_json) VALUES ($1, $2, $3, $4, $5)',
            [userId, 'membership_activated', 'Membership Activated', `Your ${membershipType} membership is now active.`, JSON.stringify({ membership_type: membershipType, reference })]
          );
        });
      }

      return reply.send({ received: true });

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Webhook processing failed', error.message));
    }
  });

  // GET /api/payments/verify/:reference - Verify payment status
  fastify.get('/verify/:reference', { preHandler: authenticateToken }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { reference } = request.params as { reference: string };

      // Verify with Paystack
      const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: {
          Authorization: `Bearer ${config.paystack.secretKey}`,
        },
      });

      const verifyData = await response.json() as { status: boolean; data?: { status: string; amount: number; paid_at: string; channel: string } };

      if (!verifyData.status || !verifyData.data) {
        return reply.status(400).send(errorResponse('Failed to verify payment'));
      }

      // Update local transaction
      await query(
        'UPDATE transactions SET status = $1, gateway_response_json = $2 WHERE reference = $3',
        [verifyData.data!.status, JSON.stringify(verifyData.data), reference]
      );

      return reply.send(successResponse({
        status: verifyData.data!.status,
        amount: verifyData.data!.amount / 100,
        paid_at: verifyData.data!.paid_at,
        channel: verifyData.data!.channel,
      }));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to verify payment', error.message));
    }
  });

  // GET /api/payments/history - Get user's payment history
  fastify.get('/history', { preHandler: [authenticateToken, requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = request.user!.userId;

      const transactions = await query(
        'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC',
        [userId]
      );

      return reply.send(successResponse(transactions));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch payment history', error.message));
    }
  });
}
