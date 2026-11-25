"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { FileUpIcon, LockIcon } from "lucide-react";
import { cn } from "cn";
import { convertPdf, PdfError, type ConvertedPage } from "@/lib/book/convert-pdf";
import { checkPdfFile } from "@/lib/book/limits";
import { putWithRetry } from "@/lib/book/upload-put";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants, Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { finishBookUpload, mintUploadUrls, startBookUpload } from "../actions";

const BATCH = 25;
const PARALLEL_PUTS = 6;

type Phase =
  | { kind: "idle" }
  | { kind: "converting"; done: number; total: number }
  | { kind: "uploading"; from: number; to: number; total: number }
  | { kind: "saving"; total: number };

async function uploadBatch(curriculumId: string, uploadId: string, batch: ConvertedPage[]) {
  const minted = await mintUploadUrls({ curriculumId, uploadId, pages: batch.map((p) => p.page) });
  if (!minted.ok) throw new UploadProblem(minted.message);
  const jobs = batch.flatMap((p) => {
    const m = minted.urls.find((u) => u.page === p.page);
    if (!m) throw new UploadProblem("Upload links could not be created. Please try again.");
    return [() => putWithRetry(m.imageUrl, p.image), () => putWithRetry(m.thumbUrl, p.thumb)];
  });
  for (let i = 0; i < jobs.length; i += PARALLEL_PUTS) {
    await Promise.all(jobs.slice(i, i + PARALLEL_PUTS).map((j) => j()));
  }
}

class UploadProblem extends Error {}

/**
 * Book card. Converts the PDF in the browser (one page at a time, so memory stays small), uploads
 * pages in batches of 25 through signed URLs and swaps the book in only when every page is there.
 * A failed or cancelled upload never changes the current book.
 */
export function BookUploader({
  curriculumId,
  book,
}: {
  curriculumId: string;
  book: { status: "draft" | "published"; pageCount: number } | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  // The picker stays disabled until the page is interactive, so a file chosen too early is not lost.
  const ready = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const busy = phase.kind !== "idle";
  const kept = book ? " The current book was not changed." : "";

  const run = async (file: File) => {
    setError(null);
    const problem = checkPdfFile(file);
    if (problem) {
      setError(problem + kept);
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    try {
      setPhase({ kind: "converting", done: 0, total: 0 });
      const started = await startBookUpload(curriculumId);
      if (!started.ok) throw new UploadProblem(started.message);
      const uploadId = started.uploadId;
      const done: { page: number; width: number; height: number }[] = [];
      let batch: ConvertedPage[] = [];
      let total = 0;
      const flush = async () => {
        if (batch.length === 0) return;
        setPhase({ kind: "uploading", from: batch[0].page, to: batch[batch.length - 1].page, total });
        await uploadBatch(curriculumId, uploadId, batch);
        for (const p of batch) done.push({ page: p.page, width: p.width, height: p.height });
        batch = [];
      };
      const pages = convertPdf(file, {
        signal: controller.signal,
        onProgress: (n, t) => {
          total = t;
          setPhase({ kind: "converting", done: n, total: t });
        },
      });
      for await (const p of pages) {
        batch.push(p);
        if (batch.length >= BATCH) await flush();
      }
      await flush();
      if (controller.signal.aborted) throw new DOMException("cancelled", "AbortError");
      setPhase({ kind: "saving", total });
      const finished = await finishBookUpload({ curriculumId, uploadId, pages: done });
      if (!finished.ok) throw new UploadProblem(finished.message);
      router.refresh();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") setError("Upload cancelled." + kept);
      else if (e instanceof PdfError) setError(e.message + kept);
      else if (e instanceof UploadProblem) setError(e.message + kept);
      else setError("The upload did not finish. Check your connection and choose the PDF again." + kept);
    } finally {
      abort.current = null;
      setPhase({ kind: "idle" });
      if (input.current) input.current.value = "";
    }
  };

  const choose = (files: FileList | null | undefined) => {
    const file = files?.[0];
    if (file && !busy) void run(file);
  };

  const fileInput = (
    <input
      ref={input}
      type="file"
      accept="application/pdf,.pdf"
      data-testid="book-file"
      className="peer sr-only"
      disabled={busy || !ready}
      onChange={(e) => choose(e.target.files)}
    />
  );
  const chooseLabel = (text: string, variant: "default" | "outline") => (
    <label
      className={cn(
        buttonVariants({ variant }),
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
        (busy || !ready) && "pointer-events-none opacity-50",
      )}
    >
      {fileInput}
      {text}
    </label>
  );

  const percent =
    phase.kind === "converting" && phase.total > 0
      ? Math.round((phase.done / phase.total) * 50)
      : phase.kind === "uploading"
        ? 50 + Math.round((phase.to / phase.total) * 50)
        : phase.kind === "saving"
          ? 100
          : 0;
  const statusText =
    phase.kind === "converting"
      ? phase.total === 0
        ? "Reading the PDF…"
        : `Converting page ${Math.min(phase.done + 1, phase.total)} of ${phase.total}`
      : phase.kind === "uploading"
        ? `Uploading pages ${phase.from} to ${phase.to} of ${phase.total}`
        : phase.kind === "saving"
          ? "Saving the book…"
          : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Book</CardTitle>
        <CardDescription>
          {book
            ? `${book.pageCount} ${book.pageCount === 1 ? "page" : "pages"}, ${book.status === "published" ? "published" : "draft"}.`
            : "Upload the curriculum book as a PDF. Pages are converted in your browser."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {busy ? (
          <div className="flex flex-col gap-3" data-testid="upload-progress">
            <p role="status" data-testid="upload-status" className="text-sm font-semibold">
              {statusText}
            </p>
            <div
              role="progressbar"
              aria-label="Upload progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="h-2 w-full overflow-hidden rounded-sm bg-muted"
            >
              <div className="h-full bg-primary transition-[width] duration-150" style={{ width: `${percent}%` }} />
            </div>
            <div>
              <Button variant="outline" onClick={() => abort.current?.abort()} disabled={phase.kind === "saving"}>
                Cancel
              </Button>
            </div>
          </div>
        ) : !book ? (
          <div
            data-testid="book-empty"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              choose(e.dataTransfer.files);
            }}
            className={cn(
              "flex flex-col items-center gap-3 rounded-lg border border-dashed border-input px-4 py-8 text-center transition-colors",
              dragging && "border-primary bg-secondary",
            )}
          >
            <FileUpIcon className="size-8 text-muted-foreground" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <p className="font-semibold">Drop a PDF here</p>
              <p className="text-sm text-muted-foreground">Up to 50 MB and 400 pages. Use a computer with Chrome, Edge or Firefox.</p>
            </div>
            {chooseLabel("Choose PDF", "default")}
          </div>
        ) : book.status === "draft" ? (
          <div className="flex flex-col gap-2">
            <div>{chooseLabel("Replace PDF", "outline")}</div>
            <p className="text-sm text-muted-foreground">
              Chapters stay as they are; any that start after the new last page are retired. If the upload fails
              or you cancel, the current book is kept.
            </p>
          </div>
        ) : (
          <p data-testid="replace-blocked" className="flex items-start gap-2 text-sm text-muted-foreground">
            <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Unpublish the book to replace the PDF. Use Unpublish book in the Publish card below.
          </p>
        )}
        <div aria-live="polite">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription data-testid="upload-error">{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
