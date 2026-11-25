import { cn } from "cn";

/**
 * The name, drawn as one lockup: a single Königsblau T shared by "Talent" and "Track" (its stem serves both
 * words), "alent" and "rack" stacked beside it, and "Platform" after it (`inline`, headers and footers) or
 * under it (`stacked`, big placements: landing, sign-in, the end of the film). The size comes from the
 * parent's font-size; everything inside is in em.
 *
 * The drawing is hidden from assistive technology and the full name is read once as plain text, so screen
 * readers, text search, translation-off and tests all see "Talent Track Platform". The name itself never
 * changes: the T is shared in the artwork only.
 */
export function NameLockup({ layout = "inline", className }: { layout?: "inline" | "stacked"; className?: string }) {
  const stacked = layout === "stacked";
  return (
    <span translate="no" className={cn("inline-block font-heading font-bold tracking-[-0.045em] whitespace-nowrap text-foreground", className)}>
      <span className="sr-only">Talent Track Platform</span>
      <span aria-hidden="true" className={cn("inline-flex", stacked ? "flex-col items-start" : "items-center gap-[0.5em]")}>
        <span className="inline-flex items-start">
          <span className="mr-[0.02em] text-[2.3em] leading-[0.7] font-extrabold tracking-[-0.06em] text-primary">T</span>
          <span className="flex flex-col pt-[0.06em]">
            <span className="block leading-[0.8]">alent</span>
            <span className="block leading-[0.8]">rack</span>
          </span>
        </span>
        <span className={cn("block font-semibold", stacked ? "mt-[0.22em] tracking-[-0.04em]" : "ml-[0.15em] leading-none text-muted-foreground")}>Platform</span>
      </span>
    </span>
  );
}

/**
 * Wordmark: the name lockup at header size. `compact` is the smaller footer size. The T is the mark, so there
 * is no separate logo square; the check stroke lives on in the validation seal. "Powered by F.L.A.G." is not
 * part of the wordmark any more: <PoweredBy /> carries it where it is shown.
 */
export function Wordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center", className)}>
      <NameLockup className={compact ? "text-[0.8125rem] sm:text-[0.875rem]" : "text-[0.9375rem] sm:text-[1.125rem]"} />
    </span>
  );
}

/** "Powered by F.L.A.G.": the letters and the final dot exactly as given. */
export function PoweredBy({ className }: { className?: string }) {
  return (
    <span translate="no" className={cn("text-sm text-muted-foreground", className)}>
      Powered by <span className="font-heading font-semibold tracking-[0.02em] text-foreground">F.L.A.G.</span>
    </span>
  );
}
