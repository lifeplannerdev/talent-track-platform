"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveCurriculum } from "./actions";

/** Create (no `id`) or rename a curriculum. */
export function CurriculumNameForm({ id, name = "", openAfterCreate = false }: { id?: string; name?: string; openAfterCreate?: boolean }) {
  const [value, setValue] = useState(name);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const inputId = id ? `curriculum-name-${id}` : "new-curriculum-name";

  const submit = () =>
    startTransition(async () => {
      setMessage(null);
      try {
        const r = await saveCurriculum(id ? { id, name: value } : { name: value });
        if (!r.ok) return setMessage({ ok: false, text: r.message });
        if (!id) {
          setValue("");
          if (openAfterCreate) router.push(`/staff/curriculums/${r.id}`);
        }
        setMessage({ ok: true, text: id ? "Name saved." : "Curriculum created." });
      } catch {
        setMessage({ ok: false, text: "The curriculum could not be saved. Please try again." });
      }
    });

  return (
    <form action={submit} className="flex flex-wrap items-end gap-3" aria-label={id ? "Rename curriculum" : "New curriculum"}>
      <div className="flex min-w-56 flex-1 flex-col gap-1.5">
        <Label htmlFor={inputId}>{id ? "Name" : "New curriculum"}</Label>
        <Input id={inputId} required maxLength={120} value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      <Button type="submit" variant={id ? "outline" : "default"} disabled={pending || !value.trim() || value.trim() === name}>
        {pending ? "Saving…" : id ? "Rename" : "Create curriculum"}
      </Button>
      <p aria-live="polite" role="status" className={`w-full text-sm ${message?.ok === false ? "text-destructive" : "text-muted-foreground"}`}>
        {message?.text}
      </p>
    </form>
  );
}
