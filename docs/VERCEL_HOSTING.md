# RoundHouse hosting preparation

The rebuilt app lives in `buildroundhouse/RoundHouse` on `rebuild/entry-clean-v1`, under `artifacts/round-house`. The existing Vercel project `foundationapp1` is connected to **`buildroundhouse/Foundation`**, a different repository. Adding this configuration here does not update that deployment automatically. Verify the intended repository and branch before changing its Git connection; do not overwrite Foundation to make the names match.

## Web deployment

Use the repository root as Vercel's Root Directory and the committed `vercel.json`. Remove obsolete dashboard build/output overrides when applying this configuration. `build:vercel` exports the current Expo app into `.vercel/output/static` and creates a Vercel Build Output API routing manifest. App routes fall back to `index.html`; missing JS/assets remain 404s; `/api` requests proxy to the backend without caching.

Required build settings:

| Variable | Value source |
| --- | --- |
| `EXPO_PUBLIC_FIREBASE_API_KEY` | Existing Firebase web app configuration |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | Existing Firebase web app configuration |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | `round-house-nfm9r`, after confirming the intended Firebase project |
| `EXPO_PUBLIC_FIREBASE_APP_ID` | Existing Firebase web app configuration |
| `ROUNDHOUSE_API_ORIGIN` | Permanent HTTPS backend origin, without `/api` or a trailing path |

Only Firebase's public web configuration belongs in the web build. The build deliberately fails when these settings are missing or the backend points at a development tunnel. `EXPO_PUBLIC_DOMAIN` is cleared for this web export so API calls use the same-origin proxy. Automatic local `.env` loading is disabled. Add the final website domain to Firebase Authentication's authorized domains for the sign-in methods that require it.

## Backend deployment

`Dockerfile.api` packages the existing Node backend and production dependencies. Use a persistent container service with HTTPS ingress, restart-on-failure and **one replica** initially. The application currently owns interval jobs for reminders, recurring work and maintenance; running multiple replicas duplicates those jobs. A sleeping Codespace or a short-lived serverless handler does not preserve them. This file prepares the backend; it does not provision a hosting service.

Supply `DATABASE_URL`, `FIREBASE_PROJECT_ID`, and `PORT` (default 3001). Storage also needs Google Cloud credentials supplied by the host, `PUBLIC_OBJECT_SEARCH_PATHS` and `PRIVATE_OBJECT_DIR`. Mount credential files as host secrets or use supported workload credentials; they are excluded from the image. Use a staging database for the first deployment.

Backend startup runs existing schema migrations, backfills and scheduled cleanup, including the existing expired-account cleanup. Building and packaging do not run them. Inspect the target database and its backup before first starting this image against production. A live readiness check must inspect `/api/health` and confirm `migrations.state` is `ok`; `/api/healthz` is only a liveness check.

Optional integrations now use ordinary server configuration:

| Feature | Server variables |
| --- | --- |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BILLING_WEBHOOK_BASE_URL`, `BILLING_RETURN_URL` |
| AI concierge | `OPENAI_API_KEY`; optional `OPENAI_BASE_URL` |

These replace the Replit connector/proxy settings in the runtime. The existing billing mock path still applies when Stripe is disabled; do not treat a successful mock response as proof that payments work. Configure and verify Stripe in test mode before enabling live billing. Verify the webhook signing secret corresponds to the registered endpoint.

## Remaining Replit names

The Expo router no longer uses `https://replit.com/` as its origin. Stripe runtime credentials no longer come from a Replit connection API, and the concierge no longer requires a Replit AI proxy.

`app.replit.roundhouse` remains the existing native application identifier; changing it would change app identity. `stripe-replit-sync` remains a library that connects directly to Stripe and Postgres using the supplied credentials; webhook signature verification is retained. The separate mockup sandbox, legacy mobile build script and old catalog seed script still contain Replit tooling. They are not run by `build:vercel` or `Dockerfile.api`.

## Verification and remaining deployment work

Run `pnpm test:hosting`, the Stripe credential tests, `pnpm --filter @workspace/api-server build`, and `pnpm build:vercel` with staging build variables. The web build can also be checked with explicit synthetic configuration, which verifies compilation only and cannot verify login.

After deployment, verify the website root, a direct nested route, an API route, actual sign-in, homeowner/business onboarding and storage from a phone with the Codespace stopped. Successful local compilation is not proof of these live flows.

At preparation time the connected Vercel tool returned an empty team list and HTTP 403 for the known project. No live Vercel settings, domains, environment variables, deployment or database were changed during preparation. Applying the tested configuration requires access to that project and a provisioned permanent backend origin with its server settings.

References: [Expo web deployment](https://docs.expo.dev/guides/publishing-websites/) and [Vercel Build Output API configuration](https://vercel.com/docs/build-output-api/configuration).
