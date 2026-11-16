import type { ReactNode } from "react";
import { cn } from "cn";

/** Staff page title block: h1, an optional one-paragraph explanation and optional actions. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="text-2xl font-semibold text-foreground sm:text-[1.75rem]">{title}</h1>
        {description ? <p className="max-w-[70ch] text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** Section heading inside a staff page. */
export function SectionHeading({ id, children, aside }: { id?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id={id} className="text-lg font-semibold">
        {children}
      </h2>
      {aside}
    </div>
  );
}
