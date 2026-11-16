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
import { linkClass } from "./ui";

const EMPTY = { username: "", fullName: "", batch: "", track: "nursing", password: "" };

// Controlled fields: React resets uncontrolled forms after an action, which would wipe the
// staff's input on a validation error. The password lives only in this component's state and is
// sent once to the server action (never in a URL).
export function AddStudentForm() {
  const [values, setValues] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; username: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  const submit = () =>
    startTransition(async () => {
      setError(null);
      setCreated(null);
      try {
        const result = await createStudent(values);
        if (result.ok) {
          setCreated({ id: result.studentId, username: values.username.trim().toLowerCase() });
          setValues(EMPTY);
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
        <CardDescription>Choose the first password yourself and give it to the student in person.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={submit} className="flex flex-col gap-4" aria-label="Add student">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-username">Username</Label>
              <Input
                id="new-username"
                name="username"
                required
                autoComplete="off"
                value={values.username}
                onChange={set("username")}
                aria-describedby="new-username-hint"
              />
              <p id="new-username-hint" className="text-xs text-muted-foreground">
                3-40 letters, digits, dots, underscores or hyphens.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-fullname">Full name</Label>
              <Input id="new-fullname" name="fullName" required value={values.fullName} onChange={set("fullName")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-batch">Batch</Label>
              <Input id="new-batch" name="batch" value={values.batch} onChange={set("batch")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-track">Track</Label>
              <NativeSelect id="new-track" name="track" value={values.track} onChange={set("track")} className="w-full">
                <NativeSelectOption value="nursing">Nursing</NativeSelectOption>
                <NativeSelectOption value="other">Other</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="new-password">First password</Label>
              <Input
                id="new-password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={values.password}
                onChange={set("password")}
                aria-describedby="new-password-hint"
              />
              <p id="new-password-hint" className="text-xs text-muted-foreground">
                At least 8 characters.
              </p>
            </div>
          </div>
          <div aria-live="polite" className="flex flex-col gap-2">
            {error ? (
              <Alert variant="destructive">
                <AlertDescription data-testid="add-student-error">{error}</AlertDescription>
              </Alert>
            ) : null}
            {created ? (
              <Alert variant="success">
                <AlertDescription data-testid="add-student-success">
                  Student {created.username} created.{" "}
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
