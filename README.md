# Nigerian AI Builders (NAB) - Backend API

A production-ready Fastify + TypeScript backend for the AIBUILDERS.NG MVP.

## Tech Stack

- **Framework**: Fastify
- **Language**: TypeScript
- **Database**: PostgreSQL (via `pg`)
- **ORM**: Raw SQL / pg Pool
- **Authentication**: JWT
- **Validation**: Zod
- **File Uploads**: Cloudinary
- **Email**: Resend API
- **Payments**: Paystack
- **Password Hashing**: bcrypt

## Project Structure

```
/src
  /config           # Environment configuration
  /database         # PostgreSQL client (pg), types
  /modules
    /auth           # Authentication routes
    /users          # User management
    /memberships    # Membership subscriptions
    /payments       # Paystack payments & webhooks
    /referrals      # Referral system
    /community      # Community posts & comments
    /moderation     # Content moderation
    /trainings      # Training courses
    /program        # Premium course applications
    /products       # Product showcase
    /notifications  # User notifications
    /admin          # Admin dashboard & tools
  /middlewares      # Auth, validation, rate limiting
  /utils            # Helpers, validators, responses
  server.ts         # Fastify entry point
/schema.sql         # Database schema
.env.example        # Environment template
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required environment variables:

```env
# Database (PostgreSQL)
DATABASE_URL=postgresql://user:password@localhost:5432/nab_db

# Authentication
JWT_SECRET=your-jwt-secret-min-32-characters-long

# Email (Resend)
RESEND_API_KEY=re_xxxxxxxxxxxxxxx
RESEND_FROM_EMAIL=noreply@aibuilders.ng

# Payments (Paystack)
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxx
PAYSTACK_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxx

# File Uploads (Cloudinary)
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret

# Application
FRONTEND_URL=http://localhost:3001
```

### 3. Set Up Database

1. Install PostgreSQL locally or use a cloud provider (Railway, Neon, AWS RDS)
2. Create a database named `nab_db`
3. Run `schema.sql` to create all tables
4. (Optional) Set up connection pooling for production

### 4. Run Development Server

```bash
npm run dev
```

Server will start on http://localhost:3000

### 5. Build for Production

```bash
npm run build
npm start
```

## API Routes

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login (email/id_no + password)
- `POST /api/auth/guest-login` - Guest access
- `POST /api/auth/verify-email` - Email verification
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password
- `GET /api/auth/me` - Get current user

### Users
- `GET /api/users` - List users (admin)
- `GET /api/users/profile` - Get profile
- `PUT /api/users/profile` - Update profile
- `GET /api/users/:id` - Get user by ID
- `GET /api/users/states` - Get all states
- `GET /api/users/state-hubs` - Get state hubs
- `GET /api/users/state-hubs/:slug` - Get hub details

### Payments
- `POST /api/payments/initiate` - Initiate payment
- `POST /api/payments/webhook/paystack` - Paystack webhook
- `GET /api/payments/verify/:reference` - Verify payment
- `GET /api/payments/history` - Payment history

### Referrals
- `GET /api/referrals/me` - My referrals & stats
- `GET /api/referrals/leaderboard` - Top referrers
- `POST /api/referrals/track-click` - Track referral click

### Community
- `GET /api/community/posts` - List posts
- `POST /api/community/posts` - Create post
- `GET /api/community/posts/:id` - Get post
- `POST /api/community/posts/:id/comments` - Add comment
- `POST /api/community/posts/:id/react` - Like/unlike post
- `GET /api/hubs/:slug` - Get state hub

### Trainings
- `GET /api/trainings` - List trainings
- `GET /api/trainings/:id` - Get training
- `POST /api/trainings/:id/progress` - Update progress
- `GET /api/trainings/categories` - Get categories

### Program (Premium Courses)
- `GET /api/program/cohorts` - List cohorts
- `GET /api/program/cohorts/:id` - Get cohort
- `POST /api/program/apply` - Apply to cohort
- `GET /api/program/applications/me` - My applications
- `GET /api/program/enrollments/me` - My enrollments

### Products
- `GET /api/products` - List products
- `GET /api/products/:slug` - Get product
- `POST /api/products` - Submit product
- `PUT /api/products/:id` - Update product
- `POST /api/products/:id/media` - Upload media
- `POST /api/products/:id/react` - Like/unlike
- `POST /api/products/:id/review` - Admin review

### Notifications
- `GET /api/notifications` - Get notifications
- `GET /api/notifications/unread-count` - Unread count
- `POST /api/notifications/:id/read` - Mark as read
- `POST /api/notifications/read-all` - Mark all read
- `DELETE /api/notifications/:id` - Delete

### Admin
- `GET /api/admin/dashboard` - Dashboard stats
- `GET /api/admin/users` - List all users
- `PUT /api/admin/users/:id/role` - Update role
- `PUT /api/admin/users/:id/status` - Update status
- `GET /api/admin/applications` - Program applications
- `POST /api/admin/applications/:id/review` - Review application
- `POST /api/admin/cohorts` - Create cohort
- `GET /api/admin/audit-logs` - View audit logs
- `GET /api/admin/settings` - System settings
- `PUT /api/admin/settings/:key` - Update setting

### Moderation
- `POST /api/moderation/posts/:id/action` - Moderate post
- `POST /api/moderation/comments/:id/hide` - Hide comment
- `GET /api/moderation/logs` - Moderation logs

## Key Features

### User Identification
- Auto-generated ID numbers: `NAB-XXX-0001`
- Unique referral codes: `NAB-XXX-XXXX`
- First user in each state becomes `state_admin`

### Membership Flow
1. User registers → `guest` role
2. Initiates membership payment
3. Paystack webhook confirms payment
4. User role upgraded to `member`
5. Referrer rewarded (if applicable)

### Referral System
- Referral links tracked via `referral_clicks`
- Referral status: `clicked` → `signed_up` → `paid` → `rewarded`
- Rewards credited after membership payment

### Security
- JWT authentication with role-based access
- Rate limiting (100 requests per 15 minutes)
- Input validation with Zod
- Webhook signature verification
- Admin audit logging

## Database Schema

See `schema.sql` for complete table definitions including:

- `users` - Core user accounts
- `states` - Nigerian states
- `state_hubs` - Community hubs per state
- `memberships` - User subscriptions
- `transactions` - Payment records
- `referrals` & `referral_clicks` - Referral tracking
- `community_posts` & `community_comments` - Forum content
- `trainings` & `training_lessons` - Course content
- `cohorts` & `program_applications` - Premium courses
- `products` & `product_media` - Product showcase
- `notifications` - User alerts
- `moderation_logs` & `admin_audit_logs` - Audit trail

## Scripts

```bash
npm run dev        # Development server with hot reload
npm run build      # Build for production
npm start          # Start production server
npm run lint       # Run ESLint
npm run typecheck  # TypeScript type checking
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | Yes |
| `PAYSTACK_SECRET_KEY` | Paystack test/live secret | Yes |
| `RESEND_API_KEY` | Resend API key | No |
| `CLOUDINARY_*` | Cloudinary credentials | No |
| `FRONTEND_URL` | Frontend application URL | Yes |

## Testing

```bash
# Health check
curl http://localhost:3000/health

# API info
curl http://localhost:3000/
```

## Production Deployment

1. Set environment variables in production
2. Use `npm run build` to compile TypeScript
3. Run `npm start` to start the server
4. Configure Paystack webhooks to point to `/api/payments/webhook/paystack`
5. Set up connection pooling for your PostgreSQL database
6. Set up monitoring and logging

## License

MIT License - Nigerian AI Builders