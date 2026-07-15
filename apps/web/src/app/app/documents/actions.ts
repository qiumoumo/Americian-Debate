"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@debate/db";
import { createPlainTextDocument } from "@debate/editor";
import { requireUser } from "@/lib/auth";
import type { Side } from "@debate/shared";
import { sideToPrisma } from "@/lib/mappers";
import { tagsToJson } from "@/lib/data";

function requiredText(formData: FormData, name: string) {
  const value = String(formData.get(name) ?? "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function normalizeSourceUrl(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  if (raw.startsWith("//")) {
    throw new Error("Source URL must include an http:// or https:// scheme.");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Source URL must be a valid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Source URL must use http:// or https://.");
  }

  return parsed.toString();
}

export async function createDocument(formData: FormData) {
  const session = await requireUser();
  const title = requiredText(formData, "title");
  const description = String(formData.get("description") ?? "").trim();

  const created = await db.document.create({
    data: {
      workspaceId: session.workspace.id,
      ownerId: session.user.id,
      title,
      description,
      contentJson: { type: "doc", content: [] }
    },
    select: { id: true }
  });

  revalidatePath("/app/documents");
  // 创建完成 -> 直接进入这份新文档的编辑界面。
  redirect(`/app/documents?doc=${created.id}`);
}

export async function updateDocument(formData: FormData) {
  const session = await requireUser();
  const documentId = requiredText(formData, "documentId");
  const title = requiredText(formData, "title");
  const description = String(formData.get("description") ?? "").trim();

  await db.document.updateMany({
    where: { id: documentId, workspaceId: session.workspace.id, deletedAt: null },
    data: { title, description }
  });

  revalidatePath("/app/documents");
}

export async function updateDocumentContent(formData: FormData) {
  const session = await requireUser();
  const documentId = requiredText(formData, "documentId");
  const content = String(formData.get("content") ?? "");

  await db.document.updateMany({
    where: { id: documentId, workspaceId: session.workspace.id, deletedAt: null },
    data: { contentJson: JSON.parse(JSON.stringify(createPlainTextDocument(content))) }
  });

  revalidatePath("/app/documents");
}

export async function deleteDocument(formData: FormData) {
  const session = await requireUser();
  const documentId = requiredText(formData, "documentId");

  await db.document.updateMany({
    where: { id: documentId, workspaceId: session.workspace.id, deletedAt: null },
    data: { deletedAt: new Date() }
  });

  revalidatePath("/app/documents");
}

export async function createEvidence(formData: FormData) {
  const session = await requireUser();
  const documentId = requiredText(formData, "documentId");
  const document = await db.document.findFirst({
    where: { id: documentId, workspaceId: session.workspace.id, deletedAt: null, ...(session.user.isSystemAdmin ? {} : { ownerId: session.user.id }) },
    select: { id: true }
  });

  if (!document) {
    throw new Error("Document not found");
  }

  const side = String(formData.get("side") ?? "Generic") as Side;

  await db.evidence.create({
    data: {
      documentId: document.id,
      title: requiredText(formData, "title"),
      claim: requiredText(formData, "claim"),
      quote: requiredText(formData, "quote"),
      sourceUrl: normalizeSourceUrl(formData.get("sourceUrl")),
      author: String(formData.get("author") ?? "").trim() || null,
      publication: String(formData.get("publication") ?? "").trim() || null,
      publishedDate: String(formData.get("publishedDate") ?? "").trim() || null,
      side: sideToPrisma[side] ?? "GENERIC",
      tagsJson: tagsToJson(String(formData.get("tags") ?? "")),
      contentRange: {}
    }
  });

  revalidatePath("/app/documents");
}
