import { timingSafeEqual } from "node:crypto";
import { sweepExpired } from "@/lib/attempts";

// Backup sweep for expired attempts. Vercel Cron calls it with "Authorization: Bearer
// $CRON_SECRET". The real expiry mechanism is the lazy check whenever an attempt is read
// or an answer is saved (Vercel Hobby only allows daily crons).
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const submitted = await sweepExpired();
  return Response.json({ submitted });
}
