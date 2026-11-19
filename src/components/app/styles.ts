// Shared class strings for layout and inline links (see DESIGN.md).

/** Staff page body: wide, efficient, left aligned. Up to 80 rem so tables use a wide screen. */
export const staffMain = "mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pt-5 pb-12 sm:px-6 sm:pt-6 lg:px-8";

/** Student page body: one narrow centred column. */
export const studentMain = "mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 pt-6 pb-12 sm:pt-8";

/** Inline text link: Königsblau, always underlined so it never relies on colour alone. */
export const linkClass =
  "font-semibold text-primary underline decoration-primary/35 underline-offset-4 transition-colors hover:decoration-primary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** An inline link that stands alone in a row (Resume, View result): grows to 44 px on touch screens. */
export const touchLinkClass = `${linkClass} items-center pointer-coarse:inline-flex pointer-coarse:min-h-11`;

/** Small grey label above a value (facts on reports and summaries). Sentence case, never caps. */
export const factLabel = "text-xs font-semibold text-muted-foreground print:text-black";
