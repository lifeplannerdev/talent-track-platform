"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { createStudent } from "./actions";
import {
  ContactSection,
  CourseSection,
  EMPTY_DETAILS,
  FormSection,
  NotesSection,
  PassportSection,
  type DetailsKey,
} from "./student-details-fields";
import { linkClass } from "./ui";

const EMPTY_ACCOUNT = { username: "", fullName: "", batch: "", track: "nursing", password: "", trainerId: "" };
type AccountKey = keyof typeof EMPTY_ACCOUNT;

const INVITE_NOTE = {
  sent: "An invite email with a link to choose a password was sent.",
  failed: "The invite email could not be sent. Open the student and use Resend invite.",
  skipped: "",
} as const;

// Controlled fields: React resets uncontrolled forms after an action, which would wipe the
// staff's input on a validation error. The password lives only in this component's state and is
// sent once to the server action (never in a URL). `trainers` is given to an admin only (the
// trainer picker); a trainer's students always belong to that trainer.
export function AddStudentForm({ trainers }: { trainers: { id: string; name: string }[] | null }) {
  const [account, setAccount] = useState(EMPTY_ACCOUNT);
  const [details, setDetails] = useState(EMPTY_DETAILS);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; username: string; invite: keyof typeof INVITE_NOTE } | null>(null);
  const [pending, startTransition] = useTransition();

  const setA = (key: AccountKey) => (e: { target: { value: string } }) => setAccount((v) => ({ ...v, [key]: e.target.value }));
  const setD = (key: DetailsKey) => (e: { target: { value: string } }) => setDetails((v) => ({ ...v, [key]: e.target.value }));

  const submit = () =>
    startTransition(async () => {
      setError(null);
      setCreated(null);
      try {
        const { contactEmail, ...rest } = details;
        const result = await createStudent({
          ...account,
          trainerId: trainers ? account.trainerId || null : undefined,
          contactEmail,
          details: rest,
        });
        if (result.ok) {
          setCreated({ id: result.studentId, username: account.username.trim().toLowerCase(), invite: result.invite });
          setAccount(EMPTY_ACCOUNT);
          setDetails(EMPTY_DETAILS);
        } else {
          setError(result.message);
        }
      } catch {
        setError("The student could not be created. Please try again.");
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add student</CardTitle>
        <CardDescription>
          Choose the first password yourself. The contact email gets an invite with a link where the student chooses their own password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={submit} className="flex flex-col gap-5" aria-label="Add student">
          <FormSection title="Account">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-username">Username</Label>
              <Input
                id="new-username"
                name="username"
                required
                autoComplete="off"
                value={account.username}
                onChange={setA("username")}
                aria-describedby="new-username-hint"
              />
              <p id="new-username-hint" className="text-xs text-muted-foreground">
                3-40 letters, digits, dots, underscores or hyphens.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-fullname">Full name</Label>
              <Input id="new-fullname" name="fullName" required autoComplete="off" value={account.fullName} onChange={setA("fullName")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-batch">Batch</Label>
              <Input id="new-batch" name="batch" autoComplete="off" value={account.batch} onChange={setA("batch")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-track">Track</Label>
              <NativeSelect id="new-track" name="track" value={account.track} onChange={setA("track")} className="w-full">
                <NativeSelectOption value="nursing">Nursing</NativeSelectOption>
                <NativeSelectOption value="other">Other</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-password">First password</Label>
              <Input
                id="new-password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={account.password}
                onChange={setA("password")}
                aria-describedby="new-password-hint"
              />
              <p id="new-password-hint" className="text-xs text-muted-foreground">
                At least 8 characters.
              </p>
            </div>
            {trainers ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-trainer">Trainer</Label>
                <NativeSelect
                  id="new-trainer"
                  name="trainerId"
                  data-testid="trainer-select"
                  value={account.trainerId}
                  onChange={setA("trainerId")}
                  className="w-full"
                  aria-describedby="new-trainer-hint"
                >
                  <NativeSelectOption value="">No trainer</NativeSelectOption>
                  {trainers.map((t) => (
                    <NativeSelectOption key={t.id} value={t.id}>
                      {t.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <p id="new-trainer-hint" className="text-xs text-muted-foreground">
                  Only this trainer and admins can see the student.
                </p>
              </div>
            ) : null}
          </FormSection>
          <ContactSection values={details} onChange={setD} idPrefix="new" />
          <PassportSection values={details} onChange={setD} idPrefix="new" />
          <CourseSection values={details} onChange={setD} idPrefix="new" />
          <NotesSection values={details} onChange={setD} idPrefix="new" />
          <div aria-live="polite" className="flex flex-col gap-2">
            {error ? (
              <Alert variant="destructive">
                <AlertDescription data-testid="add-student-error">{error}</AlertDescription>
              </Alert>
            ) : null}
            {created ? (
              <Alert variant={created.invite === "failed" ? "warning" : "success"}>
                <AlertDescription data-testid="add-student-success">
                  Student {created.username} created. {INVITE_NOTE[created.invite]}{" "}
                  <Link href={`/staff/students/${created.id}`} className={linkClass}>
                    Open student
                  </Link>
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create student"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
