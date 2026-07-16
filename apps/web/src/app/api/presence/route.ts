import { requireUser, touchCurrentUserSession } from "@/lib/auth";

export async function POST() {
  await requireUser();
  await touchCurrentUserSession();
  return Response.json({ online: true });
}
