import { headers } from "next/headers";
import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { SectionCard } from "@/components/section-card";
import { requireAdmin } from "@/lib/auth";
import { sessionShellUser } from "@/lib/session-props";
import { getPendingInvitations, getWorkspaceMembers } from "@/lib/data";
import {
  inviteMember,
  removeMember,
  revokeInvitation,
  updateMemberRole
} from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_email: "请填写有效邮箱。",
  already_member: "该邮箱已经是本工作区成员。",
  forbidden_role: "COACH 只能邀请 DEBATER / VIEWER。",
  forbidden: "没有权限执行该操作。",
  self: "不能对自己执行该操作。"
};

export default async function AdminMembersPage({
  searchParams
}: {
  searchParams: Promise<{
    invited?: string;
    token?: string;
    error?: string;
  }>;
}) {
  const session = await requireAdmin();
  const [members, invitations, headerList, params] = await Promise.all([
    getWorkspaceMembers(session.workspace.id),
    getPendingInvitations(session.workspace.id),
    headers(),
    searchParams
  ]);

  const isOwner = session.role === "OWNER";
  const host = headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const inviteLink = params.token ? `${proto}://${host}/register?invite=${params.token}` : null;
  const errorMessage = params.error ? ERROR_MESSAGES[params.error] ?? "操作失败，请重试。" : null;

  return (
    <AdminShell activeHref="/admin/members" user={sessionShellUser(session)}>
      <section className="hero">
        <div className="eyebrow">Members</div>
        <h1>工作区成员管理</h1>
        <p>邀请成员、调整角色或移出当前工作区成员。全局账号与密码管理请前往注册账号页面。</p>
      </section>

      {errorMessage ? <p className="empty-state">{errorMessage}</p> : null}

      {inviteLink ? (
        <SectionCard title="邀请已创建" description={`已为 ${params.invited} 生成邀请链接（7 天内有效），复制发给对方即可注册加入。`}>
          <pre className="mini-pre">{inviteLink}</pre>
        </SectionCard>
      ) : null}

      <div style={{ height: 18 }} />

      <div className="actions"><Link className="button" href="/admin/accounts">前往全局注册账号管理</Link></div>

      <div style={{ height: 18 }} />

      <SectionCard title="邀请新成员" description={isOwner ? "可邀请任意角色。" : "COACH 可邀请 DEBATER / VIEWER。"}>
        <form action={inviteMember} className="stack">
          <div className="grid two">
            <label className="field">
              <span>邮箱</span>
              <input name="email" type="email" placeholder="teammate@example.com" required />
            </label>
            <label className="field">
              <span>角色</span>
              <select name="role" defaultValue="DEBATER">
                {isOwner ? <option value="OWNER">OWNER</option> : null}
                {isOwner ? <option value="COACH">COACH</option> : null}
                <option value="DEBATER">DEBATER</option>
                <option value="VIEWER">VIEWER</option>
              </select>
            </label>
          </div>
          <button className="button primary" type="submit">生成邀请链接</button>
        </form>
      </SectionCard>

      <div style={{ height: 18 }} />

      <SectionCard title="成员列表" description={isOwner ? "OWNER 可调整角色或将成员移出当前 workspace。" : "COACH 可查看当前 workspace 成员。"}>
        <div className="table-like admin-table members-table">
          <div className="table-row header">
            <div>成员</div>
            <div>角色</div>
            <div>状态</div>
            <div>操作</div>
          </div>
          {members.map((membership) => {
            const isSelf = membership.userId === session.user.id;
            return (
              <div className="table-row" key={membership.id}>
                <div>
                  <strong>{membership.user.name}</strong>
                  <br />
                  <small>{membership.user.email}</small>
                </div>
                <div>
                  {isOwner ? (
                    <form action={updateMemberRole} className="inline-form">
                      <input type="hidden" name="membershipId" value={membership.id} />
                      <select name="role" defaultValue={membership.role}>
                        <option value="OWNER">OWNER</option>
                        <option value="COACH">COACH</option>
                        <option value="DEBATER">DEBATER</option>
                        <option value="VIEWER">VIEWER</option>
                      </select>
                      <button className="button" type="submit">保存</button>
                    </form>
                  ) : (
                    <span className="pill">{membership.role}</span>
                  )}
                </div>
                <div>
                  <span className="pill">{membership.user.disabledAt ? "账号已禁用" : "正常"}</span>
                </div>
                <div className="action-cell">
                  {isOwner && !isSelf ? (
                    <form action={removeMember} className="inline-form">
                      <input type="hidden" name="membershipId" value={membership.id} />
                      <button className="button danger" type="submit">移除</button>
                    </form>
                  ) : null}
                  {isSelf ? <span className="small-note">当前登录账号</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <div style={{ height: 18 }} />

      <SectionCard title="待接受的邀请" description="尚未注册接受的邀请；可随时撤销。">
        <div className="table-like admin-table invitations-table">
          <div className="table-row header">
            <div>邮箱</div>
            <div>角色</div>
            <div>到期</div>
            <div>操作</div>
          </div>
          {invitations.map((invitation) => (
            <div className="table-row" key={invitation.id}>
              <div><strong>{invitation.email}</strong></div>
              <div><span className="pill">{invitation.role}</span></div>
              <div><small>{invitation.expiresAt.toLocaleDateString()}</small></div>
              <div>
                <form action={revokeInvitation} className="inline-form">
                  <input type="hidden" name="invitationId" value={invitation.id} />
                  <button className="button danger" type="submit">撤销</button>
                </form>
              </div>
            </div>
          ))}
          {invitations.length === 0 ? <p className="empty-state">暂无待接受的邀请。</p> : null}
        </div>
      </SectionCard>
    </AdminShell>
  );
}
