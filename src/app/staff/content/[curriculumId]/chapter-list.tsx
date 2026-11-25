"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2Icon } from "lucide-react";
import {
  adoptServerIds,
  checkRows,
  isDirty,
  rowsFromServer,
  sortRows,
  toggleMarker,
  type ChapterRow,
} from "@/lib/book/chapter-editor";
import { MAX_CHAPTER_TITLE_LENGTH } from "@/lib/book/chapters";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveChapterStarts } from "../actions";
import { ChapterStrip, type StripPage } from "./chapter-strip";

/**
 * Chapters card: the page strip, one row per chapter (title, start page, live range) and Save.
 * Existing chapters keep their id with every save; a removed row is left out and the server
 * retires it, so history stays. The list shows active chapters only.
 */
export function ChaptersCard({
  curriculumId,
  pageCount,
  pages,
  chapters,
}: {
  curriculumId: string;
  pageCount: number;
  pages: StripPage[];
  chapters: { id: string; title: string; startPage: number }[];
}) {
  const router = useRouter();
  const [initial, setInitial] = useState(() => rowsFromServer(chapters));
  const [rows, setRows] = useState<ChapterRow[]>(initial);
  // After a save the page refreshes with the server's chapters (new ones now have ids): adopt them.
  const serverSignature = JSON.stringify(chapters);
  const [seen, setSeen] = useState(serverSignature);
  // Edits typed while the refresh was on its way are kept; their rows take the new ids.
  const [syncing, setSyncing] = useState(false);
  if (serverSignature !== seen) {
    const fromServer = rowsFromServer(chapters);
    setSeen(serverSignature);
    setRows(
      isDirty(initial, rows) ? adoptServerIds(rows, chapters) : fromServer,
    );
    setInitial(fromServer);
    setSyncing(false);
  }
  // A save is only final for the editor once the server's chapters (with ids) are back.

  useEffect(() => {
    if (!syncing) return;
    const timer = setInterval(() => router.refresh(), 4000);
    const giveUp = setTimeout(() => setSyncing(false), 20000);
    return () => {
      clearInterval(timer);
      clearTimeout(giveUp);
    };
  }, [syncing, router]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const counter = useRef(0);

  const checked = checkRows(rows, pageCount);
  const dirty = isDirty(initial, rows);
  const ranges = checked.ok ? checked.ranges : [];
  const touched = () => {
    setSaved(false);
    setError(null);
  };

  const update = (key: string, patch: Partial<ChapterRow>) => {
    touched();
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const rangeOf = (key: string) => {
    if (!checked.ok) return null;
    const row = rows.find((r) => r.key === key);
    return ranges.find((r) => r.startPage === row?.startPage) ?? null;
  };

  const save = async () => {
    if (!checked.ok || pending) return;
    setPending(true);
    setError(null);
    try {
      const r = await saveChapterStarts({
        curriculumId,
        chapters: checked.chapters,
      });
      if (r.ok) {
        setSaved(true);
        setSyncing(true);
        router.refresh();
      } else {
        setError(r.message);
      }
    } catch {
      setError("The chapters could not be saved. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chapters</CardTitle>
        <CardDescription>
          Choose Start here under the page where each chapter begins. The first
          chapter must start on page 1. A chapter runs until the next one
          starts.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Locked for the moment between a save and the server's ids coming back, so a move cannot be mistaken for a new chapter. */}
        <fieldset
          disabled={syncing}
          className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
        >
          <ChapterStrip
            pages={pages}
            ranges={ranges}
            onToggle={(page) => {
              touched();
              setRows((rs) =>
                toggleMarker(rs, page, `new-${counter.current++}`),
              );
            }}
          />

          {rows.length === 0 ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="chapters-empty"
            >
              No chapters yet. Start with page 1.
            </p>
          ) : (
            <ol className="flex flex-col gap-3" aria-label="Chapters">
              {rows.map((r, i) => {
                const range = rangeOf(r.key);
                return (
                  <li
                    key={r.key}
                    data-testid="chapter-row"
                    className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_7rem_auto] sm:items-end"
                  >
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`title-${r.key}`}>
                        Title of chapter {i + 1}
                      </Label>
                      <Input
                        id={`title-${r.key}`}
                        value={r.title}
                        maxLength={MAX_CHAPTER_TITLE_LENGTH + 20}
                        autoComplete="off"
                        onChange={(e) =>
                          update(r.key, { title: e.target.value })
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`start-${r.key}`}>
                        Start page of chapter {i + 1}
                      </Label>
                      <Input
                        id={`start-${r.key}`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={pageCount}
                        value={r.startPage ?? ""}
                        onChange={(e) =>
                          update(r.key, {
                            startPage:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          })
                        }
                        onBlur={() => setRows((rs) => sortRows(rs))}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={`Remove chapter ${i + 1}`}
                      onClick={() => {
                        touched();
                        setRows((rs) => rs.filter((x) => x.key !== r.key));
                      }}
                    >
                      <Trash2Icon aria-hidden="true" />
                    </Button>
                    <p
                      data-testid="chapter-range"
                      className="text-sm text-muted-foreground sm:col-span-3"
                    >
                      {range
                        ? `Pages ${range.startPage}–${range.endPage} (${range.pageCount} ${range.pageCount === 1 ? "page" : "pages"})`
                        : "Pages: fix the problem below"}
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </fieldset>

        <div className="flex flex-col gap-3">
          {!checked.ok && rows.length > 0 ? (
            <p
              role="status"
              data-testid="chapter-validation"
              className="text-sm font-semibold text-warning"
            >
              {checked.message}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void save()}
              disabled={pending || syncing || !checked.ok || !dirty}
            >
              {pending || syncing ? "Saving…" : "Save chapters"}
            </Button>
            {dirty && checked.ok ? (
              <span className="text-sm text-muted-foreground">
                Unsaved changes
              </span>
            ) : null}
          </div>
          <div aria-live="polite" className="flex flex-col gap-2">
            {error ? (
              <Alert variant="destructive">
                <AlertDescription data-testid="chapters-error">
                  {error}
                </AlertDescription>
              </Alert>
            ) : null}
            {saved && !error ? (
              <Alert variant="success">
                <AlertDescription data-testid="chapters-saved">
                  Chapters saved.
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
