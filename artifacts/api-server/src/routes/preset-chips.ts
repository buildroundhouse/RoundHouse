import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { tryAttachAuth, type AuthRequest } from "../middlewares/requireAuth";
import { isAdminUser } from "../lib/rewards";
import {
  PRESET_SET_KEYS,
  createChip,
  listAdminPresetSets,
  listPublicPresetSets,
  renameGroup,
  reorderChips,
  updateChip,
} from "../lib/presetChips";

const router: IRouter = Router();

// Admin gating mirrors the Game Room: an authenticated Clerk user
// whose id is on the ADMIN_CLERK_IDS allowlist.
async function requirePresetAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await tryAttachAuth(req);
  const ar = req as AuthRequest;
  if (ar.userId && (await isAdminUser(ar.userId))) {
    next();
    return;
  }
  res.status(401).json({ error: "Preset chips edit requires admin auth" });
}

// --- Public read -----------------------------------------------------
router.get("/preset-chips", async (_req, res): Promise<void> => {
  const data = await listPublicPresetSets();
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("ETag", `"${data.updatedAt}"`);
  res.json(data);
});

// --- Admin -----------------------------------------------------------
router.get(
  "/admin/preset-chips",
  requirePresetAdmin,
  async (_req, res): Promise<void> => {
    const data = await listAdminPresetSets();
    res.setHeader("Cache-Control", "no-store");
    res.json(data);
  },
);

router.post(
  "/admin/preset-chips",
  requirePresetAdmin,
  async (req, res): Promise<void> => {
    const body = (req.body ?? {}) as {
      setKey?: string;
      label?: string;
      groupKey?: string | null;
    };
    if (!body.setKey || !PRESET_SET_KEYS.includes(body.setKey as never)) {
      res.status(400).json({ error: "Unknown preset set" });
      return;
    }
    const result = await createChip({
      setKey: body.setKey,
      label: body.label ?? "",
      groupKey: body.groupKey ?? null,
    });
    if ("error" in result) {
      res.status(400).json(result);
      return;
    }
    res.status(201).json(result);
  },
);

router.patch(
  "/admin/preset-chips/:id",
  requirePresetAdmin,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid chip id" });
      return;
    }
    const body = (req.body ?? {}) as {
      label?: string;
      groupKey?: string | null;
      archived?: boolean;
    };
    const result = await updateChip(id, body);
    if ("error" in result) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  },
);

router.post(
  "/admin/preset-chips/:setKey/reorder",
  requirePresetAdmin,
  async (req, res): Promise<void> => {
    const setKey = String(req.params.setKey);
    const body = (req.body ?? {}) as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((n): n is number => Number.isFinite(n))
      : [];
    const result = await reorderChips(setKey, ids);
    if ("error" in result) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  },
);

router.patch(
  "/admin/preset-groups/:id",
  requirePresetAdmin,
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid group id" });
      return;
    }
    const body = (req.body ?? {}) as { label?: string };
    const result = await renameGroup(id, body.label ?? "");
    if ("error" in result) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  },
);

export default router;
