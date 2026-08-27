import { db, type Role } from "@debate/db";
import { createPlainTextDocument } from "@debate/editor";
import { mapDocument } from "./mappers.ts";

export interface DocumentActor {
  userId: string;
  workspaceId: string;
  role: Role;
  isSystemAdmin: boolean;
}

export interface DocumentDraft {
  title: string;
  description: string;
}

export interface DocumentContentDraft extends DocumentDraft {
  content: string;
}

export function documentActorFromSession(session: {
  user: { id: string; isSystemAdmin: boolean };
  workspace: { id: string };
  role: Role;
}): DocumentActor {
  return {
    userId: session.user.id,
    workspaceId: session.workspace.id,
    role: session.role,
    isSystemAdmin: session.user.isSystemAdmin
  };
}

export function canEditDocuments(actor: DocumentActor) {
  return actor.role !== "VIEWER";
}

export function canDeleteDocument(actor: DocumentActor, ownerId: string) {
  return actor.userId === ownerId || actor.role === "OWNER" || actor.role === "COACH" || actor.isSystemAdmin;
}

function requiredTitle(value: string) {
  const title = value.trim();
  if (!title) throw new Error("文档标题不能为空");
  return title;
}

async function findActiveDocument(actor: DocumentActor, documentId: string) {
  const document = await db.document.findFirst({
    where: { id: documentId, workspaceId: actor.workspaceId, deletedAt: null },
    include: { evidence: { orderBy: { createdAt: "desc" } } }
  });
  if (!document) throw new Error("文档不存在或不属于当前工作区");
  return document;
}

export async function requireDocumentAccess(actor: DocumentActor, documentId: string, intent: "view" | "edit" | "delete") {
  const document = await findActiveDocument(actor, documentId);
  if (intent === "edit" && !canEditDocuments(actor)) {
    throw new Error("只读成员不能修改文档");
  }
  if (intent === "delete" && !canDeleteDocument(actor, document.ownerId)) {
    throw new Error("没有删除这份文档的权限");
  }
  return document;
}

export async function createDocumentRecord(actor: DocumentActor, input: DocumentDraft) {
  if (!canEditDocuments(actor)) throw new Error("只读成员不能创建文档");
  return db.document.create({
    data: {
      workspaceId: actor.workspaceId,
      ownerId: actor.userId,
      title: requiredTitle(input.title),
      description: input.description.trim(),
      contentJson: { type: "doc", content: [] }
    },
    select: { id: true }
  });
}

export async function getDocumentRecord(actor: DocumentActor, documentId: string) {
  const document = await requireDocumentAccess(actor, documentId, "view");
  return { ...mapDocument(document), ownerId: document.ownerId };
}

export async function saveDocumentRecord(actor: DocumentActor, documentId: string, input: DocumentContentDraft) {
  await requireDocumentAccess(actor, documentId, "edit");
  const result = await db.document.updateMany({
    where: { id: documentId, workspaceId: actor.workspaceId, deletedAt: null },
    data: {
      title: requiredTitle(input.title),
      description: input.description.trim(),
      contentJson: JSON.parse(JSON.stringify(createPlainTextDocument(input.content)))
    }
  });
  if (result.count !== 1) throw new Error("文档保存失败");
}

export async function softDeleteDocumentRecord(actor: DocumentActor, documentId: string) {
  await requireDocumentAccess(actor, documentId, "delete");
  const result = await db.document.updateMany({
    where: { id: documentId, workspaceId: actor.workspaceId, deletedAt: null },
    data: { deletedAt: new Date() }
  });
  if (result.count !== 1) throw new Error("文档删除失败");
}
