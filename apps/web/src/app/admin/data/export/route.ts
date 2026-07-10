import { requireAdmin } from "@/lib/auth";
import { buildWorkspaceExport } from "@/lib/workspace-export";

export async function GET() {
  const session = await requireAdmin();
  const data = await buildWorkspaceExport(session.workspace.id, session.workspace.name);
  const filename = `debate-export-${session.workspace.id}.json`;

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}
