import { requireUser } from "@/lib/auth";
import { enterRoom, getRoomSnapshot, heartbeatRoom, updateRoomTimer } from "@/lib/rooms";
import type { SharedTimerState } from "@debate/shared";

export async function GET(_request: Request, context: { params: Promise<{ matchId: string }> }) {
  const session = await requireUser();
  const { matchId } = await context.params;
  try {
    return Response.json(await getRoomSnapshot(matchId, session.user.id, session.user.isSystemAdmin));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Room unavailable" }, { status: 403 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ matchId: string }> }) {
  const session = await requireUser();
  const { matchId } = await context.params;
  const body = await request.json() as {
    action?: "enter" | "heartbeat" | "timer";
    roomId?: string;
    connectionToken?: string;
    timer?: SharedTimerState;
    startedAtMs?: number | null;
  };
  try {
    if (body.action === "enter") {
      return Response.json(await enterRoom(matchId, session.user.id, session.user.isSystemAdmin));
    }
    if (body.action === "heartbeat" && body.roomId && body.connectionToken) {
      const active = await heartbeatRoom(body.roomId, session.user.id, body.connectionToken);
      return Response.json({ active }, { status: active ? 200 : 409 });
    }
    if (body.action === "timer" && body.timer) {
      await updateRoomTimer(matchId, session.user.id, body.timer, body.startedAtMs ?? null);
      return Response.json({ saved: true });
    }
    return Response.json({ error: "Invalid room action" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Room action failed" }, { status: 403 });
  }
}
