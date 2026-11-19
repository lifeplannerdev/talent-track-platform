import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { formatPercent } from "@/lib/percent";
import { touchLinkClass } from "@/components/app/styles";
import { Badge } from "@/components/ui/badge";
import type { ResultGroup, ResultRow } from "./view";

function Row({ row, curriculum }: { row: ResultRow; curriculum: string }) {
  if (row.kind === "in_progress") {
    return (
      <li data-testid="result-row" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <span className="text-base text-muted-foreground">Exam running now</span>
        <span className="flex items-center gap-3">
          <Badge variant="outline">In progress</Badge>
          <Link href={`/exam/${row.attemptId}`} className={touchLinkClass}>
            Resume<span className="sr-only"> {curriculum}</span>
          </Link>
        </span>
      </li>
    );
  }
  const r = row.result;
  const scored = r.status === "released" && r.points !== null && r.maxPoints !== null;
  const meta = `${r.examSetName ? `${r.examSetName}, ` : ""}submitted ${formatDateTime(r.submittedAt)}`;
  return (
    <li data-testid="result-row" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        {scored ? (
          <span className="flex items-baseline gap-2">
            <span className="font-heading text-xl leading-tight font-semibold tabular-nums" data-testid="result-percent">
              {formatPercent(r.points!, r.maxPoints!)}
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">
              {r.points} / {r.maxPoints} points
            </span>
          </span>
        ) : null}
        <span className="text-sm break-words text-muted-foreground">{meta}</span>
      </div>
      <span className="flex items-center gap-3">
        {scored ? (
          <Badge variant={r.passed ? "success" : "destructive"}>{r.passed ? "Passed" : "Not passed"}</Badge>
        ) : (
          <Badge variant="warning">Being calculated</Badge>
        )}
        <Link href={`/results/${r.id}`} className={touchLinkClass}>
          {scored ? "View result" : "View status"}
          <span className="sr-only">
            {" "}
            for {curriculum}, {meta}
          </span>
        </Link>
      </span>
    </li>
  );
}

/**
 * "Your results": one block per curriculum (each is its own exam), percentage first. A running or
 * not yet calculated attempt has no numbers. Every row links to its result (or resumes the exam).
 */
export function ResultsByCurriculum({ groups }: { groups: ResultGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <section aria-labelledby="results-heading" className="flex flex-col gap-3 pt-2">
      <h2 id="results-heading" className="text-lg font-semibold">
        Your results
      </h2>
      <div className="flex flex-col gap-4" data-testid="results-list">
        {groups.map((g) => (
          <section key={g.key} data-testid="results-group" aria-labelledby={`results-${g.key}`} className="flex flex-col gap-1.5">
            <h3 id={`results-${g.key}`} className="text-base font-semibold">
              {g.name}
            </h3>
            <ul className="flex flex-col divide-y rounded-xl border bg-card">
              {g.rows.map((row) => (
                <Row key={row.kind === "result" ? row.result.id : `run-${row.attemptId}`} row={row} curriculum={g.name} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
