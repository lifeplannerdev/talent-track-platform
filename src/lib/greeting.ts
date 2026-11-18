// Time-aware greetings for the student start page and the staff dashboard. Users are in Kerala,
// so the hour is read in India time (Asia/Kolkata), whatever the server's own time zone is.

export type DayPeriod = "morning" | "afternoon" | "evening";

const HOUR = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" });

/** morning 05:00-11:59, afternoon 12:00-16:59, evening otherwise (India time). */
export function dayPeriod(now: Date): DayPeriod {
  const hour = Number(HOUR.format(now));
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  return "evening";
}

/** First word of the full name, else the username, else null. */
export function firstName(fullName: string | null | undefined, username: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  if (first) return first;
  return username?.trim() || null;
}

/** "Good morning, Anjali" (or "Good morning" when no name is known). */
export function greeting(person: { fullName: string | null | undefined; username: string | null | undefined }, now: Date): string {
  const hello = `Good ${dayPeriod(now)}`;
  const name = firstName(person.fullName, person.username);
  return name ? `${hello}, ${name}` : hello;
}
