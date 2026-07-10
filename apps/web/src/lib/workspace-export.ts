import { db } from "@debate/db";

export const WORKSPACE_EXPORT_VERSION = 1;

/** Serializes a workspace's structured data to a plain object for JSON export. */
export async function buildWorkspaceExport(workspaceId: string, workspaceName: string) {
  const [documents, matches, memberships, announcements] = await Promise.all([
    db.document.findMany({ where: { workspaceId, deletedAt: null }, include: { evidence: true } }),
    db.match.findMany({
      where: { workspaceId, deletedAt: null },
      include: { argumentOutcomes: true, reflection: true, speechNotes: true }
    }),
    db.membership.findMany({ where: { workspaceId }, include: { user: { select: { email: true, name: true } } } }),
    db.announcement.findMany({ where: { workspaceId } })
  ]);

  return {
    version: WORKSPACE_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    workspace: { id: workspaceId, name: workspaceName },
    members: memberships.map((m) => ({ email: m.user.email, name: m.user.name, role: m.role })),
    documents,
    matches,
    announcements
  };
}

interface ImportPayload {
  version?: number;
  documents?: Array<{ title?: string; description?: string; contentJson?: unknown; evidence?: unknown[] }>;
  announcements?: Array<{ title?: string; body?: string; published?: boolean }>;
}

export interface ImportOutcome {
  ok: boolean;
  message: string;
  documents?: number;
  announcements?: number;
}

/** Imports documents + announcements from an exported payload (additive). */
export async function importWorkspaceData(args: { workspaceId: string; ownerId: string; raw: string }): Promise<ImportOutcome> {
  let parsed: ImportPayload;
  try {
    parsed = JSON.parse(args.raw) as ImportPayload;
  } catch {
    return { ok: false, message: "JSON 解析失败。" };
  }
  if (parsed.version !== WORKSPACE_EXPORT_VERSION) {
    return { ok: false, message: `不支持的导出版本（期望 ${WORKSPACE_EXPORT_VERSION}）。` };
  }

  let importedDocs = 0;
  let importedAnnouncements = 0;

  await db.$transaction(async (tx) => {
    for (const doc of parsed.documents ?? []) {
      if (!doc.title) continue;
      const created = await tx.document.create({
        data: {
          workspaceId: args.workspaceId,
          ownerId: args.ownerId,
          title: doc.title,
          description: doc.description ?? "",
          contentJson: (doc.contentJson ?? {}) as object
        }
      });
      for (const ev of (doc.evidence as Array<Record<string, unknown>> | undefined) ?? []) {
        await tx.evidence.create({
          data: {
            documentId: created.id,
            title: String(ev.title ?? ""),
            claim: String(ev.claim ?? ""),
            quote: String(ev.quote ?? ""),
            sourceUrl: String(ev.sourceUrl ?? ""),
            author: ev.author ? String(ev.author) : null,
            publication: ev.publication ? String(ev.publication) : null,
            publishedDate: ev.publishedDate ? String(ev.publishedDate) : null,
            tagsJson: (ev.tagsJson ?? []) as object,
            contentRange: (ev.contentRange ?? {}) as object
          }
        });
      }
      importedDocs += 1;
    }

    for (const ann of parsed.announcements ?? []) {
      if (!ann.title) continue;
      await tx.announcement.create({
        data: {
          workspaceId: args.workspaceId,
          title: ann.title,
          body: ann.body ?? "",
          published: Boolean(ann.published),
          createdByUserId: args.ownerId
        }
      });
      importedAnnouncements += 1;
    }
  });

  return { ok: true, message: `导入完成：${importedDocs} 个文档、${importedAnnouncements} 条公告。`, documents: importedDocs, announcements: importedAnnouncements };
}
