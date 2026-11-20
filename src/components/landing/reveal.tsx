"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "cn";

/**
 * Scroll reveal, once. Marks its element with data-in the first time it is on screen; the CSS in
 * globals.css (.reveal) hides it only when scripting is on and motion is allowed, so content is
 * always readable without JS and with reduced motion. One shared observer per element, disconnected
 * after the first hit. Also drives the seal and score-bar drawing inside it.
 */
export function Reveal({
  as: Tag = "div",
  index = 0,
  className,
  children,
  id,
  ...rest
}: {
  as?: "div" | "section" | "li" | "article" | "header" | "footer";
  /** Stagger position among siblings (80 ms steps). */
  index?: number;
  className?: string;
  children: ReactNode;
  id?: string;
  "aria-labelledby"?: string;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.setAttribute("data-in", "");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.setAttribute("data-in", "");
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const Component = Tag as "div";
  return (
    <Component
      ref={ref as React.RefObject<HTMLDivElement>}
      id={id}
      className={cn("reveal", className)}
      style={{ "--reveal-i": index } as CSSProperties}
      {...rest}
    >
      {children}
    </Component>
  );
}
