import { Suspense } from "react";
import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/require-role";
import { logout } from "@/app/login/actions";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Staff | TalentTrack" };

async function StaffContent() {
  const profile = await requireRole("staff");
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Staff area</h1>
      <p>Signed in as {profile.full_name ?? profile.username}. Staff tools arrive in later tasks.</p>
      <form action={logout}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </div>
  );
}

export default function StaffPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10">
      <Suspense fallback={<p role="status">Loading…</p>}>
        <StaffContent />
      </Suspense>
    </main>
  );
}
