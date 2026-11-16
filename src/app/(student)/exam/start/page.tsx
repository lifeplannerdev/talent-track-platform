import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Exam | TalentTrack" };

// Stub: the real exam start page arrives in a later task.
async function StartContent() {
  const profile = await requireRole("student");
  if (!profile.consent_at) {
    redirect("/consent");
  }

  const supabase = await createClient();
  // Next open curriculum exam: lowest position among open assignments (student-safe view).
  const { data: next } = await supabase
    .from("student_assignments")
    .select("curriculum_id, position")
    .eq("status", "open")
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  let curriculumName: string | null = null;
  if (next) {
    const { data: curriculum } = await supabase
      .from("curriculums")
      .select("name")
      .eq("id", next.curriculum_id)
      .single();
    curriculumName = curriculum?.name ?? null;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Exam start</h1>
      {next ? (
        <p data-testid="next-exam">
          Your next exam: <strong>{curriculumName}</strong>. The exam start page arrives in a later
          task.
        </p>
      ) : (
        <p data-testid="no-exams">
          No exams are assigned to you yet. Please check back later or ask your instructor.
        </p>
      )}
      <form action={logout}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </div>
  );
}

export default function ExamStartPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10">
      <Suspense fallback={<p role="status">Loading…</p>}>
        <StartContent />
      </Suspense>
    </main>
  );
}
