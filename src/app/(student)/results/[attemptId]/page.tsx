import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { isUuid } from "@/lib/attempts";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Result | TalentTrack" };

// Minimal placeholder until Task 6 builds the result page. It never shows marks: it reads
// only the status through the student-safe student_attempts view.
async function Result({ params }: { params: Promise<{ attemptId: string }> }) {
  await requireRole("student");
  const { attemptId } = await params;
  if (!isUuid(attemptId)) notFound();

  const supabase = await createClient();
  const { data: attempt } = await supabase
    .from("student_attempts")
    .select("id, status")
    .eq("id", attemptId)
    .maybeSingle<{ id: string; status: "in_progress" | "submitted" | "released" }>();
  if (!attempt) notFound();
  if (attempt.status === "in_progress") redirect(`/exam/${attempt.id}`);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Submitted</CardTitle>
      </CardHeader>
      <CardContent>
        {attempt.status === "submitted" ? (
          <p data-testid="result-status">Submitted, awaiting review. Your trainer will release your result.</p>
        ) : (
          <p data-testid="result-status">Your exam has been submitted.</p>
        )}
      </CardContent>
      <CardFooter>
        <Link href="/exam/start" className={buttonVariants({ variant: "outline" })}>
          Back to exams
        </Link>
      </CardFooter>
    </Card>
  );
}

export default function ResultPage(props: PageProps<"/results/[attemptId]">) {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10">
      <Suspense fallback={<p role="status">Loading…</p>}>
        <Result params={props.params} />
      </Suspense>
    </main>
  );
}
