import { Badge } from "@/components/ui/badge";
import { formatPercent } from "@/lib/percent";

/**
 * Stored score, percentage first ("67%"), the points as small secondary text ("2 / 3") and a
 * pass/fail tag; "Scoring pending" when the attempt is not scored yet.
 */
export function ResultScore({ points, maxPoints, passed }: { points: number | null; maxPoints: number | null; passed: boolean | null }) {
  if (points === null || maxPoints === null) return <Badge variant="outline">Scoring pending</Badge>;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="font-heading font-semibold tabular-nums" data-testid="score-percent">
        {formatPercent(points, maxPoints)}
      </span>
      <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        {points} / {maxPoints}
        <span className="sr-only"> points</span>
      </span>
      <Badge variant={passed ? "success" : "destructive"} className="self-center">
        {passed ? "Pass" : "Fail"}
      </Badge>
    </span>
  );
}

/** Held results are "Awaiting release" (warning), released ones "Released" (outline). */
export function ReleaseStatus({ status }: { status: "submitted" | "released" }) {
  return status === "released" ? <Badge variant="outline">Released</Badge> : <Badge variant="warning">Awaiting release</Badge>;
}
