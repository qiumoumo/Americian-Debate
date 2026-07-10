"use server";

import { revalidatePath } from "next/cache";
import { db } from "@debate/db";
import { requireUser } from "@/lib/auth";

export async function saveReflection(formData: FormData) {
  const session = await requireUser();
  const matchId = String(formData.get("matchId") ?? "").trim();
  if (!matchId) {
    throw new Error("matchId is required");
  }

  const match = await db.match.findFirst({ where: { id: matchId, workspaceId: session.workspace.id, deletedAt: null } });
  if (!match) {
    throw new Error("Match not found");
  }

  await db.reflection.upsert({
    where: { matchId },
    update: {
      whatWorked: String(formData.get("whatWorked") ?? ""),
      whatFailed: String(formData.get("whatFailed") ?? ""),
      judgeFeedback: String(formData.get("judgeFeedback") ?? ""),
      nextSteps: String(formData.get("nextSteps") ?? "")
    },
    create: {
      matchId,
      whatWorked: String(formData.get("whatWorked") ?? ""),
      whatFailed: String(formData.get("whatFailed") ?? ""),
      judgeFeedback: String(formData.get("judgeFeedback") ?? ""),
      nextSteps: String(formData.get("nextSteps") ?? "")
    }
  });

  revalidatePath("/app/history");
}
