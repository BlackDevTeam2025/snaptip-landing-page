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

## Scripts
- `npm run dev`: run API + admin dev server
- `npm run dev:api`: run API server only
- `npm run dev:admin`: run admin app only
- `npm run build`: build admin static files to `/admin`
- `npm run lint`: lint backend + admin source
- `npm test`: run unit + integration tests
