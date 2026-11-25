"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronLeftIcon, ChevronRightIcon, GalleryHorizontalEndIcon, XIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  clampIndex,
  counterText,
  nextIndex,
  preloadIndexes,
  prevIndex,
  spreadStart,
  visibleIndexes,
} from "./reader-model";
import { decideImageError, type RetryState } from "./retry-policy";
import { ReaderThumbs } from "./reader-thumbs";
import { useReaderLayout } from "./use-reader-layout";
import type { PageFlip } from "page-flip";

export type ReaderPage = { page: number; url: string; thumbUrl: string; width: number; height: number };

const IDLE_MS = 3500;
const ZOOM = 2;

const reducedQuery = "(prefers-reduced-motion: reduce)";
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(reducedQuery);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia(reducedQuery).matches,
    () => false,
  );
}

/**
 * Full-screen book reader around the StPageFlip core (HTML mode, so every page keeps its own shape:
 * the image is letterboxed inside the page with object-fit: contain). The flip instance is owned by
 * an effect: created per layout (mode, page size, zoom), destroyed on cleanup, never initialised
 * twice (strict mode safe). The current page index lives in React state, outside the layout.
 * `onExpired` is called when a page image fails (its signed link probably ran out): the caller
 * refreshes the route and passes fresh urls; the page index is kept.
 */
export function BookReader({
  chapterTitle,
  pages,
  onClose,
  onExpired,
}: {
  chapterTitle: string;
  pages: ReaderPage[];
  onClose: () => void;
  onExpired?: () => void;
}) {
  const count = pages.length;
  const reduced = useReducedMotion();
  const { mode, pageBox } = useReaderLayout(pages[0] ? pages[0].width / pages[0].height : undefined);

  const [current, setCurrentState] = useState(0);
  const currentRef = useRef(0);
  const [zoomed, setZoomed] = useState(false);
  const [stripOpen, setStripOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [ready, setReady] = useState(false);
  const [brokenFor, setBrokenFor] = useState<ReaderPage[] | null>(null);
  const broken = brokenFor === pages;
  const [announce, setAnnounce] = useState("");

  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const deskRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<PageFlip | null>(null);
  const imgsRef = useRef<HTMLImageElement[]>([]);
  const pagesRef = useRef(pages);
  const modeRef = useRef(mode);
  const reducedRef = useRef(reduced);
  const retryRef = useRef<RetryState>(null);
  const onExpiredRef = useRef(onExpired);
  const stripOpenRef = useRef(stripOpen);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    stripOpenRef.current = stripOpen;
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    pagesRef.current = pages;
    modeRef.current = mode;
    reducedRef.current = reduced;
    onExpiredRef.current = onExpired;
  });

  const scale = zoomed ? ZOOM : 1;
  const pageW = pageBox.width * scale;
  const pageH = pageBox.height * scale;

  const setCurrent = useCallback((index: number) => {
    currentRef.current = index;
    setCurrentState(index);
  }, []);

  // Which images should have a source: what is shown, one step back, a few ahead.
  const loadAround = useCallback(() => {
    const list = pagesRef.current;
    for (const i of preloadIndexes(currentRef.current, list.length, modeRef.current)) {
      const img = imgsRef.current[i];
      if (img && !img.getAttribute("src")) img.src = list[i].url;
    }
  }, []);

  const checkReady = useCallback(() => {
    const shown = visibleIndexes(currentRef.current, pagesRef.current.length, modeRef.current);
    if (shown.every((i) => imgsRef.current[i]?.complete && imgsRef.current[i].naturalWidth > 0)) setReady(true);
  }, []);

  // The flip instance.
  useEffect(() => {
    const container = bookRef.current;
    if (!container || pagesRef.current.length === 0) return;
    let cancelled = false;
    let flip: PageFlip | null = null;
    let host: HTMLDivElement | null = null;

    void (async () => {
      const mod = await import("page-flip");
      if (cancelled) return;
      const Flip = mod.PageFlip ?? (mod as unknown as { default: { PageFlip: typeof PageFlip } }).default.PageFlip;
      const list = pagesRef.current;
      host = document.createElement("div");
      host.style.width = `${mode === "spread" ? pageW * 2 : pageW}px`;
      host.style.height = `${pageH}px`;
      host.style.isolation = "isolate";
      container.appendChild(host);

      const imgs: HTMLImageElement[] = [];
      const elements = list.map((p, i) => {
        const el = document.createElement("div");
        el.className = "h-full w-full overflow-hidden bg-card";
        const img = document.createElement("img");
        img.alt = `Page ${i + 1}`;
        img.dataset.page = String(i + 1);
        img.dataset.testid = `reader-page-${i + 1}`;
        img.setAttribute("data-testid", `reader-page-${i + 1}`);
        img.decoding = "async";
        img.draggable = false;
        img.className = "size-full select-none object-contain";
        img.addEventListener("load", checkReady);
        img.addEventListener("error", () => {
          if (cancelled) return;
          const latest = pagesRef.current;
          const decision = decideImageError(retryRef.current, Date.now(), latest);
          retryRef.current = decision.state;
          if (decision.action === "refresh") onExpiredRef.current?.();
          else if (decision.action === "broken") setBrokenFor(latest);
        });
        el.appendChild(img);
        imgs.push(img);
        return el;
      });
      imgsRef.current = imgs;

      const start = spreadStart(clampIndex(currentRef.current, list.length), mode);
      flip = new Flip(host, {
        width: pageW,
        height: pageH,
        size: "fixed",
        autoSize: false,
        usePortrait: mode === "single",
        showCover: false,
        startPage: start,
        flippingTime: 720,
        maxShadowOpacity: 0.4,
        drawShadow: !reducedRef.current,
        showPageCorners: !reducedRef.current && !zoomed,
        useMouseEvents: !zoomed,
        mobileScrollSupport: false,
        swipeDistance: 30,
      });
      loadAround();
      flip.loadFromHTML(elements);
      flipRef.current = flip;
      flip.on("flip", (e) => {
        const index = spreadStart(clampIndex(e.data as number, pagesRef.current.length), modeRef.current);
        if (index !== currentRef.current) {
          setCurrent(index);
          loadAround();
        }
      });
      // A turn the library ignored (for example during an animation) must not leave the counter wrong.
      flip.on("changeState", (e) => {
        if (e.data === "read" && flipRef.current) {
          const index = flipRef.current.getCurrentPageIndex();
          if (index !== currentRef.current) setCurrent(index);
        }
      });
      checkReady();
    })();

    return () => {
      cancelled = true;
      flipRef.current = null;
      if (flip) {
        try {
          flip.getUI().removeHandlers(); // the library leaves its resize listener when mouse events are off
          flip.destroy();
        } catch {
          host?.remove();
        }
      } else {
        host?.remove();
      }
    };
    // pageW/pageH/mode/zoomed decide the layout; everything else is read through refs.
  }, [mode, pageW, pageH, zoomed, count, checkReady, loadAround, setCurrent]);

  // Fresh signed urls (after a route refresh): swap the sources of the images that have one or failed.
  useEffect(() => {
    imgsRef.current.forEach((img, i) => {
      const url = pages[i]?.url;
      if (url && img.getAttribute("src") !== null && img.getAttribute("src") !== url) img.src = url;
    });
    loadAround();
    // A failed image has no usable src but did have one set: make sure every window page is set again.
    imgsRef.current.forEach((img, i) => {
      if (img.getAttribute("src") && img.complete && img.naturalWidth === 0 && pages[i]) img.src = pages[i].url;
    });
  }, [pages, loadAround]);

  useEffect(() => {
    loadAround();
  }, [current, mode, loadAround]);

  // Turn to a page. Reduced motion: instant.
  const goTo = useCallback(
    (index: number) => {
      const target = spreadStart(clampIndex(index, pagesRef.current.length), modeRef.current);
      if (target === spreadStart(currentRef.current, modeRef.current)) return;
      setCurrent(target);
      const flip = flipRef.current;
      if (!flip) return;
      if (reducedRef.current) flip.turnToPage(target);
      else flip.flip(target);
    },
    [setCurrent],
  );
  const goNext = useCallback(() => goTo(nextIndex(currentRef.current, pagesRef.current.length, modeRef.current)), [goTo]);
  const goPrev = useCallback(() => goTo(prevIndex(currentRef.current, pagesRef.current.length, modeRef.current)), [goTo]);

  // Keep the page after a layout change: the instance restarts at the spread that holds it.
  useEffect(() => {
    setCurrent(spreadStart(currentRef.current, mode));
  }, [mode, setCurrent]);

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          goNext();
          break;
        case "ArrowLeft":
          e.preventDefault();
          goPrev();
          break;
        case "Home":
          e.preventDefault();
          goTo(0);
          break;
        case "End":
          e.preventDefault();
          goTo(pagesRef.current.length - 1);
          break;
        case "Escape":
          if (stripOpenRef.current) setStripOpen(false);
          else onCloseRef.current();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev, goTo]);

  // Take focus once so the keyboard works at once; never moves it afterwards.
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  // Lock the page behind the reader.
  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  // Calm chrome: fades after idle (motion allowed only), returns on pointer, touch or key, never
  // while a control has focus or the strip is open.
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arm = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (reducedRef.current) return;
    idleTimer.current = setTimeout(() => {
      const root = rootRef.current;
      const focusInside = !!root && root !== document.activeElement && root.contains(document.activeElement);
      if (!focusInside && !stripOpenRef.current) setChromeVisible(false);
    }, IDLE_MS);
  }, []);
  const wake = useCallback(() => {
    setChromeVisible(true);
    arm();
  }, [arm]);
  useEffect(() => {
    arm();
    const events = ["pointermove", "pointerdown", "touchstart", "keydown"] as const;
    events.forEach((n) => window.addEventListener(n, wake, { passive: true }));
    return () => {
      events.forEach((n) => window.removeEventListener(n, wake));
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [wake, arm, reduced, stripOpen]);

  // Live region: announce the position after a pause, not at every flip.
  const shown = visibleIndexes(current, count, mode);
  const counter = counterText(current, count, mode);
  useEffect(() => {
    const t = setTimeout(() => setAnnounce(`Page ${counter.replace("/", "of")}`), 700);
    return () => clearTimeout(t);
  }, [counter]);

  // Drag to pan the enlarged view with a mouse (touch and trackpad scroll natively).
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const onPanDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!zoomed || e.pointerType !== "mouse" || e.button !== 0 || !deskRef.current) return;
    panRef.current = { x: e.clientX, y: e.clientY, left: deskRef.current.scrollLeft, top: deskRef.current.scrollTop };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPanMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = panRef.current;
    if (!p || !deskRef.current) return;
    deskRef.current.scrollLeft = p.left - (e.clientX - p.x);
    deskRef.current.scrollTop = p.top - (e.clientY - p.y);
  };
  const onPanUp = () => {
    panRef.current = null;
  };

  const atStart = shown[0] === 0;
  const atEnd = shown[shown.length - 1] === count - 1;
  const chromeHidden = !chromeVisible && !reduced;
  const chromeClass = cn(
    "transition-opacity duration-300 focus-within:opacity-100",
    chromeHidden ? "opacity-0" : "opacity-100",
    reduced && "transition-none",
  );

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={`Reading: ${chapterTitle}`}
      tabIndex={-1}
      data-testid="book-reader"
      data-mode={mode}
      data-zoomed={zoomed || undefined}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background text-foreground outline-none"
    >
      {/* Top bar */}
      <div
        ref={barRef}
        data-testid="reader-bar"
        className={cn("relative z-20 flex h-16 shrink-0 items-center gap-2 px-3 sm:px-5", chromeClass)}
      >
        <Button variant="outline" size="lg" onClick={onClose} aria-label="Close reader" className="px-3 sm:px-4">
          <XIcon data-icon="inline-start" aria-hidden="true" />
          <span className="max-sm:sr-only">Close</span>
        </Button>
        <h1 className="min-w-0 flex-1 truncate px-1 text-base font-semibold sm:text-lg">{chapterTitle}</h1>
        <Button
          variant="outline"
          size="icon-lg"
          aria-label={stripOpen ? "Hide page strip" : "Show page strip"}
          aria-expanded={stripOpen}
          onClick={() => setStripOpen((v) => !v)}
        >
          <GalleryHorizontalEndIcon aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon-lg"
          aria-label="Enlarge pages"
          aria-pressed={zoomed}
          onClick={() => setZoomed((v) => !v)}
        >
          {zoomed ? <ZoomOutIcon aria-hidden="true" /> : <ZoomInIcon aria-hidden="true" />}
        </Button>
      </div>

      {/* Desk and book */}
      <div
        ref={deskRef}
        className={cn("relative flex min-h-0 flex-1 overflow-auto", zoomed ? "cursor-grab active:cursor-grabbing" : "overflow-hidden")}
        onPointerDown={onPanDown}
        onPointerMove={onPanMove}
        onPointerUp={onPanUp}
        onPointerCancel={onPanUp}
      >
        <div className="relative m-auto shrink-0 shadow-panel" style={{ width: mode === "spread" ? pageW * 2 : pageW, height: pageH }}>
          <div ref={bookRef} className="absolute inset-0" />
          {mode === "spread" && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-1/2 z-10 w-8 -translate-x-1/2 bg-linear-to-r from-transparent via-foreground/15 to-transparent"
            />
          )}
          {!ready && (
            <div data-testid="reader-skeleton" role="status" aria-label="Loading pages" className="absolute inset-0 z-20 flex gap-px bg-card">
              <Skeleton className="size-full rounded-none" />
              {mode === "spread" && <Skeleton className="size-full rounded-none" />}
            </div>
          )}
        </div>
      </div>

      {broken && (
        <p role="alert" data-testid="reader-broken" className="absolute inset-x-4 bottom-24 z-30 mx-auto w-fit max-w-full rounded-md bg-destructive-muted px-3 py-2 text-sm text-destructive ring-1 ring-destructive/30">
          A page could not be loaded. Check your connection and reload.
        </p>
      )}

      {/* Page strip */}
      {stripOpen && (
        <div
          role="region"
          aria-label="Pages"
          className="absolute inset-x-0 bottom-20 z-30 mx-auto max-w-3xl rounded-t-xl bg-card shadow-overlay ring-1 ring-border"
        >
          <ReaderThumbs
            pages={pages}
            shown={shown}
            reducedMotion={reduced}
            onJump={(i) => {
              goTo(i);
              setStripOpen(false);
            }}
          />
        </div>
      )}

      {/* Bottom toolbar */}
      <div className={cn("relative z-20 flex h-20 shrink-0 items-center justify-center gap-3 px-3", chromeClass)}>
        <Button variant="outline" size="icon-lg" aria-label="Previous page" disabled={atStart} onClick={goPrev}>
          <ChevronLeftIcon aria-hidden="true" />
        </Button>
        <p
          data-testid="reader-counter"
          aria-hidden="true"
          className="min-w-24 text-center font-heading text-base font-semibold tabular-nums"
        >
          {counter}
        </p>
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announce}
        </span>
        <Button variant="outline" size="icon-lg" aria-label="Next page" disabled={atEnd} onClick={goNext}>
          <ChevronRightIcon aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
