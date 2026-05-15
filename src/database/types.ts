// Types matching database schema

export type UserRole = 'guest' | 'member' | 'premium_builder' | 'state_admin' | 'super_admin';
export type UserStatus = 'pending_verification' | 'verified' | 'membership_inactive' | 'membership_active' | 'course_applicant' | 'course_enrolled' | 'suspended' | 'pending_admin_approval';
export type MembershipPlanType = 'ai_explorer' | 'ai_builder' | 'ai_product_founder';
export type DealAiSyncStatus = 'active' | 'sync_failed' | 'removed';
export type MembershipStatus = 'pending' | 'active' | 'expired' | 'cancelled';
export type TransactionType = 'membership' | 'course' | 'event' | 'other';
export type TransactionStatus = 'pending' | 'success' | 'failed' | 'abandoned';
export type ReferralStatus = 'clicked' | 'signed_up' | 'paid' | 'rewarded';
export type PostVisibility = 'public' | 'members' | 'state_only';
export type ModerationAction = 'hide_post' | 'suspend_user' | 'mark_spam' | 'feature_post';
export type ProgramStatus = 'draft' | 'open' | 'in_progress' | 'closed' | 'completed';
export type ApplicationStatus = 'pending' | 'reviewing' | 'accepted' | 'rejected' | 'waitlisted';
export type ProductStatus = 'pending_review' | 'approved' | 'rejected' | 'published' | 'archived';
export type NotificationType = 'membership_activated' | 'referral_reward' | 'training_update' | 'product_approved' | 'course_application' | 'course_accepted' | 'general';

export interface State {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface User {
  id: string;
  id_no: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  password_hash: string | null;
  state_id: string | null;
  profession: string | null;
  avatar_url: string | null;
  role: UserRole;
  status: UserStatus;
  referral_code: string;
  referred_by_user_id: string | null;
  email_verified_at: string | null;
  email_verification_token: string | null;
  password_reset_token: string | null;
  password_reset_expires_at: string | null;
  last_login_at: string | null;
  login_attempts: number;
  locked_until: string | null;
  membership_plan_type: MembershipPlanType | null;
  membership_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Membership {
  id: string;
  user_id: string;
  plan_type: MembershipPlanType;
  amount_paid: number;
  starts_at: string | null;
  expires_at: string | null;
  status: MembershipStatus;
  transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  type: TransactionType;
  provider: 'paystack';
  reference: string;
  amount: number;
  currency: string;
  status: TransactionStatus;
  provider_payload_json: any;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Referral {
  id: string;
  referrer_user_id: string;
  referred_user_id: string | null;
  referral_code_used: string;
  status: ReferralStatus;
  reward_amount: number;
  created_at: string;
  qualified_at: string | null;
}

export interface ReferralClick {
  id: string;
  referral_code: string;
  ip_address: string | null;
  user_agent: string | null;
  clicked_at: string;
}

export interface StateHub {
  id: string;
  name: string;
  slug: string;
  state_id: string | null;
  description: string | null;
  banner_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommunityPost {
  id: string;
  author_user_id: string;
  hub_id: string | null;
  category: string;
  title: string;
  body: string;
  visibility: PostVisibility;
  is_featured: boolean;
  is_hidden: boolean;
  view_count: number;
  likes_count: number;
  comments_count: number;
  created_at: string;
  updated_at: string;
}

export interface CommunityComment {
  id: string;
  post_id: string;
  author_user_id: string;
  body: string;
  parent_comment_id: string | null;
  is_hidden: boolean;
  created_at: string;
  updated_at: string;
}

export interface Training {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  thumbnail_url: string | null;
  is_premium: boolean;
  access_level: UserRole;
  duration_minutes: number | null;
  category: string | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export interface TrainingLesson {
  id: string;
  training_id: string;
  title: string;
  description: string | null;
  video_url: string | null;
  duration_minutes: number | null;
  order_index: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export interface Cohort {
  id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  capacity: number | null;
  application_opens_at: string | null;
  application_closes_at: string | null;
  status: ProgramStatus;
  created_at: string;
  updated_at: string;
}

export interface ProgramApplication {
  id: string;
  user_id: string;
  cohort_id: string;
  status: ApplicationStatus;
  experience_level: string | null;
  motivation: string | null;
  portfolio_url: string | null;
  github_url: string | null;
  resume_url: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  website_url: string | null;
  demo_url: string | null;
  status: ProductStatus;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  featured_at: string | null;
  view_count: number;
  likes_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProductMedia {
  id: string;
  product_id: string;
  media_type: 'image' | 'video' | 'screenshot';
  url: string;
  order_index: number;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  data_json: any;
  is_read: boolean;
  email_sent: boolean;
  email_sent_at: string | null;
  action_url: string | null;
  created_at: string;
}

export interface ModerationLog {
  id: string;
  target_user_id: string | null;
  target_post_id: string | null;
  target_comment_id: string | null;
  action: ModerationAction;
  reason: string | null;
  performed_by_user_id: string;
  created_at: string;
}

export interface AdminAuditLog {
  id: string;
  admin_user_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_values_json: any;
  new_values_json: any;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

// JWT Payload type
export interface JWTPayload {
  userId: string;
  email: string | null;
  role: UserRole;
  iat: number;
  exp: number;
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

// ============================================
// AI LAUNCHPAD / TOOLS MODULE TYPES
// ============================================

export interface ToolCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
}

export interface Tool {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  required_plan: MembershipPlanType;
  featured: boolean;
  active: boolean;
  created_at: string;
}

export interface DealAiUser {
  id: string;
  user_id: string;
  deal_ai_email: string;
  current_role: string;
  synced_at: string;
  last_role_sync_at: string;
  status: DealAiSyncStatus;
  created_at: string;
}

export interface ToolLaunchLog {
  id: string;
  user_id: string;
  tool_id: string;
  launched_at: string;
  ip_address: string | null;
  user_agent: string | null;
}
