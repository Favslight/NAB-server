// Plan hierarchy levels for comparison
export const PLAN_LEVELS: Record<string, number> = {
  'standard_member': 0,
  'ai_explorer': 1,
  'ai_builder': 2,
  'ai_product_founder': 3,
};

/**
 * Check whether a membership plan can access a tool requiring a certain plan level
 */
export function canAccessTool(userPlan: string | null | undefined, requiredPlan: string): boolean {
  if (!userPlan) return false;
  
  const userLevel = PLAN_LEVELS[userPlan] ?? 0;
  const requiredLevel = PLAN_LEVELS[requiredPlan] ?? 0;
  
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
    'standard_member': 'Standard Member',
  };
  return names[plan] || plan;
}
