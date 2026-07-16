"use server";

import { redirect } from "next/navigation";
import { db } from "@debate/db";
import { hashPassword, isPasswordStrongEnough, requireUser } from "@/lib/auth";

export async function changeRequiredPassword(formData: FormData) {
  const session = await requireUser({ allowPasswordChange: true });
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (!isPasswordStrongEnough(password)) redirect("/app/change-password?error=weak");
  if (password !== confirmation) redirect("/app/change-password?error=mismatch");
  const passwordHash = await hashPassword(password);
  await db.$transaction([
    db.user.update({ where: { id: session.user.id }, data: { passwordHash, mustChangePassword: false } }),
    db.session.deleteMany({ where: { userId: session.user.id, id: { not: session.sessionId } } })
  ]);
  redirect("/app/documents");
}
