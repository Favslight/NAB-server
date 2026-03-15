import { z } from 'zod';

// Auth schemas
export const registerSchema = z.object({
  full_name: z.string().min(2).max(255),
  email: z.string().email(),
  phone: z.string().min(10).max(20).optional(),
  password: z.string().min(8).max(100),
  state_id: z.string().uuid(),
  profession: z.string().max(100).optional(),
  referral_code: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email().optional(),
  id_no: z.string().optional(),
  password: z.string().min(1),
}).refine((data) => data.email || data.id_no, {
  message: "Either email or id_no must be provided",
});

export const guestLoginSchema = z.object({
  full_name: z.string().min(2).max(255),
  state_id: z.string().uuid(),
});

export const verifyEmailSchema = z.object({
  token: z.string(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(8).max(100),
});

// User schemas
export const updateUserSchema = z.object({
  full_name: z.string().min(2).max(255).optional(),
  phone: z.string().min(10).max(20).optional(),
  profession: z.string().max(100).optional(),
  avatar_url: z.string().url().optional().nullable(),
});

// Community schemas
export const createPostSchema = z.object({
  hub_id: z.string().uuid().optional(),
  category: z.string().max(50).default('general'),
  title: z.string().min(1).max(255),
  body: z.string().min(1),
  visibility: z.enum(['public', 'members', 'state_only']).default('public'),
});

export const createCommentSchema = z.object({
  body: z.string().min(1),
  parent_comment_id: z.string().uuid().optional(),
});

// Product schemas
export const createProductSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  category: z.string().max(50).optional(),
  website_url: z.string().url().optional(),
  demo_url: z.string().url().optional(),
});

export const updateProductSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  category: z.string().max(50).optional(),
  website_url: z.string().url().optional().nullable(),
  demo_url: z.string().url().optional().nullable(),
});

// Program application schema
export const programApplicationSchema = z.object({
  cohort_id: z.string().uuid(),
  experience_level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  motivation: z.string().max(2000).optional(),
  portfolio_url: z.string().url().optional(),
  github_url: z.string().url().optional(),
  resume_url: z.string().url().optional(),
});

// Moderation schemas
export const moderationActionSchema = z.object({
  action: z.enum(['hide_post', 'suspend_user', 'mark_spam', 'feature_post']),
  reason: z.string().max(500).optional(),
});

// Pagination schema
export const paginationSchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).default('20'),
});

// Export types
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type GuestLoginInput = z.infer<typeof guestLoginSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreatePostInput = z.infer<typeof createPostSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProgramApplicationInput = z.infer<typeof programApplicationSchema>;
export type ModerationActionInput = z.infer<typeof moderationActionSchema>;
