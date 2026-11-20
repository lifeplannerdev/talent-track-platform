import { cn } from "cn";

/**
 * The validation seal: two rings and a check mark in seal gold. The strokes draw in once when the
 * enclosing <Reveal> comes into view (CSS only, see .seal-draw); without JS or with reduced motion
 * it is simply drawn. Decorative: the result it sits beside is always written out.
 */
export function Seal({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 96 96"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-24 text-seal-ring [print-color-adjust:exact]", className)}
    >
      <circle cx="48" cy="48" r="44" fill="var(--seal-muted)" className="seal-pop" />
      <circle cx="48" cy="48" r="44" stroke="currentColor" strokeWidth="2.5" className="seal-draw" style={{ "--len": 277 } as React.CSSProperties} />
      <circle cx="48" cy="48" r="36" stroke="currentColor" strokeWidth="1.25" strokeDasharray="2 4" opacity="0.8" className="seal-pop" />
      <path
        d="M30 50 L43 63 L67 35"
        stroke="var(--seal)"
        strokeWidth="6"
        className="seal-draw"
        style={{ "--len": 70, "--draw-delay": "350ms" } as React.CSSProperties}
      />
    </svg>
  );
}
