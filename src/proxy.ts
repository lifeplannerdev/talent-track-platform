import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath } from "@/lib/auth/public-paths";
import { isStaffRole, type Role } from "@/lib/auth/roles";

type PendingCookie = { name: string; value: string; options: CookieOptions }[];

export async function proxy(request: NextRequest) {
  let pending: PendingCookie = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          pending = cookiesToSet;
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
        },
      },
    },
  );

  const finish = (response: NextResponse) => {
    pending.forEach(({ name, value, options }) =>
      response.cookies.set(name, value, options),
    );
    return response;
  };
  const redirectTo = (path: string) =>
    finish(NextResponse.redirect(new URL(path, request.url)));

  const path = request.nextUrl.pathname;
  const inArea = (prefix: string) =>
    path === prefix || path.startsWith(`${prefix}/`);

  // getUser() asks the Auth server, so a session ended by a newer login is rejected immediately.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return isPublicPath(path) ? finish(NextResponse.next({ request })) : redirectTo("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, consent_at, active")
    .eq("id", user.id)
    .single();
  // A deactivated account is treated like a missing profile: the guards send it to /login too, so
  // /login must not bounce it back to /staff.
  if (!profile || !profile.active) {
    return isPublicPath(path) ? finish(NextResponse.next({ request })) : redirectTo("/login");
  }

  const staff = isStaffRole(profile.role as Role);
  const home =
    staff
      ? "/staff"
      : profile.consent_at
        ? "/learn"
        : "/consent";

  if (path === "/" || path === "/login") return redirectTo(home);

  if (staff) {
    if (!inArea("/staff")) return redirectTo(home);
  } else if (!profile.consent_at) {
    if (!inArea("/consent")) return redirectTo(home);
  } else if (inArea("/staff") || inArea("/consent")) {
    return redirectTo(home);
  }

  return finish(NextResponse.next({ request }));
}

export const config = {
  // "\\." in a JS string is the regex "\.": only real file extensions (".png") skip the proxy.
  // /api/cron/ skips it too: cron route handlers check their own Bearer secret.
  matcher: ["/((?!_next/static|_next/image|api/cron/|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
