"use client";

import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { resendInvite } from "../actions";

/** Emails the student a fresh link to choose a password (needs a contact email on the student). */
export function ResendInviteCard({ studentId, studentName }: { studentId: string; studentName: string }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const send = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        const r = await resendInvite(studentId);
        setMessage(r.ok ? { ok: true, text: `Invite sent to ${studentName}.` } : { ok: false, text: r.message });
      } catch {
        setMessage({ ok: false, text: "The invite could not be sent. Please try again." });
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite</CardTitle>
        <CardDescription>
          Email {studentName} a link to choose their own password. Each link works once; sending again makes a new one.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="outline" onClick={send} disabled={pending}>
          {pending ? "Sending…" : "Resend invite"}
        </Button>
        <div aria-live="polite" className="mt-3">
          {message ? (
            <Alert variant={message.ok ? "success" : "destructive"}>
              <AlertDescription data-testid="resend-invite-message">{message.text}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
