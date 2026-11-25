"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { setBookPublished } from "../actions";

/** Publish or unpublish. Publishing uses the saved chapters; a book needs a chapter on page 1. */
export function PublishCard({
  curriculumId,
  status,
  hasFirstChapter,
}: {
  curriculumId: string;
  status: "draft" | "published";
  hasFirstChapter: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const published = status === "published";

  const change = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const r = await setBookPublished({ curriculumId, published: !published });
      if (r.ok) router.refresh();
      else setError(r.message);
    } catch {
      setError("The book could not be updated. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Publish</CardTitle>
        <CardDescription>
          {published
            ? "Students can read this book. Unpublish it to replace the PDF."
            : "Students cannot see this book yet. Publishing uses the chapters you have saved."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={published ? "success" : "warning"} data-testid="publish-status">
            {published ? "Published" : "Draft"}
          </Badge>
          <Button variant={published ? "outline" : "default"} onClick={() => void change()} disabled={pending || (!published && !hasFirstChapter)}>
            {pending ? "Working…" : published ? "Unpublish book" : "Publish book"}
          </Button>
        </div>
        {!published && !hasFirstChapter ? (
          <p className="text-sm text-muted-foreground">Save a chapter that starts on page 1 to publish.</p>
        ) : null}
        <div aria-live="polite">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription data-testid="publish-error">{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
