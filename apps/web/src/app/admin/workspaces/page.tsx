import { AdminShell } from "@/components/admin-shell";
import { SectionCard } from "@/components/section-card";
import { requireAdmin } from "@/lib/auth";
import { sessionShellUser } from "@/lib/session-props";
import { getAdminWorkspaces } from "@/lib/data";
import { archiveWorkspace, createWorkspace, renameWorkspace, switchWorkspace } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "请填写工作区名称。",
  forbidden: "没有权限操作该工作区。",
  last_workspace: "不能归档你唯一的工作区。",
  current: "不能归档当前正在使用的工作区，请先切换。"
};

export default async function AdminWorkspacesPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; switched?: string }>;
}) {
  const session = await requireAdmin();
  const [workspaces, params] = await Promise.all([getAdminWorkspaces(session.user.id), searchParams]);
  const errorMessage = params.error ? ERROR_MESSAGES[params.error] ?? "操作失败。" : null;

  return (
    <AdminShell activeHref="/admin/workspaces" user={sessionShellUser(session)}>
      <section className="hero">
        <div className="eyebrow">Workspaces</div>
        <h1>工作区 / 队伍管理</h1>
        <p>创建、重命名、归档工作区，并切换当前管理的工作区。当前：{session.workspace.name}。</p>
      </section>

      {errorMessage ? <p className="empty-state">{errorMessage}</p> : null}
      {params.switched ? <p className="small-note">已切换当前管理工作区。</p> : null}

      <SectionCard title="新建工作区" description="创建后你将成为其 OWNER。">
        <form action={createWorkspace} className="inline-form">
          <input name="name" type="text" placeholder="工作区名称" required />
          <button className="button primary" type="submit">创建</button>
        </form>
      </SectionCard>

      <div style={{ height: 18 }} />

      <SectionCard title="我的工作区" description="你作为 OWNER / COACH 参与的工作区。">
        <div className="table-like admin-table workspaces-table">
          <div className="table-row header"><div>工作区</div><div>规模</div><div>角色</div><div>操作</div></div>
          {workspaces.map((ws) => {
            const isCurrent = ws.id === session.workspace.id;
            return (
              <div className="table-row" key={ws.id}>
                <div>
                  <strong>{ws.name}</strong>
                  {isCurrent ? <span className="pill">当前</span> : null}
                </div>
                <div><small>{ws.memberCount} 成员 · {ws.documentCount} 文档 · {ws.matchCount} 比赛</small></div>
                <div><span className="pill">{ws.role}</span></div>
                <div className="action-cell">
                  {!isCurrent ? (
                    <form action={switchWorkspace} className="inline-form">
                      <input type="hidden" name="workspaceId" value={ws.id} />
                      <button className="button" type="submit">切换到此</button>
                    </form>
                  ) : null}
                  {ws.role === "OWNER" ? (
                    <form action={renameWorkspace} className="inline-form">
                      <input type="hidden" name="workspaceId" value={ws.id} />
                      <input name="name" type="text" placeholder="新名称" required />
                      <button className="button" type="submit">重命名</button>
                    </form>
                  ) : null}
                  {ws.role === "OWNER" && !isCurrent ? (
                    <form action={archiveWorkspace} className="inline-form">
                      <input type="hidden" name="workspaceId" value={ws.id} />
                      <button className="button danger" type="submit">归档</button>
                    </form>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </AdminShell>
  );
}
