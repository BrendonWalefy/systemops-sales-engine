import { NextResponse, type NextRequest } from "next/server";

export function normalizeCronAuthorizationHeader(
  authHeader: string | null,
): string | null {
  if (!authHeader) return null;

  const trimmed = authHeader.trim();
  if (!trimmed) return null;

  if (trimmed === "Bearer") {
    return null;
  }

  if (trimmed.startsWith("Bearer ")) {
    const token = trimmed.slice("Bearer ".length).trim();
    return token.length > 0 ? token : null;
  }

  return trimmed;
}

export function isAuthorizedCronRequest(
  authHeader: string | null,
  cronSecret: string | undefined,
): boolean {
  if (!cronSecret) return false;

  const providedSecret = normalizeCronAuthorizationHeader(authHeader);
  return providedSecret === cronSecret;
}

export function requireCronAuthorization(
  request: Pick<NextRequest, "headers">,
): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[CronAuth] CRON_SECRET is not configured");
    return NextResponse.json(
      { error: "cron_secret_not_configured" },
      { status: 500 },
    );
  }

  if (
    !isAuthorizedCronRequest(
      request.headers.get("authorization"),
      cronSecret,
    )
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}
