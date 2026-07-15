import { AdminShell } from "@/components/admin-shell";
import { AccountPasswordReset } from "@/components/account-password-reset";
import { SectionCard } from "@/components/section-card";
import { requireSystemAdmin } from "@/lib/auth";
import { getGlobalAccounts, type GlobalAccountFilter } from "@/lib/accounts";
import { sessionShellUser } from "@/lib/session-props";
import { deleteGlobalAccountAction, setGlobalAccountDisabledAction, setGlobalSystemAdminAction } from "./actions";

const FILTERS: Array<{ value: GlobalAccountFilter; label: string }> = [
  { value: "all", label: "全部账号" },
  { value: "online", label: "当前在线" },
  { value: "disabled", label: "已禁用" },
  { value: "admin", label: "系统管理员" }
];

export default async function AdminAccountsPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string }> }) {
  const session = await requireSystemAdmin();
  const params = await searchParams;
  const filter = FILTERS.some((item) => item.value === params.filter) ? params.filter as GlobalAccountFilter : "all";
  const accounts = await getGlobalAccounts(session.user.id, { query: params.q, filter });
  return (
    <AdminShell activeHref="/admin/accounts" user={sessionShellUser(session)}>
      <section className="hero"><div className="eyebrow">Accounts</div><h1>注册账号管理</h1><p>查看主机上的全部注册账号。密码采用单向哈希，管理员只能重置，不能查看原密码。</p></section>
      <SectionCard title="搜索与筛选" description="在线状态取最近 30 秒内的真实客户端心跳。">
        <form className="account-filter" method="get">
          <input type="search" name="q" defaultValue={params.q ?? ""} placeholder="姓名或邮箱" />
          <select name="filter" defaultValue={filter}>{FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          <button className="button primary" type="submit">筛选</button>
        </form>
      </SectionCard>
      <div style={{ height: 18 }} />
      <SectionCard title={`账号列表（${accounts.length}）`} description="永久删除会清理该账号拥有的数据，且不可恢复。">
        <div className="account-list">
          {accounts.map((account) => {
            const isSelf = account.id === session.user.id;
            return <article className="account-row" key={account.id}>
              <div className="account-summary">
                <div><strong>{account.name}</strong><br /><small>{account.email}</small></div>
                <div className="actions">
                  <span className="pill">{account.online ? "在线" : "离线"}</span>
                  <span className="pill">{account.disabledAt ? "已禁用" : "正常"}</span>
                  {account.isSystemAdmin ? <span className="pill">系统管理员</span> : null}
                  {account.mustChangePassword ? <span className="pill">待修改临时密码</span> : null}
                </div>
              </div>
              <details className="account-details">
                <summary>查看账号详情与操作</summary>
                <div className="account-detail-grid">
                  <div><span>注册时间</span><strong>{account.createdAt.toLocaleString()}</strong></div>
                  <div><span>最近在线</span><strong>{account.lastSeenAt?.toLocaleString() ?? "无在线心跳"}</strong></div>
                  <div><span>密码状态</span><strong>{account.hasPassword ? "已设置（不可查看）" : "未设置"}</strong></div>
                  <div><span>拥有数据</span><strong>{account.counts.documents} 文档 · {account.counts.matches} 比赛 · {account.counts.practiceSessions} 训练</strong></div>
                </div>
                <div className="membership-list">{account.memberships.map((membership) => <span className="pill" key={`${membership.workspaceId}-${membership.role}`}>{membership.workspaceName} · {membership.role}</span>)}</div>
                <div className="account-actions">
                  {!isSelf ? <AccountPasswordReset userId={account.id} /> : <span className="small-note">当前管理员账号请在用户端自行改密。</span>}
                  {!isSelf ? <form action={setGlobalAccountDisabledAction}><input type="hidden" name="userId" value={account.id} /><input type="hidden" name="disabled" value={String(!account.disabledAt)} /><button className="button" type="submit">{account.disabledAt ? "启用账号" : "禁用账号"}</button></form> : null}
                  {!isSelf ? <form action={setGlobalSystemAdminAction}><input type="hidden" name="userId" value={account.id} /><input type="hidden" name="enabled" value={String(!account.isSystemAdmin)} /><button className="button" type="submit">{account.isSystemAdmin ? "撤销系统管理员" : "授予系统管理员"}</button></form> : null}
                </div>
                {!isSelf ? <details className="danger-zone"><summary>永久删除账号</summary><form action={deleteGlobalAccountAction} className="stack"><p className="small-note">输入完整邮箱 <strong>{account.email}</strong> 确认删除账号及其拥有的数据。</p><input type="hidden" name="userId" value={account.id} /><input name="confirmationEmail" type="email" required autoComplete="off" /><button className="button danger" type="submit">永久删除</button></form></details> : null}
              </details>
            </article>;
          })}
          {accounts.length === 0 ? <p className="empty-state">没有符合条件的账号。</p> : null}
        </div>
      </SectionCard>
    </AdminShell>
  );
}
