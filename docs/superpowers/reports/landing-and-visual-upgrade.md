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
