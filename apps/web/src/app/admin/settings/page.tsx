import { AdminShell } from "@/components/admin-shell";
import { SectionCard } from "@/components/section-card";
import { requireAdmin } from "@/lib/auth";
import { sessionShellUser } from "@/lib/session-props";
import { getAnnouncements, getSystemSettings } from "@/lib/settings";
import {
  createAnnouncement,
  deleteAnnouncement,
  toggleAnnouncement,
  updateSystemSettings
} from "./actions";

const FORMATS = ["PF", "LD", "POLICY", "BP", "CUSTOM"];

export default async function AdminSettingsPage() {
  const session = await requireAdmin();
  const [announcements, settings] = await Promise.all([
    getAnnouncements(session.workspace.id),
    getSystemSettings(session.workspace.id)
  ]);
  const canEditSystem = session.role === "OWNER";

  return (
    <AdminShell activeHref="/admin/settings" user={sessionShellUser(session)}>
      <section className="hero">
        <div className="eyebrow">Settings</div>
        <h1>公告与系统设置</h1>
        <p>发布队伍公告、配置注册开关、默认赛制与密码策略。当前工作区：{session.workspace.name}。</p>
      </section>

      <SectionCard title="发布公告" description="已发布的公告会显示在成员的用户端。">
        <form action={createAnnouncement} className="stack">
          <label className="field">
            <span>标题</span>
            <input name="title" type="text" required />
          </label>
          <label className="field">
            <span>内容</span>
            <textarea name="body" rows={3} />
          </label>
          <label className="check-field">
            <input name="published" type="checkbox" value="true" defaultChecked />
            <span>立即发布</span>
          </label>
          <button className="button primary" type="submit">发布公告</button>
        </form>
      </SectionCard>

      <div style={{ height: 18 }} />

      <SectionCard title="公告列表" description="管理已有公告的发布状态。">
        <div className="table-like admin-table audit-table">
          <div className="table-row header"><div>时间</div><div>标题</div><div>状态</div><div>操作</div></div>
          {announcements.map((item) => (
            <div className="table-row" key={item.id}>
              <div><small>{item.createdAt.toLocaleDateString()}</small></div>
              <div><strong>{item.title}</strong><br /><small>{item.body}</small></div>
              <div><span className="pill">{item.published ? "已发布" : "草稿"}</span></div>
              <div className="action-cell">
                <form action={toggleAnnouncement} className="inline-form">
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="publish" value={item.published ? "false" : "true"} />
                  <button className="button" type="submit">{item.published ? "撤回" : "发布"}</button>
                </form>
                <form action={deleteAnnouncement} className="inline-form">
                  <input type="hidden" name="id" value={item.id} />
                  <button className="button danger" type="submit">删除</button>
                </form>
              </div>
            </div>
          ))}
          {announcements.length === 0 ? <p className="empty-state">还没有公告。</p> : null}
        </div>
      </SectionCard>

      <div style={{ height: 18 }} />

      <SectionCard title="系统设置" description={canEditSystem ? "影响注册与密码策略。" : "仅 OWNER 可修改。"}>
        <form action={updateSystemSettings} className="stack">
          <label className="check-field">
            <input name="registrationOpen" type="checkbox" value="true" defaultChecked={settings.registrationOpen} disabled={!canEditSystem} />
            <span>允许自助注册（关闭后仅邀请可注册）</span>
          </label>
          <label className="field">
            <span>默认赛制</span>
            <select name="defaultFormat" defaultValue={settings.defaultFormat} disabled={!canEditSystem}>
              {FORMATS.map((format) => <option key={format} value={format}>{format}</option>)}
            </select>
          </label>
          <label className="field">
            <span>密码最短长度</span>
            <input name="minPasswordLength" type="number" min={6} max={64} defaultValue={settings.minPasswordLength} disabled={!canEditSystem} />
          </label>
          {canEditSystem ? <button className="button primary" type="submit">保存设置</button> : null}
        </form>
      </SectionCard>
    </AdminShell>
  );
}
