import { cn } from "cn";

/**
 * Wordmark: "KVP" set heavy in Lexend with "Knowledge Validation Platform" beneath. The mark is a
 * Königsblau square with a check drawn as one stroke, the same check the validation seal uses.
 * `compact` drops the full name (tight headers); "Powered by F.L.A.G" lives in <PoweredBy />.
 * No logo files exist; do not invent one.
 */
export function Wordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span translate="no" className={cn("inline-flex items-center gap-2.5", className)}>
      <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-[7px] bg-primary [print-color-adjust:exact]">
        <svg viewBox="0 0 24 24" className="size-[1.15rem]" fill="none" stroke="var(--primary-foreground)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5 L10 17.5 L19 7" />
        </svg>
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-heading text-[1.1875rem] font-bold tracking-[-0.025em] text-foreground">KVP</span>
        {compact ? null : <span className="mt-1 text-xs font-medium text-muted-foreground">Knowledge Validation Platform</span>}
      </span>
    </span>
  );
}

/** "Powered by F.L.A.G": the letters exactly as given. */
export function PoweredBy({ className }: { className?: string }) {
  return (
    <span translate="no" className={cn("text-sm text-muted-foreground", className)}>
      Powered by <span className="font-heading font-semibold tracking-[0.02em] text-foreground">F.L.A.G</span>
    </span>
  );
}
