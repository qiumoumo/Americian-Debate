import { requireUser } from "@/lib/auth";
import { getPendingRoomInvitation, respondToRoomInvitation } from "@/lib/rooms";

export async function GET() {
  const session = await requireUser();
  const invitation = await getPendingRoomInvitation(session.user.id);
  if (!invitation) return Response.json({ invitation: null });
  return Response.json({
    invitation: {
      id: invitation.id,
      inviterName: invitation.invitedBy.name,
      matchTitle: `${invitation.room.match.tournament} vs ${invitation.room.match.opponent}`,
      topic: invitation.room.match.topic
    }
  });
}

export async function POST(request: Request) {
  const session = await requireUser();
  const body = await request.json() as { invitationId?: string; accept?: boolean };
  if (!body.invitationId) return Response.json({ error: "Missing invitation" }, { status: 400 });
  try {
    const matchId = await respondToRoomInvitation(body.invitationId, session.user.id, Boolean(body.accept));
    return Response.json({ matchId });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invitation failed" }, { status: 400 });
  }
}
