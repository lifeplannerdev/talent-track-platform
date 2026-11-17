"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteStudent } from "../actions";

// Permanent erasure of a student (DPDP delete path). Staff type the username to confirm.
export function DeleteStudentForm({ studentId, studentName, username }: { studentId: string; studentName: string; username: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const matches = typed.trim().toLowerCase() === username;

  const submit = () =>
    startTransition(async () => {
      setError(null);
      try {
        const r = await deleteStudent(studentId, { confirmUsername: typed });
        if (r.ok) {
          setOpen(false);
          router.push("/staff/students");
        } else {
          setError(r.message);
        }
      } catch {
        setError("The student could not be deleted. Please try again.");
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delete student</CardTitle>
        <CardDescription>
          Permanently removes the account and all of the student&apos;s data: assignments, attempts, answers and results.
          Use this when a student asks for their data to be erased.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setTyped("");
            setError(null);
            setOpen(true);
          }}
        >
          Delete student
        </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {studentName}?</DialogTitle>
              <DialogDescription>
                This deletes the account and every attempt and result of this student. It cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <form
              action={submit}
              className="flex flex-col gap-3"
              aria-label="Confirm delete student"
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="delete-confirm">
                  Type the username <span className="font-semibold">{username}</span> to confirm
                </Label>
                <Input
                  id="delete-confirm"
                  autoComplete="off"
                  spellCheck={false}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                />
              </div>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription data-testid="delete-student-error">{error}</AlertDescription>
                </Alert>
              ) : null}
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                <Button type="submit" variant="destructive" disabled={pending || !matches}>
                  {pending ? "Deleting…" : "Delete permanently"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
