import { db } from "@debate/db";

export interface WorkspaceSystemSettings {
  registrationOpen: boolean;
  defaultFormat: string;
  minPasswordLength: number;
}

export const DEFAULT_SYSTEM_SETTINGS: WorkspaceSystemSettings = {
  registrationOpen: true,
  defaultFormat: "PF",
  minPasswordLength: 8
};

const SETTINGS_KEY = "system";

export async function getSystemSettings(workspaceId: string): Promise<WorkspaceSystemSettings> {
  const record = await db.systemSetting.findUnique({
    where: { workspaceId_key: { workspaceId, key: SETTINGS_KEY } }
  });
  if (!record || typeof record.valueJson !== "object" || record.valueJson === null) {
    return DEFAULT_SYSTEM_SETTINGS;
  }
  return { ...DEFAULT_SYSTEM_SETTINGS, ...(record.valueJson as Partial<WorkspaceSystemSettings>) };
}

export async function saveSystemSettings(workspaceId: string, settings: WorkspaceSystemSettings) {
  const valueJson = JSON.parse(JSON.stringify(settings));
  await db.systemSetting.upsert({
    where: { workspaceId_key: { workspaceId, key: SETTINGS_KEY } },
    create: { workspaceId, key: SETTINGS_KEY, valueJson },
    update: { valueJson }
  });
}

export async function getAnnouncements(workspaceId: string, publishedOnly = false) {
  return db.announcement.findMany({
    where: { workspaceId, ...(publishedOnly ? { published: true } : {}) },
    orderBy: { createdAt: "desc" }
  });
}
