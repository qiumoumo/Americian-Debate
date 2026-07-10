"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { parsePreferredSource, readAIConfigForm, saveUserAIConfig, saveUserAIPreference } from "@/lib/ai-config";

export async function updateUserAIConfig(formData: FormData) {
  const session = await requireUser();
  const input = readAIConfigForm(formData);
  await saveUserAIConfig({ ...input, userId: session.user.id });
  revalidatePath("/app/settings");
}

export async function updateUserAIPreference(formData: FormData) {
  const session = await requireUser();
  const preferredSource = parsePreferredSource(String(formData.get("preferredSource") ?? ""));
  await saveUserAIPreference(session.user.id, preferredSource);
  revalidatePath("/app/settings");
}
