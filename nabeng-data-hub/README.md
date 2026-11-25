# Nabeng Data Hub

Static frontend + Express API for Paystack payment verification and DataJust bundle fulfillment.

## Security first
The uploaded project contained credentials in `.env.example` and the README. Those values have been removed from this corrected copy. Treat the previously shared Paystack secret, DataJust API key, and Supabase service-role key as compromised and rotate them before testing. Keep fresh secrets only in local `.env` and Render environment variables.


## Local development
Run commands from the project root (the folder containing `package.json` and `server.js`):

```cmd
copy .env.example .env
npm install
npm run dev
```

Fill `.env` with your fresh credentials. The API runs at `http://localhost:3000`; check `http://localhost:3000/api/health`.

Serve `frontend/` using VS Code Live Server. Local frontend requests use `http://localhost:3000` automatically.

## Supabase setup / migration
Open Supabase SQL Editor and run `supabase/schema.sql`. It creates/updates the orders table and the atomic delivery-claim function. If the orders table already exists, this script adds the function and trigger/policy changes without deleting orders.

## Render backend
Deploy the repository root as a Render Web Service:
- Root Directory: leave blank (project root)
- Build Command: `npm install`
- Start Command: `npm start`

Set these environment variables in Render (using rotated/fresh values): `PORT` (optional), `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `DATARJUST_API_KEY`, `DATARJUST_BASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FRONTEND_URL`.

Set the Paystack webhook to `https://YOUR-API-URL/api/paystack/webhook`.

## Frontend production connection
Before deploying the static frontend, edit `frontend/config.js` and set `window.NABENG_API_BASE` to your deployed API URL, e.g. `https://your-api-name.onrender.com`. Set the backend `FRONTEND_URL` to the frontend's exact deployed origin (no trailing slash), then redeploy/restart backend.

## Payment and delivery protections in this version
- Prices and package labels are checked server-side against the catalogue.
- Paystack verification must match reference, success status, GHS currency, and exact amount.
- Webhook signature is checked before accepting the event.
- The order delivery claim is atomic in Supabase to prevent webhook and browser verification from both delivering the same order concurrently.
- Provider delivery failures are recorded as `delivery_failed`; retry attempts use the same order idempotency key.
- API routes have basic per-process rate limiting.

Provider API contract details should be checked with DataJust before real-money transactions. Test end-to-end in Paystack test mode first. This code cannot guarantee exactly-once delivery unless the DataJust API honors the supplied idempotency key.
