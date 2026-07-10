import { AdminShell } from "@/components/admin-shell";
import { SectionCard } from "@/components/section-card";
import { requireAdmin } from "@/lib/auth";
import { sessionShellUser } from "@/lib/session-props";

const ERROR_MESSAGES: Record<string, string> = {
  forbidden: "仅 OWNER 可导入数据。",
  empty: "请粘贴导出的 JSON。",
  parse: "JSON 解析失败或版本不支持。"
};

export default async function AdminDataPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; imported?: string }>;
}) {
  const session = await requireAdmin();
  const params = await searchParams;
  const canImport = session.role === "OWNER";
  const errorMessage = params.error ? ERROR_MESSAGES[params.error] ?? "操作失败。" : null;

  return (
    <AdminShell activeHref="/admin/data" user={sessionShellUser(session)}>
      <section className="hero">
        <div className="eyebrow">Data</div>
        <h1>数据备份 / 导入导出</h1>
        <p>导出当前工作区的结构化数据为 JSON，或从 JSON 导入。当前工作区：{session.workspace.name}。</p>
      </section>

      {errorMessage ? <p className="empty-state">{errorMessage}</p> : null}
      {params.imported ? <p className="small-note">导入完成：{params.imported} 个文档。</p> : null}

      <div className="grid two">
        <SectionCard title="导出" description="下载文档、evidence、比赛记录、公告与成员名单的 JSON 快照。">
          <a className="button primary" href="/admin/data/export" download>
            下载 JSON 导出
          </a>
        </SectionCard>

        <SectionCard title="导入" description={canImport ? "把导出的 JSON 粘贴到下方，将以新增方式写入当前工作区。" : "仅 OWNER 可导入。"}>
          {canImport ? (
            <form action="/admin/data/import" method="post" className="stack">
              <label className="field">
                <span>导出 JSON</span>
                <textarea name="payload" rows={8} placeholder='{"version":1,...}' required />
              </label>
              <button className="button" type="submit">导入到当前工作区</button>
            </form>
          ) : (
            <p className="empty-state">没有导入权限。</p>
          )}
        </SectionCard>
      </div>

      <div style={{ height: 18 }} />

      <SectionCard title="SQLite 备份（本地运维）" description="本地部署时可直接备份数据库文件。">
        <div className="timeline">
          <div className="timeline-item"><strong>数据库文件</strong><p>项目根 <code>prisma/dev-mvp.db</code>（由 DATABASE_URL 指定）。停止 dev server 后复制该文件即为完整备份。</p></div>
          <div className="timeline-item"><strong>恢复</strong><p>用备份文件覆盖原文件后重启即可。</p></div>
        </div>
      </SectionCard>
    </AdminShell>
  );
}
