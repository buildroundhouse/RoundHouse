import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { UploadOwnershipError } from "./lib/objectAccess";
import { tryAttachAuth, type AuthRequest } from "./middlewares/requireAuth";
import { withActiveMode } from "./middlewares/withActiveMode";
import { withActiveOutwardAccount } from "./middlewares/withActiveOutwardAccount";
import { migrationReadiness } from "./middlewares/migrationReadiness";
import { processStripeWebhook } from "./lib/stripeWebhook";

const app: Express = express();
// Disable Express's weak ETag generation. The default weak ETag matches
// when the Content-Length is identical, which silently produces 304s on
// responses whose payload changed but happens to be the same length —
// e.g. /api/outward-accounts whose `activeOutwardAccountId` flips between
// numerically-similar ids. Clients then receive cached stale data.
app.disable("etag");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({ credentials: true, origin: true }));

// Stripe webhook MUST be registered with a raw body parser BEFORE
// express.json() so the signature verification can recompute the hash
// over the exact bytes Stripe signed.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature" });
      return;
    }
    const sig = Array.isArray(signature) ? signature[0] : signature;
    try {
      await processStripeWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (err) {
      req.log?.warn({ err }, "Stripe webhook rejected");
      res.status(400).json({ error: "Webhook processing error" });
    }
  },
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Best-effort attach req.userId + req.activeModeId for any request that
// presents a bearer token + x-active-mode-id header. This is non-fatal:
// invalid/missing tokens are silently ignored so public routes (e.g.
// /healthz, /storage/public-objects, /app-invites/by-token/:token) still
// work even if a stale Authorization header is sent. Protected routes
// MUST still call requireAuth themselves to enforce auth.
// Readiness gate (#392): block /api/* traffic when boot-time
// migrations have not finished cleanly. Health probes are allowed
// through so deploy tooling can still observe what state we're in.
app.use("/api", migrationReadiness);

app.use("/api", async (req, res, next) => {
  if (req.headers.authorization) {
    await tryAttachAuth(req);
  }
  if ((req as Partial<AuthRequest>).userId) {
    await withActiveMode(req, res, async () => {
      await withActiveOutwardAccount(req, res, () => next());
    });
  } else {
    next();
  }
});

app.use("/api", router);

const uploadOwnershipErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (err instanceof UploadOwnershipError) {
    req.log?.warn({ objectPath: err.objectPath }, "Upload ownership check rejected");
    res.status(403).json({ error: "Forbidden: cannot reference another user's upload" });
    return;
  }
  next(err);
};
app.use(uploadOwnershipErrorHandler);

export default app;
