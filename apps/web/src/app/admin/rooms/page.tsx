import { AdminShell } from "@/components/admin-shell";
import { AdminAutoRefresh } from "@/components/admin-auto-refresh";
import { SectionCard } from "@/components/section-card";
import { requireSystemAdmin } from "@/lib/auth";
import { sessionShellUser } from "@/lib/session-props";
import { listActiveRooms, listOnlineUsers } from "@/lib/rooms";
import { adminChangeRoomMember, adminInviteToRoom, adminRotateRoomCode, adminTransferRoomOwner } from "./actions";

export default async function AdminRoomsPage() {
  const session = await requireSystemAdmin();
  const [rooms, onlineUsers] = await Promise.all([
    listActiveRooms(),
    listOnlineUsers()
  ]);

  return (
    <AdminShell activeHref="/admin/rooms" user={sessionShellUser(session)}>
      <AdminAutoRefresh />
      <section className="hero"><div className="eyebrow">LAN Rooms</div><h1>活跃比赛房间</h1><p>只显示最近 30 秒内仍有成员在线的房间。</p></section>
      <SectionCard title="在线用户" description="只有系统管理员可以查看此全局名单。">
        <div className="actions">{onlineUsers.map((user) => <span className="pill" key={user.id}>{user.name} · {user.email}</span>)}{onlineUsers.length === 0 ? <p className="empty-state">当前没有在线用户。</p> : null}</div>
      </SectionCard>
      <div style={{ height: 18 }} />
      <div className="stack">
        {rooms.map((room) => (
          <SectionCard key={room.id} title={`${room.match.tournament} vs ${room.match.opponent}`} description={room.match.topic}>
            <div className="actions"><span className="pill">邀请码 {room.inviteCode}</span><span className="pill">房主 {room.owner.name}</span><span className="pill">在线 {room.presences.length}</span><form action={adminRotateRoomCode}><input type="hidden" name="matchId" value={room.matchId} /><button className="button" type="submit">更换邀请码</button></form></div>
            <form action={adminInviteToRoom} className="actions">
              <input type="hidden" name="matchId" value={room.matchId} />
              <select name="userId" required defaultValue=""><option value="" disabled>选择在线用户</option>{onlineUsers.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}</select>
              <button className="button primary" type="submit">发送弹窗邀请</button>
            </form>
            <div className="table-like admin-table">
              {room.members.map((member) => <div className="table-row" key={member.id}>
                <div><strong>{member.user.name}</strong><br /><small>{member.user.email}</small></div>
                <div>{member.status === "ACTIVE" ? "可访问" : "已移出"}</div>
                <div className="actions">
                  {member.userId !== room.ownerId ? <form action={adminChangeRoomMember}><input type="hidden" name="matchId" value={room.matchId} /><input type="hidden" name="userId" value={member.userId} /><input type="hidden" name="status" value={member.status === "ACTIVE" ? "REMOVED" : "ACTIVE"} /><button className="button" type="submit">{member.status === "ACTIVE" ? "移出" : "恢复"}</button></form> : null}
                  {member.status === "ACTIVE" && member.userId !== room.ownerId && room.presences.some((presence) => presence.userId === member.userId) ? <form action={adminTransferRoomOwner}><input type="hidden" name="matchId" value={room.matchId} /><input type="hidden" name="userId" value={member.userId} /><button className="button" type="submit">转让房主</button></form> : null}
                </div>
              </div>)}
            </div>
          </SectionCard>
        ))}
        {rooms.length === 0 ? <p className="empty-state">当前没有有人的比赛房间。</p> : null}
      </div>
    </AdminShell>
  );
}
