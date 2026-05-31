import { NextRequest, NextResponse } from "next/server";

export function e2eGuard(req: NextRequest): NextResponse | null {
  if (process.env.E2E_MODE !== "true" || process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not available" }, { status: 404 });
  }
  const secret = req.headers.get("x-e2e-secret");
  if (!secret || secret !== process.env.E2E_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export const E2E_CLINIC_ID = process.env.E2E_CLINIC_ID!;
