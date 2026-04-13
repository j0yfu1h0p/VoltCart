# VoltCart Commerce

Full-stack commerce backend (Express + MongoDB) with frontend HTML pages for auth, account, checkout, tracking, and admin operations.

# UI's
<img width="1920" height="1440" alt="create" src="https://github.com/user-attachments/assets/61fe4d8e-d3e5-4f29-a181-866762a57097" />
<img width="1920" height="1440" alt="login-acc" src="https://github.com/user-attachments/assets/bd1cc266-a8f6-4f8d-815a-eee766fe4e61" />
<img width="1920" height="1440" alt="account" src="https://github.com/user-attachments/assets/19405860-7c2d-4b33-90ee-63f9f6363916" />
<img width="1920" height="1440" alt="orders-user" src="https://github.com/user-attachments/assets/186b6f62-56f8-4479-930d-7d1320856389" />
<img width="1920" height="1440" alt="chcekout" src="https://github.com/user-attachments/assets/663540ba-c96e-47f2-929c-c8c3f7c82ac8" />
<img width="1920" height="1440" alt="products-user" src="https://github.com/user-attachments/assets/d7b88fa5-86b5-4f26-bbd3-59a60124957a" />
<img width="1920" height="1440" alt="index" src="https://github.com/user-attachments/assets/eb73130c-3256-4872-922c-c72a33ae0439" />
<img width="1920" height="1440" alt="products" src="https://github.com/user-attachments/assets/85c60934-beba-4600-8e69-04c59dd1dd2e" />
<img width="1920" height="1440" alt="orders" src="https://github.com/user-attachments/assets/c18a76c5-23e8-4325-b59b-935ed490fe3d" />
<img width="1920" height="1440" alt="s-dash2" src="https://github.com/user-attachments/assets/ce7e5dfc-ed61-4a58-8f52-5b7a3e8c2d9d" />
<img width="1920" height="1440" alt="s-dash1" src="https://github.com/user-attachments/assets/ab6358cb-c444-4e0b-8548-bbfe3b8aa3a6" />
<img width="1920" height="1440" alt="dash1" src="https://github.com/user-attachments/assets/cb0422c6-c529-4757-ba46-7618220542fb" />
<img width="1920" height="1440" alt="dash2" src="https://github.com/user-attachments/assets/663331ef-6408-4987-87f8-c2050649ff05" />


## What This Project Includes

- Auth: register, login, refresh token, logout, sessions
- Security: 2FA (TOTP), trusted device token support, magic-link login, account status control
- Account recovery: forgot password + reset password pages
- Store: products, cart, checkout preview
- Payments: Stripe payment intents, webhook processing, refunds
- Orders: tracking, user order history, admin order status updates
- Notifications: user/admin notifications for order/payment events
- Rate limiting: layered auth and endpoint-specific request throttling
- Frontend UI pages under `frontend-ui/`

## Tech Stack

- Node.js (ESM)
- Express 5
- MongoDB + Mongoose
- Stripe
- Redis + `rate-limiter-flexible`
- Nodemailer
- Speakeasy (2FA)

## Project Structure

- `src/` backend API
- `frontend-ui/` static frontend pages
- `postman/auth-api.collection.json` API collection

## Environment Setup

Use `.env` with real values. Important keys:

```bash
PORT=3000
MONGO_URI=...
JWT_SECRET=...
JWT_REFRESH_SECRET=...

# Backend API base
APP_URL=http://localhost:3000

# Frontend base used in magic-link redirects
WEB_APP_URL=http://127.0.0.1:5500/frontend-ui

EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=...
EMAIL_PASS=...
EMAIL_FROM=...

REDIS_HOST=...
REDIS_PORT=...
REDIS_PASSWORD=...

STRIPE_SECRET_KEY=...
STRIPE_PUBLIC_KEY=...
STRIPE_WEBHOOK_SECRET=...
```

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Start backend:

```bash
npm run dev
```

3. Start frontend static server from project root (example):

```bash
npx serve . -l 5500
```

Then open frontend pages like:

- `http://127.0.0.1:5500/frontend-ui/index.html`
- `http://127.0.0.1:5500/frontend-ui/login.html`

## Core API Groups

### Auth (`/auth`)

- `POST /register`
- `POST /login`
- `POST /refresh-token`
- `POST /logout`
- `GET /me`
- `PATCH /me`
- `PATCH /me/password`
- `DELETE /me`

### Recovery + Verification

- `POST /forgot-password`
- `GET /reset-password/:token`
- `POST /reset-password/:token`
- `POST /email/verify`
- `GET /verify-email/:token`
- `POST /email/verify/resend`

### Magic Link

- `POST /magic-link/request`
- `POST /magic-link/verify`
- `GET /magic-link/verify/:token`

### Orders (`/orders`)

- `GET /preview`
- `GET /`
- `GET /tracking/:tracking_id`
- `GET /:id`
- `POST /:id/refund-request` (user refund request flow)

### Stripe (`/stripe`)

- `POST /payment-intents`
- `POST /refunds/:payment_intent_id` (admin)
- `POST /stripe/webhook` (raw body)

### Admin (`/admin`)

- Orders, payments, ledger, webhooks
- Order status updates
- Refund initiation

## User Refund Request Flow

New user-facing refund request support:

1. User opens account order history.
2. For paid orders, UI shows `Request Refund`.
3. UI calls `POST /orders/:id/refund-request`.
4. Backend:
   - validates order ownership and eligibility
   - prevents duplicate requests
   - records timeline entry
   - sets support issue flag
   - creates user + admin notifications

This is a request workflow (not direct automatic refund). Admin can review and process through existing admin/Stripe refund flows.

## Frontend Notes

- Shared shell and drawer: `frontend-ui/shared-shell.js`, `frontend-ui/shared-shell.css`
- Checkout/auth redirects validate JWT expiry client-side
- Magic-link login now routes to frontend URL and uses explicit user action

## Rate Limiting

Layered protection is enabled:

- Global auth limiter
- Login-specific account lock limiter
- Endpoint-specific limiter for:
  - register
  - refresh-token
  - forgot-password
  - magic-link request/verify
  - email/token verification
  - reset-password token endpoints

## Email Events Already Wired

- Password change security email
- Magic-link email
- Order booked email (payment success)
- Order status update email (admin updates)
- Refund status email (admin refund path)

## Postman

Import:

- `postman/auth-api.collection.json`

## Production Recommendations

- Use strong secrets and rotate regularly
- Enforce HTTPS and secure proxy headers
- Use real SMTP + monitored sender domain
- Move async work (email/webhooks) to queue workers
- Add automated tests and CI gates
