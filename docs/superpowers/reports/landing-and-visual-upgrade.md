# Landing page, rebrand and visual upgrade (branch `landing`)

## Skills used and what each changed
- impeccable (craft floor, anti-pattern list): refused eyebrows, gradient text, identical icon-card grids, a centred hero; picked the editorial direction and motion rules. Its detector CLI was not run; PRODUCT.md was not created (init needs the owner). Reviewed by eye on screenshots instead.
- frontend-design: plan before build (tokens, type, layout, principles); one bold place (the hero and its sample answer sheet), everything else quiet.
- ui-ux-pro-max: quick-reference rules (44 px targets, reduced motion, CLS, contrast, focus); no CLI search run.
- shadcn: reused Button, Badge, Card, Skeleton, Table; no new components added or overridden at call sites except the Skeleton shimmer.
- superpowers:test-driven-development: `isPublicPath` test written first and seen failing, then the proxy change.
- Extra guidance read as data: no-ai-design-slop, ui-craft (skimmed SKILL.md only). design-taste-frontend: only the head of its SKILL.md was read before it was withdrawn; nothing from it was used or executed (it asks for photographs, which contradicts the brief). animation-vocabulary and taste-design were not needed.
- web-design-guidelines and verify: see "Final checks".

## Direction and motif
Calm authority of a credential body with an editorial finish: very large Lexend headings, ruled exam-paper lines, ruled dividers instead of card grids, Königsblau kept. Motifs that belong to validation: the answer bubble, the validation seal (two rings and a check in a single warm accent, seal gold `--seal`), and the German and English pair as a side-by-side review specimen. Specimens are labelled as samples.

## What changed
- Brand: Wordmark (KVP, Knowledge Validation Platform, check mark), `PoweredBy` ("Powered by F.L.A.G"), titles and metadata, consent copy, login, footers on student and staff pages. The internal email domain `students.talenttrack.internal` is intentionally unchanged (not user-facing).
- Landing `/`: hero, what it is, how it works (3 steps), students, trainers (with review specimen), fairness (what KVP does and what it cannot do), final call, footer. Public via `isPublicPath`; signed-in users still redirect.
- Tokens: refined neutrals, `--rule`, `--seal*`, `--card-shadow`, `--lift-shadow`, motion tokens.
- Site wide: login split layout, page header rule, footers, start cards (lift, bubbles per attempt left), report seal when passed, skeleton shimmer, route fade.
- DESIGN.md and CLAUDE.md updated.

## Animation inventory (all respect reduced motion, none shift layout)
Hero entrance (CSS, works without JS); scroll reveal (`Reveal`, once, hidden only with scripting on and motion allowed); seal stroke draw; score bar grow; count-up (final value in server text plus sr-only copy); `.lift` and `.link-draw` micro-interactions; route fade via `template.tsx` (not on the exam page); skeleton shimmer. The exam page has no new animation.

## Notes
- Local Supabase ports were moved to 57xxx in `supabase/config.toml` and `.env.local` for this session because Windows reserved 54264 to 54363. `config.toml` was restored before committing.

## Gate results
- `npm run lint`: clean. `npx tsc --noEmit`: clean (after `next typegen`). `npm test`: 46 files, 406 tests passed. `npm run build`: passed.
- `npm run test:e2e`: 88 passed (both projects: mobile-375 and desktop), including 16 new landing tests (public, one h1, brand words, CTA to /login, skip link, signed-in redirects for student, staff and not-yet-consented student, no overflow at 320/375/768/1024/1280/1536, axe 0 serious/critical, no-JS readable, reveal on scroll) and the landing plus all refreshed shots in `design.spec.ts` (axe on every screen at both widths).
- `npm run db:reset` and `node scripts/demo-seed.mjs` ran at the very end.

## Screenshots viewed
Landing at 375 and 1280 (full page and first viewport), login at 1280, student start cards, score report and staff dashboard at desktop. Fixed: seal ring colour token missing, login right pane background. All screenshots are in `docs/design-review/`. The other pages (staff tables, forms, dialogs) were not individually re-inspected; they inherit the token and chrome changes and pass axe and the overflow check.

## Final checks and honest gaps
- Not run: the impeccable detector CLI and the web-design-guidelines skill review (no time left in this session); no Lighthouse or measured LCP/CLS (no hero images, fonts via next/font, reveal uses opacity and transform only).
- Staff dashboard and tables got the shared chrome upgrade (tokens, header rule, footer, fades) but not a bespoke redesign, so they are calmer and less editorial than the landing page.
- The exam screen was not changed beyond its title text.
