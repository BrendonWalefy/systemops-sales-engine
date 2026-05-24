import { NextRequest, NextResponse } from "next/server";
import { verifyToken, COOKIE_NAME } from "@/lib/session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const session = await getSession(request);

  // Redirect authenticated users away from /login
  if (pathname === "/login" || pathname.startsWith("/login?")) {
    if (session) {
      return NextResponse.redirect(
        new URL(session.role === "owner" ? "/owner" : "/app/dashboard", request.url),
      );
    }
    return NextResponse.next();
  }

  // Old routes: redirect to new paths (no auth required here — middleware runs before render)
  if (pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/app/dashboard", request.url));
  }
  if (pathname.startsWith("/inbox")) {
    const rest = pathname.slice("/inbox".length);
    return NextResponse.redirect(new URL(`/app/inbox${rest}`, request.url));
  }
  if (pathname.startsWith("/settings")) {
    const rest = pathname.slice("/settings".length);
    return NextResponse.redirect(new URL(`/app/settings${rest}`, request.url));
  }

  // /app/* — requires any authenticated session
  if (pathname.startsWith("/app/")) {
    if (!session) return redirectToLogin(request, pathname);
    return NextResponse.next();
  }

  // /owner/* — requires role = owner
  if (pathname.startsWith("/owner")) {
    if (!session) return redirectToLogin(request, pathname);
    if (session.role !== "owner") {
      return NextResponse.redirect(new URL("/app/dashboard", request.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

async function getSession(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}

function redirectToLogin(request: NextRequest, from: string) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", from);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/login",
    "/dashboard/:path*",
    "/inbox/:path*",
    "/settings/:path*",
    "/app/:path*",
    "/owner/:path*",
  ],
};
