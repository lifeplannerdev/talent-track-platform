"use client";

import { cn } from "cn";
import type { ChapterRange } from "@/lib/book/chapters";
import { chapterOfPage } from "@/lib/book/chapters";

export type StripPage = { page: number; thumbUrl: string; width: number; height: number };

/**
 * Horizontal strip of page thumbnails. Under each page a marker button starts (or removes) a
 * chapter there. Pages that belong to a chapter carry a tinted bar with the chapter number.
 */
export function ChapterStrip({
  pages,
  ranges,
  onToggle,
}: {
  pages: StripPage[];
  ranges: ChapterRange[];
  onToggle: (page: number) => void;
}) {
  return (
    <ul
      data-testid="page-strip"
      aria-label="Book pages"
      className="relative flex snap-x gap-3 overflow-x-auto rounded-lg border bg-muted p-3 pb-4"
    >
      {pages.map((p) => {
        const chapter = chapterOfPage(ranges, p.page);
        const starts = chapter?.startPage === p.page;
        return (
          <li key={p.page} data-testid="page-thumb" className="flex w-28 shrink-0 snap-start flex-col gap-1.5">
            <div className={cn("overflow-hidden rounded-md bg-card ring-1 ring-border", starts && "ring-2 ring-primary")}>
              {p.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed Storage URL
                <img
                  src={p.thumbUrl}
                  alt={`Page ${p.page}`}
                  width={p.width}
                  height={p.height}
                  loading="lazy"
                  className="block h-auto w-full"
                />
              ) : (
                <div className="grid aspect-[3/4] place-items-center text-xs text-muted-foreground">Page {p.page}</div>
              )}
            </div>
            <div className="flex items-center justify-between gap-1 text-xs text-muted-foreground">
              <span>{p.page}</span>
              {chapter ? <span className="truncate font-semibold text-secondary-foreground">Ch. {chapter.index + 1}</span> : null}
            </div>
            <button
              type="button"
              onClick={() => onToggle(p.page)}
              className={cn(
                "inline-flex h-8 items-center justify-center rounded-md border px-2 text-xs font-semibold outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11",
                starts
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input/70 bg-card text-foreground hover:bg-secondary",
              )}
            >
              <span className="sr-only">Page {p.page}: </span>
              {starts ? "Chapter starts" : "Start here"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
