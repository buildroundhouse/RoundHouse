import { type Request, type Response, type NextFunction } from "express";
import { db, userModesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { AuthRequest } from "./requireAuth";

export interface ActiveModeRequest extends AuthRequest {
  activeModeId: number | null;
}

export const withActiveMode = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const ar = req as ActiveModeRequest;
  ar.activeModeId = null;

  const raw = req.header("x-active-mode-id");
  if (!raw || !ar.userId) {
    next();
    return;
  }

  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) {
    next();
    return;
  }

  try {
    const [row] = await db
      .select({ id: userModesTable.id })
      .from(userModesTable)
      .where(and(eq(userModesTable.id, id), eq(userModesTable.userClerkId, ar.userId)))
      .limit(1);
    if (row) ar.activeModeId = row.id;
  } catch (err) {
    req.log?.warn({ err: err instanceof Error ? err.message : String(err) }, "withActiveMode failed");
  }

  next();
};
