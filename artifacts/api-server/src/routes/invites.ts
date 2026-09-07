/**
 * Task #663 — business invites are retired alongside `user_connections`.
 *
 * The avatar-to-avatar collaborator handshake the legacy
 * /invites/business endpoints created has been replaced by the
 * entity-membership flow (see `routes/entities.ts` and
 * `routes/app-invites.ts`). Adding someone to a property, business, or
 * commercial-property workspace now goes through `entity_members`
 * directly; there is no longer a separate "business invite" object that
 * gates a back-channel collaborator connection.
 *
 * The endpoints below remain registered as 410 Gone stubs so any
 * remaining mobile or web client still pointing at them fails loudly
 * (and surfaces a deprecation message) instead of silently no-oping.
 * They keep the same paths, methods, and minimal shape; the body is a
 * stable error envelope clients can recognize.
 */
import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

const GONE_BODY = {
  error:
    "Business invites are no longer supported. Add this person to the workspace (property or business) directly.",
  code: "endpoint_removed",
} as const;

function gone(_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }): void {
  res.status(410).json(GONE_BODY);
}

router.get("/invites/business", requireAuth, gone);
router.post("/invites/business", requireAuth, gone);
router.post("/invites/business/accept", requireAuth, gone);
// Token lookup is unauthenticated by design (the email landing page hits
// it before sign-in) — keep the same shape so a stale link still
// responds with the deprecation envelope rather than a 404 surprise.
router.get("/invites/business/:token", gone);

export default router;
