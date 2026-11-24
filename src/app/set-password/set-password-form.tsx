"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setPasswordAction } from "./actions";

export function SetPasswordForm({ tokenHash }: { tokenHash: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    if (password !== confirm) {
      setError("The two passwords are not the same.");
      return;
    }
    setError(null);
    startTransition(async () => {
      // On success the action redirects to /login and never returns.
      const result = await setPasswordAction({ tokenHash, password });
      if (result && !result.ok) setError(result.message);
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          className="h-11"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "password-hint set-password-error" : "password-hint"}
        />
        <p id="password-hint" className="text-xs text-muted-foreground">
          At least 8 characters, and no space at the start or end.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">Repeat the password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required className="h-11" />
      </div>
      {error ? (
        <p id="set-password-error" role="alert" className="rounded-md bg-destructive-muted px-3 py-2 text-sm font-semibold text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving…" : "Save password"}
      </Button>
    </form>
  );
}
