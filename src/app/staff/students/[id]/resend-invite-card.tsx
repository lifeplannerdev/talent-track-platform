"use client";

import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { resendInvite } from "../actions";

/** Emails the student a fresh link to choose a password (needs a contact email on the student). */
export function ResendInviteCard({ studentId, studentName, contactEmail }: { studentId: string; studentName: string; contactEmail: string | null }) {
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
        <p className="mb-3 text-sm" data-testid="invite-status">
          {contactEmail ? (
            <>Invites go to {contactEmail}. Whether the student has chosen a password is not tracked here.</>
          ) : (
            <>No contact email, so no invite can be sent. Add one under Details first.</>
          )}
        </p>
        <Button type="button" variant="outline" onClick={send} disabled={pending || !contactEmail}>
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
