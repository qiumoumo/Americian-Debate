import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { EvidenceCard } from "@/components/evidence-card";
import { EvidenceImporter } from "@/components/evidence-importer";
import { EvidenceLibraryPanel } from "@/components/evidence-library-panel";
import { SectionCard } from "@/components/section-card";
import { createDocument, createEvidence, deleteDocument, updateDocument, updateDocumentContent } from "./actions";
import { getDocumentsForWorkspace, getEvidenceForWorkspace } from "@/lib/data";
import { getAnnouncements } from "@/lib/settings";
import { requireUser } from "@/lib/auth";
import { sessionShellUser } from "@/lib/session-props";

export default async function DocumentsPage({
  searchParams
}: {
  searchParams: Promise<{ doc?: string }>;
}) {
  const session = await requireUser();
  const { doc: requestedId } = await searchParams;
  const documents = await getDocumentsForWorkspace(session.workspace.id);

  // 只有传入了有效且属于本 workspace 的文档 id 时，才进入聚焦编辑界面。
  const selectedDocument = requestedId
    ? documents.find((document) => document.id === requestedId.trim())
    : undefined;

  // ----- 编辑状态：只显示这一份文档的正文 / 证据编辑界面。 -----
  if (selectedDocument) {
    return (
      <AppShell
        activeHref="/app/documents"
        user={sessionShellUser(session)}
        note="文档编辑界面：修改标题、正文，管理这份文档的 evidence。"
      >
        <div className="practice-back-row">
          <Link className="button ghost" href="/app/documents">← 返回文档列表</Link>
        </div>

        <SectionCard title="文档信息" description="修改标题和描述。">
          <form action={updateDocument} className="form-grid">
            <input type="hidden" name="documentId" value={selectedDocument.id} />
            <label className="field">
              <span>标题</span>
              <input name="title" defaultValue={selectedDocument.title} required />
            </label>
            <label className="field">
              <span>描述</span>
              <textarea name="description" defaultValue={selectedDocument.description} rows={2} />
            </label>
            <div className="actions">
              <button className="button primary" type="submit">保存信息</button>
              <span className="pill">Updated {selectedDocument.updatedAt}</span>
              <span className="pill">{selectedDocument.evidence.length} cards</span>
            </div>
          </form>
        </SectionCard>

        <div style={{ height: 18 }} />

        <SectionCard title="正文 Document body" description="粘贴 case text、blocks 或笔记；evidence 抽取可以基于这里保存的正文。">
          <form action={updateDocumentContent} className="form-grid">
            <input type="hidden" name="documentId" value={selectedDocument.id} />
            <label className="field">
              <span>Document body</span>
              <textarea
                name="content"
                defaultValue={selectedDocument.contentText ?? ""}
                placeholder="Paste case text, blocks, or notes here. Evidence extraction can build on this stored body."
                rows={8}
              />
            </label>
            <button className="button" type="submit">保存正文</button>
          </form>
        </SectionCard>

        <div style={{ height: 18 }} />

        <SectionCard title="Evidence cards" description="悬停卡片可看到 source、author、date 和打开链接。">
          <div className="grid">
            {selectedDocument.evidence.map((card) => (
              <EvidenceCard key={card.id} evidence={card} showIssues />
            ))}
            {selectedDocument.evidence.length === 0 ? <p className="empty-state">这份文档还没有 evidence。</p> : null}
          </div>
        </SectionCard>

        <div style={{ height: 18 }} />

        <SectionCard title="添加 Evidence" description="添加后会进入资料库，并可在比赛页被 AI 草稿引用。">
          <form action={createEvidence} className="form-grid">
            <input type="hidden" name="documentId" value={selectedDocument.id} />
            <label className="field">
              <span>标题</span>
              <input name="title" placeholder="卡片标题" required />
            </label>
            <label className="field">
              <span>Claim</span>
              <textarea name="claim" placeholder="这条 evidence 支持什么论点？" rows={2} required />
            </label>
            <label className="field">
              <span>Quote</span>
              <textarea name="quote" placeholder="原文引用" rows={4} required />
            </label>
            <div className="form-grid two-columns">
              <label className="field">
                <span>Side</span>
                <select name="side" defaultValue="Generic">
                  <option>Aff</option>
                  <option>Neg</option>
                  <option>Pro</option>
                  <option>Con</option>
                  <option>Generic</option>
                </select>
              </label>
              <label className="field">
                <span>Tags（逗号分隔）</span>
                <input name="tags" placeholder="economy, weighing" />
              </label>
            </div>
            <div className="form-grid two-columns">
              <label className="field">
                <span>Source URL</span>
                <input name="sourceUrl" placeholder="https://..." />
              </label>
              <label className="field">
                <span>Published date</span>
                <input name="publishedDate" placeholder="2026" />
              </label>
            </div>
            <div className="form-grid two-columns">
              <label className="field">
                <span>Author</span>
                <input name="author" placeholder="作者/机构" />
              </label>
              <label className="field">
                <span>Publication</span>
                <input name="publication" placeholder="刊物/报告" />
              </label>
            </div>
            <button className="button primary" type="submit">添加 evidence</button>
          </form>
        </SectionCard>
      </AppShell>
    );
  }

  // ----- 列表状态：创建文档、浏览资料库、选择一份文档进入编辑。 -----
  const evidence = await getEvidenceForWorkspace(session.workspace.id);
  const announcements = await getAnnouncements(session.workspace.id, true);

  return (
    <AppShell
      activeHref="/app/documents"
      user={sessionShellUser(session)}
      note="创建文档后会直接进入编辑界面；从列表可随时打开任意一份文档继续编辑。"
    >
      <section className="hero">
        <div className="eyebrow">Shared Documents</div>
        <h1>共享文档</h1>
        <p>
          文档与 evidence 已从静态 mock 改为本地数据库读写。Evidence 从第一天就结构化保存，方便比赛、AI 引用和统计复用。
        </p>
      </section>

      {announcements.length ? (
        <SectionCard title="队伍公告" description="来自管理员的最新公告。">
          <div className="timeline">
            {announcements.map((item) => (
              <div className="timeline-item" key={item.id}>
                <strong>{item.title}</strong>
                {item.body ? <p>{item.body}</p> : null}
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="新建文档" description="创建后会直接进入这份文档的编辑界面。">
        <form action={createDocument} className="form-grid">
          <label className="field">
            <span>文档标题</span>
            <input name="title" placeholder="例如：July PF Immigration File" required />
          </label>
          <label className="field">
            <span>描述</span>
            <textarea name="description" placeholder="这份资料主要覆盖哪些论点？" rows={3} />
          </label>
          <button className="button primary" type="submit">创建文档 →</button>
        </form>
      </SectionCard>

      <div style={{ height: 18 }} />

      <SectionCard title="文档列表" description="点「打开编辑」进入正文与 evidence 编辑界面；删除采用软删除。">
        <div className="timeline spaced">
          {documents.map((document) => (
            <article className="timeline-item" key={document.id}>
              <div className="actions">
                <strong>{document.title}</strong>
                <span className="pill">Updated {document.updatedAt}</span>
                <span className="pill">{document.evidence.length} cards</span>
              </div>
              {document.description ? <p>{document.description}</p> : null}
              <div className="actions">
                <Link className="button primary" href={`/app/documents?doc=${document.id}`}>打开编辑 →</Link>
                <form action={deleteDocument}>
                  <input type="hidden" name="documentId" value={document.id} />
                  <button className="link-button danger" type="submit">删除文档</button>
                </form>
              </div>
            </article>
          ))}
          {documents.length === 0 ? <p className="empty-state">还没有文档。先创建一份资料文件。</p> : null}
        </div>
      </SectionCard>

      <div style={{ height: 18 }} />

      <SectionCard
        title="导入 Evidence"
        description="粘贴外部 evidence 文本，自动解析 title / claim / quote / source / author / date / tag。检查校验徽章后一键导入，导入后可撤回。"
      >
        <EvidenceImporter documents={documents.map((document) => ({ id: document.id, title: document.title }))} />
      </SectionCard>

      <div style={{ height: 18 }} />

      <SectionCard
        title="Evidence 库 / 搜索"
        description="按 title、claim、quote、author、tag 搜索，或只看有引用问题的卡片。"
      >
        <EvidenceLibraryPanel evidence={evidence} />
      </SectionCard>
    </AppShell>
  );
}
