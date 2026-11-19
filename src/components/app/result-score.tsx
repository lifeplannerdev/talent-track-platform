import { Badge } from "@/components/ui/badge";
import { ATTEMPT_STATUS, attemptStatusKind, type AttemptRowStatus } from "@/lib/attempt-status";
import { formatPercent } from "@/lib/percent";

/**
 * Stored score, percentage first ("67%"), the points as small secondary text ("2 / 3") and, unless
 * `outcome` is false (a status badge sits beside it), a pass/fail tag. No numbers before scoring.
 */
export function ResultScore({
  points,
  maxPoints,
  passed,
  outcome = true,
}: {
  points: number | null;
  maxPoints: number | null;
  passed: boolean | null;
  outcome?: boolean;
}) {
  if (points === null || maxPoints === null) return <span className="text-muted-foreground">No score yet</span>;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="font-heading font-semibold tabular-nums" data-testid="score-percent">
        {formatPercent(points, maxPoints)}
      </span>
      <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        {points} / {maxPoints}
        <span className="sr-only"> points</span>
      </span>
      {outcome ? (
        <Badge variant={passed ? "success" : "destructive"} className="self-center">
          {passed ? "Passed" : "Not passed"}
        </Badge>
      ) : null}
    </span>
  );
}

/** Stage of an attempt: In progress, Being scored, Passed or Not passed (no hold or release step). */
export function AttemptStatusBadge({
  attempt,
}: {
  attempt: { status: AttemptRowStatus; points: number | null; maxPoints: number | null; passed: boolean | null };
}) {
  const s = ATTEMPT_STATUS[attemptStatusKind(attempt)];
  return (
    <Badge variant={s.variant} data-testid="attempt-status">
      {s.label}
    </Badge>
  );
}
