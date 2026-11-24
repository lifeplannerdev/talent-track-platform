import { Suspense } from "react";
import type { Metadata } from "next";
import { UsersIcon } from "lucide-react";
import { requireAdmin } from "@/lib/auth/require-role";
import { listTrainers } from "@/lib/team";
import { PageHeader, SectionHeading } from "@/components/app/page-header";
import { staffMain } from "@/components/app/styles";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TrainerActions } from "./trainer-actions";
import { TrainerForm } from "./trainer-form";

export const metadata: Metadata = { title: "Team | Talent Track Platform" };

async function TeamList() {
  // Admin only: a trainer or student is redirected before anything is read.
  await requireAdmin();
  const trainers = await listTrainers();
  const activeTrainers = trainers.filter((t) => t.active);

  if (trainers.length === 0) {
    return (
      <Empty className="border" data-testid="team-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No trainers yet</EmptyTitle>
          <EmptyDescription>Add a trainer below. They get an email to choose a password.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table data-testid="team-table" className="min-w-[56rem]">
      <TableHeader>
        <TableRow>
          <TableHead>Trainer</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Students</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trainers.map((t) => (
          <TableRow key={t.id} className="align-top" data-testid="trainer-row">
            <TableCell>
              <span className="block font-semibold">{t.name}</span>
              <span className="block text-muted-foreground">{t.username}</span>
            </TableCell>
            <TableCell>{t.email}</TableCell>
            <TableCell className="whitespace-normal">
              <div className="flex flex-wrap gap-1.5">
                <Badge variant={t.active ? "success" : "outline"}>{t.active ? "Active" : "Inactive"}</Badge>
                {t.active && !t.signedIn ? <Badge variant="warning">Not signed in yet</Badge> : null}
              </div>
            </TableCell>
            <TableCell data-testid="trainer-students">{t.students}</TableCell>
            <TableCell className="whitespace-normal">
              <TrainerActions
                trainerId={t.id}
                name={t.name}
                active={t.active}
                students={t.students}
                targets={activeTrainers.filter((o) => o.id !== t.id).map((o) => ({ id: o.id, name: o.name }))}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function TeamPage() {
  return (
    <main className={staffMain}>
      <PageHeader
        title="Team"
        description="Trainers see and manage only their own students. A trainer with students cannot be deactivated until the students are moved to another trainer."
      />
      <Suspense
        fallback={
          <div role="status" aria-label="Loading team" className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        }
      >
        <TeamList />
      </Suspense>
      <section aria-labelledby="add-trainer-heading" className="flex flex-col gap-3">
        <SectionHeading id="add-trainer-heading">Add a trainer</SectionHeading>
        <Suspense fallback={<Skeleton className="h-48 w-full" />}>
          <AddTrainer />
        </Suspense>
      </section>
    </main>
  );
}

async function AddTrainer() {
  await requireAdmin();
  return <TrainerForm />;
}
