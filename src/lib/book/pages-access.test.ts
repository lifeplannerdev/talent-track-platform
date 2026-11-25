// Integration tests for student book page access. They run against the LOCAL Supabase stack with
// the service role, using throwaway users, curriculums and files that are removed in afterAll.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getChapterForReading, listLearningPaths } from "./pages-access";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const run = randomUUID().slice(0, 8);
const userIds: string[] = [];
const curriculumIds: string[] = [];
const objectPaths: string[] = [];
const BUCKET = "book-pages";
const NOT_FOUND = { ok: false, reason: "not_found" };

async function ok(p: PromiseLike<{ error: unknown }>): Promise<void> {
  const { error } = await p;
  if (error) throw error;
}

async function makeCurriculum(label: string): Promise<string> {
  const { data, error } = await db.from("curriculums").insert({ name: `T6 ${run} ${label}` }).select("id").single();
  if (error) throw error;
  curriculumIds.push(data.id);
  return data.id as string;
}

async function makeBook(
  curriculumId: string,
  opts: { status: "draft" | "published"; pages: number; chapters: { title: string; start: number | null; archived?: boolean }[] },
) {
  const uploadId = randomUUID();
  await ok(db.from("books").insert({ curriculum_id: curriculumId, status: opts.status, page_count: opts.pages, upload_id: uploadId }));
  const pages = [];
  for (let n = 1; n <= opts.pages; n++) {
    const path = `${curriculumId}/${uploadId}/${n}.webp`;
    const thumb = `${curriculumId}/${uploadId}/${n}.thumb.webp`;
    for (const p of [path, thumb]) {
      await ok(db.storage.from(BUCKET).upload(p, new Blob([`img ${p}`], { type: "image/webp" }), { contentType: "image/webp" }));
      objectPaths.push(p);
    }
    pages.push({ curriculum_id: curriculumId, page_number: n, path, thumb_path: thumb, width: 600 + n, height: 800 + n });
  }
  await ok(db.from("book_pages").insert(pages));
  const rows = opts.chapters.map((c) =>
    c.archived
      ? { curriculum_id: curriculumId, title: c.title, start_page: null, archived_at: new Date().toISOString(), retired_start_page: c.start }
      : { curriculum_id: curriculumId, title: c.title, start_page: c.start },
  );
  const { data, error } = await db.from("chapters").insert(rows).select("id, title");
  if (error) throw error;
  return new Map((data ?? []).map((c) => [c.title as string, c.id as string]));
}

let studentCounter = 0;
async function makeStudent(...curriculums: string[]): Promise<string> {
  studentCounter += 1;
  const username = `t6.${run}.${studentCounter}`;
  const { data, error } = await db.auth.admin.createUser({
    email: `${username}@students.test`,
    password: randomUUID(),
    email_confirm: true,
    app_metadata: { role: "student", username, full_name: `T6 Student ${studentCounter}` },
  });
  if (error) throw error;
  userIds.push(data.user.id);
  if (curriculums.length) {
    await ok(
      db.from("assignments").insert(curriculums.map((c, i) => ({ student_id: data.user.id, curriculum_id: c, position: i + 1 }))),
    );
  }
  return data.user.id;
}

let cA: string; // published, 3 active chapters + 1 archived, 6 pages
let cB: string; // published, other curriculum
let cDraft: string;
let cEmpty: string; // published but every chapter archived
let chA: Map<string, string>;
let chB: Map<string, string>;
let chDraft: Map<string, string>;
let student: string;
let outsider: string;

beforeAll(async () => {
  cA = await makeCurriculum("A");
  cB = await makeCurriculum("B");
  cDraft = await makeCurriculum("Draft");
  cEmpty = await makeCurriculum("Empty");
  chA = await makeBook(cA, {
    status: "published",
    pages: 6,
    chapters: [
      { title: "One", start: 1 },
      { title: "Two", start: 3 },
      { title: "Three", start: 5 },
      { title: "Old", start: 4, archived: true },
    ],
  });
  chB = await makeBook(cB, { status: "published", pages: 2, chapters: [{ title: "B One", start: 1 }] });
  chDraft = await makeBook(cDraft, { status: "draft", pages: 2, chapters: [{ title: "D One", start: 1 }] });
  await makeBook(cEmpty, { status: "published", pages: 2, chapters: [{ title: "Gone", start: 1, archived: true }] });
  // Positions: cB first, then cDraft, cEmpty, cA last (list order follows position).
  student = await makeStudent(cB, cDraft, cEmpty, cA);
  outsider = await makeStudent();
});

afterAll(async () => {
  if (objectPaths.length) await db.storage.from(BUCKET).remove(objectPaths);
  if (curriculumIds.length) await db.from("curriculums").delete().in("id", curriculumIds);
  for (const id of userIds) await db.auth.admin.deleteUser(id);
});

describe("getChapterForReading", () => {
  it("returns the chapter's pages with signed urls that fetch", async () => {
    const r = await getChapterForReading(student, cA, chA.get("Two")!);
    if (!r.ok) throw new Error("expected ok");
    expect(r.curriculumName).toBe(`T6 ${run} A`);
    expect(r.chapterTitle).toBe("Two");
    expect(r.chapterIndex).toBe(1);
    expect(r.chapterCount).toBe(3);
    expect(r.pages.map((p) => p.page)).toEqual([3, 4]);
    expect(r.pages[0]).toMatchObject({ width: 603, height: 803 });
    expect(r.prev).toEqual({ chapterId: chA.get("One") });
    expect(r.next).toEqual({ chapterId: chA.get("Three") });
    for (const p of r.pages) {
      expect((await fetch(p.url)).status).toBe(200);
      expect((await fetch(p.thumbUrl)).status).toBe(200);
    }
    // A guessed path without a signature fails.
    const bare = r.pages[0].url.split("?")[0];
    expect((await fetch(bare)).status).not.toBe(200);
    const [{ path: otherPath }] = (await db.from("book_pages").select("path").eq("curriculum_id", cA).eq("page_number", 1)).data!;
    const guessed = bare.replace(/\/object\/sign\/book-pages\/.*$/, `/object/sign/book-pages/${otherPath}`);
    expect((await fetch(guessed)).status).not.toBe(200);
  });

  it("ends the last chapter at the book's page count and has no neighbour past the ends", async () => {
    const first = await getChapterForReading(student, cA, chA.get("One")!);
    const last = await getChapterForReading(student, cA, chA.get("Three")!);
    if (!first.ok || !last.ok) throw new Error("expected ok");
    expect(first.prev).toBeNull();
    expect(first.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(last.next).toBeNull();
    expect(last.pages.map((p) => p.page)).toEqual([5, 6]);
  });

  it("refuses everything else with the same not_found and no extra fields", async () => {
    const archivedId = (await db.from("chapters").select("id").eq("curriculum_id", cA).not("archived_at", "is", null)).data![0].id;
    const cases: [string, string, string, string][] = [
      ["unassigned student", outsider, cA, chA.get("One")!],
      ["unpublished book", student, cDraft, chDraft.get("D One")!],
      ["chapter of another curriculum", student, cA, chB.get("B One")!],
      ["archived chapter", student, cA, archivedId],
      ["nonexistent id", student, cA, randomUUID()],
      ["malformed chapter id", student, cA, "not-a-uuid"],
      ["malformed curriculum id", student, "nope", chA.get("One")!],
      ["malformed student id", "x", cA, chA.get("One")!],
    ];
    for (const [label, s, c, ch] of cases) {
      const r = await getChapterForReading(s, c, ch);
      expect(r, label).toStrictEqual(NOT_FOUND);
    }
  });

  it("refuses a chapter again once the book goes back to draft", async () => {
    await ok(db.from("books").update({ status: "draft" }).eq("curriculum_id", cB));
    const s = await makeStudent(cB);
    expect(await getChapterForReading(s, cB, chB.get("B One")!)).toStrictEqual(NOT_FOUND);
    await ok(db.from("books").update({ status: "published" }).eq("curriculum_id", cB));
    expect((await getChapterForReading(s, cB, chB.get("B One")!)).ok).toBe(true);
  });

  it("refuses a url after its lifetime (injectable ttl)", async () => {
    const r = await getChapterForReading(student, cA, chA.get("One")!, { ttlSeconds: 3 });
    if (!r.ok) throw new Error("expected ok");
    // The token's expiry has second granularity: with 3 s the first fetch is always still inside it.
    expect((await fetch(r.pages[0].url)).status).toBe(200);
    await new Promise((res) => setTimeout(res, 5000));
    expect((await fetch(r.pages[0].url)).status).not.toBe(200);
  }, 20_000);
});

describe("listLearningPaths", () => {
  it("lists only assigned, published books with active chapters, in position order", async () => {
    const paths = await listLearningPaths(student);
    expect(paths.map((p) => p.curriculumId)).toEqual([cB, cA]);
    const a = paths[1];
    expect(a.name).toBe(`T6 ${run} A`);
    expect(a.chapters).toEqual([
      { id: chA.get("One"), title: "One", startPage: 1, endPage: 2, pageCount: 2 },
      { id: chA.get("Two"), title: "Two", startPage: 3, endPage: 4, pageCount: 2 },
      { id: chA.get("Three"), title: "Three", startPage: 5, endPage: 6, pageCount: 2 },
    ]);
  });

  it("is empty for a student with no assignments or a malformed id", async () => {
    expect(await listLearningPaths(outsider)).toEqual([]);
    expect(await listLearningPaths("nope")).toEqual([]);
  });
});
