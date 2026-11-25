// Pure rules of the book reader (layout choice, page box, spread maths, counter text). No DOM, so
// they are unit tested. Page indexes are 0-based inside the chapter; the counter shows them from 1.

export type ReaderMode = "spread" | "single";

const SPREAD_MIN_WIDTH = 900;
const SPREAD_MIN_ASPECT = 1.2;
const PRELOAD_AHEAD = 3;

/** Two pages side by side only on a wide landscape viewport; a phone on its side is too short. */
export function chooseMode({ width, height }: { width: number; height: number }): ReaderMode {
  return width >= SPREAD_MIN_WIDTH && width / Math.max(height, 1) >= SPREAD_MIN_ASPECT ? "spread" : "single";
}

/** The largest page (ratio = width / height) that fits: one page in single mode, two in a spread. */
export function fitPageBox({
  width,
  height,
  ratio,
  mode,
}: {
  width: number;
  height: number;
  ratio: number;
  mode: ReaderMode;
}): { width: number; height: number } {
  const r = ratio > 0 && Number.isFinite(ratio) ? ratio : 0.7;
  const areaW = Math.max(width, 1) / (mode === "spread" ? 2 : 1);
  const areaH = Math.max(height, 1);
  const pageW = Math.min(areaW, areaH * r);
  return { width: pageW, height: pageW / r };
}

export function clampIndex(index: number, count: number): number {
  return Math.max(0, Math.min(index, Math.max(count - 1, 0)));
}

/** First page index shown for `index`: the left page of its spread, or the page itself. */
export function spreadStart(index: number, mode: ReaderMode): number {
  return mode === "spread" ? index - (index % 2) : index;
}

export function visibleIndexes(index: number, count: number, mode: ReaderMode): number[] {
  const start = spreadStart(clampIndex(index, count), mode);
  const out = [start];
  if (mode === "spread" && start + 1 < count) out.push(start + 1);
  return out;
}

const step = (mode: ReaderMode) => (mode === "spread" ? 2 : 1);

export function nextIndex(index: number, count: number, mode: ReaderMode): number {
  const start = spreadStart(clampIndex(index, count), mode);
  const next = start + step(mode);
  return next < count ? next : start;
}

export function prevIndex(index: number, count: number, mode: ReaderMode): number {
  const start = spreadStart(clampIndex(index, count), mode);
  return Math.max(start - step(mode), 0);
}

/** "3 / 10" for a page, "3–4 / 10" for a spread: position inside the chapter, from 1. */
export function counterText(index: number, count: number, mode: ReaderMode): string {
  if (count <= 0) return "0 / 0";
  const shown = visibleIndexes(index, count, mode);
  const first = shown[0] + 1;
  const last = shown[shown.length - 1] + 1;
  return first === last ? `${first} / ${count}` : `${first}\u2013${last} / ${count}`;
}

/** Pages worth having loaded: what is shown, one step back and a few pages ahead. */
export function preloadIndexes(index: number, count: number, mode: ReaderMode): number[] {
  if (count <= 0) return [];
  const shown = visibleIndexes(index, count, mode);
  const from = Math.max(shown[0] - step(mode), 0);
  const to = Math.min(shown[shown.length - 1] + PRELOAD_AHEAD, count - 1);
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}
