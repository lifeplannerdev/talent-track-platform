import { CheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScoreBar } from "@/components/app/score-bar";
import { CountUp } from "./count-up";
import { Seal } from "./seal";

const SAMPLE_PASS_MARK = 90;
const SAMPLE_PERCENT = 92;

/** A sample answer sheet as a student sees it (German), with a sample result under it. Illustration only. */
export function AnswerSheetSpecimen() {
  const options = ["Körpertemperatur", "Blutdruck", "Puls"];
  return (
    <figure className="m-0 flex flex-col overflow-hidden rounded-xl bg-card shadow-lift">
      <figcaption className="flex items-center justify-between gap-3 border-b bg-muted/60 px-4 py-2.5 text-xs font-semibold text-muted-foreground">
        <span>Sample paper</span>
        <span>For illustration, not a real exam</span>
      </figcaption>
      <div className="flex flex-col gap-4 px-4 pt-5 pb-4 sm:px-6">
        <p lang="de" className="font-sans text-xl leading-snug font-semibold text-foreground sm:text-[1.375rem]">
          Was messen Sie mit einem Fieberthermometer?
        </p>
        <ol lang="de" className="flex list-none flex-col gap-2 p-0">
          {options.map((text, i) => {
            const chosen = i === 0;
            return (
              <li
                key={text}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[1.0625rem] ring-1 ring-inset ${
                  chosen ? "bg-secondary text-secondary-foreground ring-primary" : "bg-card ring-border"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full ring-2 ring-inset ${
                    chosen ? "bg-primary text-primary-foreground ring-primary" : "ring-input"
                  }`}
                >
                  {chosen ? <CheckIcon className="size-3.5" strokeWidth={3} /> : null}
                </span>
                <span>{text}</span>
                {chosen ? <span className="sr-only"> (selected)</span> : null}
              </li>
            );
          })}
        </ol>
      </div>
      <div className="flex items-center gap-4 border-t px-4 py-4 sm:px-6">
        <Seal className="size-[4.5rem] shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="font-heading text-[2.5rem] leading-none font-semibold tracking-[-0.03em] text-foreground">
              <CountUp value={SAMPLE_PERCENT} />
            </p>
            <Badge variant="success">Passed</Badge>
          </div>
          <ScoreBar percent={SAMPLE_PERCENT} passMarkPercent={SAMPLE_PASS_MARK} passed size="sm" />
          <p className="text-xs text-muted-foreground">Sample result. Pass mark {SAMPLE_PASS_MARK}%.</p>
        </div>
      </div>
    </figure>
  );
}

/** The staff review view: one question in German and English side by side. Illustration only. */
export function ReviewSpecimen() {
  const rows = [
    { de: "Was messen Sie mit einem Fieberthermometer?", en: "What do you measure with a clinical thermometer?", kind: "question" as const },
    { de: "Körpertemperatur", en: "Body temperature", kind: "chosen" as const },
    { de: "Blutdruck", en: "Blood pressure", kind: "option" as const },
    { de: "Puls", en: "Pulse", kind: "option" as const },
  ];
  return (
    <figure className="m-0 overflow-hidden rounded-xl bg-card shadow-lift">
      <figcaption className="border-b bg-muted/60 px-4 py-2.5 text-xs font-semibold text-muted-foreground">
        Sample review, for illustration
      </figcaption>
      <div className="grid grid-cols-2 border-b text-sm font-semibold text-foreground">
        <p className="px-4 py-2 font-heading">Deutsch</p>
        <p className="border-l px-4 py-2 font-heading">English</p>
      </div>
      {rows.map((row) => (
        <div key={row.de} className="grid grid-cols-2 border-b last:border-b-0">
          <p lang="de" className={`px-4 py-3 ${row.kind === "question" ? "text-base font-semibold" : "text-[0.9375rem]"}`}>
            {row.de}
          </p>
          <p lang="en" className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-l px-4 py-3 ${row.kind === "question" ? "text-base font-semibold" : "text-[0.9375rem]"}`}>
            <span>{row.en}</span>
            {row.kind === "chosen" ? <Badge variant="success">Chosen, correct</Badge> : null}
          </p>
        </div>
      ))}
    </figure>
  );
}
