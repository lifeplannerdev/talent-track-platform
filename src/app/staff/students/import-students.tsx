"use client";

import { useState, useTransition } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { importStudents, previewStudentsImport, type ImportPreview, type ImportStudentsResult } from "./actions";
import { linkClass } from "./ui";

const TEMPLATE = "username,full_name,batch,track,password\r\n";
const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`;

// The CSV text (which contains first passwords) stays in this component's state and is sent only
// to the server actions, which process it in memory. Previews and results never contain passwords.
export function ImportStudents() {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportStudentsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const changeCsv = (text: string) => {
    setCsv(text);
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    changeCsv(await file.text());
  };

  const check = () =>
    startTransition(async () => {
      setError(null);
      setResult(null);
      try {
        const r = await previewStudentsImport(csv);
        if (r.ok) setPreview(r);
        else setError(r.message);
      } catch {
        setError("The file could not be checked. Please try again.");
      }
    });

  const create = () =>
    startTransition(async () => {
      setError(null);
      try {
        const r = await importStudents(csv);
        setResult(r);
        if (r.ok && r.failed.length === 0) {
          setCsv("");
          setPreview(null);
        }
      } catch {
        setError("The import could not be finished. Check the students list before trying again.");
      }
    });

  const canCreate = preview !== null && preview.errors.length === 0 && preview.rows.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import CSV</CardTitle>
        <CardDescription>
          Columns: username, full_name, batch, track (nursing or other), password. Check the file first; nothing is created
          until every row is valid.{" "}
          <a href={TEMPLATE_HREF} download="students-template.csv" className={linkClass}>
            Download template
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="students-file">CSV file</Label>
          <Input id="students-file" type="file" accept=".csv,text/csv" onChange={(e) => readFile(e.target.files?.[0])} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="students-csv">Or paste the CSV</Label>
          <Textarea
            id="students-csv"
            rows={5}
            value={csv}
            onChange={(e) => changeCsv(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            className="font-mono text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={check} disabled={pending || !csv.trim()}>
            {pending && !preview ? "Checking…" : "Check file"}
          </Button>
          <Button type="button" onClick={create} disabled={pending || !canCreate}>
            {pending && preview ? "Creating…" : canCreate ? `Create ${preview.rows.length} student${preview.rows.length === 1 ? "" : "s"}` : "Create students"}
          </Button>
        </div>

        <div aria-live="polite" className="flex flex-col gap-3">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {preview && !result ? (
            preview.errors.length > 0 ? (
              <Alert variant="destructive" data-testid="students-import-errors">
                <AlertTitle>
                  {preview.errors.length} row{preview.errors.length === 1 ? " has" : "s have"} errors. Nothing will be created.
                </AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {preview.errors.map((e) => (
                      <li key={`${e.row}:${e.message}`}>{e.row === 0 ? e.message : `Row ${e.row}: ${e.message}`}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : (
              <p className="text-sm" data-testid="students-import-ready">
                {preview.rows.length} student{preview.rows.length === 1 ? "" : "s"} ready to create.
              </p>
            )
          ) : null}

          {preview && preview.rows.length > 0 && !result ? (
            <Table className="min-w-[28rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>Row</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Track</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((r) => (
                  <TableRow key={r.row}>
                    <TableCell className="tabular-nums">{r.row}</TableCell>
                    <TableCell>{r.username}</TableCell>
                    <TableCell>{r.fullName}</TableCell>
                    <TableCell>{r.batch || "–"}</TableCell>
                    <TableCell>{r.track}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}

          {result ? (
            result.ok ? (
              <Alert variant={result.failed.length > 0 ? "destructive" : "success"} data-testid="students-import-result">
                <AlertTitle>
                  Created {result.created.length} student{result.created.length === 1 ? "" : "s"}
                  {result.failed.length > 0 ? `; ${result.failed.length} could not be created` : "."}
                </AlertTitle>
                {result.failed.length > 0 ? (
                  <AlertDescription>
                    <ul className="list-disc pl-4">
                      {result.failed.map((f) => (
                        <li key={f.row}>
                          Row {f.row} ({f.username}): {f.message}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2">
                      The other rows were created. To finish, import a file that contains only the failed rows. Running
                      the same file again creates nothing: the students already created are reported as taken.
                    </p>
                  </AlertDescription>
                ) : null}
              </Alert>
            ) : (
              <Alert variant="destructive">
                <AlertTitle>{result.message}</AlertTitle>
                {result.errors.length > 0 ? (
                  <AlertDescription>
                    <ul className="list-disc pl-4">
                      {result.errors.map((e) => (
                        <li key={`${e.row}:${e.message}`}>{e.row === 0 ? e.message : `Row ${e.row}: ${e.message}`}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                ) : null}
              </Alert>
            )
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
