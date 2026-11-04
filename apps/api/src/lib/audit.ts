import { db, schema } from "../db/client.ts";

export async function audit(
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  data?: unknown,
) {
  await db.insert(schema.auditLog).values({ actorId, action, entity, entityId, data: data ?? null });
}
