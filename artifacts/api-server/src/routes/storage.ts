import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import cookieParser from "cookie-parser";
import { decodeJwt } from "jose";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { canUserAccessObjectPath, isPublicProfileMedia, recordObjectUpload } from "../lib/objectAccess";
import { requireAuth, tryAttachAuth, type AuthRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const mediaCookie = "roundhouse_media";
const cookieOptions = {
  httpOnly: true, secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const, path: "/api/storage",
};
router.use("/storage", cookieParser());

// Browser images and download links cannot set a bearer header. Keep a
// short-lived Firebase token in an HttpOnly cookie used ONLY for file reads.
router.post("/storage/session", requireAuth, (req: Request, res: Response) => {
  const token = req.headers.authorization!.slice("Bearer ".length).trim();
  const expiresAt = decodeJwt(token).exp ?? 0; // requireAuth already verified it
  res.cookie(mediaCookie, token, { ...cookieOptions, maxAge: Math.max(0, expiresAt * 1000 - Date.now()) });
  res.setHeader("Cache-Control", "no-store");
  res.status(204).end();
});

router.delete("/storage/session", (_req: Request, res: Response) => {
  res.clearCookie(mediaCookie, cookieOptions);
  res.status(204).end();
});

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", requireAuth, async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { userId, activeOutwardAccountId } = req as AuthRequest;
    const { name, size, contentType } = parsed.data;
    if (!Number.isSafeInteger(size) || size <= 0 || size > 25 * 1024 * 1024) {
      res.status(400).json({ error: "Choose a file between 1 byte and 25 MB" });
      return;
    }

    const { uploadURL, objectPath } = await objectStorageService.requestUpload(contentType, size);

    // Track who uploaded this path so attachment-write routes can later
    // reject reference spoofing (writing someone else's path into your
    // own property's records). Stamp the active outward account so the
    // file is owned by the skin (Trade Pro, Homeowner, …) the user was
    // acting under at upload time.
    await recordObjectUpload(userId, objectPath, activeOutwardAccountId);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve private object entities from PRIVATE_OBJECT_DIR. The caller must be
 * authenticated AND must be a member of a property that references the
 * requested path through one of: property specs, property notes, work orders,
 * work logs, or property standard evidence.
 *
 * Sharing model: to grant another user access to a file, attach it to a record
 * on a property they belong to (or add them as a member of a property whose
 * records already reference the file). Files that are not yet attached to any
 * record are accessible only via the original presigned upload URL — once a
 * record references them, every member of that property can read them.
 *
 * Note on user avatars: avatar paths live under /objects/ but are NOT used as
 * authorization input here. A user-controlled string (users.avatarUrl) cannot
 * grant read access to a private path — otherwise a user could point their
 * avatar at any object id and bypass the property check. Avatar fetching that
 * crosses property boundaries needs a dedicated mechanism (signed URL or a
 * separate avatar-serving route).
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;

    // Profile media (avatar, company logo, header background) is treated as
    // public and served WITHOUT requiring an Authorization header. React
    // Native <Image> can't attach our Firebase bearer token, so requiring
    // auth here would 401 every profile photo. The uploader-match guard
    // below still defends against a user spoofing someone else's private
    // object via a profile field.
    const profilePublic = await isPublicProfileMedia(objectPath);
    if (profilePublic) {
      const response = await objectStorageService.downloadObjectEntity(objectPath);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (response.body) {
        const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
        nodeStream.pipe(res);
      } else {
        res.end();
      }
      return;
    }

    // All other private object reads require an authenticated caller with
    // membership-based access to the path.
    // Never accept a cookie from a cross-origin fetch, even if global CORS
    // permits bearer-authenticated API clients on other origins.
    const origin = req.get("origin");
    const sameOrigin = !origin || origin === `https://${req.get("host")}` ||
      (process.env.NODE_ENV !== "production" && origin === `http://${req.get("host")}`);
    if (!req.headers.authorization && sameOrigin && req.get("sec-fetch-site") !== "cross-site") {
      const token = req.cookies?.[mediaCookie];
      if (typeof token === "string") req.headers.authorization = `Bearer ${token}`;
    }
    const authHeader = req.header("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    await tryAttachAuth(req);
    if (!(req as AuthRequest).userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { userId } = req as AuthRequest;

    const allowed = await canUserAccessObjectPath(userId, objectPath);
    if (!allowed) {
      // Resolve the file existence after the ACL check so we don't leak which
      // paths exist to unauthorized callers.
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const response = await objectStorageService.downloadObjectEntity(objectPath);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
