import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockChatMessage = { role: string; content: string };
type MockMode = "success" | "model-error" | "missing-then-success" | "bad-section-draft";

const lmStudioMock = vi.hoisted(() => {
  let mode: MockMode = "success";
  let payloadFactory: (schemaName: string, context: Record<string, unknown>) => unknown = () => ({});
  const modelKeys: string[] = [];
  const modelAttempts = new Map<string, number>();
  const contexts: Record<string, unknown>[] = [];
  const chats: MockChatMessage[][] = [];
  const respondOptions: Record<string, unknown>[] = [];

  const parsePrompt = (chat: unknown) => {
    const messages = Array.isArray(chat) ? (chat as MockChatMessage[]) : [{ role: "user", content: String(chat) }];
    const userMessage = [...messages].reverse().find((message) => message.role === "user");
    try {
      return JSON.parse(userMessage?.content ?? "{}") as { schemaName?: string; context?: Record<string, unknown> };
    } catch {
      return { schemaName: undefined, context: {} };
    }
  };

  const respond = vi.fn(async (chat: unknown, options: Record<string, unknown>) => {
    const messages = Array.isArray(chat) ? (chat as MockChatMessage[]) : [{ role: "user", content: String(chat) }];
    chats.push(messages);
    respondOptions.push(options);
    const prompt = parsePrompt(chat);
    const context = prompt.context ?? {};
    contexts.push(context);
    const content =
      mode === "bad-section-draft" && prompt.schemaName === "RepoBookSectionDraft"
        ? {
            body: [
              "이 테스트는 SDK 메타 응답이 JSON parsing 처리를 통과하는지 확인하기 위해 충분히 긴 prose를 제공합니다.",
              "모델 응답과 프롬프트 처리 상태를 설명하는 문장이므로 독자가 읽는 저장소 기술서 본문에는 저장되면 안 됩니다."
            ].join("\n\n")
          }
        : payloadFactory(prompt.schemaName ?? "", context);
    return { content: JSON.stringify(content), parsed: content };
  });

  const model = vi.fn((modelKey: string) => {
    modelKeys.push(modelKey);
    const nextAttempt = (modelAttempts.get(modelKey) ?? 0) + 1;
    modelAttempts.set(modelKey, nextAttempt);
    if (mode === "model-error") throw new Error("LM Studio SDK model unavailable");
    if (mode === "missing-then-success" && nextAttempt === 1) throw new Error(`Model not found: ${modelKey}`);
    return { respond };
  });

  const LMStudioClient = vi.fn(() => ({
    llm: { model }
  }));

  return {
    LMStudioClient,
    setMode: (nextMode: MockMode) => {
      mode = nextMode;
    },
    setPayloadFactory: (factory: (schemaName: string, context: Record<string, unknown>) => unknown) => {
      payloadFactory = factory;
    },
    reset: () => {
      mode = "success";
      modelKeys.length = 0;
      modelAttempts.clear();
      contexts.length = 0;
      chats.length = 0;
      respondOptions.length = 0;
      respond.mockClear();
      model.mockClear();
      LMStudioClient.mockClear();
    },
    requests: () => respond.mock.calls.length,
    modelKeys: () => [...modelKeys],
    contexts: () => [...contexts],
    chats: () => [...chats],
    respondOptions: () => [...respondOptions]
  };
});

const lmsMock = vi.hoisted(() => {
  let downloadMode: "success" | "error" = "success";
  let listMode: "success" | "error" = "success";
  let listPayload: unknown = [
    {
      model: {
        type: "llm",
        modelKey: "google/gemma-4-e4b",
        format: "gguf",
        displayName: "Gemma 4 E4B",
        publisher: "google",
        path: "google/gemma-4-e4b",
        sizeBytes: 6326936720,
        paramsString: "7.5B",
        architecture: "gemma4",
        quantization: { name: "Q4_K_M", bits: 4 },
        variants: ["google/gemma-4-e4b@q4_k_m"],
        selectedVariant: "google/gemma-4-e4b@q4_k_m",
        vision: true,
        trainedForToolUse: true,
        maxContextLength: 131072
      },
      variants: [
        {
          type: "llm",
          modelKey: "google/gemma-4-e4b@q4_k_m",
          format: "gguf",
          displayName: "Gemma 4 E4B",
          publisher: "google",
          path: "google/gemma-4-e4b",
          sizeBytes: 6326936720,
          paramsString: "7.5B",
          architecture: "gemma4",
          quantization: { name: "Q4_K_M", bits: 4 },
          vision: true,
          trainedForToolUse: true,
          maxContextLength: 131072
        }
      ]
    }
  ];
  const execFile = vi.fn((command: string, args: string[], options: Record<string, unknown>, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    void options;
    setImmediate(() => {
      if (args[0] === "ls") {
        if (listMode === "error") callback(Object.assign(new Error("lms list failed"), { code: 1, stderr: "\u001b[91mnot ready\u001b[39m" }), "", "\u001b[91mnot ready\u001b[39m");
        else callback(null, JSON.stringify(listPayload), "");
        return;
      }
      if (downloadMode === "error") callback(Object.assign(new Error("lms download failed"), { code: 1, stderr: "not found" }), "", "not found");
      else callback(null, "downloaded", "");
    });
    return { pid: 1, kill: vi.fn() };
  });

  return {
    execFile,
    setMode: (nextMode: "success" | "error") => {
      downloadMode = nextMode;
    },
    setListMode: (nextMode: "success" | "error") => {
      listMode = nextMode;
    },
    setListPayload: (nextPayload: unknown) => {
      listPayload = nextPayload;
    },
    reset: () => {
      downloadMode = "success";
      listMode = "success";
      listPayload = [
        {
          model: {
            type: "llm",
            modelKey: "google/gemma-4-e4b",
            format: "gguf",
            displayName: "Gemma 4 E4B",
            publisher: "google",
            path: "google/gemma-4-e4b",
            sizeBytes: 6326936720,
            paramsString: "7.5B",
            architecture: "gemma4",
            quantization: { name: "Q4_K_M", bits: 4 },
            variants: ["google/gemma-4-e4b@q4_k_m"],
            selectedVariant: "google/gemma-4-e4b@q4_k_m",
            vision: true,
            trainedForToolUse: true,
            maxContextLength: 131072
          },
          variants: [
            {
              type: "llm",
              modelKey: "google/gemma-4-e4b@q4_k_m",
              format: "gguf",
              displayName: "Gemma 4 E4B",
              publisher: "google",
              path: "google/gemma-4-e4b",
              sizeBytes: 6326936720,
              paramsString: "7.5B",
              architecture: "gemma4",
              quantization: { name: "Q4_K_M", bits: 4 },
              vision: true,
              trainedForToolUse: true,
              maxContextLength: 131072
            }
          ]
        }
      ];
      execFile.mockClear();
    },
    calls: () => execFile.mock.calls.map(([command, args]) => ({ command, args }))
  };
});

vi.mock("@lmstudio/sdk", () => ({
  LMStudioClient: lmStudioMock.LMStudioClient
}));

vi.mock("node:child_process", () => ({
  execFile: lmsMock.execFile
}));

import { createApp, type RepoBooksApp } from "../src/app.js";
import { resetLmStudioModelCache } from "../src/lmStudioModels.js";

let app: RepoBooksApp;
let tempDir: string;
let dbPath: string;

const makeApp = async () => {
  app = await createApp({ dbPath });
  return app;
};

beforeEach(async () => {
  lmStudioMock.reset();
  lmsMock.reset();
  resetLmStudioModelCache();
  lmStudioMock.setPayloadFactory(fakeStructuredPayload);
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
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'sync_metadata', 'books', 'parts', 'chapters', 'reading_states', 'generation_runs', 'generation_chapter_runs', 'generation_artifacts', 'tutor_threads', 'tutor_messages', 'ui_state')")
      .all() as Array<{ name: string }>;
    expect(tableRows.map((row) => row.name).sort()).toEqual([
      "books",
      "chapters",
      "generation_artifacts",
      "generation_chapter_runs",
      "generation_runs",
      "parts",
      "reading_states",
      "sync_metadata",
      "tutor_messages",
      "tutor_threads",
      "ui_state",
      "users"
    ]);

    const books = await app.inject({ method: "GET", url: "/api/books" });
    expect(books.statusCode).toBe(200);
    expect(books.json().books.length).toBeGreaterThan(0);
  });

  it("lists local LM Studio model variants and caches them", async () => {
    const first = await app.inject({ method: "GET", url: "/api/lm-studio/models" });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      stale: false,
      models: [
        {
          modelKey: "google/gemma-4-e4b@q4_k_m",
          displayName: "Gemma 4 E4B",
          path: "google/gemma-4-e4b",
          publisher: "google",
          paramsString: "7.5B",
          quantization: { name: "Q4_K_M", bits: 4 },
          sizeBytes: 6326936720,
          maxContextLength: 131072,
          vision: true,
          trainedForToolUse: true,
          stale: false
        }
      ]
    });

    const second = await app.inject({ method: "GET", url: "/api/lm-studio/models" });
    expect(second.statusCode).toBe(200);
    expect(lmsMock.calls().filter((call) => call.args[0] === "ls")).toHaveLength(1);
  });

  it("refreshes the LM Studio model list when requested", async () => {
    await app.inject({ method: "GET", url: "/api/lm-studio/models" });
    lmsMock.setListPayload([
      {
        model: { type: "llm", modelKey: "qwen/qwen3-4b-2507", displayName: "Qwen3 4B", publisher: "qwen", path: "qwen/qwen3-4b-2507" },
        variants: [{ type: "llm", modelKey: "qwen/qwen3-4b-2507@q4_k_m", displayName: "Qwen3 4B", publisher: "qwen", path: "qwen/qwen3-4b-2507", quantization: { name: "Q4_K_M", bits: 4 } }]
      }
    ]);

    const refreshed = await app.inject({ method: "GET", url: "/api/lm-studio/models?refresh=1" });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().models[0]).toMatchObject({ modelKey: "qwen/qwen3-4b-2507@q4_k_m", stale: false });
    expect(lmsMock.calls().filter((call) => call.args[0] === "ls")).toHaveLength(2);
  });

  it("returns stale LM Studio models when refresh fails after a successful cache", async () => {
    await app.inject({ method: "GET", url: "/api/lm-studio/models" });
    lmsMock.setListMode("error");

    const stale = await app.inject({ method: "GET", url: "/api/lm-studio/models?refresh=1" });
    expect(stale.statusCode).toBe(200);
    expect(stale.json()).toMatchObject({
      stale: true,
      models: [{ modelKey: "google/gemma-4-e4b@q4_k_m", stale: true }]
    });
    expect(stale.json().error).toContain("LM_STUDIO_MODEL_LIST_FAILED");
    expect(stale.json().error).not.toContain("\u001b");
  });

  it("returns an empty LM Studio model list when lms fails before cache exists", async () => {
    lmsMock.setListMode("error");

    const failed = await app.inject({ method: "GET", url: "/api/lm-studio/models" });
    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toMatchObject({ models: [], cachedAt: null, stale: false });
    expect(failed.json().error).toContain("LM_STUDIO_MODEL_LIST_FAILED");
    expect(failed.json().error).not.toContain("\u001b");
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

  it("keeps reading and UI state scoped to the selected local user", async () => {
    const user = await app.inject({
      method: "POST",
      url: "/api/users",
      payload: { id: "reviewer", name: "Reviewer", color: "green" }
    });
    expect(user.statusCode).toBe(200);
    expect(user.json().user).toMatchObject({ id: "reviewer", name: "Reviewer" });

    const detail = await app.inject({ method: "GET", url: "/api/books/repo-books-book" });
    const chapterId = detail.json().book.chapters[2].id;

    const saveReviewer = await app.inject({
      method: "PATCH",
      url: "/api/reading-state/repo-books-book",
      headers: { "x-repo-books-user": "reviewer" },
      payload: { chapterId, progressPercent: 13, scrollY: 99 }
    });
    expect(saveReviewer.statusCode).toBe(200);
    expect(saveReviewer.json().readingState).toMatchObject({ userId: "reviewer", chapterId, progressPercent: 13 });

    const reviewerDetail = await app.inject({
      method: "GET",
      url: "/api/books/repo-books-book",
      headers: { "x-repo-books-user": "reviewer" }
    });
    expect(reviewerDetail.json().readingState).toMatchObject({ userId: "reviewer", chapterId, progressPercent: 13 });
    expect(reviewerDetail.json().book).toMatchObject({ currentChapterId: chapterId, progress: 13 });

    const defaultDetail = await app.inject({ method: "GET", url: "/api/books/repo-books-book" });
    expect(defaultDetail.json().readingState.progressPercent).not.toBe(13);

    const saveUi = await app.inject({
      method: "PATCH",
      url: "/api/ui-state/default?userId=reviewer",
      payload: { focus: true, mobilePanel: "tutor", preferences: { density: "review" } }
    });
    expect(saveUi.statusCode).toBe(200);
    expect(saveUi.json().uiState).toMatchObject({ userId: "reviewer", focus: true, mobilePanel: "tutor" });
  });

  it("exports and imports a local sync snapshot", async () => {
    const status = await app.inject({ method: "GET", url: "/api/sync/status" });
    expect(status.statusCode).toBe(200);
    expect(status.json().syncStatus).toMatchObject({ activeProfileId: "local", schemaVersion: 1 });

    const profile = await app.inject({
      method: "POST",
      url: "/api/profiles",
      payload: { id: "snapshot-user", displayName: "Snapshot User", color: "rose" }
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().profile).toMatchObject({ id: "snapshot-user", name: "Snapshot User" });

    const activated = await app.inject({ method: "PATCH", url: "/api/profiles/snapshot-user/activate" });
    expect(activated.statusCode).toBe(200);
    expect(activated.json().syncStatus.activeProfileId).toBe("snapshot-user");

    const exported = await app.inject({ method: "POST", url: "/api/sync/export" });
    expect(exported.statusCode).toBe(200);
    const snapshot = exported.json().snapshot;
    expect(snapshot.version).toBe(1);
    expect(snapshot.activeProfileId).toBe("snapshot-user");
    expect(snapshot.users.map((user: { id: string }) => user.id)).toEqual(expect.arrayContaining(["local", "snapshot-user"]));
    expect(snapshot.books.length).toBeGreaterThan(0);
    expect(exported.json().syncStatus.lastExportAt).not.toBeNull();

    const imported = await app.inject({
      method: "POST",
      url: "/api/sync/import",
      payload: { mode: "merge", snapshot }
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json().syncStatus.activeProfileId).toBe("snapshot-user");
    expect(imported.json().syncStatus.lastImportAt).not.toBeNull();
    expect(imported.json().snapshot.users.map((user: { id: string }) => user.id)).toEqual(expect.arrayContaining(["snapshot-user"]));
  });

  it("creates a generated book from an indexed repository using the SDK model", async () => {
    const fixturePath = createGenericFixture(tempDir);
    const response = await app.inject({
      method: "POST",
      url: "/api/generation/outline",
      payload: {
        repoUrl: fixturePath,
        model: "google/gemma-4-E4B-it",
        readerLevel: "설계자",
        bookPurpose: "구조 이해",
        depth: "deep",
        customPrompt: "테스트 전략을 각 장의 체크포인트에 반영"
      }
    });
    expect(response.statusCode).toBe(200);
    const book = response.json().book;
    expect(book.title).toContain("sample-service");
    expect(book.repo).toContain("sample-service");
    expect(book.model).toContain("google/gemma-4-E4B-it");
    expect(book.subtitle).toEqual(expect.stringContaining("설계자"));
    expect(book.subtitle).toEqual(expect.stringContaining("구조 이해"));
    expect(book.parts.map((part: { title: string }) => part.title)).toEqual(
      expect.arrayContaining(["Part I. 저장소 방향", "Part II. 실행 흐름"])
    );
    expect(book.chapters.length).toBeGreaterThanOrEqual(4);
    expect(book.chapters.map((chapter: { title: string }) => chapter.title)).toEqual(
      expect.arrayContaining(["서비스 진입점과 공개 계약", "도메인 규칙과 데이터 흐름"])
    );
    expect(book.chapters[0].files).toEqual(expect.arrayContaining(["src/server.ts", "src/routes/books.ts"]));
    expect(book.chapters[0].keyQuestion).toBeTruthy();
    expect(book.chapters[0].responsibility).toBeTruthy();
    expect(book.chapters[0].flow.title).toBeTruthy();
    expect(book.chapters[0].codeAnchors.length).toBeGreaterThanOrEqual(2);
    expect(book.chapters[0].evidence.length).toBeGreaterThanOrEqual(2);
    expect(book.chapters[0].recap.changeEntryPoints.length).toBeGreaterThan(0);
    expect(book.chapters[0].sections.length).toBeGreaterThanOrEqual(5);
    expect(book.chapters[0].sections[0].body.length).toBeGreaterThan(700);
    expect(book.chapters[0].sections[0].body.split("\n\n")).toHaveLength(3);
    expect(response.json().generationRun).toMatchObject({
      repoUrl: fixturePath,
      branch: "main",
      model: "google/gemma-4-E4B-it",
      bookId: book.id,
      status: "complete",
      progress: 100
    });
    expect(response.json().generationRun.steps.map((step: { detail: string }) => step.detail)).toEqual(
      expect.arrayContaining([expect.stringContaining("structured LM calls succeeded")])
    );
    expect(response.json().generationRun.steps.map((step: { detail: string }) => step.detail)).not.toContain("local structured generation");
    expect(response.json().generationRun.outline.length).toBeGreaterThanOrEqual(2);
    expect(response.json().generationRun.artifacts.map((artifact: { kind: string }) => artifact.kind)).toEqual(
      expect.arrayContaining(["repository_analysis", "part_plan", "chapter_plan", "chapter_brief", "section_plan", "section_draft", "chapter_revision", "book_coherence", "quality_issues"])
    );
    expect(new Set(lmStudioMock.modelKeys())).toEqual(new Set(["google/gemma-4-E4B-it"]));
    expect(
      lmStudioMock.contexts().some(
        (context) => context.readerLevel === "설계자" && context.bookPurpose === "구조 이해" && context.customPrompt === "테스트 전략을 각 장의 체크포인트에 반영"
      )
    ).toBe(true);
    expect(lmStudioMock.chats().every((chat) => chat.some((message) => message.role === "system") && chat.some((message) => message.role === "user"))).toBe(true);
    expect(lmStudioMock.respondOptions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          structured: expect.objectContaining({ type: "json" }),
          maxTokens: expect.any(Number),
          temperature: expect.any(Number)
        })
      ])
    );

    const events = await app.inject({ method: "GET", url: `/api/generation/runs/${response.json().generationRun.id}/events` });
    expect(events.statusCode).toBe(200);
    expect(events.headers["content-type"]).toContain("text/event-stream");
    expect(events.body).toContain("event: generation");
    expect(events.body).toContain("\"status\":\"complete\"");

    const detail = await app.inject({ method: "GET", url: `/api/books/${book.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().book.chapters.length).toBe(book.chapters.length);
    expect(detail.json().book.chapters[0].codeAnchors[0].filePath).toBe(book.chapters[0].codeAnchors[0].filePath);
    expect(detail.json().readingState).toMatchObject({ bookId: book.id, chapterId: book.currentChapterId, progressPercent: book.progress });
  });

  it("downloads a missing LM Studio model with lms get before generation", async () => {
    lmStudioMock.setMode("missing-then-success");
    const fixturePath = createGenericFixture(tempDir);
    const response = await app.inject({
      method: "POST",
      url: "/api/generation/outline",
      payload: {
        repoUrl: fixturePath,
        model: "qwen/qwen3-4b-2507",
        readerLevel: "설계자",
        bookPurpose: "구조 이해",
        depth: "balanced"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(lmsMock.calls()).toEqual([{ command: "lms", args: ["get", "qwen/qwen3-4b-2507"] }]);
    expect(lmStudioMock.modelKeys().filter((key) => key === "qwen/qwen3-4b-2507")).toHaveLength(2);
    expect(response.json().generationRun.steps[0]).toMatchObject({
      label: "모델 준비",
      state: "complete",
      detail: expect.stringContaining("1/1 missing model downloads completed")
    });
  });

  it("marks background generation failed when the SDK model cannot be loaded", async () => {
    lmStudioMock.setMode("model-error");
    const queued = await app.inject({
      method: "POST",
      url: "/api/generation/runs",
      payload: {
        repoUrl: createGenericFixture(tempDir),
        model: "missing-local-model",
        readerLevel: "유지보수자",
        bookPurpose: "변경 준비",
        depth: "balanced",
        background: true
      }
    });

    expect(queued.statusCode).toBe(202);
    expect(queued.json().book).toMatchObject({ status: "generating", statusLabel: "생성 대기 중", progress: 0 });
    const polled = await waitForGenerationRun(queued.json().generationRun.id);
    expect(polled.generationRun.status).toBe("failed");
    expect(polled.generationRun.error).toContain("LM Studio SDK model unavailable");
    expect(polled.book).toMatchObject({ status: "generating", statusLabel: "생성 실패" });
    expect(lmStudioMock.modelKeys()).toContain("missing-local-model");
    expect(lmsMock.calls()).toEqual([{ command: "lms", args: ["get", "missing-local-model"] }]);
  });

  it("rejects meta SDK prose and records failed chapter text without deterministic prose fallback", async () => {
    lmStudioMock.setMode("bad-section-draft");
    const response = await app.inject({
      method: "POST",
      url: "/api/generation/outline",
      payload: {
        repoUrl: createGenericFixture(tempDir),
        model: "google/gemma-4-E4B-it",
        readerLevel: "유지보수자",
        bookPurpose: "변경 준비",
        depth: "balanced"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(lmStudioMock.requests()).toBeGreaterThan(1);
    expect(JSON.stringify(body.book.chapters[0].sections)).not.toContain("JSON parsing");
    expect(body.generationRun.chapterRuns.some((chapter: { status: string }) => chapter.status === "failed")).toBe(true);
    expect(body.generationRun.artifacts.some((artifact: { kind: string; payload: { error?: string } }) => artifact.kind === "section_draft" && artifact.payload.error)).toBe(true);
    expect(new Set(lmStudioMock.modelKeys())).toEqual(new Set(["google/gemma-4-E4B-it"]));
  });

  it("regenerates failed chapters through the SDK retry path", async () => {
    lmStudioMock.setMode("bad-section-draft");

    const queued = await app.inject({
      method: "POST",
      url: "/api/generation/runs",
      payload: {
        repoUrl: createGenericFixture(tempDir),
        model: "google/gemma-4-E4B-it",
        readerLevel: "유지보수자",
        bookPurpose: "변경 준비",
        depth: "balanced",
        background: true
      }
    });

    expect(queued.statusCode).toBe(202);
    const runId = queued.json().generationRun.id;
    expect(queued.json().generationRun.status).toBe("queued");
    expect(queued.json().book).toMatchObject({ status: "generating", generationRunId: runId });

    const polled = await waitForGenerationRun(runId);
    expect(polled.generationRun.status).toBe("complete");
    expect(polled.generationRun.model).toBe("google/gemma-4-E4B-it");
    expect(polled.book.id).toBe(polled.generationRun.bookId);
    expect(polled.book.subtitle).toContain("유지보수자");
    expect(polled.book.subtitle).toContain("변경 준비");

    const failedChapters = polled.generationRun.chapterRuns.filter((chapter: { status: string }) => chapter.status === "failed");
    expect(failedChapters.length).toBeGreaterThan(0);

    lmStudioMock.setMode("success");
    const singleRetry = await app.inject({
      method: "POST",
      url: `/api/generation/runs/${runId}/chapters/${failedChapters[0].chapterId}/retry`
    });
    expect(singleRetry.statusCode).toBe(200);
    expect(singleRetry.json().retried).toBe(1);
    expect(singleRetry.json().generationRun.chapterRuns.every((chapter: { status: string }) => chapter.status === "complete")).toBe(true);
    expect(singleRetry.json().generationRun.chapterRuns.every((chapter: { source: string }) => chapter.source === "LM Studio TypeScript SDK")).toBe(true);

    const retry = await app.inject({
      method: "POST",
      url: `/api/generation/runs/${runId}/retry-failed-chapters`
    });

    expect(retry.statusCode).toBe(200);
    expect(retry.json().retried).toBe(0);
    expect(retry.json().generationRun.chapterRuns.every((chapter: { status: string }) => chapter.status === "complete")).toBe(true);
    expect(retry.json().book.chapters.every((chapter: { sections: unknown[] }) => chapter.sections.length >= 5)).toBe(true);
    expect(new Set(lmStudioMock.modelKeys())).toEqual(new Set(["google/gemma-4-E4B-it"]));
  });

  it("uses the @lmstudio/sdk structured JSON adapter when available", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/generation/outline",
      payload: {
        repoUrl: createGenericFixture(tempDir),
        model: "google/gemma-4-E4B-it",
        readerLevel: "설계자",
        bookPurpose: "구조 이해",
        depth: "deep"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(lmStudioMock.requests()).toBeGreaterThan(body.book.chapters.length);
    expect(lmStudioMock.modelKeys()).toEqual(expect.arrayContaining(["google/gemma-4-E4B-it"]));
    expect(lmStudioMock.contexts().some((context) => context.readerLevel === "설계자" && context.bookPurpose === "구조 이해")).toBe(true);
    expect(body.book.chapters[0].sections[0].body).toContain("저장소 책임");
    expect(body.book.chapters[0].sections[0].body).not.toContain("JSON parsing");
    expect(body.generationRun.steps.map((step: { detail: string }) => step.detail)).toEqual(
      expect.arrayContaining([expect.stringContaining("structured LM calls succeeded")])
    );
  });

  it("creates default tutor threads for a context and persists contextual replies", async () => {
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

async function waitForGenerationRun(runId: string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/api/generation/runs/${runId}` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    if (body.generationRun.status !== "queued" && body.generationRun.status !== "running") return body;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Generation run ${runId} did not finish`);
}

function createGenericFixture(root: string) {
  const repoPath = join(root, "sample-service");
  writeFixture(repoPath, "README.md", "# sample-service\n\nA small TypeScript service that exposes book routes, domain rules, repository storage, and worker jobs.\n");
  writeFixture(
    repoPath,
    "package.json",
    JSON.stringify(
      {
        name: "sample-service",
        scripts: { dev: "tsx src/server.ts", test: "vitest run" },
        dependencies: { fastify: "^5.0.0", zod: "^3.23.8" },
        devDependencies: { vitest: "^2.0.0", tsx: "^4.0.0", typescript: "^5.0.0" }
      },
      null,
      2
    )
  );
  writeFixture(repoPath, "src/server.ts", "import { createApp } from './app';\n\nexport async function startServer() {\n  const app = createApp();\n  await app.listen({ port: 3000 });\n}\n");
  writeFixture(repoPath, "src/app.ts", "import Fastify from 'fastify';\nimport { registerBookRoutes } from './routes/books';\n\nexport function createApp() {\n  const app = Fastify();\n  registerBookRoutes(app);\n  return app;\n}\n");
  writeFixture(repoPath, "src/routes/books.ts", "import type { FastifyInstance } from 'fastify';\nimport { listBooks, updateReadingState } from '../domain/books';\n\nexport function registerBookRoutes(app: FastifyInstance) {\n  app.get('/books', async () => ({ books: listBooks() }));\n  app.patch('/books/:id/reading-state', async (request) => updateReadingState(request.params, request.body));\n}\n");
  writeFixture(repoPath, "src/domain/books.ts", "import { saveReadingState } from '../storage/repository';\n\nexport function listBooks() {\n  return [{ id: 'repo-books', title: 'Repo Books' }];\n}\n\nexport function updateReadingState(params: unknown, payload: unknown) {\n  return saveReadingState({ params, payload, updatedAt: new Date().toISOString() });\n}\n");
  writeFixture(repoPath, "src/storage/repository.ts", "export function saveReadingState(record: unknown) {\n  return { ok: true, record };\n}\n\nexport function loadSnapshot() {\n  return { users: [], books: [] };\n}\n");
  writeFixture(repoPath, "src/jobs/sync.ts", "import { loadSnapshot } from '../storage/repository';\n\nexport async function runSyncJob() {\n  const snapshot = loadSnapshot();\n  return { synced: snapshot.books.length };\n}\n");
  writeFixture(repoPath, "test/books.test.ts", "import { describe, expect, it } from 'vitest';\nimport { listBooks } from '../src/domain/books';\n\ndescribe('books', () => {\n  it('lists seeded books', () => {\n    expect(listBooks()).toHaveLength(1);\n  });\n});\n");
  writeFixture(repoPath, "docs/architecture.md", "# Architecture\n\nRequests enter through Fastify routes, move into domain functions, persist through repository helpers, and background jobs reuse the same storage contracts.\n");
  return repoPath;
}

function writeFixture(root: string, path: string, body: string) {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, body, "utf8");
}

function fakeStructuredPayload(schemaName: string, context: Record<string, unknown>) {
  if (schemaName === "RepoBookPartPlan") {
    return {
      parts: [
        { title: "Part I. 저장소 방향", summary: "서비스가 제공하는 공개 계약과 진입점을 먼저 읽는다." },
        { title: "Part II. 실행 흐름", summary: "도메인 규칙, 저장소 계층, 작업 흐름이 이어지는 방식을 설명한다." }
      ]
    };
  }
  if (schemaName === "RepoBookChapterPlan") {
    const candidateFiles = (context.candidateFiles as Array<{ path: string }> | undefined)?.map((file) => file.path) ?? [];
    const routeFiles = ["src/server.ts", "src/app.ts", "src/routes/books.ts"].filter((path) => candidateFiles.length === 0 || candidateFiles.includes(path));
    const domainFiles = ["src/domain/books.ts", "src/storage/repository.ts", "src/jobs/sync.ts"].filter((path) => candidateFiles.length === 0 || candidateFiles.includes(path));
    return {
      chapters: [
        {
          title: "서비스 진입점과 공개 계약",
          subtitle: "요청이 서버에서 라우트로 들어오는 경계를 읽는다.",
          files: routeFiles.length ? routeFiles : ["src/server.ts", "src/app.ts", "src/routes/books.ts"],
          goals: ["서버 진입점과 라우트 등록 흐름을 설명한다.", "외부 요청이 어떤 공개 계약으로 표현되는지 구분한다."],
          focus: "Fastify 앱 생성, 라우트 등록, 요청 핸들러가 맡는 책임을 연결한다.",
          checkpoints: ["라우트 추가 시 앱 등록 지점을 확인한다.", "요청/응답 계약 변경 시 테스트를 함께 갱신한다."],
          codePath: "src/routes/books.ts",
          codeLabel: "book route contract"
        },
        {
          title: "도메인 규칙과 데이터 흐름",
          subtitle: "핸들러 이후 도메인과 저장소가 책임을 나누는 방법을 읽는다.",
          files: domainFiles.length ? domainFiles : ["src/domain/books.ts", "src/storage/repository.ts", "src/jobs/sync.ts"],
          goals: ["도메인 함수와 저장소 함수의 책임을 분리해 설명한다.", "동기화 작업이 기존 저장소 계약을 재사용하는 지점을 찾는다."],
          focus: "도메인 규칙, 저장소 경계, 배경 작업이 같은 데이터 계약으로 이어진다.",
          checkpoints: ["저장 형식 변경 시 도메인과 작업 경로를 함께 확인한다.", "상태 갱신 부작용이 한 계층에 고립되는지 점검한다."],
          codePath: "src/domain/books.ts",
          codeLabel: "domain state update"
        }
      ]
    };
  }
  if (schemaName === "RepoBookChapterBrief") return context.evidenceSeed ?? {};
  if (schemaName === "RepoBookSectionPlan") {
    const files = ((context.files as Array<{ path: string }> | undefined) ?? []).map((file) => file.path);
    return {
      sections: Array.from({ length: 6 }, (_, index) => ({
        eyebrow: ["핵심 질문", "책임 경계", "흐름", "핵심 구현", "변경 판단", "Recap"][index],
        title: `LM 구조화 section ${index + 1}`,
        purpose: `저장소 책임을 ${index + 1}번째 관점에서 설명한다.`,
        evidenceFiles: files.slice(0, 3)
      }))
    };
  }
  if (schemaName === "RepoBookSectionDraft") {
    const section = context.section as { title?: string; purpose?: string; evidenceFiles?: string[] } | undefined;
    const brief = context.brief as { keyQuestion?: string; responsibility?: string; codeAnchors?: Array<{ filePath: string; symbolName?: string; claim: string; explanation: string }>; evidence?: Array<{ filePath: string; role: string; usedAsEvidence: string }> } | undefined;
    const evidenceFile = section?.evidenceFiles?.[0] ?? brief?.evidence?.[0]?.filePath ?? brief?.codeAnchors?.[0]?.filePath ?? "README.md";
    const anchor = brief?.codeAnchors?.[0];
    return {
      body: [
        `${section?.purpose ?? "저장소 책임을 설명한다."} ${brief?.keyQuestion ?? "핵심 질문"}은 파일 안내가 아니라 시스템 책임을 세우는 문장이다. ${evidenceFile}와 ${anchor?.filePath ?? evidenceFile}는 이 장의 주장이 실제 저장소 근거에 연결되어 있음을 보여 준다. 이 절은 독자가 ${section?.title ?? "section"}을 통해 저장소 책임, 공개 계약, 변경 위험을 한 번에 설명할 수 있게 만든다.`,
        `${anchor?.filePath ?? evidenceFile}${anchor?.symbolName ? `의 ${anchor.symbolName}` : ""}는 ${anchor?.claim ?? "공개 계약"}을 드러낸다. ${brief?.responsibility ?? "이 모듈 책임"}은 단순한 파일 목록이 아니라 실행 흐름과 설정, 검증 지점이 만나는 경계다. 그래서 본문은 원본 코드를 대신하지 않고, 어떤 주장에 어떤 파일 근거가 붙는지 분명히 연결한다.`,
        `변경 시에는 ${evidenceFile}를 먼저 확인하고, 같은 책임을 공유하는 코드 앵커와 테스트 근거를 함께 대조해야 한다. ${anchor?.explanation ?? "코드 앵커 설명"}은 이 변경 판단의 기준이 되며, 다음 절에서는 이 근거를 더 구체적인 흐름이나 검증 기준으로 좁힌다.`
      ].join("\n\n")
    };
  }
  if (schemaName === "RepoBookChapterRevision") return { sections: context.sections ?? [] };
  if (schemaName === "RepoBookCoherenceReview") return { summary: "coherent", missingFlows: [] };
  return {};
}
