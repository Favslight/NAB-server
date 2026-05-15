// Tool access control — maps membership plans to allowed tool slugs

// Exact plan slugs stored in DB
export const PLAN_SLUGS = {
  AI_EXPLORER: 'ai_explorer',
  AI_BUILDER: 'ai_builder',
  AI_PRODUCT_FOUNDER: 'ai_product_founder',
  STANDARD_MEMBER: 'standard_member',
} as const;

// Tool slugs accessible per plan
export const PLAN_TOOL_ACCESS: Record<string, string[] | '*'> = {
  'ai_explorer': [
    'hyperrealistic-ai-images',
  ],
  'ai_builder': [
    'hyperrealistic-ai-images',
    'ai-videos',
    'ai-voice-over',
  ],
  'ai_product_founder': '*', // all tools
  'standard_member': [],     // no tools — legacy plan
};

/**
 * Check whether a membership plan can access a specific tool slug
 */
export function canAccessTool(plan: string | null | undefined, toolSlug: string): boolean {
  if (!plan) return false;
  const access = PLAN_TOOL_ACCESS[plan];
  if (!access) return false;
  if (access === '*') return true;
  return access.includes(toolSlug);
}

/**
 * Get the list of tool slugs a plan can access (or '*' for all)
 */
export function getAccessibleSlugs(plan: string | null | undefined): string[] | '*' {
  if (!plan) return [];
  const access = PLAN_TOOL_ACCESS[plan];
  if (!access) return [];
  return access;
}

/**
 * Get plan display name from plan slug
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
