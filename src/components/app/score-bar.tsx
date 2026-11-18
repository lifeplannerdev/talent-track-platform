import { cn } from "cn";

/**
 * A bullet bar: the share of points as an ink fill on a ruled track, with an optional tick at
 * the pass mark. Decorative (aria-hidden): the numbers are always printed next to it.
 */
export function ScoreBar({
  percent,
  passMarkPercent,
  passed,
  size = "md",
  className,
}: {
  percent: number;
  passMarkPercent?: number | null;
  passed?: boolean | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const value = Math.min(100, Math.max(0, percent));
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative w-full rounded-full bg-muted ring-1 ring-border ring-inset [print-color-adjust:exact]",
        size === "md" ? "h-3" : "h-2",
        className,
      )}
    >
      <div
        className={cn(
          "h-full rounded-full [print-color-adjust:exact]",
          passed === false ? "bg-destructive" : "bg-primary",
        )}
        style={{ width: `${value}%` }}
      />
      {passMarkPercent !== null && passMarkPercent !== undefined ? (
        <div
          className={cn(
            "absolute top-1/2 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground",
            size === "md" ? "h-5" : "h-3.5",
          )}
          style={{ left: `${Math.min(100, Math.max(0, passMarkPercent))}%` }}
        />
      ) : null}
    </div>
  );
}
