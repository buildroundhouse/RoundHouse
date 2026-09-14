# RoundHouse phone access without a development tunnel

`Dockerfile.web` builds the existing Expo web app and Node API into one container.
The API serves the web export using `ROUNDHOUSE_WEB_DIR`, so both use one HTTPS
origin. Opening the hosted URL requires no Expo tunnel, Codespace, or laptop.
This is the web app; it does not create an App Store or TestFlight build.

## Deployment configuration

`render.yaml` targets `buildroundhouse/RoundHouse`, branch
`fix/permanent-phone-hosting`, and prepares one paid, non-sleeping instance.
Verify the current price and account approval before applying it. Automatic
deployment is initially off. The existing Foundation/Vercel project and custom
domain are not changed by this configuration.

The build needs Firebase's public API key, auth domain, project ID, and app ID.
Only the four `EXPO_PUBLIC_FIREBASE_*` build arguments are declared in the
Dockerfile. The web export clears the old tunnel origin and disables local
environment-file loading. Database and Google service credentials are runtime
secrets and must not be included in the web export or committed to Git.

Runtime needs the existing `DATABASE_URL` and `FIREBASE_PROJECT_ID`. Do not create
an empty replacement database and present it as the user's existing records.
First inspect the intended database and a recovery point. The existing backend
startup runs migrations, backfills, and scheduled maintenance, including expired
account cleanup. Verify those against a database branch before production use.
Keep one instance because maintenance jobs currently run in-process.

Google Cloud storage credentials, `PUBLIC_OBJECT_SEARCH_PATHS`, and
`PRIVATE_OBJECT_DIR` are also needed to verify file uploads. Optional Stripe and
AI settings are documented in `VERCEL_HOSTING.md`. Add the final domain to
Firebase's authorized domains for sign-in methods that require it.

## Verification

Run `pnpm --filter @workspace/api-server exec vitest run src/lib/hostedWeb.test.ts src/routes/health.test.ts`
and `pnpm build:hosted` with the public Firebase configuration. These verify
routing and compilation, not live account or data access.

Before calling the service usable, verify `/`, a direct nested app URL, a real
JavaScript asset, `/api/health` with migrations ready, sign-in, reading saved
records, homeowner/business onboarding, and file uploads. Unknown API endpoints
and missing assets must return 404, never the app's HTML. Use the hosted service
with the Codespace stopped. Then connect the user's Wix-managed domain after
the hosted origin works.

References: https://render.com/docs/web-services,
https://render.com/docs/blueprint-spec, https://render.com/docs/free.
