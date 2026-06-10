"use server";

import { cookies } from "next/headers";
import { put } from "@vercel/blob";
import { eq, and } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { clinicMembers } from "@/infrastructure/db/schema";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE_BYTES = 4 * 1024 * 1024; // 4 MB

export async function uploadAvatar(
  formData: FormData,
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  try {
    const jar = await cookies();
    const token = jar.get(COOKIE_NAME)?.value;
    const session = token ? await verifyToken(token) : null;
    if (!session) return { success: false, error: "Não autenticado" };

    const clinicId = await requireSessionClinicId();

    const file = formData.get("avatar") as File | null;
    if (!file || file.size === 0) return { success: false, error: "Nenhum arquivo enviado" };
    if (!ALLOWED_TYPES.includes(file.type)) return { success: false, error: "Tipo de arquivo inválido. Use JPG, PNG ou WebP." };
    if (file.size > MAX_SIZE_BYTES) return { success: false, error: "Arquivo muito grande. Máximo 4 MB." };

    const ext = file.name.split(".").pop() ?? "jpg";
    const key = `avatars/${clinicId}/${Date.now()}.${ext}`;

    const blob = await put(key, file, {
      access: "public",
      contentType: file.type,
    });

    await db
      .update(clinicMembers)
      .set({ avatarUrl: blob.url })
      .where(
        and(
          eq(clinicMembers.email, session.email),
          eq(clinicMembers.clinicId, clinicId),
        ),
      );

    return { success: true, url: blob.url };
  } catch (e) {
    console.error("[uploadAvatar]", e);
    return { success: false, error: "Erro ao fazer upload" };
  }
}

export async function removeAvatar(): Promise<{ success: boolean }> {
  try {
    const jar = await cookies();
    const token = jar.get(COOKIE_NAME)?.value;
    const session = token ? await verifyToken(token) : null;
    if (!session) return { success: false };

    const clinicId = await requireSessionClinicId();

    await db
      .update(clinicMembers)
      .set({ avatarUrl: null })
      .where(
        and(
          eq(clinicMembers.email, session.email),
          eq(clinicMembers.clinicId, clinicId),
        ),
      );

    return { success: true };
  } catch {
    return { success: false };
  }
}
