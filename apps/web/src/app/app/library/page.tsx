import { AppShell } from "@/components/app-shell";
import { LibraryRoundWorkspace } from "@/components/library-round-workspace";
import { requireUser } from "@/lib/auth";
import { getLibraryRoundsForWorkspace } from "@/lib/data";
import { canCreateLibraryRound, canManageLibraryRound, libraryActorFromSession } from "@/lib/library";
import { sessionShellUser } from "@/lib/session-props";

export default async function LibraryPage() {
  const session = await requireUser();
  const rounds = await getLibraryRoundsForWorkspace(session.workspace.id, session.user.id);
  const actor = libraryActorFromSession(session);
  return (
    <AppShell activeHref="/app/library" user={sessionShellUser(session)} note="集中保存外部优秀比赛录像；录像由工作区共享，时间戳笔记仅自己可见。">
      <LibraryRoundWorkspace canCreate={canCreateLibraryRound(actor)} rounds={rounds.map((round) => ({ ...round, canManage: canManageLibraryRound(actor, round.createdByUserId) }))} />
    </AppShell>
  );
}
