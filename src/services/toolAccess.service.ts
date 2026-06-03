export type ToolAccessPlan = 'ai_explorer' | 'ai_builder' | 'ai_product_founder';

// Plan hierarchy levels for comparison.
export const PLAN_LEVELS: Record<ToolAccessPlan, number> = {
  'ai_explorer': 1,
  'ai_builder': 2,
  'ai_product_founder': 3,
};

const VALID_TOOL_PLANS = new Set<string>(Object.keys(PLAN_LEVELS));

export function normalizeUserPlan(plan: string | null | undefined): ToolAccessPlan | null {
  if (!plan) return null;
  if (plan === 'standard_member') return 'ai_explorer';
  return VALID_TOOL_PLANS.has(plan) ? (plan as ToolAccessPlan) : null;
}

export function normalizeRequiredPlan(plan: string | null | undefined): ToolAccessPlan | null {
  if (!plan) return null;
  return VALID_TOOL_PLANS.has(plan) ? (plan as ToolAccessPlan) : null;
}

export function getEffectiveToolPlan(
  status: string | null | undefined,
  membershipPlan: string | null | undefined
): ToolAccessPlan | null {
  switch (status) {
    case 'pending_verification':
    case 'verified':
      return 'ai_explorer';

    case 'membership_active':
      return membershipPlan === 'ai_product_founder' ? 'ai_product_founder' : 'ai_builder';

    default:
      return null;
  }
}

export function getMembershipPlanForResponse(
  status: string | null | undefined,
  membershipPlan: string | null | undefined
): ToolAccessPlan {
  if (status === 'membership_active') {
    return membershipPlan === 'ai_product_founder' ? 'ai_product_founder' : 'ai_builder';
  }

  return normalizeUserPlan(membershipPlan) || 'ai_explorer';
}

/**
 * Check whether a membership plan can access a tool requiring a certain plan level
 */
export function canAccessTool(userPlan: string | null | undefined, requiredPlan: string): boolean {
  const normalizedUserPlan = normalizeUserPlan(userPlan);
  const normalizedRequiredPlan = normalizeRequiredPlan(requiredPlan);
  if (!normalizedUserPlan || !normalizedRequiredPlan) return false;

  const userLevel = PLAN_LEVELS[normalizedUserPlan];
  const requiredLevel = PLAN_LEVELS[normalizedRequiredPlan];
  
  return userLevel >= requiredLevel;
}

/**
 * Get display name for a plan slug
 */
export function getPlanDisplayName(plan: string): string {
  const names: Record<string, string> = {
    'ai_explorer': 'AI Explorer',
    'ai_builder': 'AI Builder',
    'ai_product_founder': 'AI Product Founder',
    'standard_member': 'AI Explorer',
  };
  return names[plan] || plan;
}
