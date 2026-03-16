import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { query, queryOne } from '../../database/database';
import { User } from '../../database/types';
import { hashPassword, comparePassword } from '../../utils/password';
import { generateReferralCode, generateIdNo, generateEmailVerificationToken } from '../../utils/helpers';
import { successResponse, errorResponse } from '../../utils/response';
import { validateBody } from '../../middlewares/validation';
import { authenticateToken } from '../../middlewares/auth';
import { isMembershipFeeEnabled, isGuestLoginEnabled } from '../../utils/settings';

// Schemas
const registerSchema = z.object({
  full_name: z.string().min(2).max(255),
  email: z.string().email(),
  phone: z.string().min(10).max(20).optional(),
  password: z.string().min(8).max(100),
  state_id: z.string().uuid(),
  profession: z.string().max(100).optional(),
  referral_code: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email().optional(),
  id_no: z.string().optional(),
  password: z.string().min(1),
}).refine((data: { email?: string; id_no?: string }) => data.email || data.id_no, {
  message: "Either email or id_no must be provided",
});

const guestLoginSchema = z.object({
  full_name: z.string().min(2).max(255),
  state_id: z.string().uuid(),
});

const verifyEmailSchema = z.object({
  token: z.string(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(8).max(100),
});

export default async function authRoutes(fastify: FastifyInstance) {
  // POST /api/auth/register
  fastify.post('/register', { preHandler: validateBody(registerSchema) }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = request.body as z.infer<typeof registerSchema>;

      // Check if email already exists
      const existingEmail = await queryOne('SELECT id FROM users WHERE email = $1', [data.email]);

      if (existingEmail) {
        return reply.status(409).send(errorResponse('Email already registered'));
      }

      // Check if phone already exists (if provided)
      if (data.phone) {
        const existingPhone = await queryOne('SELECT id FROM users WHERE phone = $1', [data.phone]);

        if (existingPhone) {
          return reply.status(409).send(errorResponse('Phone number already registered'));
        }
      }

      // Get state for ID generation
      const state = await queryOne<{ slug: string }>('SELECT slug FROM states WHERE id = $1', [data.state_id]);

      if (!state) {
        return reply.status(400).send(errorResponse('Invalid state'));
      }

      // Get next ID number for this state
      const counterResult = await queryOne<{ current_number: number }>(
        `INSERT INTO state_counters (state_id, current_number) VALUES ($1, 1)
         ON CONFLICT (state_id) DO UPDATE SET current_number = state_counters.current_number + 1
         RETURNING current_number`,
        [data.state_id]
      );

      const idNo = generateIdNo(state.slug, counterResult?.current_number || 1);

      // Generate referral code
      const referralCode = generateReferralCode(data.full_name);

      // Hash password
      const passwordHash = await hashPassword(data.password);

      // Generate email verification token
      const verificationToken = generateEmailVerificationToken();

      // Check if this is the first user for this state (for auto state_admin)
      const userCount = await queryOne<{ count: number }>(
        'SELECT COUNT(*)::int as count FROM users WHERE state_id = $1',
        [data.state_id]
      );

      const isFirstInState = (userCount?.count || 0) === 0;

      // Check if membership fee is enabled
      const feeEnabled = await isMembershipFeeEnabled();

      // Determine role and status based on payment setting
      const userRole = isFirstInState ? 'state_admin' : (feeEnabled ? 'guest' : 'member');
      const userStatus = feeEnabled ? 'pending_verification' : 'membership_active';

      // Create user
      const newUser = await queryOne<User>(
        `INSERT INTO users (id_no, full_name, email, phone, password_hash, state_id, profession, role, status, referral_code, email_verification_token)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          idNo,
          data.full_name,
          data.email,
          data.phone || null,
          passwordHash,
          data.state_id,
          data.profession || null,
          userRole,
          userStatus,
          referralCode,
          verificationToken,
        ]
      );

      if (!newUser) {
        return reply.status(500).send(errorResponse('Failed to create user'));
      }

      // Handle referral if provided
      if (data.referral_code) {
        await query(
          'INSERT INTO referrals (referrer_user_id, referred_user_id, referral_code_used, status) VALUES ((SELECT id FROM users WHERE referral_code = $1), $2, $3, $4)',
          [data.referral_code, newUser.id, data.referral_code, 'signed_up']
        );
      }

      // If membership is free, create membership record immediately
      if (!feeEnabled && !isFirstInState) {
        await query(
          `INSERT INTO memberships (user_id, plan_type, amount_paid, status, starts_at, expires_at)
           VALUES ($1, 'standard_member', 0, 'active', $2, $3)`,
          [newUser.id, new Date().toISOString(), new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()]
        );
      }

      // Generate JWT
      const token = fastify.jwt.sign({
        userId: newUser.id,
        email: newUser.email || '',
        role: newUser.role,
        stateId: newUser.state_id,
      });

      const message = feeEnabled 
        ? 'Registration successful. Please verify your email and complete payment to become a member.'
        : 'Registration successful. You are now a member! Please verify your email.';

      return reply.status(201).send(successResponse({
        user: {
          id: newUser.id,
          id_no: newUser.id_no,
          full_name: newUser.full_name,
          email: newUser.email,
          role: newUser.role,
          status: newUser.status,
          referral_code: newUser.referral_code,
        },
        token,
        requiresPayment: feeEnabled && !isFirstInState,
      }, message));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Registration failed', error.message));
    }
  });

  // POST /api/auth/login
  fastify.post('/login', { preHandler: validateBody(loginSchema) }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = request.body as z.infer<typeof loginSchema>;

      // Find user by email or id_no
      let sql = 'SELECT * FROM users WHERE ';
      let params: any[] = [];

      if (data.email) {
        sql += 'email = $1';
        params = [data.email];
      } else if (data.id_no) {
        sql += 'id_no = $1';
        params = [data.id_no];
      }

      const user = await queryOne<User>(sql, params);

      if (!user) {
        return reply.status(401).send(errorResponse('Invalid credentials'));
      }

      // Check if account is locked
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        return reply.status(401).send(errorResponse('Account temporarily locked. Please try again later.'));
      }

      // Verify password
      const validPassword = await comparePassword(data.password, user.password_hash || '');

      if (!validPassword) {
        // Increment login attempts
        const newAttempts = (user.login_attempts || 0) + 1;

        if (newAttempts >= 5) {
          const lockedUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
          await query(
            'UPDATE users SET login_attempts = $1, locked_until = $2 WHERE id = $3',
            [newAttempts, lockedUntil, user.id]
          );
        } else {
          await query(
            'UPDATE users SET login_attempts = $1 WHERE id = $2',
            [newAttempts, user.id]
          );
        }

        return reply.status(401).send(errorResponse('Invalid credentials'));
      }

      // Reset login attempts on successful login
      await query(
        'UPDATE users SET login_attempts = 0, locked_until = NULL, last_login_at = $1 WHERE id = $2',
        [new Date().toISOString(), user.id]
      );

      // Generate JWT
      const token = fastify.jwt.sign({
        userId: user.id,
        email: user.email || '',
        role: user.role,
        stateId: user.state_id,
      });

      return reply.send(successResponse({
        user: {
          id: user.id,
          id_no: user.id_no,
          full_name: user.full_name,
          email: user.email,
          role: user.role,
          status: user.status,
          referral_code: user.referral_code,
          avatar_url: user.avatar_url,
        },
        token,
      }, 'Login successful'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Login failed', error.message));
    }
  });

  // POST /api/auth/guest-login
  fastify.post('/guest-login', { preHandler: validateBody(guestLoginSchema) }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!await isGuestLoginEnabled()) {
        return reply.status(403).send(errorResponse('Guest login is disabled'));
      }

      const data = request.body as z.infer<typeof guestLoginSchema>;

      // Get state for ID generation
      const state = await queryOne<{ slug: string }>('SELECT slug FROM states WHERE id = $1', [data.state_id]);

      if (!state) {
        return reply.status(400).send(errorResponse('Invalid state'));
      }

      // Get next ID number for this state
      const counterResult = await queryOne<{ current_number: number }>(
        `INSERT INTO state_counters (state_id, current_number) VALUES ($1, 1)
         ON CONFLICT (state_id) DO UPDATE SET current_number = state_counters.current_number + 1
         RETURNING current_number`,
        [data.state_id]
      );

      const idNo = generateIdNo(state.slug, counterResult?.current_number || 1);

      // Generate referral code
      const referralCode = generateReferralCode(data.full_name);

      // Create guest user
      const newUser = await queryOne<User>(
        `INSERT INTO users (id_no, full_name, email, phone, password_hash, state_id, role, status, referral_code)
         VALUES ($1, $2, NULL, NULL, NULL, $3, 'guest', 'pending_verification', $4)
         RETURNING *`,
        [idNo, data.full_name, data.state_id, referralCode]
      );

      if (!newUser) {
        return reply.status(500).send(errorResponse('Failed to create guest user'));
      }

      // Generate JWT
      const token = fastify.jwt.sign({
        userId: newUser.id,
        email: '',
        role: 'guest',
        stateId: newUser.state_id,
      });

      return reply.status(201).send(successResponse({
        user: {
          id: newUser.id,
          id_no: newUser.id_no,
          full_name: newUser.full_name,
          role: 'guest',
          status: newUser.status,
          referral_code: newUser.referral_code,
        },
        token,
        isGuest: true,
      }, 'Guest access granted. Dashboard is locked until you complete registration.'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Guest login failed', error.message));
    }
  });

  // POST /api/auth/verify-email
  fastify.post('/verify-email', { preHandler: validateBody(verifyEmailSchema) }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { token } = request.body as z.infer<typeof verifyEmailSchema>;

      const user = await queryOne<User>(
        'SELECT * FROM users WHERE email_verification_token = $1',
        [token]
      );

      if (!user) {
        return reply.status(400).send(errorResponse('Invalid or expired verification token'));
      }

      // Update user as verified
      const newStatus = user.status === 'pending_verification' ? 'verified' : user.status;
      await query(
        'UPDATE users SET email_verified_at = $1, email_verification_token = NULL, status = $2 WHERE id = $3',
        [new Date().toISOString(), newStatus, user.id]
      );

      return reply.send(successResponse(null, 'Email verified successfully'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Email verification failed', error.message));
    }
  });

  // POST /api/auth/forgot-password
  fastify.post('/forgot-password', { preHandler: validateBody(forgotPasswordSchema) }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { email } = request.body as z.infer<typeof forgotPasswordSchema>;

      const user = await queryOne<{ id: string; email: string }>(
        'SELECT id, email FROM users WHERE email = $1',
        [email]
      );

      if (!user) {
        return reply.send(successResponse(null, 'If an account exists, a password reset email has been sent'));
      }

      // Generate reset token
      const resetToken = generateEmailVerificationToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      await query(
        'UPDATE users SET password_reset_token = $1, password_reset_expires_at = $2 WHERE id = $3',
        [resetToken, expiresAt, user.id]
      );

      return reply.send(successResponse(null, 'If an account exists, a password reset email has been sent'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to process request', error.message));
    }
  });

  // POST /api/auth/reset-password
  fastify.post('/reset-password', { preHandler: validateBody(resetPasswordSchema) }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { token, password } = request.body as z.infer<typeof resetPasswordSchema>;

      const user = await queryOne<{ id: string; password_reset_expires_at: string }>(
        'SELECT id, password_reset_expires_at FROM users WHERE password_reset_token = $1',
        [token]
      );

      if (!user) {
        return reply.status(400).send(errorResponse('Invalid or expired reset token'));
      }

      if (user.password_reset_expires_at && new Date(user.password_reset_expires_at) < new Date()) {
        return reply.status(400).send(errorResponse('Reset token has expired'));
      }

      // Hash new password
      const passwordHash = await hashPassword(password);

      await query(
        'UPDATE users SET password_hash = $1, password_reset_token = NULL, password_reset_expires_at = NULL WHERE id = $2',
        [passwordHash, user.id]
      );

      return reply.send(successResponse(null, 'Password reset successful'));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Password reset failed', error.message));
    }
  });

  // GET /api/auth/me
  fastify.get('/me', { preHandler: authenticateToken }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = await queryOne<User & { state_name: string; state_slug: string }>(
        `SELECT u.*, s.name as state_name, s.slug as state_slug
         FROM users u
         LEFT JOIN states s ON u.state_id = s.id
         WHERE u.id = $1`,
        [request.user!.userId]
      );

      if (!user) {
        return reply.status(404).send(errorResponse('User not found'));
      }

      // Get active membership if any
      const membership = await queryOne(
        'SELECT * FROM memberships WHERE user_id = $1 AND status = $2',
        [user.id, 'active']
      );

      return reply.send(successResponse({
        ...user,
        membership: membership || null,
      }));

    } catch (error: any) {
      request.log.error(error);
      return reply.status(500).send(errorResponse('Failed to get user', error.message));
    }
  });
}
