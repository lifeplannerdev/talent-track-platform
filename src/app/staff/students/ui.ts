// Small presentation helpers shared by the student pages.

export { linkClass } from "@/components/app/styles";

export function statusVariant(status: string): "success" | "destructive" | "outline" {
  if (status === "passed") return "success";
  if (status === "blocked") return "destructive";
  return "outline";
}

export function trackLabel(track: string | null): string {
  if (track === "nursing") return "Nursing";
  if (track === "other") return "Other";
  return track ?? "–";
}
