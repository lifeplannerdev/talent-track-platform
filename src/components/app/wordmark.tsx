import { cn } from "cn";

/**
 * Wordmark: "Talent Track Platform" set heavy in Lexend with "Powered by F.L.A.G" beneath. The mark is a
 * Königsblau square with a check drawn as one stroke, the same check the validation seal uses.
 * `compact` drops the sub-line (tight headers and footers that already carry <PoweredBy />).
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
        <span className="font-heading text-base font-bold tracking-[-0.025em] whitespace-nowrap text-foreground sm:text-[1.1875rem]">Talent Track Platform</span>
        {compact ? null : <span className="mt-1 text-xs font-medium whitespace-nowrap text-muted-foreground">Powered by F.L.A.G</span>}
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
