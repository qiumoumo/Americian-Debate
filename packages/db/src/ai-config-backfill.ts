import { db } from "./index.ts";

export async function backfillLegacyAIConfigs() {
  const [workspaceConfigs, userConfigs, users] = await Promise.all([
    db.workspaceAIConfig.findMany({ include: { workspace: true }, orderBy: { updatedAt: "desc" } }),
    db.userAIConfig.findMany({ orderBy: { updatedAt: "desc" } }),
    db.user.findMany({ select: { id: true } })
  ]);
  const userIds = new Set(users.map((user) => user.id));

  const migratedWorkspaceIds = new Map<string, string>();
  for (const legacy of workspaceConfigs) {
    const legacyRef = `workspace:${legacy.id}`;
    const existing = await db.aIConfig.findUnique({ where: { legacyRef } });
    const migrated = existing ?? await db.aIConfig.create({
      data: {
        name: `${legacy.workspace.name} · ${legacy.providerId}`,
        scope: "GLOBAL",
        providerId: legacy.providerId,
        model: legacy.model,
        baseUrl: legacy.baseUrl,
        apiKeyEnc: legacy.apiKeyEnc,
        enabled: legacy.enabled,
        updatedByUserId: legacy.updatedByUserId && userIds.has(legacy.updatedByUserId) ? legacy.updatedByUserId : null,
        legacyRef,
        createdAt: legacy.createdAt,
        updatedAt: legacy.updatedAt
      }
    });
    migratedWorkspaceIds.set(legacy.workspaceId, migrated.id);
  }

  const migratedUserIds = new Map<string, string>();
  for (const legacy of userConfigs) {
    const legacyRef = `user:${legacy.id}`;
    const existing = await db.aIConfig.findUnique({ where: { legacyRef } });
    const migrated = existing ?? await db.aIConfig.create({
      data: {
        name: `我的 ${legacy.providerId}`,
        scope: "PERSONAL",
        ownerUserId: legacy.userId,
        providerId: legacy.providerId,
        model: legacy.model,
        baseUrl: legacy.baseUrl,
        apiKeyEnc: legacy.apiKeyEnc,
        enabled: legacy.enabled,
        legacyRef,
        createdAt: legacy.createdAt,
        updatedAt: legacy.updatedAt
      }
    });
    migratedUserIds.set(legacy.userId, migrated.id);
  }

  const currentDefault = await db.aIConfig.findFirst({
    where: { scope: "GLOBAL", enabled: true, isDefault: true }
  });
  if (!currentDefault) {
    const candidate = await db.aIConfig.findFirst({
      where: { scope: "GLOBAL", enabled: true },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }]
    });
    if (candidate) {
      await db.aIConfig.update({ where: { id: candidate.id }, data: { isDefault: true } });
    }
  }

  for (const legacy of userConfigs) {
    if (await db.userAISelection.findUnique({ where: { userId: legacy.userId } })) continue;

    let mode: "AUTO" | "CONFIG" | "ENV" = "AUTO";
    let configId: string | null = null;
    if ((legacy.preferredSource === "personal" || legacy.preferredSource === "auto") && legacy.enabled) {
      mode = "CONFIG";
      configId = migratedUserIds.get(legacy.userId) ?? null;
    } else if (legacy.preferredSource === "workspace") {
      const memberships = await db.membership.findMany({
        where: { userId: legacy.userId },
        orderBy: { createdAt: "asc" },
        select: { workspaceId: true }
      });
      configId = memberships.map((membership) => migratedWorkspaceIds.get(membership.workspaceId)).find(Boolean) ?? null;
      mode = configId ? "CONFIG" : "AUTO";
    } else if (legacy.preferredSource === "env") {
      mode = "ENV";
    }

    await db.userAISelection.create({ data: { userId: legacy.userId, mode, configId } });
  }

  return { global: migratedWorkspaceIds.size, personal: migratedUserIds.size };
}
