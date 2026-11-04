import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic check only: send people without a session cookie to the sign-in page.
 * The API validates the session on every request.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has("sched_sid")) {
    const url = new URL("/login", request.url);
    url.searchParams.set("returnTo", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/calendar/:path*", "/rooms/:path*", "/requests/:path*", "/builder/:path*"],
};
