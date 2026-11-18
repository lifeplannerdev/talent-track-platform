import { cn } from "cn";

/**
 * Text wordmark (no logo assets exist): "TalentTrack" with "Life Planner" as the secondary line.
 * The small mark is two stacked bars, like ruled lines on an exam sheet.
 */
export function Wordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span translate="no" className={cn("inline-flex items-center gap-2.5", className)}>
      <span aria-hidden="true" className="flex h-7 w-6 shrink-0 flex-col justify-center gap-1 rounded-[5px] bg-primary px-1.5">
        <span className="h-[3px] rounded-full bg-primary-foreground" />
        <span className="h-[3px] w-2/3 rounded-full bg-primary-foreground/70" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-heading text-[1.0625rem] font-semibold tracking-[-0.02em] text-foreground">TalentTrack</span>
        {compact ? null : <span className="mt-1 text-xs font-medium text-muted-foreground">Life Planner</span>}
      </span>
    </span>
  );
}
