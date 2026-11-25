import type { Metadata } from "next";
import Link from "next/link";
import { NameLockup, PoweredBy, Wordmark } from "@/components/app/wordmark";
import { buttonVariants } from "@/components/ui/button";
import { Reveal } from "@/components/landing/reveal";
import { AnswerSheetSpecimen, ReviewSpecimen } from "@/components/landing/specimens";
import { cn } from "cn";

const TITLE = "Talent Track Platform, powered by F.L.A.G.";
const DESCRIPTION =
  "Talent Track Platform is where trainers set exams and students sit them: German questions, results as a percentage the moment you submit, and every attempt open to review.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "Talent Track Platform" },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
};

const wrap = "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8";
const h2 = "font-heading text-[1.75rem] leading-[1.12] font-semibold tracking-[-0.03em] text-balance text-foreground sm:text-4xl";
const body = "text-base leading-relaxed text-muted-foreground sm:text-[1.0625rem]";
const navLink = "link-draw rounded-sm py-1 text-sm font-semibold text-foreground";

const steps = [
  {
    title: "Your trainer sets you up",
    text: "Your trainer creates your account and assigns the curriculums you will sit. You sign in with the username and password you were given.",
  },
  {
    title: "You sit the exam",
    text: "Read each German question, choose an answer and move on when you are ready. A timer shows what is left and your answers are saved as you go.",
  },
  {
    title: "You see your percentage at once",
    text: "The moment you submit, your result appears as a percentage, with totals per topic and a report you can print.",
  },
];

const studentFacts = [
  { title: "German exams, English around them", text: "Questions are in German. The instructions, buttons and your result report are in English, with German and English side by side on the report." },
  { title: "Phone or laptop", text: "The exam works on a phone and on a laptop. For a long paper a computer is easier on the eyes." },
  { title: "Results straight away", text: "You get your percentage the moment you submit, not days later." },
  { title: "A 90% pass mark", text: "The standard pass mark is 90%. Your result shows where you stand against it." },
  { title: "Two attempts per curriculum", text: "Each curriculum gives you two attempts, on a different exam where possible. If you need more, your trainer can add attempts." },
];

const staffFacts = [
  { title: "Set the exam", text: "Choose the questions per paper, time limit, pass mark and topic mix for every exam set." },
  { title: "Set attempts per student", text: "Decide how many attempts a curriculum allows. The standard is two." },
  { title: "Review every attempt", text: "Open any attempt and read each question in German and English, side by side." },
  { title: "Add extra attempts", text: "Give a student more attempts when they need them, with or without repeating exam sets." },
];

const doesList = [
  "Logs what happens during an exam: leaving the tab, copying, pasting, printing and opening a second tab.",
  "Shows that log to your trainer, who decides what it means. Nothing fails you automatically.",
  "Takes the clock from the server, so every student runs on the same time.",
  "Fixes your paper and your deadline when you start. Later changes to an exam only apply to later attempts.",
];

const cannotList = [
  "Block screenshots or screen recordings. No web page can, and Talent Track Platform does not claim to.",
  "See a phone camera or a second device.",
];

function FactList({ items }: { items: { title: string; text: string }[] }) {
  return (
    <dl className="flex flex-col border-t border-rule">
      {items.map((item, i) => (
        <Reveal key={item.title} index={i} className="grid gap-1 border-b border-rule py-4 sm:grid-cols-[minmax(0,13rem)_1fr] sm:gap-6 sm:py-5">
          <dt className="font-heading text-base font-semibold text-foreground">{item.title}</dt>
          <dd className="m-0 max-w-[60ch] text-base leading-relaxed text-muted-foreground">{item.text}</dd>
        </Reveal>
      ))}
    </dl>
  );
}

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col bg-card">
      <header className="border-b bg-card">
        <div className={cn(wrap, "flex h-16 items-center justify-between gap-4")}>
          <Link href="/" className="rounded-md">
            <Wordmark />
          </Link>
          <nav aria-label="Sections" className="hidden items-center gap-6 md:flex">
            <a href="#how" className={navLink}>How it works</a>
            <a href="#students" className={navLink}>Students</a>
            <a href="#trainers" className={navLink}>Trainers</a>
            <a href="#trust" className={navLink}>Fairness</a>
          </nav>
          <Link href="/login" className={buttonVariants({ variant: "outline" })}>
            Sign in
          </Link>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col outline-none">
        <section aria-labelledby="hero-title" className="ruled relative overflow-hidden border-b bg-background">
          <div className={cn(wrap, "grid gap-10 py-12 sm:py-16 lg:grid-cols-12 lg:items-center lg:gap-12 lg:py-24")}>
            <div className="flex flex-col lg:col-span-7">
              <h1
                id="hero-title"
                className="enter text-[clamp(2.4rem,9.5vw,5.25rem)] leading-none"
                style={{ "--enter-i": 0 } as React.CSSProperties}
              >
                <NameLockup layout="stacked" />
              </h1>
              <p className="enter mt-6 flex flex-wrap items-center gap-x-4 gap-y-2" style={{ "--enter-i": 2 } as React.CSSProperties}>
                <PoweredBy className="text-base" />
              </p>
              <p className={cn(body, "enter mt-5 max-w-[52ch] text-foreground/80 sm:text-lg")} style={{ "--enter-i": 3 } as React.CSSProperties}>
                Exams that are set once, run the same way for everyone and scored the moment you submit. Questions are in German; everything around them comes with English.
              </p>
              <div className="enter mt-8 flex flex-col gap-3 sm:flex-row sm:items-center" style={{ "--enter-i": 4 } as React.CSSProperties}>
                <Link href="/login" className={cn(buttonVariants({ size: "lg" }), "lift")}>
                  Sign in
                </Link>
                <a href="#how" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
                  See how it works
                </a>
              </div>
              <p className="enter mt-4 text-sm text-muted-foreground" style={{ "--enter-i": 5 } as React.CSSProperties}>
                Accounts are created by your trainer. There is no self sign-up.
              </p>
            </div>
            <Reveal className="lg:col-span-5">
              <div className="enter" style={{ "--enter-i": 3 } as React.CSSProperties}>
                <AnswerSheetSpecimen />
              </div>
            </Reveal>
          </div>
        </section>

        <section aria-labelledby="what-title" className="border-b">
          <div className={cn(wrap, "grid gap-8 py-14 sm:py-20 lg:grid-cols-12 lg:gap-12")}>
            <Reveal className="lg:col-span-5">
              <h2 id="what-title" className={cn(h2, "max-w-[16ch]")}>
                Check what people know, the same way every time.
              </h2>
            </Reveal>
            <div className="flex flex-col gap-8 lg:col-span-7">
              <Reveal index={1}>
                <p className={cn(body, "max-w-[58ch]")}>
                  Talent Track Platform is where trainers set exams and students sit them. Everyone gets a paper built to the same rules, a clock that runs on the server and a result scored by the platform, so a pass means the same thing for every student.
                </p>
              </Reveal>
              <FactList
                items={[
                  { title: "One paper, fixed at the start", text: "Your questions and your deadline are set when you begin." },
                  { title: "One scale", text: "Every result is a percentage. The standard pass mark is 90%." },
                  { title: "Scored once", text: "The platform scores your paper when you submit or when time runs out, with the same rules for everyone." },
                ]}
              />
            </div>
          </div>
        </section>

        <section id="how" aria-labelledby="how-title" className="scroll-mt-4 border-b bg-background">
          <div className={cn(wrap, "py-14 sm:py-20")}>
            <Reveal>
              <h2 id="how-title" className={h2}>How it works</h2>
            </Reveal>
            <ol className="mt-10 grid list-none gap-0 p-0 md:grid-cols-3 md:gap-8">
              {steps.map((step, i) => (
                <Reveal as="li" key={step.title} index={i} className="flex flex-col gap-3 border-t-2 border-foreground py-6 md:pb-0">
                  <span aria-hidden="true" className="font-heading text-5xl leading-none font-light tracking-[-0.04em] text-primary tabular-nums">
                    {i + 1}
                  </span>
                  <h3 className="font-heading text-xl leading-snug font-semibold tracking-[-0.015em]">{step.title}</h3>
                  <p className="max-w-[40ch] text-base leading-relaxed text-muted-foreground">{step.text}</p>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        <section id="students" aria-labelledby="students-title" className="scroll-mt-4 border-b">
          <div className={cn(wrap, "grid gap-8 py-14 sm:py-20 lg:grid-cols-12 lg:gap-12")}>
            <Reveal className="lg:col-span-4">
              <div className="lg:sticky lg:top-8">
                <h2 id="students-title" className={h2}>For students</h2>
                <p className={cn(body, "mt-3 max-w-[34ch]")}>Everything you need to sit an exam, on the device you already have.</p>
              </div>
            </Reveal>
            <div className="lg:col-span-8">
              <FactList items={studentFacts} />
            </div>
          </div>
        </section>

        <section id="trainers" aria-labelledby="trainers-title" className="scroll-mt-4 border-b bg-background">
          <div className={cn(wrap, "grid gap-10 py-14 sm:py-20 lg:grid-cols-12 lg:gap-12")}>
            <div className="flex flex-col gap-6 lg:col-span-6">
              <Reveal>
                <h2 id="trainers-title" className={h2}>For trainers and staff</h2>
                <p className={cn(body, "mt-3 max-w-[44ch]")}>Set the exam once, then review what happened, attempt by attempt.</p>
              </Reveal>
              <FactList items={staffFacts} />
            </div>
            <Reveal index={1} className="lg:col-span-6 lg:pt-4">
              <ReviewSpecimen />
            </Reveal>
          </div>
        </section>

        <section id="trust" aria-labelledby="trust-title" className="scroll-mt-4 border-b">
          <div className={cn(wrap, "py-14 sm:py-20")}>
            <Reveal>
              <h2 id="trust-title" className={cn(h2, "max-w-[20ch]")}>Fairness you can check, and limits we state.</h2>
            </Reveal>
            <div className="mt-10 grid gap-10 lg:grid-cols-12 lg:gap-12">
              <Reveal className="lg:col-span-7">
                <h3 className="font-heading text-xl font-semibold tracking-[-0.015em]">What Talent Track Platform does</h3>
                <ul className="mt-4 flex list-none flex-col border-t border-rule p-0">
                  {doesList.map((t) => (
                    <li key={t} className="border-b border-rule py-3.5 text-base leading-relaxed text-foreground/85">{t}</li>
                  ))}
                </ul>
              </Reveal>
              <Reveal index={1} className="lg:col-span-5">
                <h3 className="font-heading text-xl font-semibold tracking-[-0.015em]">What it cannot do</h3>
                <ul className="mt-4 flex list-none flex-col border-t border-rule p-0">
                  {cannotList.map((t) => (
                    <li key={t} className="border-b border-rule py-3.5 text-base leading-relaxed text-foreground/85">{t}</li>
                  ))}
                </ul>
                <p className="mt-4 max-w-[44ch] text-sm leading-relaxed text-muted-foreground">
                  The log is evidence for a person to weigh. It is not a verdict.
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        <section aria-labelledby="cta-title" className="bg-primary text-primary-foreground [print-color-adjust:exact]">
          <div className={cn(wrap, "flex flex-col gap-6 py-14 sm:py-20 md:flex-row md:items-end md:justify-between")}>
            <Reveal className="max-w-[34rem]">
              <h2 id="cta-title" className="font-heading text-[1.875rem] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-[2.5rem]">
                Ready for your exam?
              </h2>
              <p className="mt-3 text-base leading-relaxed text-primary-foreground/90 sm:text-lg">
                Sign in with the account your trainer created for you.
              </p>
            </Reveal>
            <Reveal index={1}>
              <Link href="/login" className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "lift w-full sm:w-auto")}>
                Sign in
              </Link>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t bg-card">
        <div className={cn(wrap, "flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:justify-between")}>
          <div className="flex flex-col gap-3">
            <Wordmark compact />
            <PoweredBy />
            <p className="text-sm text-muted-foreground">F.L.A.G. is the Foreign Languages Academy Gurukulam.</p>
          </div>
          <div className="flex flex-col gap-1 sm:items-end">
            <Link href="/login" className="link-draw w-fit rounded-sm py-1 text-sm font-semibold text-primary">
              Sign in
            </Link>
            <p className="text-sm text-muted-foreground">Accounts are created by instructors.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
