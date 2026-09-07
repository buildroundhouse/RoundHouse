import { type Request, type Response, type NextFunction } from "express";
import { jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";

export interface AuthRequest extends Request {
  userId: string;
  userEmail: string | null;
  userName: string | null;
  userAvatar: string | null;
  // Active outward-facing account id for this request, resolved by
  // `withActiveOutwardAccount` from either the `x-active-outward-account-id`
  // header (when present and owned by the caller) or the user's stored
  // `users.active_outward_account_id`. May be null briefly during signup
  // before the user has any outward accounts.
  activeOutwardAccountId: number | null;
  // When the caller is acting as a company skin they don't personally
  // own — i.e. they hold a `team_seats` row on it — this carries the
  // resolved seat + the skin's owner clerk id. Routes use this to
  // gate sensitive surfaces (billing, contact details, etc.) and to
  // stamp `acted_by_clerk_id` for internal attribution. NULL means the
  // caller is acting as a skin they own directly (the common case).
  actingAsTeamSeat: {
    seatId: number;
    skinId: number;
    skinOwnerClerkId: string;
    isAdmin: boolean;
    permissions: {
      seeContacts: boolean;
      seeBilling: boolean;
      createOnProperties: boolean;
      manageTeam: boolean;
    };
  } | null;
}

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;

const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

interface FirebaseJWT extends JWTPayload {
  user_id?: string;
  email?: string;
  name?: string;
  picture?: string;
  firebase?: { sign_in_provider?: string };
}

async function verifyFirebaseIdToken(token: string): Promise<FirebaseJWT> {
  if (!FIREBASE_PROJECT_ID) {
    throw new Error("FIREBASE_PROJECT_ID is not configured on the server.");
  }
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    audience: FIREBASE_PROJECT_ID,
  });
  return payload as FirebaseJWT;
}

/**
 * Non-fatal token verification used by the global /api middleware. If the
 * Authorization header carries a valid Firebase ID token, attaches userId
 * and friends to the request. On any failure (missing token, invalid
 * token, missing project config), returns silently without touching the
 * response. Protected routes must still call `requireAuth` to enforce.
 */
export const tryAttachAuth = async (req: Request): Promise<void> => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) return;
  try {
    const payload = await verifyFirebaseIdToken(token);
    const userId = (payload.sub || payload.user_id) as string | undefined;
    if (!userId) return;
    const ar = req as AuthRequest;
    ar.userId = userId;
    ar.userEmail = payload.email ?? null;
    ar.userName = payload.name ?? null;
    ar.userAvatar = payload.picture ?? null;
  } catch {
    // Silently ignore — public routes still work, protected routes will
    // re-verify via requireAuth and 401 there.
  }
};

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";

  if (!token) {
    res.status(401).json({ error: "Unauthorized: missing bearer token" });
    return;
  }

  try {
    const payload = await verifyFirebaseIdToken(token);
    const userId = (payload.sub || payload.user_id) as string | undefined;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized: token missing subject" });
      return;
    }
    const ar = req as AuthRequest;
    ar.userId = userId;
    ar.userEmail = payload.email ?? null;
    ar.userName = payload.name ?? null;
    ar.userAvatar = payload.picture ?? null;
    next();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Log full detail server-side only — never leak verification internals to clients.
    req.log?.warn({ err: msg }, "Firebase token verification failed");
    res.status(401).json({ error: "Unauthorized" });
  }
};
