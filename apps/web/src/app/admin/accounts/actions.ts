"use server";

import { revalidatePath } from "next/cache";
import { requireSystemAdmin } from "@/lib/auth";
import { deleteGlobalAccount, resetGlobalAccountPassword, setGlobalAccountDisabled, setGlobalSystemAdmin } from "@/lib/accounts";

function value(formData: FormData, key: string) {
  const result = String(formData.get(key) ?? "").trim();
  if (!result) throw new Error(`${key} is required`);
  return result;
}

export interface PasswordResetState {
  temporaryPassword?: string;
  error?: string;
}

export async function resetGlobalAccountPasswordAction(_state: PasswordResetState, formData: FormData): Promise<PasswordResetState> {
  const session = await requireSystemAdmin();
  try {
    const result = await resetGlobalAccountPassword(session.user.id, value(formData, "userId"));
    revalidatePath("/admin/accounts");
    return { temporaryPassword: result.temporaryPassword };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "密码重置失败" };
  }
}

export async function setGlobalAccountDisabledAction(formData: FormData) {
  const session = await requireSystemAdmin();
  await setGlobalAccountDisabled(session.user.id, value(formData, "userId"), value(formData, "disabled") === "true");
  revalidatePath("/admin/accounts");
}

export async function setGlobalSystemAdminAction(formData: FormData) {
  const session = await requireSystemAdmin();
  await setGlobalSystemAdmin(session.user.id, value(formData, "userId"), value(formData, "enabled") === "true");
  revalidatePath("/admin/accounts");
}

export async function deleteGlobalAccountAction(formData: FormData) {
  const session = await requireSystemAdmin();
  await deleteGlobalAccount(session.user.id, value(formData, "userId"), value(formData, "confirmationEmail"));
  revalidatePath("/admin/accounts");
}
