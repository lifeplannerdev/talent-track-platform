import Link from "next/link";
import { ChevronLeftIcon, HourglassIcon, RotateCwIcon } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import type { StudentResult } from "@/lib/results";
import { factLabel } from "@/components/app/styles";
import { buttonVariants } from "@/components/ui/button";

/**
 * A submitted attempt whose score is not recorded yet (the submit was interrupted between closing
 * and scoring; the next read scores it). No numbers at all until the score exists.
 */
export function CalculatingResult({ result }: { result: Extract<StudentResult, { status: "submitted" }> }) {
  return (
    <section aria-labelledby="calculating-heading" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 id="calculating-heading" className="text-[1.625rem] leading-tight font-semibold sm:text-[1.75rem]">
          Submitted
        </h1>
        <p className="text-base text-muted-foreground">Your answers for {result.curriculumName || "this exam"} are in.</p>
      </div>
      <p
        data-testid="result-status"
        role="status"
        className="flex items-start gap-3 rounded-lg bg-secondary px-4 py-3 text-base text-secondary-foreground"
      >
        <HourglassIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <span>Your result is being calculated, please check again in a moment.</span>
      </p>
      <dl className="grid grid-cols-1 gap-3 rounded-xl border px-4 py-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className={factLabel}>Exam</dt>
          <dd className="text-base break-words">{result.examSetName}</dd>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <dt className={factLabel}>Submitted</dt>
          <dd className="text-base">{formatDateTime(result.submittedAt)}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Link href={`/results/${result.id}`} prefetch={false} className={buttonVariants({ size: "lg" })}>
          <RotateCwIcon data-icon="inline-start" aria-hidden="true" />
          Check again
        </Link>
        <Link href="/exam/start" className={buttonVariants({ variant: "outline", size: "lg" })}>
          <ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />
          Back to exams
        </Link>
      </div>
    </section>
  );
}
