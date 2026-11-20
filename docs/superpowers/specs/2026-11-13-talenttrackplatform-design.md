# TalentTrackPlatform: design

Status: draft for owner approval. Date: 2026-11-13.

**Amended by spec change 1:** `2026-11-18-immediate-marks-attempts-design.md` wins where the two disagree: no video capture, marks shown to the student immediately (no hold, no release step; the staff review panel is read-only), 2 attempts per curriculum per student without approval (blocked after the last failed one; staff give extra attempts), curriculums are independent (separate cards, any order, no sequence, no cross-curriculum lock), and each attempt uses a different exam set of the curriculum. Struck-through text below is superseded.
Marker used below: **[Call]** = a decision made by the designer, not yet confirmed by the owner. Everything else was stated by the owner.

## 1. Intent and why

Life Planner is a study/work-abroad agency in Kerala, India. It trains students (19-25, German level A2-B2) on its own curriculums before placing them in Germany. It needs a platform that tests students after training and produces a validated, trustworthy score the agency can rely on. It identifies strengths, evaluates competencies, monitors skill development and assesses professional readiness.

Used only by Life Planner's own students and staff. Not a public product.

## 2. Users and tracks

- **Student**: logs in with credentials issued by the agency. Cannot sign up, cannot choose anything. Lands directly in the flow the agency set.
- **Agency staff**: creates students, assigns curriculums, builds exams, ~~reviews video answers,~~ sees all results. **[Call]** One staff role at first; split admin/reviewer later if needed.
- **Tracks** (defaults only; the real model is a per-student list):
  - Nursing Ausbildung students: Pflege Ausbildung curriculum + Life in Germany curriculum, both must be completed.
  - Any other Ausbildung aspirant: Life in Germany only.
  - Staff can add or remove any curriculum for any individual student at any time.
- New curriculums will be added over time; this must not need code changes.

## 3. Goals

1. ~~Student logs in and is taken straight to their next assigned curriculum exam; after completing, sees the result (once released, see section 5).~~ Spec change 1: the student sees one card per assigned curriculum, starts any of them in any order, and sees the result as soon as the exam is submitted.
2. Curriculums are data. Each curriculum has one or more exam sets (one per curriculum or several; staff choose).
3. Exams are multiple choice, auto-scored. ~~plus optional "video questions" answered by live camera recording.~~ (Video capture dropped by spec change 1.)
4. Questions differ per student as much as possible (section 4).
5. Everything about an exam is staff-controllable: questions per set, topic mix, time limit, pass mark, number of attempts (per curriculum since spec change 1), which questions are in the pool~~, which questions are video~~.
6. Bilingual: student interface in English; exam questions and answer options in German; staff evaluation view and score report show German and English together.
7. Works on phone and laptop; laptop is the primary target and students are told to use a computer.
8. Staff and student can both see the result.

## 4. Question variety per student

- Each exam set has a **question pool** larger than the number delivered. Staff set how many are drawn and (optionally) how many per topic/difficulty tag.
- When a student starts an attempt, the platform draws their questions and shuffles question order and answer-option order, and **stores that draw** so refresh/resume shows the same paper. **[Call]**
- A retake draws again, avoiding questions the student already saw where the pool allows. **[Call]**
- This reduces copying; it is not proctoring (see non-goals).

## 5. Scoring ~~and result release~~

- Multiple-choice questions are scored automatically.
- ~~Video questions are marked by agency staff after reviewing the recording.~~
- ~~**Marks are shown to the student only after team verification.** Until then the student sees "submitted, awaiting review". The owner confirmed this for video answers.~~
- ~~**[Call]** For an exam set with no video questions, the result may be released instantly (the owner wanted instant results for plain multiple choice). Each set has a setting "hold result for staff review" that defaults to on if the set contains video questions, off otherwise. Owner to confirm.~~
- Spec change 1: marks are shown to the student immediately after submit or time-out; there is no hold setting and no release step.
- Final score, pass/fail against the staff-set pass mark, and a per-topic breakdown. The report is bilingual (German and English).
- A student's overall status (for example nursing: both curriculums complete) is visible to staff.

## 6. ~~Video questions~~ (dropped by spec change 1; nothing was built)

- Recorded live in the browser using the camera (and microphone). There is **no file-picker or upload option anywhere**; recording starts and stops inside the page. **[Call]** Technically the recorded blob is sent to storage when the student stops recording; "no upload" means no choosing of an existing file.
- Requires HTTPS and the student granting camera permission; clear consent notice before first recording. **[Call]**
- Stored in a private bucket; staff watch via short-lived signed links next to the question (German and English). **[Call]** retention period configurable, default 180 days, then deleted.
- Must work on phone browsers (Android Chrome, iOS Safari) as well as desktop; a fallback message if the browser cannot record.
- This is a deterrent, not a guarantee against cheating.

## 7. Constraints

- Host close to users: **Supabase project in Mumbai (ap-south-1) and Vercel region bom1** because all students are in Kerala. (Frankfurt was considered and rejected.)
- Student data is Indian residents' personal data: show a consent/privacy notice and apply India's DPDP Act principles; keep minimum data. **[Call]** Legal wording is the owner's to approve.
- Login is by username and password issued by staff (many students may not have email). **[Call]** The builder may map usernames to internal email addresses in the auth system.
- Exam timer must be enforced on the server, not only in the browser.
- Expected scale: tens to low hundreds of students at a time, small team of staff.
- Everything in the project follows the global workflow: superpowers, test-driven build, every step logged to the Monday board.

## 8. Non-goals

- No hosting of training material or lessons. **[Call]** "Curriculum" here means the assigned exam flow; the training itself happens elsewhere. Owner to confirm.
- No speaking/listening audio exams, no free-text answers marked by a person~~ other than video review~~.
- No full proctoring (no face detection, no screen lock, no AI cheating detection).
- No public sign-up, payments, or marketplace features.
- No native mobile app; responsive web only.

## 9. Anti-goals (would be a failure even if it technically works)

- Two students getting identical papers where the pool could have varied them.
- ~~A student seeing their score before staff have released it where release is held.~~ (No release step since spec change 1.)
- ~~Video recordings reachable by anyone other than staff.~~ (No video.)
- Having to edit code to add a curriculum, change question counts or add a student.

## 10. Approaches considered

1. **Next.js web app on Supabase, hosted on Vercel (chosen).** Database~~, logins and video storage~~ and logins in Supabase (Mumbai); app on Vercel. Fastest and cheapest, fits the existing connectors; some dependence on two vendors.
2. **Custom AWS build** (Cognito, database, S3). Most control, most work and maintenance; nothing in the brief needs it.
3. **Off-the-shelf quiz tools** (Moodle, Typeform). Cannot combine per-student random draws, side-by-side German/English review, live-only video and per-student curriculum lists.

The owner chose 1.

## 11. Left to the builder

Data model and permissions rules; question import format (suggest spreadsheet/CSV bulk import for staff **[Call]**); exact scoring formula and topic breakdown; UI design and component choices; report layout and whether it can be printed/exported as PDF; how question translations are authored; session handling (one active session per student); test strategy including camera/recording tests on real phones.

## 12. Calls added after the builder check (designer's calls, owner to confirm)

- ~~**Held results:** for a held set, the student sees nothing (not even the multiple-choice score) until staff release the attempt. Release is one staff action per attempt. Staff cannot edit the auto-scored multiple-choice marks; they can only mark video answers and release.~~ (Superseded: no held results.)
- ~~**Video marks:** each video question has a max points value set by staff; one reviewer is enough. Video points add to the multiple-choice points for the total and topic breakdown. Recording length limit is staff-set per question (default 2 minutes); re-record allowed only if staff enable it for that question. Uploads retry automatically on a weak connection.~~ (Superseded: no video.)
- **Timer:** the clock keeps running if the student disconnects; answers are saved continuously; at expiry the saved answers are submitted automatically (checked on the server when next read plus a periodic sweep).
- **Retakes:** SUPERSEDED by section 13, which is itself amended by spec change 1 (2 attempts per curriculum without approval, each on a different exam set).
- **Accounts:** staff set the initial password; students are NOT forced to change it (owner decision); only staff reset passwords; bulk student creation by CSV; a second login ends the first session; staff sign in with email and password.
- **Consent:** consent acceptance is recorded with a timestamp per student; deletion on request is handled by staff manually (a delete-student action), not an automated workflow.
- **Reports:** printable/PDF bilingual report; students carry a batch tag so staff can filter results by batch. Sharing by email is in scope (section 13). Verifiable certificates are out of scope.
- **Browsers:** current and previous major versions of Chrome and Safari~~, Android 10+ and iOS 15+ for recording~~.

## 13. Owner answers after the builder check (2026-11-13)

These come from the owner and override sections 4-12 where they conflict.

**13.1 Question content does not exist yet.** The agency has only curriculum PDFs, no question sets. Questions must be created from those PDFs. Owner asked the designer to research and implement the best way. Proposed plan (designer's call): staff upload a curriculum PDF; the platform uses the Claude API to draft German multiple-choice questions with English translations, tagged by topic and difficulty; staff review, edit and approve each question before it can enter a pool; only approved questions are ever delivered. Target pool size per exam set is at least 3 times the number delivered. German quality must be checked by a German-competent reviewer. Staff can also add or edit questions by hand and bulk import by CSV.

**13.2 Exams are scheduled events, like an entrance exam.** Staff create an exam event for a specific date and time window, enrol students (including setting up their curriculums in the background), and students can start only inside the window. Outside the window the student sees when the exam opens. Timer rules from section 12 still apply inside the window.

**13.3 Hall tickets and email centre (Gmail API).** When staff add students to an event they can email each student a hall ticket (PDF) that carries their login credentials, exam date/time and venue/instructions. The platform includes a mail centre using the Gmail API: compose, reusable templates, send, save as draft, view all threads (drafts, sent), and a per-student view of every message exchanged with that student. Staff can also email a student's result report (PDF) from the platform. Designer notes: (a) emailing credentials in plain text is accepted by the owner; a student's login can be limited to work only from shortly before the exam window until the owner chooses to disable it; (b) Gmail API needs a Google Cloud project with OAuth and a sending mailbox; permission to read/send mail is a sensitive scope, so use a single agency mailbox and keep the Google app in a mode that avoids a lengthy public verification. Which mailbox and whether it is Google Workspace is still to be confirmed.

**13.4 Failing and blocking.** A student who fails their last allowed attempt is blocked. Blocked students appear on a dedicated "Blocked" page for staff and also as a summary on the staff main dashboard.

**13.5 ~~Attempts are only granted by staff.~~** (Amended by spec change 1: every student gets the curriculum's attempts, default 2, without approval; staff give extra attempts, also to unblock; each attempt uses a different exam set unless staff allow repeats.) ~~Retakes are never automatic.~~ Only a verifier/admin can give another attempt or reassign an exam. When staff give another attempt or reassign, the platform must never reuse questions that student has already been given. If the pool has too few unseen questions the staff are told so.

**13.6 Curriculum is the exam flow.** Training lessons are not hosted. **[Call]** A curriculum counts as complete when passed~~, and the order is any order unless staff set an order~~. Spec change 1: curriculums are independent and taken in any order; the staff order is only the display order (no sequence, no one-exam-at-a-time lock across curriculums).

**13.7 Environment.** Supabase and Vercel accounts exist and are linked. Domain: owner wants `talenttrackplatform.lifeplanneruniversal.com` (to be confirmed, since the message spelled it in several ways). **[Call]** Vercel preview deployments with a separate Supabase development project serve as the test version; production uses its own Supabase project in Mumbai.

**13.9 Mail setup (corrects an earlier wrong assumption; Gmail API stays in scope as 13.3 says).** There IS a real Gmail inbox. Cloudflare Email Routing forwards the domain alias into it, and in Gmail's "Send mail as" settings the alias is configured to send through Brevo's SMTP, so the agency's mail on the domain is handled in that one Gmail account. The mail centre therefore uses the Gmail API on that account: send as the domain alias, save drafts, templates, list all threads (inbox, sent, drafts), and show a per-student view by matching the student's email address. **[Call]** The app only shows threads that involve student email addresses or carry an app label, not the owner's whole personal inbox. Replies arrive in the same Gmail inbox, so threads stay complete with no extra work.
Designer notes for the builder: it is a regular Gmail account, so the Google Cloud OAuth app must be moved out of "Testing" mode (where refresh tokens expire after 7 days) to avoid weekly re-login; because the app serves only the agency's own account the Google warning screen is acceptable. Verify current Google OAuth rules at plan time. Sending as the alias requires the alias to be verified in Gmail Send mail as (already done by the owner). Student login works only from shortly before the exam window opens (owner confirmed).

**13.10 Domain (supersedes 13.7's domain).** DNS check shows the owned domain is `lifeplanneruniversal.com`, hosted on Cloudflare DNS (`lifeplanneruniveral.com` does not exist). The app will live at `talenttrackplatform.lifeplanneruniversal.com`: add it to the Vercel project, then in Cloudflare add a CNAME `talenttrackplatform` to the target Vercel shows, set to "DNS only" (not proxied) so Vercel can issue the certificate.

**13.8 Delivery phases (designer's suggestion).** One design, built in phases so something usable arrives early: (1) accounts, curriculums, exams, scoring, results, blocked page; (2) scheduled events ~~and video questions with review~~; (3) mail centre and hall tickets; (4) AI-assisted question creation from PDFs. Phase 4 content is needed before real exams, so a manual or CSV route for questions is part of phase 1.
