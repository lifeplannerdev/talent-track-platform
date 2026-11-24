"use client";

import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { reassignStudents, resendTrainerInvite, setTrainerActive } from "./actions";

type Message = { ok: boolean; text: string };

/** The admin controls of one trainer row (each action checks requireAdmin again on the server). */
export function TrainerActions({
  trainerId,
  name,
  active,
  students,
  targets,
}: {
  trainerId: string;
  name: string;
  active: boolean;
  students: number;
  /** Other active trainers the students can move to. */
  targets: { id: string; name: string }[];
}) {
  const [message, setMessage] = useState<Message | null>(null);
  const [target, setTarget] = useState("");
  const [pending, startTransition] = useTransition();

  const run = (job: () => Promise<Message>, fallback: string) =>
    startTransition(async () => {
      setMessage(null);
      try {
        setMessage(await job());
      } catch {
        setMessage({ ok: false, text: fallback });
      }
    });

  const resend = () =>
    run(async () => {
      const r = await resendTrainerInvite(trainerId);
      return r.ok ? { ok: true, text: `Invite sent to ${name}.` } : { ok: false, text: r.message };
    }, "The invite could not be sent. Please try again.");

  const toggle = () =>
    run(async () => {
      const r = await setTrainerActive(trainerId, !active);
      return r.ok ? { ok: true, text: active ? `${name} deactivated.` : `${name} reactivated.` } : { ok: false, text: r.message };
    }, "The change could not be saved. Please try again.");

  const reassign = () =>
    run(async () => {
      const r = await reassignStudents({ fromTrainerId: trainerId, toTrainerId: target });
      if (!r.ok) return { ok: false, text: r.message };
      setTarget("");
      return { ok: true, text: `${r.moved} student${r.moved === 1 ? "" : "s"} moved.` };
    }, "The students could not be reassigned. Please try again.");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {active ? (
          <Button type="button" variant="outline" size="sm" onClick={resend} disabled={pending}>
            Resend invite<span className="sr-only"> to {name}</span>
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={toggle} disabled={pending || (active && students > 0)}>
          {active ? "Deactivate" : "Reactivate"}
          <span className="sr-only"> {name}</span>
        </Button>
      </div>
      {students > 0 ? (
        <form action={reassign} className="flex flex-wrap items-center gap-2" aria-label={`Reassign students of ${name}`}>
          <NativeSelect
            aria-label={`Move the students of ${name} to`}
            data-testid="reassign-select"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-44"
            disabled={targets.length === 0}
          >
            <NativeSelectOption value="">{targets.length === 0 ? "No other trainer" : "Move to…"}</NativeSelectOption>
            {targets.map((t) => (
              <NativeSelectOption key={t.id} value={t.id}>
                {t.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button type="submit" variant="outline" size="sm" disabled={pending || !target}>
            Reassign students
          </Button>
        </form>
      ) : null}
      <div aria-live="polite">
        {message ? (
          <Alert variant={message.ok ? "success" : "destructive"}>
            <AlertDescription data-testid="trainer-action-message">{message.text}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </div>
  );
}
