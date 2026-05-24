"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signToken, COOKIE_NAME, MAX_AGE } from "@/lib/session";

export async function login(formData: FormData) {
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const password = formData.get("password") as string;

  const validEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const validPassword = process.env.ADMIN_PASSWORD;

  if (!validEmail || !validPassword || email !== validEmail || password !== validPassword) {
    redirect("/login?error=1");
  }

  const token = await signToken(email);
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });

  redirect("/inbox");
}

export async function logout() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  redirect("/login");
}
