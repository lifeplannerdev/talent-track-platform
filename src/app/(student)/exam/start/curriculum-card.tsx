import Link from "next/link";
import { CircleCheckIcon, HourglassIcon, LockIcon, PlayIcon, RotateCwIcon } from "lucide-react";
import type { CurriculumCard, CurriculumCardKind } from "@/lib/exam-start";
import { formatPercent } from "@/lib/percent";
import type { StudentResultListItem } from "@/lib/results";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { startExam } from "../actions";
import { StartButton } from "./start-button";
import { attemptsLeftLabel } from "./view";

const BADGE: Record<CurriculumCardKind, { label: string; variant: "outline" | "success" | "warning" | "destructive" }> = {
  ready: { label: "Ready", variant: "outline" },
  in_progress: { label: "In progress", variant: "outline" },
  calculating: { label: "Being calculated", variant: "warning" },
  passed: { label: "Passed", variant: "success" },
  blocked: { label: "Blocked", variant: "destructive" },
  unavailable: { label: "Not available", variant: "warning" },
};

const actionClass = "w-full sm:w-auto sm:min-w-44";

/** A line of state text with its icon (the icon is decoration; the words carry the meaning). */
function Note({ icon: Icon, testId, children }: { icon: typeof LockIcon; testId?: string; children: React.ReactNode }) {
  return (
    <p data-testid={testId} className="flex items-start gap-2.5 text-base">
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <span>{children}</span>
    </p>
  );
}

/**
 * One assigned curriculum on the student start page. Each curriculum is its own exam (any order).
 * The exam set is chosen by the server at Start, so the card shows only the curriculum, the
 * attempts left and what happens next; no number is promised once the student is blocked.
 */
export function CurriculumCardView({ card, passedResult }: { card: CurriculumCard; passedResult: StudentResultListItem | null }) {
  const headingId = `curriculum-${card.curriculumId}`;
  const badge = BADGE[card.kind];
  const passPercent =
    card.kind === "passed" && passedResult && passedResult.points !== null && passedResult.maxPoints !== null
      ? formatPercent(passedResult.points, passedResult.maxPoints)
      : null;

  return (
    <Card className="h-full" data-testid="curriculum-card" data-kind={card.kind} aria-labelledby={headingId}>
      <CardHeader>
        <CardTitle className="min-w-0">
          <h2 id={headingId} className="text-[1.25rem] leading-tight font-semibold break-words sm:text-[1.375rem]">
            {card.name}
          </h2>
        </CardTitle>
        <CardAction>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {card.kind === "ready" ? (
          <>
            <p data-testid="attempts-left" className="flex items-baseline gap-1.5 text-base text-muted-foreground">
              <span className="font-heading text-[1.75rem] leading-none font-semibold text-foreground tabular-nums">
                {card.attemptsLeft}
              </span>
              {attemptsLeftLabel(card.attemptsLeft).replace(/^\d+ /, "")}
            </p>
            <p className="text-base">
              {card.attemptsLeft === 1 ? "This is your last attempt. " : ""}
              Each attempt uses a different exam. Your result is shown as soon as you submit.
            </p>
          </>
        ) : null}

        {card.kind === "in_progress" ? (
          <Note icon={HourglassIcon}>Your exam is running. The timer keeps going, so continue where you left off.</Note>
        ) : null}

        {card.kind === "calculating" ? (
          <Note icon={HourglassIcon} testId="calculating">
            Your result is being calculated, please check again in a moment.
          </Note>
        ) : null}

        {card.kind === "passed" ? (
          passPercent ? (
            <p className="flex items-center gap-3">
              <CircleCheckIcon aria-hidden="true" className="size-6 shrink-0 text-success" />
              <span className="flex items-baseline gap-2">
                <span className="font-heading text-[1.75rem] leading-none font-semibold tabular-nums">{passPercent}</span>
                <span className="text-base text-muted-foreground">You passed this exam.</span>
              </span>
            </p>
          ) : (
            <Note icon={CircleCheckIcon}>You passed this exam.</Note>
          )
        ) : null}

        {card.kind === "blocked" ? (
          <Note icon={LockIcon} testId="contact-trainer">
            You have used your attempts for this exam. Please contact your trainer.
          </Note>
        ) : null}

        {card.kind === "unavailable" ? (
          <Note icon={LockIcon} testId="contact-trainer">
            No exam is available right now, please contact your trainer.
          </Note>
        ) : null}
      </CardContent>

      {card.kind === "ready" ? (
        <CardFooter>
          <form action={startExam.bind(null, card.curriculumId)} className="w-full">
            <StartButton />
          </form>
        </CardFooter>
      ) : null}

      {card.kind === "in_progress" && card.attemptId ? (
        <CardFooter>
          <Link href={`/exam/${card.attemptId}`} data-testid="resume-exam" className={buttonVariants({ size: "lg", className: actionClass })}>
            <PlayIcon data-icon="inline-start" aria-hidden="true" />
            Resume exam
          </Link>
        </CardFooter>
      ) : null}

      {card.kind === "calculating" ? (
        <CardFooter>
          <Link href="/exam/start" prefetch={false} className={buttonVariants({ variant: "outline", size: "lg", className: actionClass })}>
            <RotateCwIcon data-icon="inline-start" aria-hidden="true" />
            Check again
          </Link>
        </CardFooter>
      ) : null}

      {card.kind === "passed" && passedResult ? (
        <CardFooter>
          <Link
            href={`/results/${passedResult.id}`}
            className={buttonVariants({ variant: "outline", size: "lg", className: actionClass })}
          >
            View result
            <span className="sr-only"> for {card.name}</span>
          </Link>
        </CardFooter>
      ) : null}
    </Card>
  );
}
