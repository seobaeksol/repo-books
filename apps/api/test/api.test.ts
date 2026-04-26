import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
    expect(response.json().generationRun).toMatchObject({
      repoUrl: fixturePath,
      branch: "main",
      bookId: book.id,
      status: "complete",
      progress: 100
    });
    expect(response.json().generationRun.steps.map((step: { detail: string }) => step.detail)).toEqual(expect.arrayContaining(["esp-hal HAL profile"]));
    expect(response.json().generationRun.outline).toHaveLength(5);

    const detail = await app.inject({ method: "GET", url: `/api/books/${book.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().book.chapters.length).toBe(book.chapters.length);
    expect(detail.json().readingState).toMatchObject({ bookId: book.id, chapterId: book.currentChapterId, progressPercent: book.progress });
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
