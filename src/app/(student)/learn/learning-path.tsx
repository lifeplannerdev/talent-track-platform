import Link from "next/link";
import { BookOpenIcon, FlagIcon } from "lucide-react";
import { Reveal } from "@/components/landing/reveal";
import { buttonVariants } from "@/components/ui/button";
import type { LearningPath } from "@/lib/book/pages-access";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * One curriculum's pathway: a vertical line with a node per chapter (all open in this slice, no
 * locks and no progress yet) and the Main exam at the end, display-only until phase 3. Motion is
 * Reveal-based (CSS only hides content when scripting is on and motion is allowed).
 */
export function LearningPathView({ path }: { path: LearningPath }) {
  const totalPages = path.chapters.reduce((sum, c) => sum + c.pageCount, 0);
  const headingId = `path-${path.curriculumId}`;
  return (
    <Reveal as="section" aria-labelledby={headingId} id={path.curriculumId} className="flex scroll-mt-6 flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 id={headingId} className="flex items-center gap-2 text-xl leading-snug font-semibold sm:text-2xl">
          <BookOpenIcon aria-hidden="true" className="size-5 shrink-0 text-primary" />
          <span className="min-w-0 break-words">{path.name}</span>
        </h2>
        <p className="text-sm text-muted-foreground" data-testid="path-summary">
          {plural(path.chapters.length, "chapter")} · {plural(totalPages, "page")}
        </p>
      </header>

      <div className="relative">
        <span aria-hidden="true" className="line-grow absolute top-5 bottom-5 left-[1.0625rem] w-0.5 rounded-full bg-border" />
        <ol aria-label="Chapters" className="m-0 flex list-none flex-col gap-3 p-0">
          {path.chapters.map((c, i) => (
            <Reveal as="li" key={c.id} index={i} className="relative pl-12" data-testid="chapter-node">
              <span
                aria-hidden="true"
                className="node-dot absolute top-4 left-0 flex size-9 items-center justify-center rounded-full border-2 border-primary bg-card font-heading text-sm font-bold text-primary"
              >
                {i + 1}
              </span>
              <div className="lift flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <h3 className="text-lg leading-snug font-semibold break-words">{c.title}</h3>
                  <p className="text-sm text-muted-foreground">{plural(c.pageCount, "page")}</p>
                </div>
                <Link
                  href={`/learn/${path.curriculumId}/read/${c.id}`}
                  aria-label={`Read chapter ${i + 1}: ${c.title}`}
                  className={buttonVariants({ variant: "outline", size: "lg", className: "shrink-0 sm:min-w-24" })}
                >
                  Read
                </Link>
              </div>
            </Reveal>
          ))}
          <Reveal as="li" index={path.chapters.length} className="relative pl-12" data-testid="main-exam-node">
            <span
              aria-hidden="true"
              className="node-dot absolute top-4 left-0 flex size-9 items-center justify-center rounded-full bg-foreground text-background"
            >
              <FlagIcon className="size-4" />
            </span>
            <div className="flex flex-col gap-0.5 rounded-xl border border-dashed bg-muted/50 p-4">
              <h3 className="text-lg leading-snug font-semibold">Main exam</h3>
              <p className="text-sm text-muted-foreground">Request opens when every chapter is done</p>
            </div>
          </Reveal>
        </ol>
      </div>
    </Reveal>
  );
}
