# snaptip-landing-page

SnapTip landing site + webhook backend + internal admin dashboard.

## Stack
- Landing: static HTML/CSS
- Backend: Express on Vercel Function (`/api/index.js`)
- Admin: React (Vite) served at `/admin`
- DB: Postgres (Neon via `@vercel/postgres`)

## Routes
- `/` `/privacy.html` `/support.html` `/term.html`: landing/static pages
- `/auth/*`: Shopify auth callback endpoints
- `/webhooks/*`: Shopify/Woo webhook endpoints
- `/admin/*`: admin React app
- `/admin-api/*`: admin backend APIs

## Required Env
Copy `.env.example` and configure:
- `POSTGRES_URL` (or `POSTGRES_PRISMA_URL` / `POSTGRES_URL_NON_POOLING`)
- `SHOPIFY_API_SECRET`
- `SHOPIFY_API_KEY`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `INTERNAL_SYNC_SECRET`
- SMTP envs if you want bulk email to send for real:
  - `SMTP_HOST`
  - `SMTP_PORT`
  - `SMTP_USER`
  - `SMTP_PASS`
  - `SMTP_FROM_EMAIL`
  - `SNAPTIP_EMAIL_CTA_URL`

## Scripts
- `npm run dev`: run API + admin dev server
- `npm run dev:api`: run API server only
- `npm run dev:admin`: run admin app only
- `npm run test:seed-tip -- --platform shopify --shop miahn-2.myshopify.com --amount 123.45 --currency USD`: upsert current-month tip data through the internal API
- `npm run build`: build admin static files to `/admin`
- `npm run lint`: lint backend + admin source
- `npm test`: run unit + integration tests

## Shopify install is tracked from OAuth, not a webhook
- Shopify does not send an `app installed` webhook.
- SnapTip treats `GET /auth/callback` as the install ingestion point.
- Successful OAuth callback writes the Shopify shop into `app_installations` with `status=installed`, `active_at`, and shop metadata.
- `POST /webhooks/app/uninstalled` is used later to mark `status=uninstalled` and set `deactivated_at`.

## Two-lane test flow
Use two separate lanes instead of trying to force local dev and production install tracking through the same URL.

### Lane 1: local Shopify app development
- Run the Shopify app locally with `npm run dev` in the Shopify app repo.
- Use this lane for embedded admin UI, checkout extension, settings, billing bypass, and tip runtime behavior.
- Do **not** expect the production admin at `snaptip.tech/admin` to receive installation rows from this lane.

### Lane 2: production OAuth install test on a dev store
Use this lane when you want to test the landing/admin backend end-to-end.

1. Make sure the Shopify app config is deployed with:
   - `application_url = "https://snaptip.tech/auth/start"`
   - `redirect_urls = [ "https://snaptip.tech/auth/callback" ]`
2. Uninstall the app from the dev store.
3. Install it again so the shop goes through `https://snaptip.tech/auth/start`.
4. Verify the row appears in `https://snaptip.tech/admin` → `Installations`.
5. Seed the current month tip amount:

```bash
npm run test:seed-tip -- --platform shopify --shop miahn-2.myshopify.com --amount 123.45 --currency USD
```

6. In Admin `Installations`, select the active row and send the monthly email.
7. Uninstall the app again to verify `deactivated_at` and uninstall status.

## Important warning about `shopify app dev`
- Running `shopify app dev` on the same Shopify app can temporarily switch the remote app URL to the CLI tunnel.
- If that happens, your next install will no longer go through `https://snaptip.tech/auth/start`, so Admin will not receive the production install row.
- If you need to return to the production install lane, redeploy the Shopify app config before reinstalling the app.
