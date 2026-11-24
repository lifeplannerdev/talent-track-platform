"use client";

import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { StudentDetails } from "@/lib/student-details";
import { saveStudentDetails } from "../details-actions";
import {
  ContactSection,
  CourseSection,
  NotesSection,
  PassportSection,
  detailsToValues,
  type DetailsKey,
} from "../student-details-fields";

/** Contact, passport and course details of one student, saved with saveStudentDetails (RLS decides who may). */
export function StudentDetailsCard({ studentId, studentName, details }: { studentId: string; studentName: string; details: StudentDetails | null }) {
  const [values, setValues] = useState(() => detailsToValues(details));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (key: DetailsKey) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const save = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        const r = await saveStudentDetails({ studentId, details: values });
        setMessage(r.ok ? { ok: true, text: "Details saved." } : { ok: false, text: r.message });
      } catch {
        setMessage({ ok: false, text: "The details could not be saved. Please try again." });
      }
    });

  return (
    <Card data-testid="student-details-card">
      <CardHeader>
        <CardTitle>Details</CardTitle>
        <CardDescription>
          {details
            ? `Contact, passport and course details of ${studentName}. Only an admin and the student's trainer can see them.`
            : `No details saved for ${studentName} yet. Add a contact email to save them and to send an invite.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={save} className="flex flex-col gap-5" aria-label="Student details">
          <ContactSection values={values} onChange={set} idPrefix="det" />
          <PassportSection values={values} onChange={set} idPrefix="det" />
          <CourseSection values={values} onChange={set} idPrefix="det" />
          <NotesSection values={values} onChange={set} idPrefix="det" />
          <div aria-live="polite">
            {message ? (
              <Alert variant={message.ok ? "success" : "destructive"}>
                <AlertDescription data-testid="details-message">{message.text}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save details"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
