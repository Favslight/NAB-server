import { query, queryOne } from '../database/database';
import { config } from '../config';
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
  current_role: string;
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
  const dealAiRole: DealAiRole = PLAN_TO_DEAL_AI_ROLE[membershipPlan] || 'Explorer Plan';

  const existing = await queryOne<DealAiUserRow>(
    'SELECT * FROM deal_ai_users WHERE user_id = $1',
    [userId]
  );

  if (!existing) {
    // Create user on Deal.ai
    await createDealAiUser(email, fullName, dealAiRole);

    // Record in our DB
    await query(
      `INSERT INTO deal_ai_users (user_id, deal_ai_email, current_role, synced_at, last_role_sync_at, status)
       VALUES ($1, $2, $3, NOW(), NOW(), 'active')`,
      [userId, email, dealAiRole]
    );
  } else if (existing.current_role !== dealAiRole) {
    // Role has changed — sync it
    await updateDealAiUserRole(existing.deal_ai_email, dealAiRole);

    await query(
      'UPDATE deal_ai_users SET current_role = $1, last_role_sync_at = NOW() WHERE user_id = $2',
      [dealAiRole, userId]
    );
  }
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
