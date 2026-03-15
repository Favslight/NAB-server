import crypto from 'crypto';

export function generateRandomString(length: number): string {
  return crypto.randomBytes(length).toString('hex').slice(0, length).toUpperCase();
}

export function generateRandomAlphanumeric(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function generateReferralCode(firstName: string): string {
  const prefix = firstName.slice(0, 3).toUpperCase().padEnd(3, 'X');
  const random = generateRandomAlphanumeric(4);
  return `NAB-${prefix}-${random}`;
}

export function generateIdNo(stateSlug: string, counter: number): string {
  const stateCode = stateSlug.slice(0, 3).toUpperCase();
  const number = counter.toString().padStart(4, '0');
  return `NAB-${stateCode}-${number}`;
}

export function generateEmailVerificationToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generatePasswordResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function sanitizeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '...';
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString();
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function isExpired(date: string | Date | null): boolean {
  if (!date) return false;
  const d = typeof date === 'string' ? new Date(date) : date;
  return d < new Date();
}

export function getClientIp(requestHeaders: any): string | null {
  const forwarded = requestHeaders['x-forwarded-for'];
  const realIp = requestHeaders['x-real-ip'];
  
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  if (realIp) {
    return realIp;
  }
  
  return null;
}
