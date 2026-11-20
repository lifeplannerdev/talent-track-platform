import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("relative overflow-hidden rounded-md bg-muted after:absolute after:inset-0 after:-translate-x-full after:bg-linear-to-r after:from-transparent after:via-card/70 after:to-transparent after:animate-[kvp-shimmer_1.6s_var(--ease-out)_infinite]", className)}
      {...props}
    />
  )
}

export { Skeleton }
