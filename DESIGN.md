# Talent Track Platform design system

The visual rules for Talent Track Platform, powered by F.L.A.G. (the letters and the final dot exactly as given; F.L.A.G. is the Foreign Languages Academy Gurukulam, spelled out once, in the landing footer). Tokens live in `src/app/globals.css`;
shared pieces in `src/components/app/` and the shadcn components in `src/components/ui/`.
Screenshots of every main screen at 375 px and desktop are in `docs/design-review/`.

## Direction: the exam sheet

Talent Track Platform should feel like a well-set official exam paper: white paper, clear ruled structure,
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

**The landing page and the motifs (landing branch).** The public home page (`/`, `src/app/page.tsx`)
and the sign-in page carry a more editorial finish of the same system: very large Lexend headings
(bold, tracking -0.04em), ruled exam-paper lines behind the hero (`.ruled`, `--rule-faint`), ruled
dividers (`border-rule`) instead of card grids, and two motifs that belong to validation:
the **answer bubble** (the filled round mark; the start cards show one per attempt left) and the
**validation seal** (`Seal`: two rings and a check in seal gold, drawn once). The German and
English pair appears as the side-by-side review specimen (`ReviewSpecimen`). The specimens on the
landing page are labelled as samples; no statistics, testimonials or logos exist and none may be added.
Copy states only what the code does (see the Fairness section: logging, not blocking).

Light mode only. Dark mode was left out on purpose: the exam and the printed report are designed
for paper contrast, and a second theme would double the contrast checks for little gain. There is no
`dark` variant in `globals.css` and the components carry no `dark:` classes; do not add them.

## Tokens

### Colour (all text pairs meet WCAG AA)

| Token | Value | Use |
|---|---|---|
| `--background` | `#f2f4f8` | Staff canvas, login canvas |
| `--card` | `#ffffff` | Paper: student pages, staff panels, dialogs |
| `--foreground` | `#111a30` | Body text (16.3:1 on white) |
| `--muted-foreground` | `#525d6e` | Secondary text (6.6:1 on white, 5.8:1 on muted) |
| `--primary` | `#2346a0` | Königsblau: primary action, chosen answer, current item, links, focus ring (8.6:1 on white) |
| `--secondary` / `--accent` | `#e8edf8` | Blue tint: selected option fill, current nav item, info notes |
| `--secondary-foreground` | `#1a2f6b` | Text on the blue tint |
| `--muted` | `#eef1f5` | Table head, hover fill, card footer |
| `--rule` / `--rule-faint` | `#c4cddc` / blue at 7% | Ruled dividers on the landing page; the faint ruled-paper lines |
| `--seal` / `--seal-ring` / `--seal-muted` | `#7d5a00` / `#b8860b` / `#f6ecce` | The one warm accent: the gold of the validation seal. Not for actions, links or status |
| `--border` | `#d5dbe4` | Dividers and panel frames |
| `--input` | `#8a94a6` | Form control outline (3:1 on white, so fields are findable) |
| `--success` / `--success-muted` | `#1d6b3f` / `#e3f2e8` | Passed, approved, correct answer, saved |
| `--warning` / `--warning-muted` | `#8a4b00` / `#fdf0d5` | Small pool, being calculated or scored, offline |
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

- 4 px base grid (Tailwind spacing). Staff pages: `staffMain` (max 80 rem, 20 px top on phones,
  24 px from 640 px, 16/24/32 px side gutters); student pages: `studentMain` (max 42 rem, centred,
  24 to 32 px top). Sections are separated by 20 px; groups inside a section by 8 to 16 px.
- Cards pad 16 px on phones and 20 px from 640 px (`size="sm"`: 14 / 16 px). Table heads are 36 px,
  cells 8 px vertical padding. Page titles are 22 px on phones, 24 px from 640 px.
- Touch targets: controls are compact for a mouse (36 px buttons, inputs and selects) and grow to
  44 px on touch screens through the `pointer-coarse:` variant in `button.tsx`, `input.tsx` and
  `native-select.tsx`. Student pages use `size="lg"` (44 px) everywhere.
- Radius `--radius` 0.5 rem: controls 6 px (`rounded-md`), panels and cards 12 px (`rounded-xl`),
  status tags 5 px (`rounded-sm`). No pills except tiny legend swatches.
- Elevation is a 1 px border (`ring-border`). Only overlays carry a shadow (plus the landing specimens, which use `--lift-shadow` instead of a border, and linked cards on hover): `shadow-overlay`
  (`--overlay-shadow`, dialogs) and `shadow-panel` (`--panel-shadow`, the login panel). The
  dialog backdrop is `bg-scrim` (`--scrim`, ink at 45%). No decorative gradients, glass or blur.

### Motion

Tokens: `--ease-out` (exponential ease-out), `--dur-fast` 150 ms, `--dur-base` 220 ms, `--dur-slow`
640 ms. Only transform and opacity move. Everything respects `prefers-reduced-motion` (the global
rule in `globals.css` shortens animations and transitions to nothing, and the reveal states below
are never applied) and plays once without blocking input or shifting layout.

- Hero entrance: `.enter` with `--enter-i` stagger (90 ms steps), CSS only, so it works without JS.
- Scroll reveal: `<Reveal>` (`src/components/landing/reveal.tsx`, one IntersectionObserver per
  element, disconnects after the first hit) sets `data-in`; `.reveal` is hidden only inside
  `@media (scripting: enabled) and (prefers-reduced-motion: no-preference)`, so the page is fully readable without JS.
- Seal and score bar: the strokes draw (`.seal-draw`) and the bar grows (`.bar-grow`) when their
  `.reveal` ancestor gets `data-in`; elsewhere they simply render.
- Count-up: `<CountUp>` animates the sample percentage once; the final value is the server-rendered
  text plus an `sr-only` copy, so no-JS and screen readers always get the real number.
- Micro-interactions: `.lift` (card rises 2 px with `--lift-shadow`, used on the landing buttons and the
  start cards), `.link-draw` (underline draws in), the answer mark scales in when chosen, dialogs fade
  and zoom slightly, the exam progress line grows with `transform`.
- Route change: `template.tsx` files (staff, login, consent, results, exam/start) wrap pages in
  `PageFade` (`.page-in`, a 220 ms opacity fade). The exam page (`/exam/[attemptId]`) has no template and
  no decorative animation: the exam surface stays calm.
- Loading: `Skeleton` has a shimmer (a translating highlight, transform only).

## Components and conventions

- **shadcn first.** Use `Button`, `Card`, `Table`, `Badge`, `Alert`, `Empty`, `Dialog`,
  `Skeleton`, `Input`, `NativeSelect`, `RadioGroup` from `src/components/ui`. They are restyled to
  the tokens; do not override their colours at the call site.
- **Buttons:** `default` (Königsblau) for the one primary action per area, `outline` for the rest,
  `ghost` for header actions, `destructive` (solid red) only in a confirm dialog. Student pages use
  `size="lg"` (44 px); staff pages use the default (36 px) and `sm` in tables.
- **Badges:** `success`, `warning`, `destructive`, `outline`. Map statuses with
  `statusVariant()` (`src/app/staff/students/ui.ts`): passed = success, blocked = destructive,
  open = outline (the student page shows the effective status: open with every attempt used and
  nothing running reads blocked, as on the Blocked page). Attempt stages use `ATTEMPT_STATUS`
  (`src/lib/attempt-status.ts`) through `AttemptStatusBadge`: In progress outline, Being scored
  warning, Passed success, Not passed destructive. There is no release or awaiting state.
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
  sign out; sticky from `lg`). Sections: Dashboard, Attempts (read-only list and evaluation),
  Blocked, Extra attempts, Students, Curriculums, Questions, Content, Team; Curriculums, Questions, Content and Team are admin only
  (`visibleNav`, `adminOnly`), so a trainer's nav has five links. Below `lg` the nav is one row under the wordmark that scrolls
  sideways inside itself and keeps the current section in view; the current section has a 2 px
  Königsblau underline and `aria-current="page"`. Student pages use `StudentHeader` (56 px); the
  exam page has its own sticky bar with a progress line. A "Skip to main content" link in the root
  layout jumps to `#main-content`, placed right after each header.
- **Exam on phones:** Previous / Next (or Review and submit) sit in a sticky bottom bar in thumb
  reach (`sm:` back to inline), full width each, with the safe-area inset.
- **Time reminder (exam):** a slim full-width band inside the sticky exam bar, under the progress
  line: blue tint (`bg-secondary`) for interval reminders, `bg-destructive-muted` from 5 minutes
  left, clock icon, "30 minutes left." in Lexend, a 44 px ghost close button. It pushes content
  down instead of overlaying it, never takes focus and fades in (motion-safe only). It is the one
  allowed exception to "no banners" on the exam surface because it is about the exam itself.
- **Durations** are always written by `formatDuration()`: "2 h 30 min", "2 h", "45 min". Staff
  enter them as an hours field and a minutes field under one "Time limit" legend, each with its
  unit ("h", "min") after the field.
- **Greetings:** the student start page (h1) and the staff dashboard (description) greet with
  `greeting()` from `src/lib/greeting.ts`: "Good morning / afternoon / evening, <first name>" in
  India time (Asia/Kolkata), first word of the full name, else the username. Each page has a one
  line orientation under its title; it never promises anything the code does not do.
- **Percent first:** the headline result everywhere is the percentage, never raw points. It is
  written by `formatPercent()` (`src/lib/percent.ts`): "92%" when whole, else one decimal ("66.7%"),
  and it never rounds up onto a whole number (89.95% shows "89.9%"), so a fail never reads as the
  pass mark. The percentage is the large Lexend figure; points follow as small muted secondary
  text ("23 of 25 points", "2 / 3" in tables). Shared table cell: `ResultScore`
  (`src/components/app/result-score.tsx`): percent, points and a Passed / Not passed badge (`outcome={false}` puts the status badge beside it instead). Bars take the exact
  share from `percentValue()`. Pass or fail is decided exactly by `meetsPassMark()`
  (points x 100 >= pass mark x max). The standard pass mark is 90% (`DEFAULT_PASS_MARK_PERCENT`).
- **Score report** (`/results/[id]`, `data-testid="result-report"`): letterhead (wordmark and a
  2 px Königsblau rule), h1 "Ergebnis / Result", bilingual facts in two columns (three in print),
  a summary panel with "Prozent / Percent" over the percentage in Lexend (`result-score`, 48 px,
  56 px from 640 px), the points line under it (`result-points`, bilingual), the Bestanden /
  Passed badge, a `ScoreBar` (`src/components/app/score-bar.tsx`: ink fill on a ruled track, black
  tick at the pass mark) and "Bestehensgrenze / Pass mark 90%" (`result-pass-mark`), then the
  topic table: Thema / Topic, Prozent / Percent (semibold), Punkte / Points (muted), bar. The
  pass mark is the attempt's own snapshot (`attempts.pass_mark_percent`, taken at start), so it
  always agrees with the stored outcome. Until the score exists (`result-status`, "being
  calculated"): no numbers at all (no percentage, no points, no pass mark on that page). The staff evaluation view uses the same summary panel
  (`review-score` percent, `review-points`) plus per-topic totals from the scoring snapshot
  (`topicTotals`).
- **Exam start cards** (spec change 1): one card per assigned curriculum (`curriculum-card`,
  `data-kind`), a grid of one column on phones and two from 640 px when there are several, any
  order. Header: curriculum name (h2) and a status badge (Ready outline, In progress outline,
  Being calculated warning, Passed success, Blocked destructive, Not available warning). Ready shows
  the attempts left as a Lexend figure (`attempts-left`, "2 attempts left") and "Each attempt uses a
  different exam where possible. Your result is shown as soon as you submit." (the card does not
  know whether staff allowed repeats); the card cannot show exam facts
  because the server picks the exam set at Start. The action sits full width in the card footer
  (`start-exam`, `resume-exam`, Check again, View result). Blocked and Not available say "contact
  your trainer" (`contact-trainer`) and never promise a number; calculating shows `calculating`.
  "Your results" is grouped per curriculum (`results-group`), percentage first, "2 / 3 points"
  muted and the Passed / Not passed badge; running or uncalculated attempts show no numbers.
- **Extra attempts dialog** (`ExtraAttemptsButton`, Extra attempts, Blocked and student pages):
  title "Give <name> extra attempts", a description with the attempts used ("Giving attempts lifts
  the block." when blocked), a 96 px number field (1 to 10) with helper text, and a shadcn `Switch`
  "Allow repeating exam sets" with helper text (on by default when no exam set is left; locked on
  once allowed). Success is announced at page level (`grant-success`), a refusal next to the button.
- **Curriculum settings:** name and "Attempts per student" (1 to 20, standard 2) side by side
  above the exam sets; a warning `Alert` when fewer exam sets can be given than students have attempts.
- **Add student form** (`/staff/students`, "Add student" card): one form of titled sections, each a
  `fieldset` with a `legend` (`FormSection`: semibold 14 px title, optional one-line muted hint):
  Account (username, full name, batch, track, first password, and for an admin a Trainer picker;
  a trainer's students always belong to them), Contact (contact email is the one required detail:
  "The invite email goes to the contact email."), Passport and travel (hint "Private: only an admin
  and the student's trainer can see these."), Course and Notes. Fields are controlled so a
  validation error never wipes the input. Success is a `success` `Alert` (`warning` when the invite mail failed) with a link to the new
  student and one sentence on the invite ("An invite email ... was sent." or, when the mail
  failed, "... could not be sent. Open the student and use Resend invite."). Import CSV sits under
  it with a trainer picker for admins and a preview; the result lists invited, no email and failed
  counts. Files over 200 students are refused with a plain message.
- **Student page cards** (`/staff/students/[id]`, after the results): "Details" (`student-details-card`,
  the same sections as the form, "Save details", a `details-message` alert), "Trainer" (admin only:
  a picker and a save, "Only the trainer and admins can see <name>. Changing it takes effect at
  once."), "Invite" (`invite-status`: where invites go, or "No contact email, so no invite can be
  sent"; outline "Resend invite" button, disabled without an email; the result in a live region,
  `resend-invite-message`), then Reset password, and Delete student for admins only. Cards use the
  plain `Card`; no extra colour.
- **Set password** (`/set-password?token_hash=...`, public, `src/app/set-password`): the sign-in
  layout (centred `Card`, `enter` animation, `shadow-panel`), h1 "Choose your password", one
  sentence ("You will sign in with your username and this password."), the new password field and
  a primary `size="lg"` button. A missing, used or expired link shows one destructive message
  ("This link is no longer valid. Ask your trainer to send you a new invite.") with a link to
  sign in; a saved password that could not end other sessions says so in plain words. It is in the
  axe and 375 px overflow checks of `e2e/design.spec.ts`.
- **Team** (`/staff/team`, admin only): `PageHeader` "Team" with one sentence on scope, a framed
  table (Trainer, Email, Status badge Active `success` / Inactive `outline`, plus a `warning` badge "Not signed in yet" next to Active until the trainer has signed in once, Students, Actions) and
  "Add a trainer" below (a `Card` with email, username and full name; the trainer chooses their
  own password through the invite). Row actions are outline `sm` buttons with sr-only names
  ("Resend invite to <name>"), Deactivate / Reactivate, and a "Move to..." select that moves all of
  the trainer's students; Deactivate is refused with a sentence while students remain. Results
  and errors go to a live region next to the row.
- **No template chrome:** no eyebrow labels above headings, no "A · B · C" meta strings (use
  commas or separate facts), sentence case everywhere.
- **Button links:** `buttonVariants()` returns merged classes (variant classes win over the base),
  so `<Link className={buttonVariants({ variant: "outline" })}>` keeps its border.
- **Wordmark (shared T):** the name is one lockup, `NameLockup` in `src/components/app/wordmark.tsx`: a single Königsblau T (Lexend 800) that "Talent" and "Track" share (its stem serves both words; "alent" and "rack" are stacked beside it) and "Platform" after it (`inline`, header size; `Wordmark compact` is the footer size) or under it (`layout="stacked"`, landing hero and sign-in panel). The T is the one blue accent; "Platform" is quiet beside it in headers and ink when stacked. The drawing is `aria-hidden` and the full name "Talent Track Platform" is read once as sr-only text, so headings, search, translation-off and tests still see the name; the name never wraps and fits 320 px beside Sign out. The T is the mark: no logo square and no logo file (the check stroke lives on in the validation seal). `PoweredBy` writes "Powered by F.L.A.G." (shown on the landing page, login, student and staff footers; the landing footer also spells out the name).
- **Print:** the result report prints on A4 (14/16 mm margins, 11 pt) with no app chrome
  (`print:hidden` on headers and buttons); the letterhead rule and the bars keep their ink
  (`print-color-adjust: exact`); badges, table heads and frames are forced to black; sections,
  rows and fact lists do not break across pages, so a normal report fits one sheet.

## Rules for future UI work

1. Use the tokens; never raw hex in components (add a token in `globals.css` first).
2. Königsblau is for action, selection and focus only, not for decoration.
3. Keep the student exam surface distraction-free: no extra navigation, banners or promos (the
   time reminder is the only band allowed there).
4. German exam text stays at `text-stem` / `text-option`; never shrink it to fit.
5. Every interactive element keeps the visible focus outline (2 px Königsblau, 2 px offset).
6. Check new screens at 375 px and desktop: no horizontal page scroll, AA contrast, axe clean
   (`e2e/design.spec.ts` does this and refreshes the screenshots).
7. Do not change `data-testid`s, labels or roles the e2e suite relies on without updating the
   tests in the same commit.
8. UI chrome in English; questions in German; staff evaluation and the report bilingual.
