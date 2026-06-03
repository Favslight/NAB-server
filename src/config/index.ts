import dotenv from 'dotenv';

dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  
  database: {
    url: process.env.DATABASE_URL || '',
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  
  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    fromEmail: process.env.RESEND_FROM_EMAIL || 'noreply@aibuilders.ng',
    fromName: process.env.RESEND_FROM_NAME || 'Nigerian AI Builders',
  },
  
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY || '',
    publicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
    webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET || '',
  },
  
  bank: {
    accountName: process.env.BANK_ACCOUNT_NAME || 'AFRESH BIZ & ENT LTD',
    accountNumber: process.env.BANK_ACCOUNT_NUMBER || '5080265397',
    bankName: process.env.BANK_NAME || 'Fidelity bank',
  },

  dealAi: {
    apiKey: process.env.DEAL_AI_API_KEY || '',
    baseUrl: process.env.DEAL_AI_BASE_URL || 'https://api.marketing.deal.ai/api/2024-01',
    launchUrl: process.env.DEAL_AI_LAUNCH_URL || 'https://tools.aibuilders.ng',
  },
  
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
  
  app: {
    frontendUrl: process.env.FRONTEND_URL || 'https://aibuilders.ng',
    apiUrl: process.env.API_URL || 'http://localhost:3000',
  },
  
  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  },
  
  logLevel: process.env.LOG_LEVEL || 'info',
  
  features: {
    enableGuestLogin: process.env.ENABLE_GUEST_LOGIN === 'true',
    enableEmailVerification: process.env.ENABLE_EMAIL_VERIFICATION !== 'false',
    maintenanceMode: process.env.MAINTENANCE_MODE === 'true',
  },
};

export type Config = typeof config;
