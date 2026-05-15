-- Nigerian AI Builders (NAB) Database Schema
-- Compatible with Supabase PostgreSQL
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- ENUM TYPES
-- ============================================

CREATE TYPE user_role AS ENUM ('guest', 'member', 'premium_builder', 'state_admin', 'super_admin');
CREATE TYPE user_status AS ENUM ('pending_verification', 'verified', 'membership_inactive', 'membership_active', 'course_applicant', 'course_enrolled', 'suspended', 'pending_admin_approval');
CREATE TYPE membership_plan_type AS ENUM ('standard_member');
CREATE TYPE membership_status AS ENUM ('pending', 'active', 'expired', 'cancelled');
CREATE TYPE transaction_type AS ENUM ('membership', 'course', 'event', 'other');
CREATE TYPE transaction_provider AS ENUM ('paystack', 'manual');
CREATE TYPE transaction_status AS ENUM ('pending', 'success', 'failed', 'abandoned');
CREATE TYPE referral_status AS ENUM ('clicked', 'signed_up', 'paid', 'rewarded');
CREATE TYPE post_visibility AS ENUM ('public', 'members', 'state_only');
CREATE TYPE moderation_action AS ENUM ('hide_post', 'suspend_user', 'mark_spam', 'feature_post');
CREATE TYPE program_status AS ENUM ('draft', 'open', 'in_progress', 'closed', 'completed');
CREATE TYPE application_status AS ENUM ('pending', 'reviewing', 'accepted', 'rejected', 'waitlisted');
CREATE TYPE product_status AS ENUM ('pending_review', 'approved', 'rejected', 'published', 'archived');
CREATE TYPE notification_type AS ENUM ('membership_activated', 'referral_reward', 'training_update', 'product_approved', 'course_application', 'course_accepted', 'general');
CREATE TYPE membership_plan_type AS ENUM ('standard_member', 'ai_explorer', 'ai_builder', 'ai_product_founder');
CREATE TYPE deal_ai_sync_status AS ENUM ('active', 'sync_failed', 'removed');

-- ============================================
-- CORE TABLES
-- ============================================

-- States table
CREATE TABLE states (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- State counters for ID generation
CREATE TABLE state_counters (
    state_id UUID PRIMARY KEY REFERENCES states(id) ON DELETE CASCADE,
    current_number INTEGER DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_no VARCHAR(20) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(20) UNIQUE,
    password_hash VARCHAR(255),
    state_id UUID REFERENCES states(id),
    profession VARCHAR(100),
    avatar_url TEXT,
    role user_role DEFAULT 'guest',
    status user_status DEFAULT 'pending_verification',
    referral_code VARCHAR(20) UNIQUE NOT NULL,
    referred_by_user_id UUID REFERENCES users(id),
    email_verified_at TIMESTAMP WITH TIME ZONE,
    email_verification_token VARCHAR(255),
    password_reset_token VARCHAR(255),
    password_reset_expires_at TIMESTAMP WITH TIME ZONE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_id_no ON users(id_no);
CREATE INDEX idx_users_referral_code ON users(referral_code);
CREATE INDEX idx_users_referred_by ON users(referred_by_user_id);
CREATE INDEX idx_users_state ON users(state_id);
CREATE INDEX idx_users_role ON users(role);

-- ============================================
-- MEMBERSHIP & PAYMENTS
-- ============================================

-- Memberships table
CREATE TABLE memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_type membership_plan_type NOT NULL,
    amount_paid DECIMAL(10, 2) NOT NULL,
    starts_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    status membership_status DEFAULT 'pending',
    transaction_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_memberships_status ON memberships(status);

-- Transactions table
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type transaction_type NOT NULL,
    provider transaction_provider NOT NULL,
    reference VARCHAR(255) UNIQUE NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'NGN',
    status transaction_status DEFAULT 'pending',
    provider_payload_json JSONB,
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_transactions_user ON transactions(user_id);
CREATE INDEX idx_transactions_reference ON transactions(reference);
CREATE INDEX idx_transactions_status ON transactions(status);

-- ============================================
-- REFERRAL SYSTEM
-- ============================================

-- Referrals table
CREATE TABLE referrals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referrer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referred_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    referral_code_used VARCHAR(20) NOT NULL,
    status referral_status DEFAULT 'clicked',
    reward_amount DECIMAL(10, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    qualified_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(referrer_user_id, referred_user_id)
);

CREATE INDEX idx_referrals_referrer ON referrals(referrer_user_id);
CREATE INDEX idx_referrals_referred ON referrals(referred_user_id);
CREATE INDEX idx_referrals_code ON referrals(referral_code_used);
CREATE INDEX idx_referrals_status ON referrals(status);

-- Referral clicks tracking (anti-abuse)
CREATE TABLE referral_clicks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referral_code VARCHAR(20) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    clicked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_referral_clicks_code ON referral_clicks(referral_code);
CREATE INDEX idx_referral_clicks_ip ON referral_clicks(ip_address);
CREATE INDEX idx_referral_clicks_time ON referral_clicks(clicked_at);

-- ============================================
-- COMMUNITY
-- ============================================

-- State hubs
CREATE TABLE state_hubs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    state_id UUID REFERENCES states(id) ON DELETE SET NULL,
    description TEXT,
    banner_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_state_hubs_slug ON state_hubs(slug);
CREATE INDEX idx_state_hubs_state ON state_hubs(state_id);

-- Community posts
CREATE TABLE community_posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hub_id UUID REFERENCES state_hubs(id) ON DELETE SET NULL,
    category VARCHAR(50) DEFAULT 'general',
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    media_files JSONB DEFAULT '[]',
    visibility post_visibility DEFAULT 'public',
    is_featured BOOLEAN DEFAULT FALSE,
    is_hidden BOOLEAN DEFAULT FALSE,
    view_count INTEGER DEFAULT 0,
    likes_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_posts_author ON community_posts(author_user_id);
CREATE INDEX idx_posts_hub ON community_posts(hub_id);
CREATE INDEX idx_posts_visibility ON community_posts(visibility);
CREATE INDEX idx_posts_featured ON community_posts(is_featured);
CREATE INDEX idx_posts_created ON community_posts(created_at DESC);

-- Community comments
CREATE TABLE community_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    parent_comment_id UUID REFERENCES community_comments(id) ON DELETE CASCADE,
    is_hidden BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_comments_post ON community_comments(post_id);
CREATE INDEX idx_comments_author ON community_comments(author_user_id);
CREATE INDEX idx_comments_parent ON community_comments(parent_comment_id);

-- Post reactions (likes)
CREATE TABLE post_reactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reaction_type VARCHAR(20) DEFAULT 'like',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(post_id, user_id)
);

CREATE INDEX idx_reactions_post ON post_reactions(post_id);
CREATE INDEX idx_reactions_user ON post_reactions(user_id);

-- ============================================
-- MODERATION
-- ============================================

-- Moderation logs
CREATE TABLE moderation_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    target_post_id UUID REFERENCES community_posts(id) ON DELETE SET NULL,
    target_comment_id UUID REFERENCES community_comments(id) ON DELETE SET NULL,
    action moderation_action NOT NULL,
    reason TEXT,
    performed_by_user_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_moderation_target_user ON moderation_logs(target_user_id);
CREATE INDEX idx_moderation_target_post ON moderation_logs(target_post_id);
CREATE INDEX idx_moderation_performed_by ON moderation_logs(performed_by_user_id);
CREATE INDEX idx_moderation_created ON moderation_logs(created_at DESC);

-- ============================================
-- LEARNING MODULE
-- ============================================

-- Trainings/courses
CREATE TABLE trainings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    thumbnail_url TEXT,
    is_premium BOOLEAN DEFAULT FALSE,
    access_level user_role DEFAULT 'member',
    duration_minutes INTEGER,
    category VARCHAR(50),
    is_published BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_trainings_slug ON trainings(slug);
CREATE INDEX idx_trainings_premium ON trainings(is_premium);
CREATE INDEX idx_trainings_access ON trainings(access_level);
CREATE INDEX idx_trainings_published ON trainings(is_published);

-- Training lessons
CREATE TABLE training_lessons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    training_id UUID NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    video_url TEXT,
    duration_minutes INTEGER,
    order_index INTEGER DEFAULT 0,
    is_published BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_lessons_training ON training_lessons(training_id);
CREATE INDEX idx_lessons_order ON training_lessons(order_index);

-- Training progress
CREATE TABLE training_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    training_id UUID NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
    lesson_id UUID REFERENCES training_lessons(id) ON DELETE CASCADE,
    progress_percent INTEGER DEFAULT 0,
    completed_at TIMESTAMP WITH TIME ZONE,
    last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, training_id, lesson_id)
);

CREATE INDEX idx_progress_user ON training_progress(user_id);
CREATE INDEX idx_progress_training ON training_progress(training_id);

-- ============================================
-- PREMIUM COURSE MODULE
-- ============================================

-- Cohorts
CREATE TABLE cohorts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    start_date DATE,
    end_date DATE,
    capacity INTEGER,
    application_opens_at TIMESTAMP WITH TIME ZONE,
    application_closes_at TIMESTAMP WITH TIME ZONE,
    status program_status DEFAULT 'draft',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Program applications
CREATE TABLE program_applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cohort_id UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
    status application_status DEFAULT 'pending',
    experience_level VARCHAR(50),
    motivation TEXT,
    portfolio_url TEXT,
    github_url TEXT,
    resume_url TEXT,
    reviewed_by_user_id UUID REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    review_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, cohort_id)
);

CREATE INDEX idx_applications_user ON program_applications(user_id);
CREATE INDEX idx_applications_cohort ON program_applications(cohort_id);
CREATE INDEX idx_applications_status ON program_applications(status);

-- Program enrollments
CREATE TABLE program_enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cohort_id UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
    application_id UUID REFERENCES program_applications(id),
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    certificate_issued_at TIMESTAMP WITH TIME ZONE,
    certificate_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, cohort_id)
);

CREATE INDEX idx_enrollments_user ON program_enrollments(user_id);
CREATE INDEX idx_enrollments_cohort ON program_enrollments(cohort_id);

-- ============================================
-- PRODUCT SHOWCASE
-- ============================================

-- Products
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    category VARCHAR(50),
    website_url TEXT,
    demo_url TEXT,
    status product_status DEFAULT 'pending_review',
    reviewed_by_user_id UUID REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    review_notes TEXT,
    featured_at TIMESTAMP WITH TIME ZONE,
    view_count INTEGER DEFAULT 0,
    likes_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_products_user ON products(user_id);
CREATE INDEX idx_products_slug ON products(slug);
CREATE INDEX idx_products_status ON products(status);
CREATE INDEX idx_products_featured ON products(featured_at);

-- Product media
CREATE TABLE product_media (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    media_type VARCHAR(20) NOT NULL, -- 'image', 'video', 'screenshot'
    url TEXT NOT NULL,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_media_product ON product_media(product_id);

-- Product reactions
CREATE TABLE product_reactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reaction_type VARCHAR(20) DEFAULT 'like',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(product_id, user_id)
);

CREATE INDEX idx_product_reactions_product ON product_reactions(product_id);

-- ============================================
-- NOTIFICATIONS
-- ============================================

-- Notifications
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type notification_type NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    data_json JSONB,
    is_read BOOLEAN DEFAULT FALSE,
    email_sent BOOLEAN DEFAULT FALSE,
    email_sent_at TIMESTAMP WITH TIME ZONE,
    action_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(is_read);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);

-- ============================================
-- ADMIN & AUDIT
-- ============================================

-- Admin audit logs
CREATE TABLE admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL, -- 'user', 'post', 'product', 'training', etc.
    entity_id UUID,
    old_values_json JSONB,
    new_values_json JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_admin ON admin_audit_logs(admin_user_id);
CREATE INDEX idx_audit_entity ON admin_audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_created ON admin_audit_logs(created_at DESC);

-- System settings
CREATE TABLE system_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT,
    value_type VARCHAR(20) DEFAULT 'string',
    description TEXT,
    updated_by_user_id UUID REFERENCES users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- ANALYTICS
-- ============================================

-- Daily analytics snapshot
CREATE TABLE analytics_daily (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE UNIQUE NOT NULL,
    total_users INTEGER DEFAULT 0,
    new_users INTEGER DEFAULT 0,
    paid_memberships INTEGER DEFAULT 0,
    new_memberships INTEGER DEFAULT 0,
    referral_conversions INTEGER DEFAULT 0,
    community_posts INTEGER DEFAULT 0,
    community_comments INTEGER DEFAULT 0,
    training_completions INTEGER DEFAULT 0,
    program_applications INTEGER DEFAULT 0,
    product_submissions INTEGER DEFAULT 0,
    revenue_naira DECIMAL(12, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_analytics_date ON analytics_daily(date);

-- State-based analytics
CREATE TABLE analytics_by_state (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    state_id UUID NOT NULL REFERENCES states(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    total_users INTEGER DEFAULT 0,
    new_users INTEGER DEFAULT 0,
    paid_memberships INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(state_id, date)
);

CREATE INDEX idx_analytics_state_date ON analytics_by_state(state_id, date);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Update timestamp function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at trigger to all tables with updated_at column
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_memberships_updated_at BEFORE UPDATE ON memberships
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_state_hubs_updated_at BEFORE UPDATE ON state_hubs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_community_posts_updated_at BEFORE UPDATE ON community_posts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_community_comments_updated_at BEFORE UPDATE ON community_comments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trainings_updated_at BEFORE UPDATE ON trainings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_training_lessons_updated_at BEFORE UPDATE ON training_lessons
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_training_progress_updated_at BEFORE UPDATE ON training_progress
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cohorts_updated_at BEFORE UPDATE ON cohorts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_program_applications_updated_at BEFORE UPDATE ON program_applications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_program_enrollments_updated_at BEFORE UPDATE ON program_enrollments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_analytics_daily_updated_at BEFORE UPDATE ON analytics_daily
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to auto-increment state counter
CREATE OR REPLACE FUNCTION increment_state_counter(p_state_id UUID)
RETURNS INTEGER AS $$
DECLARE
    new_number INTEGER;
BEGIN
    INSERT INTO state_counters (state_id, current_number)
    VALUES (p_state_id, 1)
    ON CONFLICT (state_id)
    DO UPDATE SET current_number = state_counters.current_number + 1
    RETURNING state_counters.current_number INTO new_number;
    
    RETURN new_number;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- SEED DATA
-- ============================================

-- Insert Nigerian states
INSERT INTO states (name, slug) VALUES
('Abia', 'abia'),
('Abuja', 'abuja'),
('Adamawa', 'adamawa'),
('Akwa Ibom', 'akwa-ibom'),
('Anambra', 'anambra'),
('Bauchi', 'bauchi'),
('Bayelsa', 'bayelsa'),
('Benue', 'benue'),
('Borno', 'borno'),
('Cross River', 'cross-river'),
('Delta', 'delta'),
('Ebonyi', 'ebonyi'),
('Edo', 'edo'),
('Ekiti', 'ekiti'),
('Enugu', 'enugu'),
('Gombe', 'gombe'),
('Imo', 'imo'),
('Jigawa', 'jigawa'),
('Kaduna', 'kaduna'),
('Kano', 'kano'),
('Katsina', 'katsina'),
('Kebbi', 'kebbi'),
('Kogi', 'kogi'),
('Kwara', 'kwara'),
('Lagos', 'lagos'),
('Nasarawa', 'nasarawa'),
('Niger', 'niger'),
('Ogun', 'ogun'),
('Ondo', 'ondo'),
('Osun', 'osun'),
('Oyo', 'oyo'),
('Plateau', 'plateau'),
('Rivers', 'rivers'),
('Sokoto', 'sokoto'),
('Taraba', 'taraba'),
('Yobe', 'yobe'),
('Zamfara', 'zamfara');

-- Initialize state counters
INSERT INTO state_counters (state_id, current_number)
SELECT id, 1 FROM states;

-- Insert default system settings
INSERT INTO system_settings (key, value, value_type, description) VALUES
('membership_price_naira', '5000', 'number', 'Standard membership price in Naira'),
('enable_membership_fee', 'true', 'boolean', 'Enable paid membership signup. When false, users join as members immediately without payment'),
('referral_reward_naira', '500', 'number', 'Referral reward amount in Naira'),
('enable_guest_login', 'true', 'boolean', 'Allow guest login without registration'),
('maintenance_mode', 'false', 'boolean', 'Put site in maintenance mode'),
('site_name', 'Nigerian AI Builders', 'string', 'Site name'),
('require_admin_approval', 'false', 'boolean', 'Require admin approval for new user signups. When true, users join waitlist and must be approved before they can log in');

-- Create default state hubs
INSERT INTO state_hubs (name, slug, state_id, description)
SELECT 
    s.name || ' AI Builders Hub',
    s.slug || '-hub',
    s.id,
    'Community hub for AI builders in ' || s.name
FROM states s;

-- Row Level Security (RLS) policies will be applied via Supabase dashboard
-- or additional migration scripts

COMMENT ON TABLE users IS 'Core user accounts with role-based access';
COMMENT ON TABLE memberships IS 'User membership subscriptions';
COMMENT ON TABLE transactions IS 'Payment transactions via Paystack';
COMMENT ON TABLE referrals IS 'Referral tracking and rewards';
COMMENT ON TABLE community_posts IS 'Community forum posts';
COMMENT ON TABLE trainings IS 'Available training courses';
COMMENT ON TABLE products IS 'User-submitted AI products showcase';
COMMENT ON TABLE notifications IS 'User notifications';
COMMENT ON TABLE admin_audit_logs IS 'Admin action audit trail';

-- ============================================
-- AI LAUNCHPAD / TOOLS MODULE
-- ============================================

-- Tool categories
CREATE TABLE tool_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tool_categories_slug ON tool_categories(slug);

-- Tools table
CREATE TABLE tools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    icon TEXT,
    category VARCHAR(100) REFERENCES tool_categories(slug) ON UPDATE CASCADE ON DELETE SET NULL,
    required_plan membership_plan_type NOT NULL DEFAULT 'ai_explorer',
    featured BOOLEAN DEFAULT FALSE,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tools_slug ON tools(slug);
CREATE INDEX idx_tools_category ON tools(category);
CREATE INDEX idx_tools_required_plan ON tools(required_plan);
CREATE INDEX idx_tools_active ON tools(active);
CREATE INDEX idx_tools_featured ON tools(featured);

-- Deal.ai user sync tracking
CREATE TABLE deal_ai_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    deal_ai_email VARCHAR(255) NOT NULL,
    current_role VARCHAR(100) NOT NULL,
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_role_sync_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status deal_ai_sync_status DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_deal_ai_users_user ON deal_ai_users(user_id);
CREATE INDEX idx_deal_ai_users_email ON deal_ai_users(deal_ai_email);
CREATE INDEX idx_deal_ai_users_status ON deal_ai_users(status);

-- Tool launch logs
CREATE TABLE tool_launch_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tool_id UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
    launched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT
);

CREATE INDEX idx_tool_launch_logs_user ON tool_launch_logs(user_id);
CREATE INDEX idx_tool_launch_logs_tool ON tool_launch_logs(tool_id);
CREATE INDEX idx_tool_launch_logs_launched ON tool_launch_logs(launched_at DESC);

-- ============================================
-- TOOLS SEED DATA
-- ============================================

-- Insert tool categories
INSERT INTO tool_categories (name, slug, description) VALUES
('Image & Video', 'image-video', 'AI-powered image and video creation tools'),
('Audio & Voice', 'audio-voice', 'AI voice generation, music, and audio tools'),
('Content & Copy', 'content-copy', 'AI writing, blogs, and copywriting tools'),
('Business & Apps', 'business-apps', 'Business applications, CRMs, and productivity tools'),
('Research & AI Agents', 'research-agents', 'Deep research, AI agents, and automation tools'),
('Training & Courses', 'training-courses', 'Academy and learning management tools');

-- Insert all tools
INSERT INTO tools (name, slug, description, icon, category, required_plan, featured) VALUES
-- AI Explorer tier (1 tool)
('Hyperrealistic AI Images', 'hyperrealistic-ai-images', 'Generate stunning, photorealistic AI images with unprecedented detail and quality.', '🎨', 'image-video', 'ai_explorer', TRUE),

-- AI Builder tier (+2 tools)
('AI Videos', 'ai-videos', 'Create professional AI-generated videos for any purpose.', '🎬', 'image-video', 'ai_builder', TRUE),
('AI Voice Over', 'ai-voice-over', 'Generate natural-sounding voiceovers in multiple languages and styles.', '🎙️', 'audio-voice', 'ai_builder', FALSE),

-- AI Product Founder tier (all remaining tools)
('AI Spokesperson', 'ai-spokesperson', 'Create realistic AI spokesperson videos for your brand or product.', '🧑‍💼', 'image-video', 'ai_product_founder', FALSE),
('AI Movies', 'ai-movies', 'Produce full-length AI-generated movie content and cinematic experiences.', '🎥', 'image-video', 'ai_product_founder', FALSE),
('AEO Funnels', 'aeo-funnels', 'Build high-converting AI-powered marketing funnels optimized for results.', '🔄', 'business-apps', 'ai_product_founder', FALSE),
('Conversational Images', 'conversational-images', 'Create interactive conversational image experiences powered by AI.', '💬', 'image-video', 'ai_product_founder', FALSE),
('AI Music Generator', 'ai-music-generator', 'Compose original music tracks using AI for any mood or genre.', '🎵', 'audio-voice', 'ai_product_founder', FALSE),
('Audiobook Maker', 'audiobook-maker', 'Convert any written content into professional-quality audiobooks instantly.', '📚', 'audio-voice', 'ai_product_founder', FALSE),
('Scroll-Stopping Ads', 'scroll-stopping-ads', 'Generate compelling ad creatives designed to capture attention instantly.', '📢', 'content-copy', 'ai_product_founder', FALSE),
('Hero Images', 'hero-images', 'Create striking hero images for websites, landing pages, and marketing materials.', '🖼️', 'image-video', 'ai_product_founder', FALSE),
('Logo Maker', 'logo-maker', 'Design professional logos and brand identities with AI assistance.', '✏️', 'image-video', 'ai_product_founder', FALSE),
('Precision Image Model', 'precision-image-model', 'Fine-tune image generation with precision controls for exact outputs.', '🎯', 'image-video', 'ai_product_founder', FALSE),
('Academy App Wizard', 'academy-app-wizard', 'Build your own branded academy application without coding.', '🏫', 'training-courses', 'ai_product_founder', FALSE),
('Live Training Wizard', 'live-training-wizard', 'Set up and manage live training sessions and webinars effortlessly.', '📡', 'training-courses', 'ai_product_founder', FALSE),
('External App Wizard', 'external-app-wizard', 'Connect and integrate external applications into your workflow seamlessly.', '🔌', 'business-apps', 'ai_product_founder', FALSE),
('Deep Research', 'deep-research', 'Conduct comprehensive AI-powered research on any topic in minutes.', '🔬', 'research-agents', 'ai_product_founder', FALSE),
('Humanizer', 'humanizer', 'Transform AI-generated text into natural, human-sounding content.', '🤝', 'content-copy', 'ai_product_founder', FALSE),
('AI Image Editor', 'ai-image-editor', 'Edit and enhance images with powerful AI-driven tools and filters.', '🖌️', 'image-video', 'ai_product_founder', FALSE),
('Super Agent', 'super-agent', 'Deploy autonomous AI agents to handle complex tasks and workflows.', '🤖', 'research-agents', 'ai_product_founder', FALSE),
('ChatWizard', 'chatwizard', 'Build intelligent chatbots and conversational AI for your business.', '💭', 'research-agents', 'ai_product_founder', FALSE),
('AEO Blogs', 'aeo-blogs', 'Generate SEO-optimized blog posts and articles that rank and convert.', '📝', 'content-copy', 'ai_product_founder', FALSE),
('Movie Editor', 'movie-editor', 'Edit and produce professional-quality movies with AI-assisted tools.', '🎞️', 'image-video', 'ai_product_founder', FALSE),
('AI Forms', 'ai-forms', 'Create intelligent forms that adapt to user responses in real time.', '📋', 'business-apps', 'ai_product_founder', FALSE),
('Easy CRM', 'easy-crm', 'Manage customer relationships effortlessly with an AI-powered CRM system.', '📊', 'business-apps', 'ai_product_founder', FALSE),
('Academies', 'academies', 'Launch and manage your own online academy with AI-enhanced learning tools.', '🎓', 'training-courses', 'ai_product_founder', FALSE),
('Copywriters', 'copywriters', 'Generate high-converting copy for any medium with AI-powered writing assistants.', '✍️', 'content-copy', 'ai_product_founder', FALSE);

COMMENT ON TABLE tool_categories IS 'Categories for AI Launchpad tools';
COMMENT ON TABLE tools IS 'AI Launchpad tools — access controlled by membership plan';
COMMENT ON TABLE deal_ai_users IS 'Tracks users synced to Deal.ai whitelabel system';
COMMENT ON TABLE tool_launch_logs IS 'Audit log of every tool launch by a user';

