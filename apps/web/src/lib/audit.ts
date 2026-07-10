import { db } from "@debate/db";

interface AuditInput {
  workspaceId: string;
  actorUserId?: string | null;
  actorName?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
}

/**
 * Records an admin write operation to the AuditLog. Never throws — auditing must
 * not break the underlying action.
 */
export async function recordAudit(input: AuditInput) {
  try {
    await db.auditLog.create({
      data: {
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId ?? null,
        actorName: input.actorName ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metaJson: input.meta ? JSON.parse(JSON.stringify(input.meta)) : undefined
      }
    });
  } catch (error) {
    console.error("Failed to write AuditLog", error);
  }
}

export async function getAuditLogs(workspaceId: string, take = 100) {
  return db.auditLog.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take
  });
}
