// Integration tests for the book authoring actions and readers against the LOCAL Supabase stack.
// Sessions are real (password sign-in with the anon key); only the Next.js plumbing is replaced.
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => session.client }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { usernameToEmail } from "@/lib/auth/username";
import { BOOK_BUCKET } from "@/lib/book/storage";
import { cleanupOldUploads } from "@/lib/book/cleanup";
import { getBookForEditor, listContent } from "@/lib/book/read";
import {
  finishBookUpload,
  mintUploadUrls,
  saveChapterStarts,
  setBookPublished,
  startBookUpload,
} from "./actions";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const db = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const bucket = db.storage.from(BOOK_BUCKET);

// A 1x1 lossless WebP.
const WEBP = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");

const run = randomUUID().slice(0, 8);
const prefix = `c4.${run}`;
const userIds: string[] = [];
const curriculumIds: string[] = [];
let counter = 0;

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

async function makeUser(role: "admin" | "trainer" | "student") {
  counter += 1;
  const username = `${prefix}.${role}${counter}`;
  const email = role === "student" ? usernameToEmail(username) : `${username}@staff.test`;
  const password = `test-${randomUUID()}`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role, username, full_name: `C4 ${role} ${counter}` },
  });
  if (error) throw error;
  userIds.push(data.user.id);
  return { id: data.user.id, client: await signIn(email, password) };
}

async function makeCurriculum(name = `C4 ${run} ${++counter}`) {
  const { data, error } = await db.from("curriculums").insert({ name }).select("id").single();
  if (error) throw error;
  curriculumIds.push(data.id);
  return data.id as string;
}

/** Puts real files in Storage for pages 1..n under an upload id and returns the finish input. */
async function stageUpload(curriculumId: string, n: number, uploadId = randomUUID()) {
  for (let p = 1; p <= n; p++) {
    for (const name of [`${p}.webp`, `${p}.thumb.webp`]) {
      const { error } = await bucket.upload(`${curriculumId}/${uploadId}/${name}`, WEBP, { contentType: "image/webp" });
      if (error) throw error;
    }
  }
  return { curriculumId, uploadId, pages: Array.from({ length: n }, (_, i) => ({ page: i + 1, width: 800, height: 1100 })) };
}

async function filesOf(curriculumId: string, uploadId: string) {
  const { data } = await bucket.list(`${curriculumId}/${uploadId}`, { limit: 1000 });
  return (data ?? []).map((f) => f.name);
}

async function chaptersOf(curriculumId: string) {
  const { data } = await db.from("chapters").select("id, title, start_page, archived_at, retired_start_page").eq("curriculum_id", curriculumId).order("title");
  return data ?? [];
}

let admin: Awaited<ReturnType<typeof makeUser>>;
let trainer: Awaited<ReturnType<typeof makeUser>>;
let student: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  admin = await makeUser("admin");
  trainer = await makeUser("trainer");
  student = await makeUser("student");
});

afterAll(async () => {
  for (const id of curriculumIds) {
    const { data } = await bucket.list(id, { limit: 1000 });
    for (const folder of data ?? []) {
      const { data: files } = await bucket.list(`${id}/${folder.name}`, { limit: 1000 });
      await bucket.remove((files ?? []).map((f) => `${id}/${folder.name}/${f.name}`));
    }
    await db.from("curriculums").delete().eq("id", id);
  }
  for (const id of userIds) await db.auth.admin.deleteUser(id);
});

beforeEach(() => {
  session.client = admin.client;
});

describe("admin only", () => {
  it.each([["trainer"], ["student"]] as const)("a %s is redirected from every action and nothing is written", async (who) => {
    const cid = await makeCurriculum();
    const staged = await stageUpload(cid, 1);
    session.client = who === "trainer" ? trainer.client : student.client;
    const redirect = who === "trainer" ? "REDIRECT /staff" : "REDIRECT /exam/start";
    await expect(startBookUpload(cid)).rejects.toThrow(redirect);
    await expect(mintUploadUrls({ curriculumId: cid, uploadId: randomUUID(), pages: [1] })).rejects.toThrow(redirect);
    await expect(finishBookUpload(staged)).rejects.toThrow(redirect);
    await expect(saveChapterStarts({ curriculumId: cid, chapters: [{ title: "A", startPage: 1 }] })).rejects.toThrow(redirect);
    await expect(setBookPublished({ curriculumId: cid, published: true })).rejects.toThrow(redirect);
    expect((await db.from("books").select("curriculum_id").eq("curriculum_id", cid)).data).toEqual([]);
    expect((await db.from("chapters").select("id").eq("curriculum_id", cid)).data).toEqual([]);
    const { data: folders } = await bucket.list(cid, { limit: 100 });
    expect(folders!.map((f) => f.name)).toEqual([staged.uploadId]); // only the pre-staged one: nothing created or removed
    expect(await filesOf(cid, staged.uploadId)).toHaveLength(2);
  });
});

describe("startBookUpload and mintUploadUrls", () => {
  it("startBookUpload returns an upload id and refuses a published book", async () => {
    const cid = await makeCurriculum();
    const first = await startBookUpload(cid);
    expect(first.ok && first.uploadId).toMatch(/^[0-9a-f-]{36}$/);
    await finishBookUpload(await stageUpload(cid, 1));
    await saveChapterStarts({ curriculumId: cid, chapters: [{ title: "One", startPage: 1 }] });
    expect(await setBookPublished({ curriculumId: cid, published: true })).toEqual({ ok: true });
    expect(await startBookUpload(cid)).toEqual({ ok: false, message: "Unpublish the book before replacing the PDF" + "." });
    expect(await mintUploadUrls({ curriculumId: cid, uploadId: randomUUID(), pages: [1] })).toMatchObject({ ok: false });
  });

  it("refuses more than 25 pages and page numbers outside 1..400", async () => {
    const cid = await makeCurriculum();
    const uploadId = randomUUID();
    const many = Array.from({ length: 26 }, (_, i) => i + 1);
    expect(await mintUploadUrls({ curriculumId: cid, uploadId, pages: many })).toMatchObject({ ok: false });
    for (const bad of [[0], [401], [1.5], [-1], [1, 1]]) {
      expect(await mintUploadUrls({ curriculumId: cid, uploadId, pages: bad })).toMatchObject({ ok: false });
    }
    expect(await mintUploadUrls({ curriculumId: cid, uploadId, pages: [] })).toMatchObject({ ok: false });
    const ok = await mintUploadUrls({ curriculumId: cid, uploadId, pages: Array.from({ length: 25 }, (_, i) => i + 1) });
    expect(ok.ok && ok.urls).toHaveLength(25);
  });

  it("mints paths in the right shape and the signed URL accepts webp and rejects other types", async () => {
    const cid = await makeCurriculum();
    const uploadId = randomUUID();
    const res = await mintUploadUrls({ curriculumId: cid, uploadId, pages: [3] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const u = res.urls[0];
    expect(u.imagePath).toBe(`${cid}/${uploadId}/3.webp`);
    expect(u.thumbPath).toBe(`${cid}/${uploadId}/3.thumb.webp`);
    const good = await fetch(u.imageUrl, { method: "PUT", headers: { "content-type": "image/webp" }, body: WEBP });
    expect(good.status).toBe(200);
    expect(await filesOf(cid, uploadId)).toContain("3.webp");
    const bad = await fetch(u.thumbUrl, { method: "PUT", headers: { "content-type": "text/plain" }, body: "not an image" });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(await filesOf(cid, uploadId)).not.toContain("3.thumb.webp");
  });
});

describe("finishBookUpload", () => {
  it("swaps pages atomically, removes the previous upload, keeps young abandoned ones, chapter titles", async () => {
    const cid = await makeCurriculum();
    const first = await stageUpload(cid, 3);
    expect(await finishBookUpload(first)).toEqual({ ok: true });
    expect((await db.from("book_pages").select("page_number").eq("curriculum_id", cid)).data).toHaveLength(3);
    await saveChapterStarts({ curriculumId: cid, chapters: [{ title: "A", startPage: 1 }, { title: "B", startPage: 3 }] });

    const abandoned = await stageUpload(cid, 2); // never finished
    const second = await stageUpload(cid, 2);
    // Old pages stay readable until the call.
    expect(await filesOf(cid, first.uploadId)).toHaveLength(6);
    expect(await finishBookUpload(second)).toEqual({ ok: true });

    expect(await filesOf(cid, first.uploadId)).toEqual([]);
    expect(await filesOf(cid, abandoned.uploadId)).toHaveLength(4); // young: kept (another admin may be uploading)
    expect(await filesOf(cid, second.uploadId)).toHaveLength(4);
    const { data: pages } = await db.from("book_pages").select("path").eq("curriculum_id", cid);
    expect(pages).toHaveLength(2);
    expect(pages!.every((p) => p.path.includes(second.uploadId))).toBe(true);
    // Chapter B started on page 3 (beyond 2 pages): retired, not deleted.
    const chapters = await chaptersOf(cid);
    expect(chapters).toHaveLength(2);
    expect(chapters.find((c) => c.title === "B")).toMatchObject({ start_page: null, retired_start_page: 3 });
    expect(chapters.find((c) => c.title === "A")).toMatchObject({ start_page: 1, archived_at: null });
  });

  it("a failed finalize leaves the old book and its files intact", async () => {
    const cid = await makeCurriculum();
    const first = await stageUpload(cid, 2);
    await finishBookUpload(first);
    const second = await stageUpload(cid, 2);
    await saveChapterStarts({ curriculumId: cid, chapters: [{ title: "A", startPage: 1 }] });
    await setBookPublished({ curriculumId: cid, published: true });
    const res = await finishBookUpload(second); // book_published
    expect(res).toEqual({ ok: false, message: "Unpublish the book before replacing the PDF." });
    expect((await db.from("book_pages").select("path").eq("curriculum_id", cid)).data!.every((p) => p.path.includes(first.uploadId))).toBe(true);
    expect(await filesOf(cid, first.uploadId)).toHaveLength(4);
    expect(await filesOf(cid, second.uploadId)).toHaveLength(4);
  });

  it("refuses pages that were never uploaded, zero pages and too many pages", async () => {
    const cid = await makeCurriculum();
    const staged = await stageUpload(cid, 1);
    expect(await finishBookUpload({ ...staged, pages: [...staged.pages, { page: 2, width: 1, height: 1 }] })).toMatchObject({ ok: false });
    expect(await finishBookUpload({ ...staged, pages: [] })).toMatchObject({ ok: false });
    expect(await finishBookUpload({ ...staged, pages: Array.from({ length: 401 }, (_, i) => ({ page: i + 1, width: 1, height: 1 })) })).toMatchObject({ ok: false });
    expect((await db.from("books").select("curriculum_id").eq("curriculum_id", cid)).data).toEqual([]);
  });

  it("maps a missing curriculum and bad dimensions to friendly messages", async () => {
    const ghost = randomUUID();
    const up = randomUUID();
    await bucket.upload(`${ghost}/${up}/1.webp`, WEBP, { contentType: "image/webp" });
    await bucket.upload(`${ghost}/${up}/1.thumb.webp`, WEBP, { contentType: "image/webp" });
    const res = await finishBookUpload({ curriculumId: ghost, uploadId: up, pages: [{ page: 1, width: 1, height: 1 }] });
    expect(res).toEqual({ ok: false, message: "This curriculum no longer exists." });
    await bucket.remove([`${ghost}/${up}/1.webp`, `${ghost}/${up}/1.thumb.webp`]);
    const cid = await makeCurriculum();
    const staged = await stageUpload(cid, 1);
    const bad = await finishBookUpload({ ...staged, pages: [{ page: 1, width: 0, height: 5 }] });
    expect(bad).toEqual({ ok: false, message: "The uploaded pages are not valid. Choose the PDF again." });
  });
});

describe("cleanup after finalize", () => {
  const hours = (h: number) => h * 3600_000;

  it("never deletes the live folder when another admin finalized in between", async () => {
    const cid = await makeCurriculum();
    const a = await stageUpload(cid, 1);
    const b = await stageUpload(cid, 1);
    expect(await finishBookUpload(b)).toEqual({ ok: true });
    expect(await filesOf(cid, a.uploadId)).toHaveLength(2); // young abandoned folder kept
    expect(await finishBookUpload(a)).toEqual({ ok: true });
    expect(await filesOf(cid, b.uploadId)).toEqual([]); // previous live folder removed
    // B's late cleanup, even far in the future: A is live and untouched.
    await cleanupOldUploads({ curriculumId: cid, newUploadId: b.uploadId, previousUploadId: null, now: Date.now() + hours(48) });
    expect(await filesOf(cid, a.uploadId)).toHaveLength(2);
    const book = await getBookForEditor(cid);
    expect((await fetch(book!.pages[0].thumbUrl)).status).toBe(200);
    // Even when it is wrongly named as the previous folder.
    await cleanupOldUploads({ curriculumId: cid, newUploadId: b.uploadId, previousUploadId: a.uploadId });
    expect(await filesOf(cid, a.uploadId)).toHaveLength(2);
  });

  it("keeps a young abandoned folder and removes an old one", async () => {
    const cid = await makeCurriculum();
    const abandoned = await stageUpload(cid, 1);
    const live = await stageUpload(cid, 1);
    expect(await finishBookUpload(live)).toEqual({ ok: true });
    expect(await filesOf(cid, abandoned.uploadId)).toHaveLength(2);
    await cleanupOldUploads({ curriculumId: cid, newUploadId: live.uploadId, previousUploadId: null, now: Date.now() + hours(23) });
    expect(await filesOf(cid, abandoned.uploadId)).toHaveLength(2);
    const removed = await cleanupOldUploads({ curriculumId: cid, newUploadId: live.uploadId, previousUploadId: null, now: Date.now() + hours(25) });
    expect(removed).toEqual([abandoned.uploadId]);
    expect(await filesOf(cid, abandoned.uploadId)).toEqual([]);
    expect(await filesOf(cid, live.uploadId)).toHaveLength(2);
  });

  it("removes the previous live folder after a swap and nothing after a failed finalize", async () => {
    const cid = await makeCurriculum();
    const first = await stageUpload(cid, 1);
    await finishBookUpload(first);
    const second = await stageUpload(cid, 1);
    expect(await finishBookUpload(second)).toEqual({ ok: true });
    expect(await filesOf(cid, first.uploadId)).toEqual([]);
    // Failed finalize (bad dimensions): the live folder and the new one both stay.
    const third = await stageUpload(cid, 1);
    const res = await finishBookUpload({ ...third, pages: [{ page: 1, width: 0, height: 1 }] });
    expect(res.ok).toBe(false);
    expect(await filesOf(cid, second.uploadId)).toHaveLength(2);
    expect(await filesOf(cid, third.uploadId)).toHaveLength(2);
  });
});

describe("saveChapterStarts", () => {
  async function bookWithPages(n = 5) {
    const cid = await makeCurriculum();
    expect(await finishBookUpload(await stageUpload(cid, n))).toEqual({ ok: true });
    return cid;
  }

  it("returns the pure module's message for a bad set and changes nothing", async () => {
    const cid = await bookWithPages();
    await saveChapterStarts({ curriculumId: cid, chapters: [{ title: "A", startPage: 1 }] });
    const before = await chaptersOf(cid);
    const res = await saveChapterStarts({ curriculumId: cid, chapters: [{ title: "A", startPage: 2 }] });
    expect(res).toEqual({ ok: false, message: "The first chapter must start on page 1." });
    expect(await chaptersOf(cid)).toEqual(before);
    expect(await saveChapterStarts({ curriculumId: cid, chapters: [{ title: "A", startPage: 1 }, { title: "B", startPage: 9 }] })).toMatchObject({ ok: false });
  });

  it("refuses a curriculum with no book", async () => {
    const cid = await makeCurriculum();
    expect(await saveChapterStarts({ curriculumId: cid, chapters: [{ title: "A", startPage: 1 }] })).toEqual({
      ok: false,
      message: "This curriculum has no book yet. Upload a PDF first.",
    });
  });

  it("sends trimmed titles, keeps ids stable and retires instead of deleting", async () => {
    const cid = await bookWithPages();
    expect(await saveChapterStarts({ curriculumId: cid, chapters: [{ title: "  Intro  ", startPage: 1 }, { title: "Two", startPage: 3 }] })).toEqual({ ok: true });
    const first = await chaptersOf(cid);
    expect(first.map((c) => c.title).sort()).toEqual(["Intro", "Two"]);
    const intro = first.find((c) => c.title === "Intro")!;
    const two = first.find((c) => c.title === "Two")!;

    // Rename and move a marker: ids stay.
    expect(await saveChapterStarts({ curriculumId: cid, chapters: [{ id: intro.id, title: "Start here", startPage: 1 }, { id: two.id, title: "Two", startPage: 4 }] })).toEqual({ ok: true });
    const second = await chaptersOf(cid);
    expect(second.map((c) => c.id).sort()).toEqual([intro.id, two.id].sort());
    expect(second.find((c) => c.id === intro.id)).toMatchObject({ title: "Start here", start_page: 1 });
    expect(second.find((c) => c.id === two.id)).toMatchObject({ start_page: 4 });

    // Remove "Two" from the list: retired (row stays), not deleted.
    expect(await saveChapterStarts({ curriculumId: cid, chapters: [{ id: intro.id, title: "Start here", startPage: 1 }] })).toEqual({ ok: true });
    const third = await chaptersOf(cid);
    expect(third).toHaveLength(2);
    expect(third.find((c) => c.id === two.id)).toMatchObject({ start_page: null, retired_start_page: 4 });
    expect((await getBookForEditor(cid))!.chapters.map((c) => c.id)).toEqual([intro.id]);
    expect((await listContent()).find((r) => r.curriculumId === cid)!.chapterCount).toBe(1);

    // Passing the retired id again restores the same chapter.
    expect(await saveChapterStarts({ curriculumId: cid, chapters: [{ id: intro.id, title: "Start here", startPage: 1 }, { id: two.id, title: "Two", startPage: 2 }] })).toEqual({ ok: true });
    expect((await getBookForEditor(cid))!.chapters.map((c) => c.id)).toEqual([intro.id, two.id]);
  });

  it("allows an empty list for a draft book, refuses it for a published one", async () => {
    const cid = await bookWithPages();
    await saveChapterStarts({ curriculumId: cid, chapters: [{ title: "A", startPage: 1 }] });
    expect(await saveChapterStarts({ curriculumId: cid, chapters: [] })).toEqual({ ok: true });
    expect((await getBookForEditor(cid))!.chapters).toEqual([]);
    expect(await chaptersOf(cid)).toHaveLength(1); // retired, never deleted
    await saveChapterStarts({ curriculumId: cid, chapters: [{ title: "A", startPage: 1 }] });
    await setBookPublished({ curriculumId: cid, published: true });
    expect(await saveChapterStarts({ curriculumId: cid, chapters: [] })).toEqual({
      ok: false,
      message: "A published book needs a chapter that starts on page 1.",
    });
    expect((await getBookForEditor(cid))!.chapters).toHaveLength(1);
  });
});

describe("setBookPublished", () => {
  it("refuses with no chapters and no book, then publishes and unpublishes", async () => {
    const cid = await makeCurriculum();
    expect(await setBookPublished({ curriculumId: cid, published: true })).toMatchObject({ ok: false });
    await finishBookUpload(await stageUpload(cid, 2));
    expect(await setBookPublished({ curriculumId: cid, published: true })).toEqual({
      ok: false,
      message: "A published book needs a chapter that starts on page 1.",
    });
    await saveChapterStarts({ curriculumId: cid, chapters: [{ title: "A", startPage: 1 }] });
    expect(await setBookPublished({ curriculumId: cid, published: true })).toEqual({ ok: true });
    expect((await db.from("books").select("status").eq("curriculum_id", cid).single()).data!.status).toBe("published");
    expect(await setBookPublished({ curriculumId: cid, published: false })).toEqual({ ok: true });
    expect((await db.from("books").select("status").eq("curriculum_id", cid).single()).data!.status).toBe("draft");
  });
});

describe("readers", () => {
  it("listContent counts with and without a book (active chapters only)", async () => {
    const none = await makeCurriculum();
    const withBook = await makeCurriculum();
    await finishBookUpload(await stageUpload(withBook, 4));
    await saveChapterStarts({ curriculumId: withBook, chapters: [{ title: "A", startPage: 1 }, { title: "B", startPage: 2 }] });
    const rows = await listContent();
    expect(rows.find((r) => r.curriculumId === none)).toMatchObject({ status: "none", pageCount: 0, chapterCount: 0 });
    expect(rows.find((r) => r.curriculumId === withBook)).toMatchObject({ status: "draft", pageCount: 4, chapterCount: 2 });
    const ids = (await chaptersOf(withBook)).map((c) => c.id);
    await saveChapterStarts({ curriculumId: withBook, chapters: [{ id: ids[0], title: "A", startPage: 1 }] });
    expect((await listContent()).find((r) => r.curriculumId === withBook)!.chapterCount).toBe(1);
  });

  it("getBookForEditor returns null without a book and signed thumbs that fetch with 200", async () => {
    expect(await getBookForEditor(await makeCurriculum())).toBeNull();
    const cid = await makeCurriculum();
    const staged = await stageUpload(cid, 2);
    await finishBookUpload(staged);
    const book = await getBookForEditor(cid);
    expect(book).toMatchObject({ status: "draft", pageCount: 2, uploadId: staged.uploadId, chapters: [] });
    expect(book!.pages.map((p) => [p.page, p.width, p.height])).toEqual([[1, 800, 1100], [2, 800, 1100]]);
    for (const p of book!.pages) {
      const r = await fetch(p.thumbUrl);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("image/webp");
    }
  });
});
