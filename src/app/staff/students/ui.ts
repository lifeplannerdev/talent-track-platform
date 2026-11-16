// Small presentation helpers shared by the student pages.

export const linkClass =
  "text-sm font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function statusVariant(status: string): "secondary" | "destructive" | "outline" {
  if (status === "passed") return "secondary";
  if (status === "blocked") return "destructive";
  return "outline";
}

export function trackLabel(track: string | null): string {
  if (track === "nursing") return "Nursing";
  if (track === "other") return "Other";
  return track ?? "–";
}
