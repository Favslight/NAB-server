import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, queryOne, transaction, getClient } from '../../database/database';
import { authenticateToken, requireAuth, requireMember } from '../../middlewares/auth';
import { validateBody } from '../../middlewares/validation';
import { successResponse, errorResponse } from '../../utils/response';
import { config } from '../../config';
import { getMembershipPrice } from '../../utils/settings';

const initiatePaymentSchema = z.object({
  membership_type: z.enum(['basic', 'premium', 'lifetime', 'standard_member', 'ai_explorer', 'ai_builder', 'ai_product_founder']),
  referral_code: z.string().nullable().optional(),
});

const confirmManualSchema = z.object({
  invoice_number: z.string(),
});

/* Paystack code commented out for now
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
*/

export default async function paymentRoutes(fastify: FastifyInstance) {
  
  // GET /api/payments/details - Get payment details
  fastify.get('/details', { preHandler: [authenticateToken, requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const amount = await getMembershipPrice();
      return reply.send(successResponse({
        amount,
        bank: config.bank
      }, 'Payment details retrieved'));
    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to fetch payment details', error.message));
    }
  });

  // POST /api/payments/initiate - Generate invoice for manual payment
  fastify.post('/initiate', { preHandler: [authenticateToken, requireAuth, validateBody(initiatePaymentSchema)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { membership_type, referral_code } = request.body as z.infer<typeof initiatePaymentSchema>;
      const userId = request.user!.userId;

      // Get user details
      const user = await queryOne<{ id: string; email: string; full_name: string; status: string; role: string }>(
        'SELECT id, email, full_name, status, role FROM users WHERE id = $1',
        [userId]
      );

      if (!user) {
        return reply.status(404).send(errorResponse('User not found'));
      }

      // Check if user already has an active membership in the users table
      if (user.status === 'membership_active') {
        return reply.status(400).send(errorResponse('You already have an active membership.'));
      }

      // If user is already active but trying to pay, maybe they are upgrading?
      if (user.status === 'membership_active' && user.role !== 'super_admin') {
         // Maybe they are active but record is missing? We'll allow them to proceed to fix their state.
      }

      // Automatically read amount from settings
      const amount = await getMembershipPrice();
      
      // Generate invoice number
      const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      // Create pending transaction for manual transfer
      // Changed column names to match schema.sql: provider_payload_json, provider, type
      await query(
        `INSERT INTO transactions (user_id, reference, amount, currency, status, provider_payload_json, provider, type)
         VALUES ($1, $2, $3, 'NGN', 'pending', $4, 'manual', 'membership')`,
        [userId, invoiceNumber, amount, JSON.stringify({ membership_type, referral_code: referral_code || null, is_manual_transfer: true })]
      );

      /*
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
          reference: invoiceNumber,
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
        reference: invoiceNumber,
        access_code: paystackData.data!.access_code,
      }, 'Payment initiated'));
      */

      return reply.send(successResponse({
        reference: invoiceNumber,
        amount,
        bank: config.bank
      }, 'Invoice generated successfully'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to initiate payment', error.message));
    }
  });

  // POST /api/payments/confirm - Confirm manual transfer
  fastify.post('/confirm', { preHandler: [authenticateToken, requireAuth, validateBody(confirmManualSchema)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { invoice_number } = request.body as z.infer<typeof confirmManualSchema>;
      const userId = request.user!.userId;

      const existingTx = await queryOne<{ id: string; status: string; provider_payload_json: any }>(
        'SELECT id, status, provider_payload_json FROM transactions WHERE reference = $1 AND user_id = $2',
        [invoice_number, userId]
      );

      if (!existingTx) {
        return reply.status(404).send(errorResponse('Invoice not found'));
      }

      if (existingTx.status !== 'pending') {
        return reply.status(400).send(errorResponse('This invoice has already been processed or cancelled'));
      }

      // Mark the transaction payload as user confirmed so admin knows they made the transfer
      const updatedPayload = { ...existingTx.provider_payload_json, user_confirmed: true, confirmed_at: new Date().toISOString() };
      
      await query(
        `UPDATE transactions SET provider_payload_json = $1 WHERE id = $2`,
        [JSON.stringify(updatedPayload), existingTx.id]
      );

      // We could also notify the super admin here via email or db notification
      await query(
        `INSERT INTO notifications (user_id, type, title, body, data_json)
         SELECT id, 'general', 'Manual Payment Pending', 'A user has confirmed a manual transfer. Invoice: ${invoice_number}', $1
         FROM users WHERE role = 'super_admin'`,
        [JSON.stringify({ invoice_number, user_id: userId })]
      );

      return reply.send(successResponse(null, 'Payment confirmation submitted. Please wait for super admin approval.'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to confirm payment', error.message));
    }
  });

  /* Paystack webhook commented out
  // POST /api/payments/webhook/paystack - Paystack webhook
  fastify.post('/webhook/paystack', async (request: FastifyRequest, reply: FastifyReply) => {
    // ...
  });
  */

  /* Verify payment commented out
  // GET /api/payments/verify/:reference - Verify payment status
  fastify.get('/verify/:reference', { preHandler: authenticateToken }, async (request: FastifyRequest, reply: FastifyReply) => {
    // ...
  });
  */

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
