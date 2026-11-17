import { Badge } from "@/components/ui/badge";

/** Stored score with a pass/fail tag, or "Scoring pending" when the attempt is not scored yet. */
export function ResultScore({ points, maxPoints, passed }: { points: number | null; maxPoints: number | null; passed: boolean | null }) {
  if (points === null || maxPoints === null) return <Badge variant="outline">Scoring pending</Badge>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="tabular-nums">
        {points} / {maxPoints}
      </span>
      <Badge variant={passed ? "success" : "destructive"}>{passed ? "Pass" : "Fail"}</Badge>
    </span>
  );
}

/** Held results are "Awaiting release" (warning), released ones "Released" (outline). */
export function ReleaseStatus({ status }: { status: "submitted" | "released" }) {
  return status === "released" ? <Badge variant="outline">Released</Badge> : <Badge variant="warning">Awaiting release</Badge>;
}
