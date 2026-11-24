"use client";

import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { assignTrainer } from "../details-actions";

/** Admin only (the page renders it for an admin; assignTrainer checks again): who the student's trainer is. */
export function TrainerCard({
  studentId,
  studentName,
  trainerId,
  trainers,
}: {
  studentId: string;
  studentName: string;
  trainerId: string | null;
  trainers: { id: string; name: string }[];
}) {
  const [value, setValue] = useState(trainerId ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        const r = await assignTrainer({ studentId, trainerId: value || null });
        setMessage({ ok: r.ok, text: r.message });
      } catch {
        setMessage({ ok: false, text: "The trainer could not be changed. Please try again." });
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trainer</CardTitle>
        <CardDescription>Only the trainer and admins can see {studentName}. Changing it takes effect at once.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={save} className="flex flex-wrap items-end gap-3" aria-label="Trainer">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="student-trainer">Trainer</Label>
            <NativeSelect id="student-trainer" data-testid="trainer-select" value={value} onChange={(e) => setValue(e.target.value)} className="w-full sm:w-72">
              <NativeSelectOption value="">No trainer</NativeSelectOption>
              {trainers.map((t) => (
                <NativeSelectOption key={t.id} value={t.id}>
                  {t.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? "Saving…" : "Save trainer"}
          </Button>
        </form>
        <div aria-live="polite" className="mt-3">
          {message ? (
            <Alert variant={message.ok ? "success" : "destructive"}>
              <AlertDescription data-testid="trainer-message">{message.text}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
