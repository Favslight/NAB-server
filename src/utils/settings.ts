import { queryOne } from '../database/database';

/**
 * Get a system setting value by key
 */
export async function getSetting(key: string): Promise<string | null> {
  const result = await queryOne<{ value: string }>(
    'SELECT value FROM system_settings WHERE key = $1',
    [key]
  );
  return result?.value || null;
}

/**
 * Get a boolean system setting
 */
export async function getBooleanSetting(key: string, defaultValue: boolean = false): Promise<boolean> {
  const value = await getSetting(key);
  if (value === null || value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

/**
 * Get a numeric system setting
 */
export async function getNumberSetting(key: string, defaultValue: number = 0): Promise<number> {
  const value = await getSetting(key);
  if (value === null || value === undefined) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get a string system setting
 */
export async function getStringSetting(key: string, defaultValue: string = ''): Promise<string> {
  const value = await getSetting(key);
  return value !== null && value !== undefined ? value : defaultValue;
}

// Common settings helpers
export async function isMembershipFeeEnabled(): Promise<boolean> {
  return getBooleanSetting('enable_membership_fee', true);
}

export async function getMembershipPrice(): Promise<number> {
  return getNumberSetting('membership_price_naira', 30000);
}

export async function getReferralReward(): Promise<number> {
  return getNumberSetting('referral_reward_naira', 500);
}

export async function isGuestLoginEnabled(): Promise<boolean> {
  return getBooleanSetting('enable_guest_login', true);
}

export async function isMaintenanceMode(): Promise<boolean> {
  return getBooleanSetting('maintenance_mode', false);
}

export async function isAdminApprovalRequired(): Promise<boolean> {
  return getBooleanSetting('require_admin_approval', false);
}

export async function getSiteName(): Promise<string> {
  return getStringSetting('site_name', 'Nigerian AI Builders');
}
