import { NextResponse } from "next/server";
import { getAIProviderConfigStatus } from "@debate/ai";
import { requireUser } from "@/lib/auth";

export async function GET() {
  await requireUser();
  const status = getAIProviderConfigStatus();

  return NextResponse.json({
    ...status,
    safeInstructions: [
      "API key 只填写在项目根目录 .env.local。",
      "不要创建 NEXT_PUBLIC_* API key 变量。",
      "修改 .env.local 后需要重启 dev server。"
    ]
  });
}
