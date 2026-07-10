import { requireAdmin } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { redirectToRequestHost } from "@/lib/api-route-utils";
import { importWorkspaceData } from "@/lib/workspace-export";

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (session.role !== "OWNER") {
    return redirectToRequestHost(request, "/admin/data?error=forbidden");
  }

  const formData = await request.formData().catch(() => null);
  const raw = String(formData?.get("payload") ?? "").trim();
  if (!raw) {
    return redirectToRequestHost(request, "/admin/data?error=empty");
  }

  const result = await importWorkspaceData({ workspaceId: session.workspace.id, ownerId: session.user.id, raw });
  if (!result.ok) {
    return redirectToRequestHost(request, `/admin/data?error=parse`);
  }

  await recordAudit({
    workspaceId: session.workspace.id,
    actorUserId: session.user.id,
    actorName: session.user.name,
    action: "data.import",
    meta: { documents: result.documents ?? 0, announcements: result.announcements ?? 0 }
  });

  return redirectToRequestHost(request, `/admin/data?imported=${result.documents ?? 0}`);
}
