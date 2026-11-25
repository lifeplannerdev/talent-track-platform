"use client";

import { useEffect, useState } from "react";
import { chooseMode, fitPageBox, type ReaderMode } from "./reader-model";

// Room kept for the top bar and the bottom toolbar, and a small margin of desk around the book.
const RESERVE_TOP = 64;
const RESERVE_BOTTOM = 88;
const MARGIN_X = 16;

function readViewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Spread or single page for the viewport, and the size of ONE page in whole pixels (the flip library
 * compares the block width with twice the page width, so fractions would tip a spread into single).
 * `ratio` is the first page's width / height; pages of other shapes are fitted inside that box.
 */
export function useReaderLayout(ratio = 0.7): { mode: ReaderMode; pageBox: { width: number; height: number } } {
  const [viewport, setViewport] = useState(readViewport);

  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setViewport(readViewport()));
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  const mode = chooseMode(viewport);
  const box = fitPageBox({
    width: viewport.width - MARGIN_X * 2,
    height: viewport.height - RESERVE_TOP - RESERVE_BOTTOM,
    ratio,
    mode,
  });
  return { mode, pageBox: { width: Math.max(Math.floor(box.width), 60), height: Math.max(Math.floor(box.height), 80) } };
}
