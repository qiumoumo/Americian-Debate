import type { Evidence } from "@debate/shared";

export interface EvidenceMarkAttributes {
  evidenceId: string;
  sourceUrl: string;
  title: string;
}

export function createEvidenceReferenceAttributes(evidence: Evidence): EvidenceMarkAttributes {
  return {
    evidenceId: evidence.id,
    sourceUrl: evidence.sourceUrl,
    title: evidence.title
  };
}

export interface PlainTextDocumentNode {
  type: "doc";
  content: Array<{
    type: "paragraph";
    content?: Array<{ type: "text"; text: string }>;
  }>;
}

export function createPlainTextDocument(text: string): PlainTextDocumentNode {
  const paragraphs = text.split(/\r?\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return {
    type: "doc",
    content: paragraphs.length
      ? paragraphs.map((paragraph) => ({
          type: "paragraph" as const,
          content: [{ type: "text" as const, text: paragraph }]
        }))
      : []
  };
}

export function readPlainTextDocument(value: unknown) {
  if (!value || typeof value !== "object" || !("content" in value) || !Array.isArray((value as { content?: unknown }).content)) {
    return "";
  }

  return (value as PlainTextDocumentNode).content
    .map((node) => node.content?.map((child) => child.text).join("") ?? "")
    .join("\n\n");
}

export const evidenceEditorRoadmap = [
  "TipTap extension for evidence marks",
  "Hover Reference Bar with source, author, date, and quick-open link",
  "Structured evidence extraction from selected rich text",
  "Yjs collaboration once local editing is stable"
] as const;
