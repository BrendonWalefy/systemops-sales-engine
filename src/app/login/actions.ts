"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signToken, COOKIE_NAME, MAX_AGE, type SessionRole } from "@/lib/session";

export async function login(formData: FormData) {
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const password = formData.get("password") as string;

  // Owner check: OWNER_EMAIL + OWNER_PASSWORD (falls back to ADMIN_PASSWORD)
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const ownerPassword = process.env.OWNER_PASSWORD ?? process.env.ADMIN_PASSWORD;
  const isOwner = ownerEmail && email === ownerEmail && password === ownerPassword;

  // Clinic admins: ADMIN_EMAIL supports comma-separated list, all use ADMIN_PASSWORD
  const adminEmails = (process.env.ADMIN_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const adminPassword = process.env.ADMIN_PASSWORD;
  const isClinicAdmin =
    adminEmails.includes(email) && adminPassword && password === adminPassword;

  if (!isOwner && !isClinicAdmin) {
    redirect("/login?error=1");
  }

  const role: SessionRole = isOwner ? "owner" : "clinic_admin";
  const token = await signToken(email, role);
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });

  redirect(role === "owner" ? "/owner" : "/app/dashboard");
}

export async function logout() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  redirect("/login");
}
