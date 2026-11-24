"use client";

import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTrainer } from "./actions";

const EMPTY = { fullName: "", email: "", username: "" };

/** Admin only. No password field: the trainer gets an email with a link to choose their own. */
export function TrainerForm() {
  const [v, setV] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; invite: "sent" | "failed" } | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [key]: e.target.value }));

  const submit = () =>
    startTransition(async () => {
      setError(null);
      setDone(null);
      try {
        const r = await createTrainer(v);
        if (r.ok) {
          setDone({ name: v.fullName.trim(), invite: r.invite });
          setV(EMPTY);
        } else {
          setError(r.message);
        }
      } catch {
        setError("The trainer could not be created. Please try again.");
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add trainer</CardTitle>
        <CardDescription>
          The trainer gets an email with a link to choose a password, and signs in with that email address afterwards.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={submit} className="flex flex-col gap-4" aria-label="Add trainer">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="trainer-fullname">Full name</Label>
              <Input id="trainer-fullname" required autoComplete="off" value={v.fullName} onChange={set("fullName")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="trainer-email">Email</Label>
              <Input id="trainer-email" type="email" required autoComplete="off" value={v.email} onChange={set("email")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="trainer-username">Username</Label>
              <Input id="trainer-username" required autoComplete="off" value={v.username} onChange={set("username")} aria-describedby="trainer-username-hint" />
              <p id="trainer-username-hint" className="text-xs text-muted-foreground">3-40 letters, digits, dots, underscores or hyphens.</p>
            </div>
          </div>
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add trainer"}
            </Button>
          </div>
        </form>
        <div aria-live="polite" className="mt-3 flex flex-col gap-2">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription data-testid="trainer-error">{error}</AlertDescription>
            </Alert>
          ) : null}
          {done ? (
            <Alert variant={done.invite === "sent" ? "success" : "warning"}>
              <AlertDescription data-testid="trainer-success">
                {done.invite === "sent"
                  ? `Trainer ${done.name} added. An invite email was sent.`
                  : `Trainer ${done.name} added, but the invite email could not be sent. Use Resend invite in the list.`}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
