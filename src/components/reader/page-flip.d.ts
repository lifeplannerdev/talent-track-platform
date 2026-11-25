// page-flip 2.0.7 ships no types. Only what the reader uses.
declare module "page-flip" {
  export type FlipEvent<T = unknown> = { data: T; object: PageFlip };
  export class PageFlip {
    constructor(block: HTMLElement, settings: Record<string, unknown>);
    loadFromHTML(items: HTMLElement[]): void;
    on(event: "flip" | "init" | "changeState" | "changeOrientation" | "update", cb: (e: FlipEvent) => void): PageFlip;
    flip(page: number): void;
    flipNext(): void;
    flipPrev(): void;
    turnToPage(page: number): void;
    getCurrentPageIndex(): number;
    getOrientation(): "portrait" | "landscape";
    getUI(): { removeHandlers(): void };
    destroy(): void;
  }
}
