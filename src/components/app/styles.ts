// Shared class strings for layout and inline links (see DESIGN.md).

/** Staff page body: wide, efficient, left aligned. */
export const staffMain = "mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pt-8 pb-16";

/** Student page body: one narrow centred column. */
export const studentMain = "mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 pt-8 pb-16";

/** Inline text link: Königsblau, always underlined so it never relies on colour alone. */
export const linkClass =
  "font-semibold text-primary underline decoration-primary/35 underline-offset-4 transition-colors hover:decoration-primary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
