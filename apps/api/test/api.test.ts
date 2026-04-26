import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, type RepoBooksApp } from "../src/app.js";

let app: RepoBooksApp;
let tempDir: string;
let dbPath: string;
let previousLmStudioBaseUrl: string | undefined;
let previousLmStudioTimeoutMs: string | undefined;

const makeApp = async () => {
  app = await createApp({ dbPath });
  return app;
};

beforeEach(async () => {
  previousLmStudioBaseUrl = process.env.LM_STUDIO_BASE_URL;
  previousLmStudioTimeoutMs = process.env.LM_STUDIO_TIMEOUT_MS;
  delete process.env.LM_STUDIO_BASE_URL;
  delete process.env.LM_STUDIO_TIMEOUT_MS;
  tempDir = mkdtempSync(join(tmpdir(), "repo-books-api-"));
  dbPath = join(tempDir, "test.sqlite");
  await makeApp();
});

afterEach(async () => {
  if (app) await app.close();
  rmSync(tempDir, { recursive: true, force: true });
  if (previousLmStudioBaseUrl === undefined) {
    delete process.env.LM_STUDIO_BASE_URL;
  } else {
    process.env.LM_STUDIO_BASE_URL = previousLmStudioBaseUrl;
  }
  if (previousLmStudioTimeoutMs === undefined) {
    delete process.env.LM_STUDIO_TIMEOUT_MS;
  } else {
    process.env.LM_STUDIO_TIMEOUT_MS = previousLmStudioTimeoutMs;
  }
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

  it("creates an esp-hal tuned generation run from an indexed repository", async () => {
    const fixturePath = createEspHalFixture(tempDir);
    const response = await app.inject({
      method: "POST",
      url: "/api/generation/outline",
      payload: {
        repoUrl: fixturePath,
        model: "qwen3-coder 14B",
        audience: "embedded Rust maintainer",
        depth: "deep"
      }
    });
    expect(response.statusCode).toBe(200);
    const book = response.json().book;
    expect(book.title).toBe("esp-hal을 읽는 책");
    expect(book.repo).toContain("esp-hal");
    expect(book.subtitle).toEqual(expect.stringContaining("embedded Rust maintainer"));
    expect(book.subtitle).toEqual(expect.stringContaining("no_std HAL"));
    expect(book.parts.map((part: { title: string }) => part.title)).toEqual([
      "Part I. esp-hal 지형도",
      "Part II. 부팅, 칩 추상화, 시스템 초기화",
      "Part III. Peripheral driver를 읽는 법",
      "Part IV. Async, radio, examples",
      "Part V. 검증, 설정, 기여"
    ]);
    expect(book.chapters.length).toBeGreaterThanOrEqual(14);
    expect(book.chapters.map((chapter: { title: string }) => chapter.title)).toEqual(
      expect.arrayContaining(["DMA와 버퍼 ownership", "GPIO, IO mux, interrupt의 기본 문법", "HIL, QA, compile-tests로 신뢰도 읽기"])
    );
    expect(book.chapters.find((chapter: { title: string }) => chapter.title.includes("DMA")).files).toEqual(
      expect.arrayContaining(["esp-hal/src/dma/mod.rs", "esp-hal/src/dma/buffers.rs"])
    );
    expect(book.chapters[0].keyQuestion).toContain("Bare-metal Rust HAL");
    expect(book.chapters[0].responsibility).toContain("no_std Rust");
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
      bookId: book.id,
      status: "complete",
      progress: 100
    });
    expect(response.json().generationRun.steps.map((step: { detail: string }) => step.detail)).toEqual(
      expect.arrayContaining([expect.stringContaining("embedded-hal"), "local structured generation"])
    );
    expect(response.json().generationRun.outline).toHaveLength(5);
    expect(response.json().generationRun.artifacts.map((artifact: { kind: string }) => artifact.kind)).toEqual(
      expect.arrayContaining(["repository_analysis", "part_plan", "chapter_plan", "chapter_brief", "section_plan", "section_draft", "chapter_revision", "book_coherence", "quality_issues"])
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

  it("marks chapters failed when configured LM Studio is unavailable", async () => {
    process.env.LM_STUDIO_BASE_URL = "http://127.0.0.1:9";
    process.env.LM_STUDIO_TIMEOUT_MS = "50";
    const response = await app.inject({
      method: "POST",
      url: "/api/generation/outline",
      payload: {
        repoUrl: createEspHalFixture(tempDir),
        model: "qwen3-coder 14B",
        audience: "embedded Rust maintainer",
        depth: "balanced"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.generationRun.steps.map((step: { detail: string }) => step.detail)).toEqual(
      expect.arrayContaining([expect.stringContaining("LM Studio structured generation failed")])
    );
    expect(body.generationRun.chapterRuns.some((chapter: { status: string }) => chapter.status === "failed")).toBe(true);
    expect(body.generationRun.artifacts.some((artifact: { kind: string; payload: { status?: string } }) => artifact.kind === "section_draft" && artifact.payload.status === "failed")).toBe(true);
  });

  it("rejects meta LM Studio prose and records failed chapter text without deterministic prose fallback", async () => {
    const lmStudio = await startBadLmStudio();
    try {
      process.env.LM_STUDIO_BASE_URL = lmStudio.baseUrl;
      process.env.LM_STUDIO_TIMEOUT_MS = "2000";
      const response = await app.inject({
        method: "POST",
        url: "/api/generation/outline",
        payload: {
          repoUrl: createEspHalFixture(tempDir),
          model: "qwen3-coder 14B",
          audience: "embedded Rust maintainer",
          depth: "balanced"
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(lmStudio.requests()).toBeGreaterThan(1);
      expect(JSON.stringify(body.book.chapters[0].sections)).not.toContain("JSON parsing");
      expect(body.generationRun.chapterRuns.some((chapter: { status: string }) => chapter.status === "failed")).toBe(true);
      expect(body.generationRun.artifacts.some((artifact: { kind: string; payload: { error?: string } }) => artifact.kind === "section_draft" && artifact.payload.error)).toBe(true);
    } finally {
      await lmStudio.close();
    }
  });

  it("queues background generation runs and repairs failed chapters from stored evidence", async () => {
    process.env.LM_STUDIO_BASE_URL = "http://127.0.0.1:9";
    process.env.LM_STUDIO_TIMEOUT_MS = "50";

    const queued = await app.inject({
      method: "POST",
      url: "/api/generation/runs",
      payload: {
        repoUrl: createEspHalFixture(tempDir),
        model: "qwen3-coder 14B",
        audience: "embedded Rust maintainer",
        depth: "balanced",
        background: true
      }
    });

    expect(queued.statusCode).toBe(202);
    const runId = queued.json().generationRun.id;
    expect(queued.json().generationRun.status).toBe("queued");
    expect(queued.json().book).toBeNull();

    const polled = await waitForGenerationRun(runId);
    expect(polled.generationRun.status).toBe("complete");
    expect(polled.book.id).toBe(polled.generationRun.bookId);

    const failedChapters = polled.generationRun.chapterRuns.filter((chapter: { status: string }) => chapter.status === "failed");
    expect(failedChapters.length).toBeGreaterThan(0);

    const singleRetry = await app.inject({
      method: "POST",
      url: `/api/generation/runs/${runId}/chapters/${failedChapters[0].chapterId}/retry`
    });
    expect(singleRetry.statusCode).toBe(200);
    expect(singleRetry.json().retried).toBe(1);

    delete process.env.LM_STUDIO_BASE_URL;
    const retry = await app.inject({
      method: "POST",
      url: `/api/generation/runs/${runId}/retry-failed-chapters`
    });

    expect(retry.statusCode).toBe(200);
    expect(retry.json().retried).toBe(Math.max(0, failedChapters.length - 1));
    expect(retry.json().generationRun.chapterRuns.every((chapter: { status: string }) => chapter.status === "complete")).toBe(true);
    expect(retry.json().generationRun.chapterRuns.some((chapter: { source: string }) => chapter.source === "chapter repair retry")).toBe(true);
    expect(retry.json().book.chapters.every((chapter: { sections: unknown[] }) => chapter.sections.length >= 5)).toBe(true);
  });

  it("uses an OpenAI-compatible LM Studio adapter when available", async () => {
    const lmStudio = await startFakeLmStudio();
    try {
      process.env.LM_STUDIO_BASE_URL = lmStudio.baseUrl;
      process.env.LM_STUDIO_TIMEOUT_MS = "2000";
      const response = await app.inject({
        method: "POST",
        url: "/api/generation/outline",
        payload: {
          repoUrl: createEspHalFixture(tempDir),
          model: "qwen3-coder 14B",
          audience: "embedded Rust maintainer",
          depth: "deep"
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(lmStudio.requests()).toBeGreaterThan(body.book.chapters.length);
      expect(body.book.chapters[0].sections[0].body).toContain("저장소 책임");
      expect(body.book.chapters[0].sections[0].body).not.toContain("JSON parsing");
      expect(body.generationRun.steps.map((step: { detail: string }) => step.detail)).toEqual(
        expect.arrayContaining([expect.stringContaining("structured LM calls succeeded")])
      );
    } finally {
      await lmStudio.close();
    }
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

function createEspHalFixture(root: string) {
  const repoPath = join(root, "esp-hal");
  writeFixture(repoPath, "README.md", "# esp-hal\n\nBare-metal `no_std` hardware abstraction layer for Espressif devices including ESP32, ESP32-C3, ESP32-C6, ESP32-S2, and ESP32-S3.\n");
  writeFixture(
    repoPath,
    "Cargo.toml",
    '[workspace]\nmembers = ["esp-hal", "esp-backtrace", "esp-config", "esp-println", "esp-radio", "esp-phy", "esp-riscv-rt", "xtensa-lx-rt"]\nexclude = ["examples"]\n'
  );
  writeFixture(repoPath, "esp-hal/Cargo.toml", '[package]\nname = "esp-hal"\nversion = "1.0.0"\n\n[dependencies]\nembedded-hal = "1"\nembassy-executor = { version = "0.7", optional = true }\n');
  writeFixture(repoPath, "esp-hal/README.md", "# esp-hal\n\nCore HAL crate for ESP32 family chips. Supports GPIO, DMA, SPI, I2C, UART, timers, interrupt, and async Embassy integration.\n");
  writeFixture(repoPath, "esp-hal/src/lib.rs", "#![no_std]\n\npub mod asynch;\npub mod clock;\npub mod delay;\npub mod dma;\npub mod gpio;\npub mod i2c;\npub mod interrupt;\npub mod peripherals;\npub mod spi;\npub mod system;\npub mod timer;\npub mod uart;\n\npub fn init() {}\n");
  writeFixture(repoPath, "esp-hal/src/peripherals/mod.rs", "pub struct Peripherals;\n\nimpl Peripherals {\n    pub fn take() -> Self { Self }\n}\n");
  writeFixture(repoPath, "esp-hal/src/system.rs", "pub struct SystemControl;\n\npub fn enable_peripheral() {}\npub fn reset_peripheral() {}\n");
  writeFixture(repoPath, "esp-hal/src/clock/mod.rs", "pub struct ClockControl;\npub struct CpuClock;\n\npub fn configure_clock() {}\n");
  writeFixture(repoPath, "esp-hal/src/time.rs", "pub struct Hertz(pub u32);\n");
  writeFixture(repoPath, "esp-hal/src/delay.rs", "pub struct Delay;\nimpl Delay { pub fn delay_millis(&self, _ms: u32) {} }\n");
  writeFixture(repoPath, "esp-hal/src/interrupt/mod.rs", "pub struct InterruptHandler;\npub fn enable_interrupt() {}\n");
  writeFixture(repoPath, "esp-hal/src/gpio/mod.rs", "pub mod embedded_hal_impls;\npub mod interrupt;\n\npub struct InputPin;\npub struct OutputPin;\npub fn into_push_pull_output() {}\n");
  writeFixture(repoPath, "esp-hal/src/gpio/interrupt.rs", "pub fn listen_gpio_interrupt() {}\n");
  writeFixture(repoPath, "esp-hal/src/gpio/embedded_hal_impls.rs", "pub trait OutputPin {}\n");
  writeFixture(repoPath, "esp-hal/src/timer/mod.rs", "pub mod systimer;\npub mod timg;\npub struct Timer;\n");
  writeFixture(repoPath, "esp-hal/src/timer/systimer.rs", "pub struct SystemTimer;\n");
  writeFixture(repoPath, "esp-hal/src/timer/timg.rs", "pub struct TimerGroup;\n");
  writeFixture(repoPath, "esp-hal/src/dma/mod.rs", "pub mod buffers;\npub struct DmaChannel;\npub fn start_transfer() {}\n");
  writeFixture(repoPath, "esp-hal/src/dma/buffers.rs", "pub struct DmaBuffer;\npub fn split_dma_buffer() {}\n");
  writeFixture(repoPath, "esp-hal/src/spi/mod.rs", "pub struct Spi;\npub fn transaction() {}\n");
  writeFixture(repoPath, "esp-hal/src/i2c/mod.rs", "pub struct I2c;\npub fn write_read() {}\n");
  writeFixture(repoPath, "esp-hal/src/uart/mod.rs", "pub struct Uart;\npub fn read() {}\n");
  writeFixture(repoPath, "esp-hal/src/i2s/mod.rs", "pub struct I2s;\n");
  writeFixture(repoPath, "esp-hal/src/rmt.rs", "pub struct Rmt;\n");
  writeFixture(repoPath, "esp-hal/src/asynch.rs", "pub async fn yield_now() {}\n");
  writeFixture(repoPath, "esp-hal/esp_config.yml", "ESP_HAL_CONFIG_PLACE_SPI_DRIVER_IN_RAM: false\nESP_HAL_CONFIG_CPU_CLOCK: 160MHz\n");
  writeFixture(repoPath, "esp-hal/MIGRATING-1.0.0.md", "# Migrating to 1.0.0\n\nBreaking changes for peripheral ownership.\n");
  writeFixture(repoPath, "esp-hal/MIGRATING-1.1.0.md", "# Migrating to 1.1.0\n\nConfiguration changes.\n");
  writeFixture(repoPath, "esp-backtrace/Cargo.toml", '[package]\nname = "esp-backtrace"\nversion = "1.0.0"\n');
  writeFixture(repoPath, "esp-backtrace/src/lib.rs", "#![no_std]\npub fn install_backtrace() {}\n");
  writeFixture(repoPath, "esp-config/Cargo.toml", '[package]\nname = "esp-config"\nversion = "1.0.0"\n');
  writeFixture(repoPath, "esp-println/Cargo.toml", '[package]\nname = "esp-println"\nversion = "1.0.0"\n');
  writeFixture(repoPath, "esp-riscv-rt/Cargo.toml", '[package]\nname = "esp-riscv-rt"\nversion = "1.0.0"\n');
  writeFixture(repoPath, "esp-riscv-rt/src/lib.rs", "#![no_std]\npub fn riscv_entry() {}\n");
  writeFixture(repoPath, "xtensa-lx-rt/Cargo.toml", '[package]\nname = "xtensa-lx-rt"\nversion = "1.0.0"\n');
  writeFixture(repoPath, "xtensa-lx-rt/src/lib.rs", "#![no_std]\npub fn xtensa_entry() {}\n");
  writeFixture(repoPath, "esp-radio/Cargo.toml", '[package]\nname = "esp-radio"\nversion = "1.0.0"\n');
  writeFixture(repoPath, "esp-radio/README.md", "# esp-radio\n\nWi-Fi, BLE, and IEEE 802.15.4 support for ESP chips.\n");
  writeFixture(repoPath, "esp-radio/src/lib.rs", "#![no_std]\npub fn init_radio() {}\n");
  writeFixture(repoPath, "esp-phy/Cargo.toml", '[package]\nname = "esp-phy"\nversion = "1.0.0"\n');
  writeFixture(repoPath, "esp-phy/README.md", "# esp-phy\n\nPHY support used by esp-radio.\n");
  writeFixture(repoPath, "examples/README.md", "# Examples\n\nStart with hello_world, then interrupt, peripheral, async, wifi, and ble examples.\n");
  writeFixture(repoPath, "examples/hello_world/src/main.rs", "#![no_std]\nfn main() {}\n");
  writeFixture(repoPath, "examples/interrupt/gpio/Cargo.toml", '[package]\nname = "gpio_interrupt_example"\nversion = "0.0.0"\n');
  writeFixture(repoPath, "examples/peripheral/twai/Cargo.toml", '[package]\nname = "twai_example"\nversion = "0.0.0"\n');
  writeFixture(repoPath, "examples/ota/update/Cargo.toml", '[package]\nname = "ota_update_example"\nversion = "0.0.0"\n');
  writeFixture(repoPath, "examples/async/embassy_hello_world/Cargo.toml", '[package]\nname = "embassy_hello_world"\nversion = "0.0.0"\n');
  writeFixture(repoPath, "examples/async/embassy_multicore/Cargo.toml", '[package]\nname = "embassy_multicore"\nversion = "0.0.0"\n');
  writeFixture(repoPath, "examples/async/embassy_spi/Cargo.toml", '[package]\nname = "embassy_spi"\nversion = "0.0.0"\n');
  writeFixture(repoPath, "examples/async/embassy_serial/Cargo.toml", '[package]\nname = "embassy_serial"\nversion = "0.0.0"\n');
  writeFixture(repoPath, "examples/wifi/embassy_access_point/Cargo.toml", '[package]\nname = "embassy_access_point"\nversion = "0.0.0"\n');
  writeFixture(repoPath, "examples/ble/scanner/Cargo.toml", '[package]\nname = "ble_scanner"\nversion = "0.0.0"\n');
  writeFixture(repoPath, "documentation/HIL-GUIDE.md", "# HIL Guide\n\nHardware-in-the-loop testing checks real boards and chip variants.\n");
  writeFixture(repoPath, "documentation/DEVELOPER-GUIDELINES.md", "# Developer Guidelines\n\nReview API changes and feature gates carefully.\n");
  writeFixture(repoPath, "documentation/CONTRIBUTING.md", "# Contributing\n\nRun QA and compile-tests before submitting changes.\n");
  writeFixture(repoPath, "hil-test/README.md", "# HIL Test\n\nBoard-backed HAL validation.\n");
  writeFixture(repoPath, "qa-test/README.md", "# QA Test\n\nRelease confidence checks.\n");
  writeFixture(repoPath, "compile-tests/README.md", "# Compile Tests\n\nAPI compatibility checks.\n");
  return repoPath;
}

function writeFixture(root: string, path: string, body: string) {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, body, "utf8");
}

async function startFakeLmStudio() {
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.statusCode = 404;
      response.end();
      return;
    }

    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests += 1;
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        messages: Array<{ role: string; content: string }>;
      };
      const userMessage = payload.messages.find((message) => message.role === "user");
      const prompt = JSON.parse(userMessage?.content ?? "{}") as { schemaName?: string; context?: Record<string, unknown> };
      const context = prompt.context ?? {};
      const content = fakeStructuredPayload(prompt.schemaName ?? "", context);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests: () => requests,
    close: () => closeServer(server)
  };
}

function fakeStructuredPayload(schemaName: string, context: Record<string, unknown>) {
  if (schemaName === "RepoBookPartPlan") return { parts: context.fallbackParts ?? [] };
  if (schemaName === "RepoBookChapterPlan") return { chapters: context.fallbackChapters ?? [] };
  if (schemaName === "RepoBookChapterBrief") return context.baseBrief ?? {};
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

async function startBadLmStudio() {
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.statusCode = 404;
      response.end();
      return;
    }

    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      requests += 1;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  body: [
                    "이 테스트는 fake OpenAI-compatible 응답이 adapter와 JSON parsing 처리를 통과하는지 확인하기 위해 충분히 긴 prose를 제공합니다.",
                    "모델 응답과 프롬프트 처리 상태를 설명하는 문장이므로 독자가 읽는 저장소 기술서 본문에는 저장되면 안 됩니다."
                  ].join("\n\n")
                })
              }
            }
          ]
        })
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests: () => requests,
    close: () => closeServer(server)
  };
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
