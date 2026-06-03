# Tool Access Frontend Guide

## Overview

The AI tools section is access-controlled by the user's current plan. The backend now returns the correct plan and lock state, so the frontend should rely on the API response instead of guessing access from payment status alone.

## Plans

| Plan value | Display label | User state | Tool access |
| --- | --- | --- | --- |
| `ai_explorer` | AI Explorer | Onboarded/unpaid users | 1 Explorer tool |
| `ai_builder` | AI Builder | Paid NGN 30,000 membership fee | Explorer tools + Builder tools |
| `ai_product_founder` | AI Product Founder | Paid NGN 250,000 founder fee | All tools |

Important: `ai_explorer` is still a current plan. Do not show "No current plan" just because `membership_status` is not `active`.

## Dashboard Current Plan

Use `membership_plan_type` for the dashboard plan label.

```ts
const planLabels: Record<string, string> = {
  ai_explorer: 'AI Explorer',
  ai_builder: 'AI Builder',
  ai_product_founder: 'AI Product Founder',
};

const currentPlan = user.membership_plan_type || 'ai_explorer';
const currentPlanLabel = planLabels[currentPlan] || 'AI Explorer';
```

Avoid this pattern:

```ts
if (user.membership_status !== 'active') {
  showCurrentPlan('No current plan');
}
```

Onboarded users should show:

```txt
Current Plan: AI Explorer
```

## User Endpoints

These endpoints return `membership_plan_type`:

- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/users/profile`

Example user fields:

```json
{
  "membership_status": "inactive",
  "membership_plan_type": "ai_explorer",
  "membership_expires_at": null
}
```

For paid Builder users:

```json
{
  "membership_status": "active",
  "membership_plan_type": "ai_builder",
  "membership_expires_at": "..."
}
```

## Tool List

Use:

```http
GET /api/tools
```

Each tool includes backend-computed access fields:

```json
{
  "id": "...",
  "name": "AI Videos",
  "slug": "ai-videos",
  "requiredPlan": "ai_builder",
  "locked": true,
  "launchable": false,
  "featured": true
}
```

Frontend tool cards should use:

- `tool.locked` to show the lock state.
- `tool.launchable` to enable or disable launch actions.
- `tool.requiredPlan` to show upgrade messaging.

## Tool Card Rules

```tsx
<button disabled={!tool.launchable}>
  {tool.launchable ? 'Launch' : 'Locked'}
</button>
```

Recommended upgrade labels:

```ts
const upgradeLabels: Record<string, string> = {
  ai_builder: 'Upgrade to AI Builder for NGN 30,000',
  ai_product_founder: 'Upgrade to AI Product Founder for NGN 250,000',
};

const upgradeText = upgradeLabels[tool.requiredPlan];
```

## Launching A Tool

Use:

```http
POST /api/tools/:slug/launch
```

Only call this when `tool.launchable === true`.

The backend also enforces access. If a locked tool is launched anyway, the API returns `403`.

## Expected Frontend Behavior

- Onboarded/unpaid user:
  - Dashboard shows `AI Explorer`.
  - Only Explorer tools are unlocked.
  - Builder and Founder tools show locks.

- NGN 30,000 paid user:
  - Dashboard shows `AI Builder`.
  - Explorer and Builder tools are unlocked.
  - Founder tools show locks.

- NGN 250,000 paid user:
  - Dashboard shows `AI Product Founder`.
  - All tools are unlocked.

## Admin Tool Requirements

Admin-created tools should use only these `required_plan` values:

- `ai_explorer`
- `ai_builder`
- `ai_product_founder`

Do not use `standard_member` for tool access.
