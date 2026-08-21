import type { PrismaClient, TransactionClient } from "@tierbase/database";
import { newId, redact } from "@tierbase/shared";

export type ActorType = "USER" | "API_KEY" | "SYSTEM" | "CUSTOMER";

export interface AuditEntry {
  organizationId: string;
  actorType: ActorType;
  actorId?: string | null;
  userId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

/**
 * Audit writes are best-effort: a logging failure must never roll back a
 * financial operation that already succeeded.
 */
export async function recordAudit(
  db: PrismaClient | TransactionClient,
  entry: AuditEntry
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        id: newId("auditLog"),
        organizationId: entry.organizationId,
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        userId: entry.userId ?? null,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId ?? null,
        metadata: (redact(entry.metadata ?? {}) ?? {}) as never,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch {
    // Intentionally swallowed — see the note above.
  }
}
