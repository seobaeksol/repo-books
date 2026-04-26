import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, type RepoBooksApp } from "../src/app.js";

let app: RepoBooksApp;
let tempDir: string;
let dbPath: string;

const makeApp = async () => {
  app = await createApp({ dbPath });
  return app;
};

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "repo-books-api-"));
  dbPath = join(tempDir, "test.sqlite");
  await makeApp();
});

afterEach(async () => {
  if (app) await app.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Repo Books API", () => {
  it("migrates and seeds a new database", async () => {
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });

    const tableRows = app.repo.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('books', 'parts', 'chapters', 'reading_states', 'generation_runs', 'tutor_threads', 'tutor_messages', 'ui_state')")
      .all() as Array<{ name: string }>;
    expect(tableRows.map((row) => row.name).sort()).toEqual([
      "books",
      "chapters",
      "generation_runs",
      "parts",
      "reading_states",
      "tutor_messages",
      "tutor_threads",
      "ui_state"
    ]);

    const books = await app.inject({ method: "GET", url: "/api/books" });
    expect(books.statusCode).toBe(200);
    expect(books.json().books.length).toBeGreaterThan(0);
  });

  it("lists and loads book details with filters", async () => {
    const all = await app.inject({ method: "GET", url: "/api/books?filter=all" });
    const allBooks = all.json().books;
    expect(allBooks.length).toBeGreaterThanOrEqual(4);

    const generating = await app.inject({ method: "GET", url: "/api/books?filter=generating" });
    expect(generating.json().books).toHaveLength(1);
    expect(generating.json().books[0].status).toBe("generating");

    const detail = await app.inject({ method: "GET", url: `/api/books/${allBooks[0].id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().book.chapters.length).toBeGreaterThan(0);
    expect(detail.json().readingState.bookId).toBe(allBooks[0].id);
  });

  it("saves and restores reading state from the database", async () => {
    const detail = await app.inject({ method: "GET", url: "/api/books/repo-books-book" });
    const chapterId = detail.json().book.chapters[2].id;

    const save = await app.inject({
      method: "PATCH",
      url: "/api/reading-state/repo-books-book",
      payload: { chapterId, progressPercent: 88, scrollY: 420 }
    });
    expect(save.statusCode).toBe(200);
    expect(save.json().readingState).toMatchObject({ chapterId, progressPercent: 88, scrollY: 420 });

    await app.close();
    await makeApp();

    const restored = await app.inject({ method: "GET", url: "/api/books/repo-books-book" });
    expect(restored.json().readingState).toMatchObject({ chapterId, progressPercent: 88, scrollY: 420 });
  });

  it("saves and restores UI state from the database", async () => {
    const save = await app.inject({
      method: "PATCH",
      url: "/api/ui-state/default",
      payload: { view: "reader", focus: true, mobilePanel: "toc", preferences: { density: "compact" } }
    });
    expect(save.statusCode).toBe(200);
    expect(save.json().uiState).toMatchObject({ view: "reader", focus: true, mobilePanel: "toc" });

    await app.close();
    await makeApp();

    const restored = await app.inject({ method: "GET", url: "/api/ui-state/default" });
    expect(restored.json().uiState).toMatchObject({
      view: "reader",
      focus: true,
      mobilePanel: "toc",
      preferences: { density: "compact" }
    });
  });

  it("creates a mock generation outline run", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/generation/outline",
      payload: {
        repoUrl: "https://github.com/suyoungkim/repo-books",
        model: "qwen3-coder 14B",
        audience: "리팩터링을 준비하는 maintainer",
        depth: "deep"
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().book).toMatchObject({
      repo: "suyoungkim/repo-books",
      subtitle: expect.stringContaining("리팩터링을 준비하는 maintainer")
    });
    expect(response.json().generationRun).toMatchObject({
      repoUrl: "https://github.com/suyoungkim/repo-books",
      branch: "main",
      bookId: response.json().book.id,
      status: "running"
    });
    expect(response.json().generationRun.outline.length).toBeGreaterThan(0);

    const detail = await app.inject({ method: "GET", url: `/api/books/${response.json().book.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().book.chapters.length).toBeGreaterThan(0);
  });

  it("creates default tutor threads for a context and persists mock replies", async () => {
    const detail = await app.inject({ method: "GET", url: "/api/books/repo-books-book" });
    const book = detail.json().book;
    const chapterId = book.chapters[2].id;

    const threads = await app.inject({
      method: "GET",
      url: `/api/tutor/threads?bookId=${book.id}&chapterId=${chapterId}`
    });
    expect(threads.statusCode).toBe(200);
    expect(threads.json().threads).toHaveLength(1);
    const thread = threads.json().threads[0];
    expect(thread.messages.length).toBeGreaterThan(0);

    const posted = await app.inject({
      method: "POST",
      url: `/api/tutor/threads/${thread.id}/messages`,
      payload: { body: "이 장에서 먼저 볼 파일은 무엇인가요?" }
    });
    expect(posted.statusCode).toBe(200);
    expect(posted.json().thread.messages.slice(-2).map((message: { role: string }) => message.role)).toEqual(["user", "assistant"]);

    await app.close();
    await makeApp();

    const restored = await app.inject({
      method: "GET",
      url: `/api/tutor/threads?bookId=${book.id}&chapterId=${chapterId}`
    });
    expect(restored.json().threads[0].messages.some((message: { body: string }) => message.body === "이 장에서 먼저 볼 파일은 무엇인가요?")).toBe(true);
  });
});
