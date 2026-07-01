"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signToken, COOKIE_NAME, MAX_AGE, type MemberRole } from "@/lib/session";
import { verifyPassword, dummyVerify } from "@/lib/password";
import { db } from "@/infrastructure/db/client";
import { clinicMembers } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";

export async function login(formData: FormData) {
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const password = formData.get("password") as string;

  // Owner: env vars (único acesso ao painel /owner)
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const ownerPassword = process.env.OWNER_PASSWORD;
  if (ownerEmail && email === ownerEmail && password === ownerPassword) {
    const token = await signToken({ email, role: "owner", memberRole: "owner", professionalId: null });
    const jar = await cookies();
    jar.set(COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: MAX_AGE, path: "/" });
    redirect("/owner");
  }

  // Clinic admin/professional/receptionist: senha em clinic_members.password_hash.
  const member = await db
    .select({ passwordHash: clinicMembers.passwordHash, role: clinicMembers.role, professionalId: clinicMembers.professionalId })
    .from(clinicMembers)
    .where(eq(clinicMembers.email, email))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (member) {
    if (member.passwordHash) {
      const authenticated = await verifyPassword(password, member.passwordHash);
      if (authenticated) {
        // Papéis "owner" e "org_admin" usam role = "org_admin" no JWT de rota
        // (o campo role é apenas para resolve-clinic.ts); memberRole carrega o papel real.
        const memberRole = member.role as MemberRole;
        const sessionRole = memberRole === "owner" ? "owner" as const : "org_admin" as const;
        const token = await signToken({
          email,
          role: sessionRole,
          memberRole,
          professionalId: member.professionalId ?? null,
        });
        const jar = await cookies();
        jar.set(COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: MAX_AGE, path: "/" });
        redirect(sessionRole === "owner" ? "/owner" : "/app/dashboard");
      }
    }
  }

  // Email não cadastrado: roda um verify descartável para igualar o tempo de
  // resposta (impede enumerar usuários pela latência) e cai no erro genérico.
  await dummyVerify(password);
  redirect("/login?error=1");
}

export async function logout() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  redirect("/login");
}
