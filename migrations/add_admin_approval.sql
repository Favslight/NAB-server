-- Migration: Add Admin Approval Feature
-- Run this in Supabase SQL Editor for existing databases

-- Add pending_admin_approval to user_status enum
-- Note: PostgreSQL doesn't support ALTER TYPE ADD VALUE directly in transactions
-- If this fails, you may need to run it separately outside a transaction
DO $$
BEGIN
    -- Check if the enum value already exists
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_enum 
        WHERE enumtypid = 'user_status'::regtype 
        AND enumlabel = 'pending_admin_approval'
    ) THEN
        -- Add the new enum value
        ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'pending_admin_approval';
    END IF;
END $$;

-- Add the require_admin_approval system setting if it doesn't exist
INSERT INTO system_settings (key, value, value_type, description) 
VALUES (
    'require_admin_approval', 
    'false', 
    'boolean', 
    'Require admin approval for new user signups. When true, users join waitlist and must be approved before they can log in'
)
ON CONFLICT (key) DO NOTHING;

-- Create index for pending_admin_approval status if not exists
CREATE INDEX IF NOT EXISTS idx_users_pending_approval 
ON users(status) 
WHERE status = 'pending_admin_approval';
