import { config } from '../config';

const BASE_URL = config.dealAi.baseUrl;
const API_KEY = config.dealAi.apiKey;

export type DealAiRole = 'AI Explorer' | 'AI Builder' | 'AI Product Founder';

// Map local membership plan → Deal.ai role
export const PLAN_TO_DEAL_AI_ROLE: Record<string, DealAiRole> = {
  'ai_explorer': 'AI Explorer',
  'ai_builder': 'AI Builder',
  'ai_product_founder': 'AI Product Founder'
};

async function dealAiFetch(
  method: string,
  path: string,
  body?: Record<string, any>,
  retries = 3
): Promise<any> {
  const url = `${BASE_URL}${path}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Deal-AI-API-Key': API_KEY,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Deal.ai API error ${response.status}: ${errorText}`);
      }

      const text = await response.text();
      return text ? JSON.parse(text) : {};
    } catch (error) {
      if (attempt === retries) throw error;
      // Exponential backoff before retry
      await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }
}

/**
 * Create a user in Deal.ai whitelabel system
 */
export async function createDealAiUser(
  email: string,
  fullName: string,
  role: DealAiRole
): Promise<any> {
  const names = fullName.trim().split(' ');
  const firstName = names[0];
  const lastName = names.length > 1 ? names.slice(1).join(' ') : '';

  // Generate a secure 16-character random password for Deal.ai account creation
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()';
  let password = '';
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return dealAiFetch('POST', '/whitelabel/users', {
    firstName,
    lastName,
    password,
    email,
    sendInviteEmail: 'yes',
    role,
  });
}

/**
 * Remove a user from Deal.ai whitelabel system
 */
export async function removeDealAiUser(email: string): Promise<any> {
  return dealAiFetch('DELETE', '/whitelabel/users', { email });
}

/**
 * Update a user's role in Deal.ai
 */
export async function updateDealAiUserRole(
  email: string,
  role: DealAiRole
): Promise<any> {
  return dealAiFetch('PATCH', '/whitelabel/users/role', { email, role });
}
