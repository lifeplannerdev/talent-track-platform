"use client";

import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPassword } from "../actions";

// The new password lives only in this component's state and goes once to the server action.
export function ResetPasswordForm({ studentId, studentName }: { studentId: string; studentName: string }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        const r = await resetPassword(studentId, password);
        if (r.ok) {
          setPassword("");
          setMessage({ ok: true, text: `Password changed. Give ${studentName} the new password in person.` });
        } else {
          setMessage({ ok: false, text: r.message });
        }
      } catch {
        setMessage({ ok: false, text: "The password could not be changed. Please try again." });
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset password</CardTitle>
        <CardDescription>Set a new password when a student has forgotten theirs. The old password stops working.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={submit} className="flex flex-wrap items-end gap-3" aria-label="Reset password">
          <div className="flex min-w-56 flex-col gap-1.5">
            <Label htmlFor="reset-password">New password</Label>
            <Input
              id="reset-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" variant="outline" disabled={pending || password.length === 0}>
            {pending ? "Saving…" : "Set new password"}
          </Button>
        </form>
        <div aria-live="polite" className="mt-3">
          {message ? (
            <Alert variant={message.ok ? "success" : "destructive"}>
              <AlertDescription data-testid="reset-password-message">{message.text}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
