import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DocumentWorkbench } from "@/components/document-workbench";
import { requireUser } from "@/lib/auth";
import { canEditDocuments, documentActorFromSession, getDocumentRecord } from "@/lib/documents";
import { sessionShellUser } from "@/lib/session-props";

export default async function DocumentEditorPage({ params }: { params: Promise<{ documentId: string }> }) {
  const session = await requireUser();
  const { documentId } = await params;
  const actor = documentActorFromSession(session);
  const document = await getDocumentRecord(actor, documentId).catch(() => notFound());

  return (
    <AppShell
      activeHref="/app/documents"
      user={sessionShellUser(session)}
      note="文档工作台：左侧维护正文，右侧选择、编辑或导入这份文档的证据。"
    >
      <DocumentWorkbench document={document} canEdit={canEditDocuments(actor)} />
    </AppShell>
  );
}
