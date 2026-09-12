import { type Request, type Response, type NextFunction } from "express";
import { jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";

export interface AuthRequest extends Request {
  userId: string;
  userEmail: string | null;
  userName: string | null;
  userAvatar: string | null;
  activeOutwardAccountId: number | null;
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

function projectIdFromStorageBucket(): string | null {
  const bucket = process.env.FIREBASE_STORAGE_BUCKET?.trim();
  if (!bucket) return null;
  const suffixes = [".firebasestorage.app", ".appspot.com"];
  for (const suffix of suffixes) {
    if (bucket.endsWith(suffix)) return bucket.slice(0, -suffix.length) || null;
  }
  return null;
}

// Codespaces no longer depends on Replit-injected server env. Prefer an
// explicit server project id, but safely fall back to the same Firebase
// project already identified by the configured storage bucket.
const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ||
  projectIdFromStorageBucket();

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
    throw new Error("Firebase project id is not configured on the server.");
  }
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    audience: FIREBASE_PROJECT_ID,
  });
  return payload as FirebaseJWT;
}

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
    // Public routes remain public; protected routes re-verify below.
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
    req.log?.warn({ err: msg }, "Firebase token verification failed");
    res.status(401).json({ error: "Unauthorized" });
  }
};
