import { and, eq, isNull, or } from "drizzle-orm";
import { workLogsTable } from "@workspace/db";

export function personalTimelineWhere(userId: string, activeOutwardAccountId: number | null, activeModeId: number | null) {
    const attribution = or(eq(workLogsTable.actedByClerkId, userId), and(isNull(workLogsTable.actedByClerkId), eq(workLogsTable.authorClerkId, userId)));
    const accountScope = activeOutwardAccountId != null
      ? or(eq(workLogsTable.authorOutwardAccountId, activeOutwardAccountId),
          and(isNull(workLogsTable.authorOutwardAccountId), activeModeId != null
            ? or(eq(workLogsTable.createdInModeId, activeModeId), isNull(workLogsTable.createdInModeId)) : undefined))
      : activeModeId != null ? or(eq(workLogsTable.createdInModeId, activeModeId), isNull(workLogsTable.createdInModeId)) : undefined;
    return and(attribution, accountScope);
}
