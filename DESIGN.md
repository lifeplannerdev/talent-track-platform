# TalentTrack design system

The visual rules for TalentTrack (Life Planner exam platform). Tokens live in `src/app/globals.css`;
shared pieces in `src/components/app/` and the shadcn components in `src/components/ui/`.
Screenshots of every main screen at 375 px and desktop are in `docs/design-review/`.

## Direction: the exam sheet

TalentTrack should feel like a well-set official exam paper: white paper, clear ruled structure,
one ink colour. The ink is **Königsblau**, the royal-blue school ink German students write with,
so the one accent comes from the subject (German exams) rather than from a SaaS palette.

Two audiences, two densities, one system:

- **Students** (19 to 25, German A2 to B2, often on phones): white paper, one narrow centred
  column, large type, large targets, no panels or side chrome. The exam page shows only the
  question, the answers, the timer and the way to move on. Nothing competes with the German text.
- **Staff**: a cool grey canvas with white framed panels, a shared header with the section
  navigation, wider left-aligned pages, compact tables and forms. Efficient, scannable, calm.

The one memorable element is the answer sheet: each option is a full-width row with a large
round answer mark that fills with Königsblau when chosen, and the question navigator is a grid
of numbered squares that fill (and get a check mark) as questions are answered.

Light mode only. Dark mode was left out on purpose: the exam and the printed report are designed
for paper contrast, and a second theme would double the contrast checks for little gain.

## Tokens

### Colour (all text pairs meet WCAG AA)

| Token | Value | Use |
|---|---|---|
| `--background` | `#f4f6f9` | Staff canvas, login canvas |
| `--card` | `#ffffff` | Paper: student pages, staff panels, dialogs |
| `--foreground` | `#172033` | Body text (16.3:1 on white) |
| `--muted-foreground` | `#525d6e` | Secondary text (6.6:1 on white, 5.8:1 on muted) |
| `--primary` | `#2346a0` | Königsblau: primary action, chosen answer, current item, links, focus ring (8.6:1 on white) |
| `--secondary` / `--accent` | `#e8edf8` | Blue tint: selected option fill, current nav item, info notes |
| `--secondary-foreground` | `#1a2f6b` | Text on the blue tint |
| `--muted` | `#eef1f5` | Table head, hover fill, card footer |
| `--border` | `#d5dbe4` | Dividers and panel frames |
| `--input` | `#8a94a6` | Form control outline (3:1 on white, so fields are findable) |
| `--success` / `--success-muted` | `#1d6b3f` / `#e3f2e8` | Passed, approved, correct answer, saved |
| `--warning` / `--warning-muted` | `#8a4b00` / `#fdf0d5` | Small pool, awaiting release, offline |
| `--destructive` / `--destructive-muted` | `#b42318` / `#fdf0ee` | Failed, blocked, errors, low time |

Status colour never stands alone: every status also has a word ("Passed", "blocked", "Correct
answer") or an icon.

### Typography

- **Source Sans 3** (body, UI, exam text): humanist sans with very good German support (ä ö ü ß,
  „ “), tabular figures, calm at small sizes.
- **Lexend** (headings, the wordmark, big numbers such as scores and the timer): wide, open
  forms designed for reading ease; used only for display, never for labels or buttons.
- **Geist Mono** only for pasted CSV text.

All three are self-hosted by `next/font` at build time (no runtime CDN), Latin and Latin Extended.

Scale (rem): `xs` 0.8125, `sm` 0.9375 (staff body), `base` 1 (student body), `lg` 1.125,
`xl` 1.25, `2xl` 1.5, page titles 1.75. Exam text: `text-stem` 1.375 (1.5 from 640 px) with line
height 1.55 and at most 60 characters per line; `text-option` 1.1875 with line height 1.45.
Headings: semibold, tracking -0.012em, balanced wrapping. No all-caps labels.

### Spacing, radius, elevation

- 4 px base grid (Tailwind spacing). Staff pages: `staffMain` (max 72 rem, 32 px top);
  student pages: `studentMain` (max 42 rem, centred). Sections are separated by 24 to 32 px.
- Radius `--radius` 0.5 rem: controls 6 px (`rounded-md`), panels and cards 12 px (`rounded-xl`),
  status tags 5 px (`rounded-sm`). No pills except tiny legend swatches.
- Elevation is a 1 px border (`ring-border`). Only overlays carry a shadow (dialogs and the
  login panel). No decorative gradients, glass or blur.

### Motion

150 ms colour and border transitions on controls; the answer mark scales in when chosen (the
one authored moment); dialogs fade and zoom slightly. `prefers-reduced-motion` turns all
animation and transitions off (global rule in `globals.css`).

## Components and conventions

- **shadcn first.** Use `Button`, `Card`, `Table`, `Badge`, `Alert`, `Empty`, `Dialog`,
  `Skeleton`, `Input`, `NativeSelect`, `RadioGroup` from `src/components/ui`. They are restyled to
  the tokens; do not override their colours at the call site.
- **Buttons:** `default` (Königsblau) for the one primary action per area, `outline` for the rest,
  `ghost` for header actions, `destructive` (solid red) only in a confirm dialog. Student pages use
  `size="lg"` (44 px); staff pages use the default (36 px) and `sm` in tables.
- **Badges:** `success`, `warning`, `destructive`, `outline`. Map statuses with
  `statusVariant()` (`src/app/staff/students/ui.ts`): passed = success, blocked = destructive,
  open = outline.
- **Alerts:** `default` (blue tint) for information, `success` after a completed action,
  `warning` for things to check, `destructive` for errors. Errors say what failed and what to do.
- **Tables** come in a framed, keyboard-scrollable container; on phones they scroll inside the
  frame, never the page. Give wide tables a `min-w-[..rem]`.
- **Empty states** use `Empty` with an icon (`EmptyMedia variant="icon"`), a title and one
  sentence that says what will appear or what to do.
- **Loading** uses `Skeleton` shapes that match the content, inside an element with
  `role="status"` and an `aria-label` starting with "Loading".
- **Errors** in route boundaries use `ErrorState` (`src/components/app/error-state.tsx`).
- **Page titles:** staff pages use `PageHeader` (h1 + one-sentence description) and
  `SectionHeading` for h2s. Student pages put one h1 per page in a plain column.
- **Links** in text use `linkClass` (`src/components/app/styles.ts`): Königsblau and always
  underlined.
- **Chrome:** staff pages get the header from `src/app/staff/layout.tsx` (wordmark, `StaffNav`,
  sign out). Student pages use `StudentHeader`; the exam page has its own sticky bar.
- **Wordmark:** text only, "TalentTrack" with "Life Planner" underneath and a small mark of two
  ruled lines. No logo files exist; do not invent one.
- **Print:** the result report prints black on white with no chrome (`print:hidden` on headers
  and buttons; badges, table heads and frames are forced to black in `@media print`).

## Rules for future UI work

1. Use the tokens; never raw hex in components (add a token in `globals.css` first).
2. Königsblau is for action, selection and focus only, not for decoration.
3. Keep the student exam surface distraction-free: no extra navigation, banners or promos.
4. German exam text stays at `text-stem` / `text-option`; never shrink it to fit.
5. Every interactive element keeps the visible focus outline (2 px Königsblau, 2 px offset).
6. Check new screens at 375 px and desktop: no horizontal page scroll, AA contrast, axe clean
   (`e2e/design.spec.ts` does this and refreshes the screenshots).
7. Do not change `data-testid`s, labels or roles the e2e suite relies on without updating the
   tests in the same commit.
8. UI chrome in English; questions in German; staff evaluation and the report bilingual.
