import { AppShell } from "@/components/app-shell";
import { DocumentListWorkspace } from "@/components/document-list-workspace";
import { requireUser } from "@/lib/auth";
import { getDocumentsForWorkspace } from "@/lib/data";
import { canDeleteDocument, documentActorFromSession } from "@/lib/documents";
import { sessionShellUser } from "@/lib/session-props";

export default async function DocumentsPage() {
  const session = await requireUser();
  const documents = await getDocumentsForWorkspace(session.workspace.id);
  const actor = documentActorFromSession(session);

  return (
    <AppShell
      activeHref="/app/documents"
      user={sessionShellUser(session)}
      note="共享文档集中保存 case 正文与结构化证据；工作区成员可在同一份资料上协作。"
    >
      <DocumentListWorkspace
        canCreate={session.role !== "VIEWER"}
        documents={documents.map((document) => ({
          id: document.id,
          title: document.title,
          description: document.description,
          updatedAt: document.updatedAt,
          evidenceCount: document.evidence.length,
          canDelete: canDeleteDocument(actor, document.ownerId)
        }))}
      />
    </AppShell>
  );
}
