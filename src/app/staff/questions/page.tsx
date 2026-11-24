import { Suspense } from "react";
import type { Metadata } from "next";
import { FileStackIcon, ListPlusIcon } from "lucide-react";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-role";
import { poolWarning } from "@/lib/exam-set-fields";
import { getQuestion, listCurriculumsWithSets, listQuestions, type QuestionFilters } from "@/lib/staff-manage";
import { PageHeader, SectionHeading } from "@/components/app/page-header";
import { staffMain } from "@/components/app/styles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { linkClass } from "../students/ui";
import { QuestionForm, type ExamSetChoice } from "./question-form";
import { QuestionImport } from "./question-import";
import { StatusToggle } from "./status-toggle";

export const metadata: Metadata = { title: "Questions | Talent Track Platform" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

async function QuestionsContent({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const sp = await searchParams;
  const filters: QuestionFilters = {
    curriculum: first(sp.curriculum),
    examSet: first(sp.examSet),
    status: first(sp.status),
    topic: first(sp.topic),
  };
  const editId = first(sp.edit);

  const curriculums = await listCurriculumsWithSets();
  const allSets = curriculums.flatMap((c) => c.examSets);
  const choices: ExamSetChoice[] = allSets.map((s) => ({ id: s.id, name: s.name, curriculumName: s.curriculumName }));
  const [{ questions, topics }, editing] = await Promise.all([listQuestions(filters), editId ? getQuestion(editId) : null]);
  const setName = new Map(allSets.map((s) => [s.id, `${s.curriculumName}, ${s.name}`]));
  const poolSets = allSets.filter(
    (s) => (!filters.examSet || s.id === filters.examSet) && (!filters.curriculum || s.curriculumId === filters.curriculum),
  );
  const filtered = Boolean(filters.curriculum || filters.examSet || filters.status || filters.topic);
  const defaultSet = filters.examSet && setName.has(filters.examSet) ? filters.examSet : "";

  if (allSets.length === 0) {
    return (
      <Empty className="border" data-testid="questions-no-sets">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileStackIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No exam sets yet</EmptyTitle>
          <EmptyDescription>
            Questions belong to an exam set. <Link href="/staff/curriculums" className={linkClass}>Create an exam set</Link> first.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <form method="get" aria-label="Filter questions" className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-curriculum">Curriculum</Label>
          <NativeSelect id="f-curriculum" name="curriculum" defaultValue={filters.curriculum}>
            <NativeSelectOption value="">All curriculums</NativeSelectOption>
            {curriculums.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-set">Exam set</Label>
          <NativeSelect id="f-set" name="examSet" defaultValue={filters.examSet}>
            <NativeSelectOption value="">All exam sets</NativeSelectOption>
            {curriculums
              .filter((c) => c.examSets.length > 0)
              .map((c) => (
                <NativeSelectOptGroup key={c.id} label={c.name}>
                  {c.examSets.map((s) => (
                    <NativeSelectOption key={s.id} value={s.id}>
                      {s.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelectOptGroup>
              ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-status">Status</Label>
          <NativeSelect id="f-status" name="status" defaultValue={filters.status}>
            <NativeSelectOption value="">Any status</NativeSelectOption>
            <NativeSelectOption value="approved">Approved</NativeSelectOption>
            <NativeSelectOption value="draft">Draft</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-topic">Topic</Label>
          <NativeSelect id="f-topic" name="topic" defaultValue={filters.topic}>
            <NativeSelectOption value="">All topics</NativeSelectOption>
            {topics.map((t) => (
              <NativeSelectOption key={t} value={t}>
                {t}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        {filtered ? (
          <Link href="/staff/questions" className={linkClass}>
            Clear filters
          </Link>
        ) : null}
      </form>

      <section aria-labelledby="pool-heading" className="flex flex-col gap-2">
        <SectionHeading id="pool-heading">Question pools</SectionHeading>
        <p className="text-sm text-muted-foreground">
          Each attempt uses a different exam set, so an exam set needs at least its questions per paper approved before students can get it.
        </p>
        <Table data-testid="pool-table" className="min-w-[36rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Exam set</TableHead>
              <TableHead className="text-right">Approved</TableHead>
              <TableHead className="text-right">Draft</TableHead>
              <TableHead className="text-right">Per paper</TableHead>
              <TableHead>Pool</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {poolSets.map((s) => {
              const warning = poolWarning(s.approvedCount, s.questionCount);
              return (
                <TableRow key={s.id} data-testid="pool-row">
                  <TableCell className="whitespace-normal">
                    <span className="block font-medium">{s.name}</span>
                    <span className="block text-muted-foreground">{s.curriculumName}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.approvedCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.draftCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.questionCount}</TableCell>
                  <TableCell className="whitespace-normal">
                    {warning ? (
                      <span className="flex flex-col gap-1">
                        <Badge variant="warning">Too few</Badge>
                        <span className="text-xs text-muted-foreground">{warning}</span>
                      </span>
                    ) : (
                      <Badge variant="success">Enough</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </section>

      <section aria-labelledby="list-heading" className="flex flex-col gap-3">
        <SectionHeading id="list-heading" aside={<span className="text-sm text-muted-foreground tabular-nums">{questions.length} shown</span>}>
          Questions
        </SectionHeading>
        {questions.length === 0 ? (
          <Empty className="border" data-testid="questions-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListPlusIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{filtered ? "No questions match these filters" : "No questions yet"}</EmptyTitle>
              <EmptyDescription>Add questions below by hand or import a CSV file.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {questions.map((q) => (
              <li key={q.id}>
                <Card size="sm" data-testid="question-card">
                  <CardHeader>
                    <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>{setName.get(q.examSetId)}</span>
                      <span>Topic: {q.topic}</span>
                      {q.difficulty ? <span>Difficulty: {q.difficulty}</span> : null}
                      <span>
                        {q.points} point{q.points === 1 ? "" : "s"}
                      </span>
                      <Badge variant={q.status === "approved" ? "success" : "outline"} data-testid="question-status">
                        {q.status}
                      </Badge>
                    </CardDescription>
                    <CardTitle className="grid gap-3 font-sans font-normal tracking-normal md:grid-cols-2">
                      <p lang="de">
                        <span className="block text-xs font-semibold text-muted-foreground">Deutsch</span>
                        <span className="text-base font-semibold">{q.stemDe}</span>
                      </p>
                      <p lang="en">
                        <span className="block text-xs font-semibold text-muted-foreground">English</span>
                        <span className="text-base">{q.stemEn}</span>
                      </p>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <ul className="grid gap-1 text-sm" aria-label="Options">
                      {q.options.map((o) => (
                        <li key={o.id} className="grid gap-x-3 rounded-sm px-2 py-1 data-correct:bg-success-muted md:grid-cols-[2rem_1fr_1fr]" data-correct={o.id === q.correctOptionId || undefined}>
                          <span className="font-medium">
                            {o.id.toUpperCase()}
                            {o.id === q.correctOptionId ? <span className="sr-only"> (correct)</span> : null}
                          </span>
                          <span lang="de" className={o.id === q.correctOptionId ? "font-semibold" : undefined}>
                            {o.de}
                          </span>
                          <span lang="en" className={o.id === q.correctOptionId ? "font-semibold" : "text-muted-foreground"}>
                            {o.en}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">Correct option: {q.correctOptionId.toUpperCase()}</p>
                    <div className="flex flex-wrap items-center gap-3">
                      <StatusToggle questionId={q.id} status={q.status} label={q.stemDe} />
                      <Link href={`/staff/questions?examSet=${q.examSetId}&edit=${q.id}#question-form`} className={linkClass}>
                        Edit<span className="sr-only">: {q.stemDe}</span>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card id="question-form">
        <CardHeader>
          <CardTitle>{editing ? "Edit question" : "Add question"}</CardTitle>
          <CardDescription>German and English side by side. New questions are drafts until you approve them.</CardDescription>
        </CardHeader>
        <CardContent>
          <QuestionForm
            key={editing?.id ?? `new-${defaultSet}`}
            sets={choices}
            initial={
              editing ?? {
                examSetId: defaultSet,
                topic: "",
                difficulty: "",
                stemDe: "",
                stemEn: "",
                options: [],
                correctOptionId: "a",
                points: 1,
                status: "draft",
              }
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import CSV</CardTitle>
        </CardHeader>
        <CardContent>
          <QuestionImport key={defaultSet} sets={choices} defaultExamSetId={defaultSet} />
        </CardContent>
      </Card>
    </div>
  );
}

function ContentSkeleton() {
  return (
    <div role="status" aria-label="Loading questions" className="flex flex-col gap-4">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

export default function QuestionsPage(props: PageProps<"/staff/questions">) {
  return (
    <main className={staffMain}>
      <PageHeader
        title="Questions"
        description="Every question has German and English text. Students see only the German; you check both here and in the evaluation."
      />
      <Suspense fallback={<ContentSkeleton />}>
        <QuestionsContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
