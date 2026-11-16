// Dates are shown in India time: students and staff are in Kerala.
const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDateTime(value: string | null): string {
  return value ? DATE_TIME.format(new Date(value)) : "–";
}
