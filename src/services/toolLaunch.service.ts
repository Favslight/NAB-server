// tool launch service
import { query, queryOne } from '../database/database';
import {
  createDealAiUser,
  updateDealAiUserRole,
  PLAN_TO_DEAL_AI_ROLE,
  DealAiRole,
} from './dealAi.service';

interface DealAiUserRow {
  id: string;
  user_id: string;
  deal_ai_email: string;
  deal_role: string;
  synced_at: string;
  last_role_sync_at: string;
  status: string;
}

/**
 * Ensure the user is synced to Deal.ai with the correct role.
 * Creates them if they don't exist, updates role if it's changed.
 */
export async function ensureUserSyncedToDealAi(
  userId: string,
  email: string,
  fullName: string,
  membershipPlan: string
): Promise<void> {
  const dealAiRole: DealAiRole = PLAN_TO_DEAL_AI_ROLE[membershipPlan] || 'AI Explorer';
  const markSynced = async (dealAiEmail: string) => {
    await query(
      `INSERT INTO deal_ai_users (user_id, deal_ai_email, deal_role, synced_at, last_role_sync_at, status)
       VALUES ($1, $2, $3, NOW(), NOW(), 'active')
       ON CONFLICT (user_id) DO UPDATE SET
         deal_ai_email = $2,
         deal_role = $3,
         synced_at = NOW(),
         last_role_sync_at = NOW(),
         status = 'active'`,
      [userId, dealAiEmail, dealAiRole]
    );
  };

  const existing = await queryOne<DealAiUserRow>(
    'SELECT * FROM deal_ai_users WHERE user_id = $1',
    [userId]
  );

  if (!existing) {
    await createDealAiUser(email, fullName, dealAiRole);
    await markSynced(email);
    return;
  }

  if (existing.status === 'active' && existing.deal_role === dealAiRole && existing.deal_ai_email === email) {
    return;
  }

  const dealAiEmail = existing.deal_ai_email || email;

  try {
    await updateDealAiUserRole(dealAiEmail, dealAiRole);
    await markSynced(dealAiEmail);
  } catch (error: any) {
    const message = error?.message || '';
    if (message.includes('401') || message.includes('403')) {
      throw error;
    }

    await createDealAiUser(email, fullName, dealAiRole);
    await markSynced(email);
  }
}

export async function markDealAiSyncFailed(
  userId: string,
  email: string,
  membershipPlan: string
): Promise<void> {
  const dealAiRole: DealAiRole = PLAN_TO_DEAL_AI_ROLE[membershipPlan] || 'AI Explorer';

  await query(
    `INSERT INTO deal_ai_users (user_id, deal_ai_email, deal_role, status, last_role_sync_at)
     VALUES ($1, $2, $3, 'sync_failed', NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       deal_ai_email = $2,
       deal_role = $3,
       status = 'sync_failed',
       last_role_sync_at = NOW()`,
    [userId, email, dealAiRole]
  );
}

/**
 * Log a tool launch event
 */
export async function logToolLaunch(
  userId: string,
  toolId: string,
  ipAddress: string | null,
  userAgent: string | null
): Promise<void> {
  await query(
    'INSERT INTO tool_launch_logs (user_id, tool_id, launched_at, ip_address, user_agent) VALUES ($1, $2, NOW(), $3, $4)',
    [userId, toolId, ipAddress || null, userAgent || null]
  );
}

/**
 * Get launch analytics for super admin
 */
export async function getLaunchAnalytics(): Promise<{
  totalLaunches: number;
  topTools: any[];
  launchesByPlan: any[];
  failedSyncs: number;
}> {
  const [totalResult, topTools, launchesByPlan, failedSyncs] = await Promise.all([
    queryOne<{ count: number }>(
      'SELECT COUNT(*)::int as count FROM tool_launch_logs'
    ),
    query(
      `SELECT t.name, t.slug, COUNT(tll.id)::int as launches
       FROM tool_launch_logs tll
       JOIN tools t ON tll.tool_id = t.id
       GROUP BY t.id, t.name, t.slug
       ORDER BY launches DESC
       LIMIT 10`
    ),
    query(
      `SELECT m.plan_type, COUNT(tll.id)::int as launches
       FROM tool_launch_logs tll
       JOIN users u ON tll.user_id = u.id
       JOIN memberships m ON u.id = m.user_id AND m.status = 'active'
       GROUP BY m.plan_type
       ORDER BY launches DESC`
    ),
    queryOne<{ count: number }>(
      "SELECT COUNT(*)::int as count FROM deal_ai_users WHERE status = 'sync_failed'"
    ),
  ]);

  return {
    totalLaunches: totalResult?.count || 0,
    topTools: topTools || [],
    launchesByPlan: launchesByPlan || [],
    failedSyncs: failedSyncs?.count || 0,
  };
}
