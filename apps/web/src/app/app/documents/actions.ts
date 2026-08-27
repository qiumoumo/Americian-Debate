"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  createDocumentRecord,
  documentActorFromSession,
  saveDocumentRecord,
  softDeleteDocumentRecord
} from "@/lib/documents";

export interface DocumentActionResult {
  ok: boolean;
  message: string;
  documentId?: string;
  fieldErrors?: { title?: string };
}

function value(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

function actionError(error: unknown, fallback: string): DocumentActionResult {
  return { ok: false, message: error instanceof Error ? error.message : fallback };
}

export async function createDocument(formData: FormData): Promise<DocumentActionResult> {
  const title = value(formData, "title").trim();
  if (!title) {
    return { ok: false, message: "请填写文档标题。", fieldErrors: { title: "文档标题不能为空。" } };
  }

  try {
    const session = await requireUser();
    const created = await createDocumentRecord(documentActorFromSession(session), {
      title,
      description: value(formData, "description")
    });
    revalidatePath("/app/documents");
    return { ok: true, documentId: created.id, message: "文档已创建。" };
  } catch (error) {
    return actionError(error, "文档创建失败。");
  }
}

export async function saveDocument(formData: FormData): Promise<DocumentActionResult> {
  const documentId = value(formData, "documentId").trim();
  const title = value(formData, "title").trim();
  if (!documentId) return { ok: false, message: "缺少文档 ID。" };
  if (!title) {
    return { ok: false, message: "请填写文档标题。", fieldErrors: { title: "文档标题不能为空。" } };
  }

  try {
    const session = await requireUser();
    await saveDocumentRecord(documentActorFromSession(session), documentId, {
      title,
      description: value(formData, "description"),
      content: value(formData, "content")
    });
    revalidatePath("/app/documents");
    revalidatePath(`/app/documents/${documentId}`);
    return { ok: true, documentId, message: "所有文档改动已保存。" };
  } catch (error) {
    return actionError(error, "文档保存失败。");
  }
}

export async function deleteDocument(formData: FormData): Promise<DocumentActionResult> {
  const documentId = value(formData, "documentId").trim();
  if (!documentId) return { ok: false, message: "缺少文档 ID。" };

  try {
    const session = await requireUser();
    await softDeleteDocumentRecord(documentActorFromSession(session), documentId);
    revalidatePath("/app/documents");
    return { ok: true, documentId, message: "文档已删除。" };
  } catch (error) {
    return actionError(error, "文档删除失败。");
  }
}
