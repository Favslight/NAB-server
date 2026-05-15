import { query, queryOne } from '../database/database';
import { canAccessTool, getAccessibleSlugs } from './toolAccess.service';

export interface ToolRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  category_name: string | null;
  required_plan: string;
  featured: boolean;
  active: boolean;
  created_at: string;
}

export interface ToolResponse {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  requiredPlan: string;
  locked: boolean;
  launchable: boolean;
  featured: boolean;
}

/**
 * Fetch all active tools, computing locked/launchable for the given membership plan
 */
export async function getAllTools(userPlan: string | null): Promise<ToolResponse[]> {
  const tools = await query<ToolRow>(
    `SELECT t.*, tc.name as category_name
     FROM tools t
     LEFT JOIN tool_categories tc ON t.category = tc.slug
     WHERE t.active = true
     ORDER BY t.featured DESC, t.name ASC`
  );

  return (tools || []).map(t => formatTool(t, userPlan));
}

/**
 * Fetch tools the user can actually launch
 */
export async function getMyAccessTools(userPlan: string): Promise<ToolResponse[]> {
  const accessible = getAccessibleSlugs(userPlan);

  let tools: ToolRow[];
  if (accessible === '*') {
    tools = await query<ToolRow>(
      `SELECT t.*, tc.name as category_name
       FROM tools t
       LEFT JOIN tool_categories tc ON t.category = tc.slug
       WHERE t.active = true
       ORDER BY t.featured DESC, t.name ASC`
    ) || [];
  } else if (accessible.length === 0) {
    return [];
  } else {
    const placeholders = accessible.map((_, i) => `$${i + 1}`).join(', ');
    tools = await query<ToolRow>(
      `SELECT t.*, tc.name as category_name
       FROM tools t
       LEFT JOIN tool_categories tc ON t.category = tc.slug
       WHERE t.active = true AND t.slug IN (${placeholders})
       ORDER BY t.featured DESC, t.name ASC`,
      accessible
    ) || [];
  }

  return tools.map(t => formatTool(t, userPlan));
}

/**
 * Get a single tool by slug
 */
export async function getToolBySlug(slug: string): Promise<ToolRow | null> {
  return queryOne<ToolRow>(
    `SELECT t.*, tc.name as category_name
     FROM tools t
     LEFT JOIN tool_categories tc ON t.category = tc.slug
     WHERE t.slug = $1 AND t.active = true`,
    [slug]
  );
}

/**
 * Format a DB row into the API response shape
 */
export function formatTool(tool: ToolRow, userPlan: string | null): ToolResponse {
  const locked = !canAccessTool(userPlan, tool.slug);
  return {
    id: tool.id,
    name: tool.name,
    slug: tool.slug,
    description: tool.description,
    icon: tool.icon,
    category: tool.category_name || tool.category,
    requiredPlan: tool.required_plan,
    locked,
    launchable: !locked,
    featured: tool.featured,
  };
}

/**
 * Get all tool categories
 */
export async function getAllCategories(): Promise<any[]> {
  return await query(
    'SELECT * FROM tool_categories ORDER BY name ASC'
  ) || [];
}
