"use client";

import { useEffect, useRef } from "react";
import { cn } from "cn";

export type ThumbPage = { page: number; thumbUrl: string; width: number; height: number };

/** The page strip: one real button per page, chapter-relative numbers, the shown pages marked. */
export function ReaderThumbs({
  pages,
  shown,
  onJump,
  reducedMotion,
}: {
  pages: ThumbPage[];
  shown: number[];
  onJump: (index: number) => void;
  reducedMotion: boolean;
}) {
  const currentRef = useRef<HTMLButtonElement | null>(null);
  const first = shown[0];

  useEffect(() => {
    currentRef.current?.scrollIntoView({ inline: "center", block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
  }, [first, reducedMotion]);

  return (
    <ul className="flex gap-2 overflow-x-auto overscroll-x-contain px-3 py-3" data-testid="reader-thumbs">
      {pages.map((p, i) => {
        const isShown = shown.includes(i);
        return (
          <li key={p.page} className="shrink-0">
            <button
              type="button"
              ref={i === first ? currentRef : undefined}
              aria-label={`Go to page ${i + 1}`}
              aria-current={isShown ? "page" : undefined}
              onClick={() => onJump(i)}
              className={cn(
                "relative flex h-16 min-w-11 cursor-pointer flex-col items-center justify-end overflow-hidden rounded-md bg-card ring-1 ring-border transition-[box-shadow,transform] duration-150 outline-none hover:ring-input focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-20",
                isShown && "ring-2 ring-primary",
              )}
              style={{ aspectRatio: `${p.width} / ${p.height}` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- signed storage url, already a small webp */}
              <img src={p.thumbUrl} alt="" decoding="async" className="absolute inset-0 size-full object-contain" />
              <span className="relative mb-0.5 rounded-sm bg-card/90 px-1 text-xs font-semibold text-foreground tabular-nums">{i + 1}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
