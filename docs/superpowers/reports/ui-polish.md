# UI polish report (branch `ui-polish`)

Owner's request: upgrade the look and feel without losing professionalism, add greetings, make
every page responsive, reduce white space, and make the report look clean. Not pushed or deployed;
no remote services touched.

## Skills used and what each changed

| Skill | How it was used | What it changed |
|---|---|---|
| `impeccable` | `impeccable context` loaded DESIGN.md (no PRODUCT.md, so this ran as a narrow refinement of the existing look, not a redesign). Followed `polish.md` and `craft-floor.md`; ran `impeccable detect` at the end. | Kept the exam-sheet direction and tokens. Removed template chrome the craft floor bans: the "Your next exam" eyebrow label and the "A · B · C" meta strings. Gave the report one strong element (letterhead and bullet bar). Detector: `[]`, no findings. |
| `frontend-design` | Design plan reviewed against the brief: the palette and fonts stay fixed; boldness goes into the report only. | The letterhead, the 2 px Königsblau rule and the Lexend score on the report; quiet copy that names actions. |
| `ui-ux-pro-max` | Quick-reference rules plus searches (`dense admin table responsive`, `score report summary`). | 44 px touch targets (via `pointer-coarse:`), 4 px spacing rhythm, tables scroll inside their frame on phones, a bullet chart for the score with the pass mark as the target (chart search: "Performance vs target, bullet chart"), the numbers always printed next to the bar. |
| `shadcn` | Project context (base-nova, Base UI, lucide); used only installed components (`Card`, `Table`, `Badge`, `Alert`, `Empty`, `Skeleton`, `Button`). No new components; nothing fetched from registries. | Density changes made in the component files (`card`, `table`, `empty`, `button`, `input`, `native-select`) rather than overriding at call sites. Found and fixed a real bug: `buttonVariants()` returned unmerged classes, so links styled as outline buttons lost their border. It now merges with `cn`. |
| `web-design-guidelines` | Fetched the current Vercel guidelines and reviewed the changed files. | Added a skip link to `#main-content`; the progress line animates `transform` only; the wordmark has `translate="no"`. Intentional exception: headings and buttons stay in sentence case (DESIGN.md rule), not Title Case. |
| `superpowers` TDD | Pure logic tests were written first and failed before the code existed. | `greeting.test.ts` (India-time morning/afternoon/evening, name fallback), `report.test.ts` (pass-mark consistency, topic totals), and `passMarkPercent` assertions added to `release.test.ts`. |

`impeccable critique`: the full critique flow spawns subagents, which this brief does not allow, so
I ran the critique inline from the screenshots (see "Critique" below).

## What changed, page by page

**Shared shell**
- `staffMain` widened from 72 rem to 80 rem. Top padding went from 32 px to 20/24 px, section gaps from 24 px to 20 px, with responsive side gutters. `studentMain` top padding went from 32 px to 24/32 px.
- Staff header is 56 px. Below lg, the nav is now one row that scrolls sideways (it used to wrap onto three rows on phones) and keeps the current section in view. The current section has an ink underline. From lg the header is sticky. "Sign out" is now a ghost button.
- Student header went from 64 px to 56 px. Page titles are 22/24 px, and each page has a one-line orientation under its title.
- Cards pad 16 px on phones (20 px from 640 px); `sm` cards pad 14/16 px. Table heads are 36 px and cells have 8 px vertical padding. Empty states are tighter.
- On touch screens, buttons, inputs and selects grow to 44 px. Selects get 16 px text there, so iOS does not zoom in.
- `scroll-padding` keeps sticky bars from hiding focused or scrolled-to elements. There is a skip link.

**Login**: warmer welcome copy, less vertical padding.
**Consent**: "Welcome, <first name>." and a short line saying it takes a minute; tighter spacing.
**Student start**
- The h1 is a time-aware greeting ("Good morning, Anjali") in India time.
- A one-line orientation follows, depending on the state (ready, in progress, awaiting review, waiting).
- The next exam is a Card: the curriculum as h2 with the exam set name, the facts inline, the rules, then Start.
- Empty states are warmer. "Your results" is a tighter framed list.

**Exam**
- A 2 px progress line under the sticky bar shows answered / total.
- On phones, Previous / Next (or Review and submit) sit in a sticky bottom bar in thumb reach: full width, with the safe-area inset.
- The timer is 44 px on touch screens. Spacing is tighter. Exam text sizes are unchanged.

**Awaiting result**: a thank-you line, the facts in a framed list, and a sentence saying where the score will appear.

**Score report (student)**
- Letterhead: the wordmark, "Prüfungsergebnis / Exam report" and a 2 px Königsblau rule.
- h1 "Ergebnis / Result", with the bilingual facts in two columns (three in print).
- Summary panel: the 40 px Lexend score "2 of 3 (66.7%)", the Bestanden / Passed badge, and a bullet bar with a black tick at the pass mark. Below it: "Bestehensgrenze / Pass mark: 60%".
- Topic table with a bar column, and a short bilingual note that scoring is automatic and the topics add up to the total.
- Print: A4, 14/16 mm margins, 11 pt, ink kept on the rule and bars, no breaks inside sections, no app chrome.
- Privacy is unchanged: no numbers before release; students see topic totals only.

**Staff dashboard**
- Description: "Good morning, <name>." plus a sentence built from live counts, e.g. "1 result is waiting for release and 2 students are blocked."
- Three cards: Awaiting review, Blocked, and Give attempts (a new card; it replaces the loose text line). Two columns on tablet, three on xl.
- The student counts are a compact strip, with the footnote moved beside the heading.

**Review list, results, blocked, grants**: inherit the denser tables, wider page and compact header.
**Evaluation (staff)**
- Header card: student name (h1), curriculum and exam set, status badge.
- Facts: Submitted, Answered, Released by.
- The Release button is its normal size (it used to stretch full width), with a note that the student sees nothing until release.
- A score panel with the bar, the pass mark and per-topic totals from the scoring snapshot (shown when there is more than one topic).
- Question cards are tighter. The badge column has a fixed width, so the English option text lines up. The topic now reads "Topic: x" instead of a middle-dot string.

**Students**: an "Add or import" action jumps to the forms, the description is shorter, and on phones the search field is full width.
**Student detail, curriculum**: orientation lines; the exam set meta uses commas, not middle dots.
**Questions**: the exam set label uses a comma, not a middle dot.
**Errors, not found**: less top padding.

## Data and behaviour

- Small additive read: `getStudentResult` and `getAttemptReview` now also read `exam_sets.pass_mark_percent`, through the same clients (session RLS) as before. It reaches the UI only through `consistentPassMark`, which returns null when the current pass mark contradicts the stored pass/fail, because staff may edit the pass mark after scoring.
- No server action, `requireRole`, RLS or migration changed. Every `data-testid`, aria label, role and asserted string is kept, so no e2e test needed changing.

## Verification

- `npm run lint`: clean.
- `npm test`: 22 files, 248 tests passed (including 14 new tests and 2 new assertions).
- `npm run build`: succeeded.
- `npm run test:e2e`: 58 passed (5.0 min), both projects (mobile-375, desktop).
- `e2e/design.spec.ts` (axe WCAG 2.2 AA with 0 serious/critical allowed, no horizontal overflow, screenshots): passed at 375 px and desktop. Screenshots in `docs/design-review/` are refreshed.
- Extra overflow sweep: dashboard, results, blocked, students, questions and curriculums at 320, 414, 768, 1024 and 1536 px. No page scrolls horizontally at any width. Wide tables scroll inside their frame.
- Screenshots I looked at: student start, exam, awaiting, report and print (375 and desktop); staff dashboard (375, 768, desktop); students (320, desktop); evaluation; questions; curriculum; results at 1536.

## Critique (inline, from the screenshots)

- Hierarchy: each page has one clear h1 and one primary action. The report reads top-down as letterhead, who and what, how well, and by topic.
- Density: staff pages use the width and have about 30 to 40 percent less vertical chrome. Student pages stay calm, and the exam text is untouched.
- Consistency: one framed-panel language. The summary panel is shared by the report and the evaluation; tables use one density.
- Remaining rough edges: listed below.

## Concerns and follow-ups

1. Pass mark on the report: the system stores no snapshot of the pass mark at scoring time, so the current exam-set value is shown only when it agrees with the stored outcome, and hidden otherwise. A snapshot column at scoring time (a migration) would make it exact.
2. On phones, staff tables still scroll inside their frame rather than turning into stacked cards. The brief allows either. Cards would mean duplicating markup and test ids, so I did not do it.
3. The 44 px touch sizes depend on `pointer: coarse`. A narrow desktop window keeps the compact 36 px controls, which is intended for mouse use.
4. Pages that Next keeps hidden (Activity) can hold a second `#main-content` target. It is harmless for the skip link, and axe reports nothing serious.
5. Greetings always use India time (Asia/Kolkata), so a trainer signing in from abroad gets the Kerala time of day.
