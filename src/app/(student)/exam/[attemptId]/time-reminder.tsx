"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { ClockIcon, XIcon } from "lucide-react";
import { cn } from "cn";
import { reminderText } from "@/lib/reminders";
import { Button } from "@/components/ui/button";

/**
 * The "N minutes left" reminder under the exam bar. Non-modal: it never takes focus, never
 * handles keys outside itself and closing it only hides it. The polite status region is always
 * in the DOM so screen readers announce a new reminder reliably; with no reminder it has no
 * height. Escape closes it while focus is inside it. It hides itself after `visibleMs` through
 * the same close path, so a focused Close button never strands focus on <body>.
 */
export function TimeReminder({
  minutes,
  onClose,
  visibleMs,
}: {
  minutes: number | null;
  onClose: () => void;
  visibleMs: number;
}) {
  const row = useRef<HTMLDivElement>(null);
  const urgent = minutes !== null && minutes <= 5;

  function close() {
    // Closing removes the button; put focus somewhere sensible instead of losing it to <body>.
    const hadFocus = row.current?.contains(document.activeElement) ?? false;
    onClose();
    if (hadFocus) document.getElementById("main-content")?.focus({ preventScroll: true });
  }
  const autoClose = useEffectEvent(() => close());

  // A reminder hides itself after a while (a new reminder restarts the time).
  useEffect(() => {
    if (minutes === null) return;
    const timer = setTimeout(() => autoClose(), visibleMs);
    return () => clearTimeout(timer);
  }, [minutes, visibleMs]);

  return (
    <div
      ref={row}
      data-testid="time-reminder-region"
      onKeyDown={(e) => {
        if (e.key === "Escape" && minutes !== null) {
          e.stopPropagation();
          close();
        }
      }}
      className={cn(
        minutes !== null &&
          "border-b motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200",
        minutes !== null && (urgent ? "border-destructive/30 bg-destructive-muted text-destructive" : "border-primary/20 bg-secondary text-secondary-foreground"),
      )}
    >
      <div className={cn("mx-auto flex w-full max-w-3xl items-center gap-3", minutes !== null && "py-1 pr-1 pl-4")}>
        <div role="status" aria-live="polite" aria-atomic="true" className="flex min-w-0 flex-1 items-center gap-2.5">
          {minutes !== null ? (
            <>
              <ClockIcon aria-hidden="true" className="size-4 shrink-0" />
              <p data-testid="time-reminder" className="text-base">
                <span className="font-heading font-semibold tabular-nums">{reminderText(minutes)}</span>
              </p>
            </>
          ) : null}
        </div>
        {minutes !== null ? (
          <Button variant="ghost" size="icon-lg" onClick={close} aria-label="Close reminder" className="shrink-0 text-current">
            <XIcon aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
