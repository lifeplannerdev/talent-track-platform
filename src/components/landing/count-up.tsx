"use client";

import { useEffect, useRef } from "react";

/**
 * A whole-number percentage that counts up once when it scrolls into view. The final value is the
 * server-rendered text (and the screen-reader text), so it is correct without JS and with reduced
 * motion. Only the aria-hidden copy animates; its box is reserved by the final text (no layout shift).
 */
export function CountUp({ value, suffix = "%", durationMs = 1100 }: { value: number; suffix?: string; durationMs?: number }) {
  const shown = useRef<HTMLSpanElement>(null);
  const final = `${value}${suffix}`;

  useEffect(() => {
    const el = shown.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeof IntersectionObserver === "undefined") return;
    let frame = 0;
    const run = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - t, 4);
        el.textContent = `${Math.round(value * eased)}${suffix}`;
        if (t < 1) frame = requestAnimationFrame(tick);
        else el.textContent = final;
      };
      el.textContent = `0${suffix}`;
      frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          run();
        }
      },
      { threshold: 0.6 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, suffix, durationMs, final]);

  return (
    <>
      <span ref={shown} aria-hidden="true" className="inline-block text-left tabular-nums" style={{ minWidth: `${final.length}ch` }}>
        {final}
      </span>
      <span className="sr-only">{final}</span>
    </>
  );
}
