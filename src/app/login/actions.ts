"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signToken, COOKIE_NAME, MAX_AGE, type SessionRole } from "@/lib/session";
import { verifyPassword, dummyVerify } from "@/lib/password";
import { db } from "@/infrastructure/db/client";
import { clinicMembers } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";

export async function login(formData: FormData) {
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const password = formData.get("password") as string;

  // Owner: env vars (único acesso ao painel /owner)
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const ownerPassword = process.env.OWNER_PASSWORD ?? process.env.ADMIN_PASSWORD;
  if (ownerEmail && email === ownerEmail && password === ownerPassword) {
    const token = await signToken(email, "owner");
    const jar = await cookies();
    jar.set(COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: MAX_AGE, path: "/" });
    redirect("/owner");
  }

  // Clinic admin: verifica no banco (passwordHash) com fallback para ADMIN_PASSWORD
  const member = await db
    .select({ passwordHash: clinicMembers.passwordHash, role: clinicMembers.role })
    .from(clinicMembers)
    .where(eq(clinicMembers.email, email))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (member) {
    let authenticated = false;
    if (member.passwordHash) {
      authenticated = await verifyPassword(password, member.passwordHash);
    } else {
      // Fallback APENAS para os emails-piloto configurados em ADMIN_EMAIL
      // (ex: a Ximendes enquanto a senha não foi definida). Contas novas sem
      // hash NÃO logam pela senha global — precisam de senha própria.
      const pilotEmails = (process.env.ADMIN_EMAIL ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      const fallbackPwd = process.env.ADMIN_PASSWORD;
      authenticated =
        pilotEmails.includes(email.toLowerCase()) && !!fallbackPwd && password === fallbackPwd;
    }

    if (authenticated) {
      const role: SessionRole = member.role === "owner" ? "owner" : "clinic_admin";
      const token = await signToken(email, role);
      const jar = await cookies();
      jar.set(COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: MAX_AGE, path: "/" });
      redirect(role === "owner" ? "/owner" : "/app/dashboard");
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
