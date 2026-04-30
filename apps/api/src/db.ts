import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  type BookChapter,
  type BookFilter,
  type GenerationArtifact,
  type BookPart,
  type GenerationChapterRun,
  type GenerationRun,
  type ImportSyncSnapshotPayload,
  type PatchUserProfilePayload,
  type PatchReadingStatePayload,
  type PatchUIStatePayload,
  type PostGenerationOutlinePayload,
  type PostTutorMessagePayload,
  type PostUserProfilePayload,
  type ReadingState,
  type RepoBook,
  type SyncSnapshot,
  type SyncStatus,
  type TutorMessage,
  type TutorThread,
  type UIState,
  type UserProfile,
  postGenerationOutlineSchema,
  seedBooks,
  seedUiState
} from "@repo-books/shared";
import { buildRepoIndex } from "./generation/indexer.js";
import { createStructuredGenerationClient } from "./generation/proseAdapter.js";
import { generationSteps, synthesizeRepoBook, type SynthesisHooks } from "./generation/synthesizer.js";
import { materializeRepository, repositorySlugFromUrl, slugify } from "./generation/source.js";

type SqliteDatabase = Database.Database;
type Row = Record<string, unknown>;

export type RepoBooksRepository = ReturnType<typeof createRepository>;

const sourceDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(sourceDir, "../../..");

export const defaultDbPath = () => process.env.REPO_BOOKS_DB_PATH ?? resolve(repoRoot, ".local/repo-books.sqlite");

const nowIso = () => new Date().toISOString();

const json = <T>(value: T) => JSON.stringify(value);

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string" || value.length === 0) return fallback;
  return JSON.parse(value) as T;
};

const asString = (value: unknown) => String(value ?? "");
const asNumber = (value: unknown) => Number(value ?? 0);

export const defaultUserId = "local";
const syncSchemaVersion = 1;
const interruptedGenerationMessage =
  "서버가 재시작되어 백그라운드 책 생성 작업이 중단되었습니다. 이미 만들어진 챕터는 부분 원고로 읽을 수 있습니다.";

const defaultUserProfile = (): UserProfile => ({
  id: defaultUserId,
  name: "Local reader",
  color: "cyan",
  createdAt: seedUiState.updatedAt,
  updatedAt: seedUiState.updatedAt
});

export const openDatabase = (dbPath = defaultDbPath()) => {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
};

export const migrate = (db: SqliteDatabase) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_metadata (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      active_user_id TEXT NOT NULL DEFAULT 'local' REFERENCES users(id) ON DELETE SET DEFAULT,
      last_export_at TEXT,
      last_import_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      repo TEXT NOT NULL,
      branch TEXT NOT NULL,
      model TEXT NOT NULL,
      updated TEXT NOT NULL,
      status TEXT NOT NULL,
      status_label TEXT NOT NULL,
      accent TEXT NOT NULL,
      progress REAL NOT NULL,
      current_chapter_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS parts (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      part_id TEXT NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL,
      number TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      progress REAL NOT NULL,
      status TEXT NOT NULL,
      estimated_minutes INTEGER NOT NULL,
      files_json TEXT NOT NULL,
      goals_json TEXT NOT NULL,
      sections_json TEXT NOT NULL,
      code_json TEXT NOT NULL,
      notes_json TEXT NOT NULL,
      checkpoints_json TEXT NOT NULL,
      chapter_body_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS reading_states (
      user_id TEXT NOT NULL DEFAULT 'local' REFERENCES users(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      progress_percent REAL NOT NULL,
      scroll_y REAL NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, book_id)
    );

    CREATE TABLE IF NOT EXISTS generation_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local' REFERENCES users(id) ON DELETE CASCADE,
      book_id TEXT REFERENCES books(id) ON DELETE SET NULL,
      repo_url TEXT NOT NULL,
      branch TEXT NOT NULL,
      model TEXT NOT NULL,
      context TEXT NOT NULL,
      status TEXT NOT NULL,
      progress REAL NOT NULL,
      steps_json TEXT NOT NULL,
      outline_json TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generation_chapter_runs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      source TEXT NOT NULL,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generation_artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
      chapter_id TEXT,
      kind TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tutor_threads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local' REFERENCES users(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tutor_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES tutor_threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      body TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ui_state (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      id TEXT NOT NULL DEFAULT 'default',
      active_book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      active_chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
      view TEXT NOT NULL,
      focus INTEGER NOT NULL,
      mobile_panel TEXT NOT NULL,
      preferences_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  upsertUser(db, defaultUserProfile());
  ensureSyncMetadata(db);
  ensureColumn(db, "generation_runs", "payload_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, "generation_runs", "error", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "generation_runs", "user_id", "TEXT NOT NULL DEFAULT 'local'");
  ensureColumn(db, "tutor_threads", "user_id", "TEXT NOT NULL DEFAULT 'local'");
  ensureColumn(db, "chapters", "chapter_body_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureUserScopedStateTables(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reading_states_user ON reading_states(user_id);
    CREATE INDEX IF NOT EXISTS idx_generation_runs_user ON generation_runs(user_id);
    CREATE INDEX IF NOT EXISTS idx_generation_artifacts_run ON generation_artifacts(run_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_tutor_threads_user_context ON tutor_threads(user_id, book_id, chapter_id);
  `);
};

const ensureColumn = (db: SqliteDatabase, table: string, column: string, definition: string) => {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
};

const upsertUser = (db: SqliteDatabase, user: UserProfile) => {
  db.prepare(
    `INSERT INTO users (id, name, color, created_at, updated_at)
     VALUES (@id, @name, @color, @createdAt, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       color = excluded.color,
       updated_at = excluded.updated_at`
  ).run(user);
};

const ensureSyncMetadata = (db: SqliteDatabase) => {
  const existing = db.prepare("SELECT id FROM sync_metadata WHERE id = 'default'").get() as Row | undefined;
  if (existing) return;

  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO sync_metadata (id, device_id, schema_version, active_user_id, last_export_at, last_import_at, updated_at)
     VALUES ('default', ?, ?, ?, NULL, NULL, ?)`
  ).run(`local-${randomUUID()}`, syncSchemaVersion, defaultUserId, timestamp);
};

const tableInfo = (db: SqliteDatabase, table: string) => db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; pk: number }>;

const ensureUserScopedStateTables = (db: SqliteDatabase) => {
  const readingInfo = tableInfo(db, "reading_states");
  const readingPk = readingInfo.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
  if (readingPk.join(",") !== "user_id,book_id") {
    const userIdExpression = readingInfo.some((column) => column.name === "user_id") ? "COALESCE(user_id, 'local')" : "'local'";
    rebuildTable(db, `
      ALTER TABLE reading_states RENAME TO reading_states_legacy;
      CREATE TABLE reading_states (
        user_id TEXT NOT NULL DEFAULT 'local' REFERENCES users(id) ON DELETE CASCADE,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        progress_percent REAL NOT NULL,
        scroll_y REAL NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, book_id)
      );
      INSERT OR REPLACE INTO reading_states (user_id, book_id, chapter_id, progress_percent, scroll_y, updated_at)
      SELECT ${userIdExpression}, book_id, chapter_id, progress_percent, scroll_y, updated_at
      FROM reading_states_legacy;
      DROP TABLE reading_states_legacy;
    `);
  }

  const uiInfo = tableInfo(db, "ui_state");
  const uiPk = uiInfo.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
  if (uiPk.join(",") !== "user_id") {
    const userIdExpression = uiInfo.some((column) => column.name === "user_id") ? "COALESCE(user_id, 'local')" : "'local'";
    rebuildTable(db, `
      ALTER TABLE ui_state RENAME TO ui_state_legacy;
      CREATE TABLE ui_state (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        id TEXT NOT NULL DEFAULT 'default',
        active_book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        active_chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
        view TEXT NOT NULL,
        focus INTEGER NOT NULL,
        mobile_panel TEXT NOT NULL,
        preferences_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT OR REPLACE INTO ui_state (
        user_id, id, active_book_id, active_chapter_id, view, focus, mobile_panel, preferences_json, updated_at
      )
      SELECT ${userIdExpression}, 'default', active_book_id, active_chapter_id, view, focus, mobile_panel, preferences_json, updated_at
      FROM ui_state_legacy;
      DROP TABLE ui_state_legacy;
    `);
  }
};

const rebuildTable = (db: SqliteDatabase, sql: string) => {
  db.pragma("foreign_keys = OFF");
  try {
    db.exec(sql);
  } finally {
    db.pragma("foreign_keys = ON");
  }
};

export const createRepository = (db: SqliteDatabase) => {
  const insertBook = db.prepare(`
    INSERT INTO books (
      id, title, subtitle, repo, branch, model, updated, status, status_label, accent, progress, current_chapter_id
    ) VALUES (
      @id, @title, @subtitle, @repo, @branch, @model, @updated, @status, @statusLabel, @accent, @progress, @currentChapterId
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      subtitle = excluded.subtitle,
      repo = excluded.repo,
      branch = excluded.branch,
      model = excluded.model,
      updated = excluded.updated,
      status = excluded.status,
      status_label = excluded.status_label,
      accent = excluded.accent,
      progress = excluded.progress,
      current_chapter_id = excluded.current_chapter_id
  `);

  const insertPart = db.prepare(`
    INSERT INTO parts (id, book_id, sort_order, title, summary)
    VALUES (@id, @bookId, @order, @title, @summary)
    ON CONFLICT(id) DO UPDATE SET
      book_id = excluded.book_id,
      sort_order = excluded.sort_order,
      title = excluded.title,
      summary = excluded.summary
  `);

  const insertChapter = db.prepare(`
    INSERT INTO chapters (
      id, book_id, part_id, sort_order, number, title, subtitle, progress, status, estimated_minutes,
      files_json, goals_json, sections_json, code_json, notes_json, checkpoints_json, chapter_body_json
    ) VALUES (
      @id, @bookId, @partId, @order, @number, @title, @subtitle, @progress, @status, @estimatedMinutes,
      @filesJson, @goalsJson, @sectionsJson, @codeJson, @notesJson, @checkpointsJson, @chapterBodyJson
    )
    ON CONFLICT(id) DO UPDATE SET
      book_id = excluded.book_id,
      part_id = excluded.part_id,
      sort_order = excluded.sort_order,
      number = excluded.number,
      title = excluded.title,
      subtitle = excluded.subtitle,
      progress = excluded.progress,
      status = excluded.status,
      estimated_minutes = excluded.estimated_minutes,
      files_json = excluded.files_json,
      goals_json = excluded.goals_json,
      sections_json = excluded.sections_json,
      code_json = excluded.code_json,
      notes_json = excluded.notes_json,
      checkpoints_json = excluded.checkpoints_json,
      chapter_body_json = excluded.chapter_body_json
  `);

  const insertGenerationRun = db.prepare(`
    INSERT INTO generation_runs (
      id, user_id, book_id, repo_url, branch, model, context, status, progress, steps_json, outline_json, payload_json, error, created_at, updated_at
    ) VALUES (
      @id, @userId, @bookId, @repoUrl, @branch, @model, @context, @status, @progress, @stepsJson, @outlineJson, @payloadJson, @error, @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      book_id = excluded.book_id,
      repo_url = excluded.repo_url,
      branch = excluded.branch,
      model = excluded.model,
      context = excluded.context,
      status = excluded.status,
      progress = excluded.progress,
      steps_json = excluded.steps_json,
      outline_json = excluded.outline_json,
      payload_json = excluded.payload_json,
      error = excluded.error,
      updated_at = excluded.updated_at
  `);

  const updateGenerationRun = db.prepare(`
    UPDATE generation_runs SET
      book_id = @bookId,
      branch = @branch,
      status = @status,
      progress = @progress,
      steps_json = @stepsJson,
      outline_json = @outlineJson,
      error = @error,
      updated_at = @updatedAt
    WHERE id = @id
  `);

  const updateGeneratingBook = db.prepare(`
    UPDATE books SET
      updated = @updated,
      status_label = @statusLabel,
      progress = @progress
    WHERE id = @bookId AND status = 'generating'
  `);

  const insertGenerationChapterRun = db.prepare(`
    INSERT INTO generation_chapter_runs (
      id, run_id, chapter_id, sort_order, title, status, attempts, source, last_error, updated_at
    ) VALUES (
      @id, @runId, @chapterId, @order, @title, @status, @attempts, @source, @lastError, @updatedAt
    )
  `);

  const insertGenerationArtifact = db.prepare(`
    INSERT INTO generation_artifacts (id, run_id, chapter_id, kind, sort_order, payload_json, created_at)
    VALUES (@id, @runId, @chapterId, @kind, @order, @payloadJson, @createdAt)
  `);

  const saveBook = db.transaction((book: RepoBook) => {
    insertBook.run(book);
    for (const part of book.parts) insertPart.run(part);
    for (const chapter of book.chapters) {
      insertChapter.run({
        ...chapter,
        filesJson: json(chapter.files),
        goalsJson: json(chapter.goals),
        sectionsJson: json(chapter.sections),
        codeJson: json(chapter.code),
        notesJson: json(chapter.notes),
        checkpointsJson: json(chapter.checkpoints),
        chapterBodyJson: json(chapterBodyJson(chapter))
      });
    }
  });

  const getParts = (bookId: string): BookPart[] =>
    db
      .prepare("SELECT id, book_id, sort_order, title, summary FROM parts WHERE book_id = ? ORDER BY sort_order")
      .all(bookId)
      .map((row) => mapPart(row as Row));

  const getChapters = (bookId: string): BookChapter[] =>
    db
      .prepare("SELECT * FROM chapters WHERE book_id = ? ORDER BY sort_order")
      .all(bookId)
      .map((row) => mapChapter(row as Row));

  const getBaseBook = (bookId: string): RepoBook | null => {
    const row = db.prepare("SELECT * FROM books WHERE id = ?").get(bookId) as Row | undefined;
    if (!row) return null;
    return mapBook(row, getParts(bookId), getChapters(bookId));
  };

  const getBook = (bookId: string, userId = defaultUserId): RepoBook | null => {
    materializePartialBookForBook(bookId);
    const book = getBaseBook(bookId);
    return book ? attachGenerationRunId(applyUserReadingState(book, userId)) : null;
  };

  const listBooks = (filter: BookFilter, userId = defaultUserId): RepoBook[] => {
    materializePartialBooksForActiveRuns();
    const statusFilter = filter === "in_progress" ? "reading" : filter === "all" ? null : filter;
    const rows = statusFilter
      ? db.prepare("SELECT * FROM books WHERE status = ? ORDER BY rowid").all(statusFilter)
      : db.prepare("SELECT * FROM books ORDER BY rowid").all();
    return rows.map((row) => {
      const bookId = asString((row as Row).id);
      return attachGenerationRunId(applyUserReadingState(mapBook(row as Row, getParts(bookId), getChapters(bookId)), userId));
    });
  };

  const getReadingState = (bookId: string, userId = defaultUserId): ReadingState | null => {
    const row = db.prepare("SELECT * FROM reading_states WHERE user_id = ? AND book_id = ?").get(userId, bookId) as Row | undefined;
    if (row) return mapReadingState(row);

    const book = getBaseBook(bookId);
    if (!book) return null;
    const chapter = book.chapters.find((item) => item.id === book.currentChapterId) ?? book.chapters[0];
    if (!chapter) return null;
    const state: ReadingState = {
      userId,
      bookId,
      chapterId: chapter.id,
      progressPercent: chapter.progress,
      scrollY: 0,
      updatedAt: nowIso()
    };
    upsertReadingState(state);
    return state;
  };

  const saveReadingState = (bookId: string, payload: PatchReadingStatePayload, userId = defaultUserId): ReadingState => {
    ensureUser(userId);
    materializePartialBookForBook(bookId);
    const book = getBaseBook(bookId);
    if (!book) throw new Error("BOOK_NOT_FOUND");
    if (!book.chapters.some((chapter) => chapter.id === payload.chapterId)) throw new Error("CHAPTER_NOT_FOUND");

    const updatedAt = nowIso();
    const state: ReadingState = { userId, bookId, chapterId: payload.chapterId, progressPercent: payload.progressPercent, scrollY: payload.scrollY, updatedAt };
    upsertReadingState(state);
    db.prepare("UPDATE books SET updated = ? WHERE id = ?").run("방금 전", bookId);
    return state;
  };

  const getUiState = (userId = defaultUserId): UIState => {
    ensureUserState(userId);
    const row = db.prepare("SELECT * FROM ui_state WHERE user_id = ?").get(userId) as Row | undefined;
    if (!row) throw new Error("UI_STATE_NOT_FOUND");
    return mapUiState(row);
  };

  const saveUiState = (payload: PatchUIStatePayload, userId = defaultUserId): UIState => {
    const current = getUiState(userId);
    const next: UIState = {
      ...current,
      ...payload,
      activeChapterId: payload.activeChapterId === undefined ? current.activeChapterId : payload.activeChapterId,
      preferences: payload.preferences === undefined ? current.preferences : payload.preferences,
      updatedAt: nowIso()
    };
    db.prepare(
      `UPDATE ui_state SET
        active_book_id = @activeBookId,
        active_chapter_id = @activeChapterId,
        view = @view,
        focus = @focus,
        mobile_panel = @mobilePanel,
        preferences_json = @preferencesJson,
        updated_at = @updatedAt
       WHERE user_id = @userId`
    ).run({
      ...next,
      focus: next.focus ? 1 : 0,
      preferencesJson: json(next.preferences)
    });
    return next;
  };

  const createGenerationRun = async (payload: PostGenerationOutlinePayload, userId = defaultUserId): Promise<{ generationRun: GenerationRun; book: RepoBook | null }> => {
    ensureUser(userId);
    const timestamp = nowIso();
    const bookId = `generated-${slugify(repositorySlugFromUrl(payload.repoUrl))}-${timestamp.replace(/[^0-9]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const run: GenerationRun = {
      id: randomUUID(),
      userId,
      bookId,
      repoUrl: payload.repoUrl,
      branch: payload.branch,
      model: payload.model,
      context: payload.context,
      status: "queued",
      progress: 0,
      steps: pendingGenerationSteps(),
      outline: [],
      chapterRuns: [],
      artifacts: [],
      error: "",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const placeholder = createGeneratingBook(payload, bookId, run.id);
    const createRun = db.transaction(() => {
      saveBook(placeholder);
      insertGenerationRun.run({
        ...run,
        stepsJson: json(run.steps),
        outlineJson: json(run.outline),
        payloadJson: json(payload)
      });
    });
    createRun();

    if (payload.background) {
      setTimeout(() => {
        void processGenerationRun(run.id).catch(() => undefined);
      }, 0);
      return { generationRun: run, book: attachGenerationRunId(placeholder) };
    }

    try {
      return await processGenerationRun(run.id, userId);
    } catch {
      const failedRun = getGenerationRun(run.id);
      if (failedRun) return { generationRun: failedRun, book: failedRun.bookId ? getBook(failedRun.bookId, failedRun.userId) : null };
      throw new Error("GENERATION_RUN_NOT_FOUND");
    }
  };

  const getGenerationRun = (runId: string): GenerationRun | null => {
    const row = db.prepare("SELECT * FROM generation_runs WHERE id = ?").get(runId) as Row | undefined;
    if (!row) return null;
    return mapGenerationRun(row, listGenerationChapterRuns(runId), listGenerationArtifacts(runId));
  };

  const listGenerationChapterRuns = (runId: string): GenerationChapterRun[] =>
    db
      .prepare("SELECT * FROM generation_chapter_runs WHERE run_id = ? ORDER BY sort_order")
      .all(runId)
      .map((row) => mapGenerationChapterRun(row as Row));

  const listGenerationArtifacts = (runId: string): GenerationArtifact[] =>
    db
      .prepare("SELECT * FROM generation_artifacts WHERE run_id = ? ORDER BY sort_order, rowid")
      .all(runId)
      .map((row) => mapGenerationArtifact(row as Row));

  const retryFailedGenerationChapters = async (runId: string): Promise<{ generationRun: GenerationRun; book: RepoBook | null; retried: number }> => {
    const run = getGenerationRun(runId);
    if (!run) throw new Error("GENERATION_RUN_NOT_FOUND");
    if (run.status === "queued" || run.status === "running") throw new Error("GENERATION_RUN_BUSY");

    const failedChapters = run.chapterRuns.filter((chapter) => chapter.status === "failed");
    if (failedChapters.length === 0) return { generationRun: run, book: run.bookId ? getBook(run.bookId, run.userId) : null, retried: 0 };

    const result = await processGenerationRun(runId, run.userId);
    return { ...result, retried: failedChapters.length };
  };

  const retryGenerationChapter = async (runId: string, chapterId: string): Promise<{ generationRun: GenerationRun; book: RepoBook | null; retried: number }> => {
    const run = getGenerationRun(runId);
    if (!run) throw new Error("GENERATION_RUN_NOT_FOUND");
    if (run.status === "queued" || run.status === "running") throw new Error("GENERATION_RUN_BUSY");

    const chapter = run.chapterRuns.find((item) => item.chapterId === chapterId);
    if (!chapter) throw new Error("CHAPTER_RUN_NOT_FOUND");

    const result = await processGenerationRun(runId, run.userId);
    return { ...result, retried: 1 };
  };

  const processGenerationRun = async (runId: string, fallbackUserId = defaultUserId): Promise<{ generationRun: GenerationRun; book: RepoBook | null }> => {
    const row = db.prepare("SELECT * FROM generation_runs WHERE id = ?").get(runId) as Row | undefined;
    if (!row) throw new Error("GENERATION_RUN_NOT_FOUND");
    const userId = asString(row.user_id) || fallbackUserId;
    const payload = postGenerationOutlineSchema.parse({
      repoUrl: asString(row.repo_url),
      branch: asString(row.branch),
      model: asString(row.model),
      context: asString(row.context),
      ...parseJson<Partial<PostGenerationOutlinePayload>>(row.payload_json, {}),
      background: false
    });
    const startedAt = nowIso();
    const startingRun = mapGenerationRun(row, listGenerationChapterRuns(runId), listGenerationArtifacts(runId));
    updateGenerationRunRecord({
      ...startingRun,
      status: "running",
      progress: 10,
      steps: runningGenerationSteps(),
      error: "",
      updatedAt: startedAt
    });
    db.prepare("DELETE FROM generation_artifacts WHERE run_id = ?").run(runId);
    let artifactOrder = 0;
    const saveArtifact: NonNullable<SynthesisHooks["onArtifact"]> = (artifact) => {
      insertGenerationArtifact.run({
        id: randomUUID(),
        runId,
        chapterId: artifact.chapterId ?? null,
        kind: artifact.kind,
        order: artifactOrder,
        payloadJson: json(artifact.payload),
        createdAt: nowIso()
      });
      artifactOrder += 1;
      materializePartialBookForRun(runId);
    };
    const updateStage: NonNullable<SynthesisHooks["onStage"]> = (label, detail, progress) => {
      const current = getGenerationRun(runId);
      if (!current) return;
      updateGenerationRunRecord({
        ...current,
        status: "running",
        progress: Math.max(current.progress, Math.min(99, progress)),
        steps: stagedGenerationSteps(label, detail),
        error: "",
        updatedAt: nowIso()
      });
    };

    try {
      const generationClient = createStructuredGenerationClient();
      updateStage("모델 준비", `LM Studio 모델 ${payload.model} 확인 중`, 8);
      await generationClient.prepareModel(payload.model, (detail) => updateStage("모델 준비", detail, 8));
      updateStage("저장소 분석", "materializing repository and building index", 12);
      const source = materializeRepository(payload.repoUrl, payload.branch);
      const index = buildRepoIndex(source);
      const { book, outline, prose, chapterProse } = await synthesizeRepoBook(
        payload,
        index,
        {
          onStage: updateStage,
          onArtifact: saveArtifact,
          structuredGenerationClient: generationClient
        },
        startingRun.bookId ?? undefined
      );
      const timestamp = nowIso();
      const chapterRuns: GenerationChapterRun[] = chapterProse.map((chapter) => ({
        id: randomUUID(),
        runId,
        chapterId: chapter.chapterId,
        order: chapter.order,
        title: chapter.title,
        status: chapter.status,
        attempts: chapter.attempts,
        source: chapter.source,
        lastError: chapter.lastError,
        updatedAt: timestamp
      }));
      const completedRun: GenerationRun = {
        ...startingRun,
        bookId: book.id,
        branch: index.branch,
        status: "complete",
        progress: 100,
        steps: generationSteps(index, prose),
        outline,
        chapterRuns,
        error: "",
        updatedAt: timestamp
      };

      const save = db.transaction(() => {
        saveBook(book);
        updateGenerationRunRecord(completedRun);
        db.prepare("DELETE FROM generation_chapter_runs WHERE run_id = ?").run(runId);
        for (const chapterRun of chapterRuns) insertGenerationChapterRun.run(chapterRun);
        upsertReadingState({
          userId,
          bookId: book.id,
          chapterId: book.currentChapterId,
          progressPercent: book.progress,
          scrollY: 0,
          updatedAt: timestamp
        });
      });
      save();

      const generationRun = getGenerationRun(runId);
      if (!generationRun) throw new Error("GENERATION_RUN_NOT_FOUND");
      return { generationRun, book };
    } catch (error) {
      const failedAt = nowIso();
      const current = getGenerationRun(runId) ?? startingRun;
      updateGenerationRunRecord({
        ...current,
        status: "failed",
        progress: Math.max(current.progress, 10),
        steps: markActiveGenerationStepFailed(current.steps, errorMessage(error)),
        error: errorMessage(error),
        updatedAt: failedAt
      });
      throw error;
    }
  };

  const updateGenerationRunRecord = (run: GenerationRun) => {
    updateGenerationRun.run({
      ...run,
      stepsJson: json(run.steps),
      outlineJson: json(run.outline)
    });
    if (run.bookId && run.status !== "complete") {
      updateGeneratingBook.run({
        bookId: run.bookId,
        updated: run.status === "failed" ? "생성 실패" : "생성 중",
        statusLabel: generationBookStatusLabel(run),
        progress: run.progress
      });
    }
  };

  const recoverInterruptedGenerationRuns = () => {
    const rows = db.prepare("SELECT * FROM generation_runs WHERE status IN ('queued', 'running') ORDER BY created_at, rowid").all() as Row[];
    for (const row of rows) {
      const runId = asString(row.id);
      materializePartialBookForRun(runId);
      const run = getGenerationRun(runId);
      if (!run || (run.status !== "queued" && run.status !== "running")) continue;
      updateGenerationRunRecord({
        ...run,
        status: "failed",
        progress: Math.max(run.progress, 10),
        steps: markActiveGenerationStepFailed(run.steps.length ? run.steps : runningGenerationSteps(), interruptedGenerationMessage),
        error: interruptedGenerationMessage,
        updatedAt: nowIso()
      });
    }
  };

  const materializePartialBooksForActiveRuns = () => {
    const rows = db.prepare("SELECT id FROM generation_runs WHERE status IN ('queued', 'running', 'failed') AND book_id IS NOT NULL ORDER BY created_at, rowid").all() as Row[];
    for (const row of rows) materializePartialBookForRun(asString(row.id));
  };

  const materializePartialBookForBook = (bookId: string) => {
    const row = db
      .prepare("SELECT id FROM generation_runs WHERE book_id = ? AND status IN ('queued', 'running', 'failed') ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(bookId) as Row | undefined;
    if (row) materializePartialBookForRun(asString(row.id));
  };

  const materializePartialBookForRun = (runId: string): RepoBook | null => {
    const run = getGenerationRun(runId);
    if (!run?.bookId || run.status === "complete") return null;
    const base = getBaseBook(run.bookId);
    if (!base) return null;

    const partialBook = buildPartialBookFromArtifacts(base, run);
    if (!partialBook.parts.length && !partialBook.chapters.length) return null;
    saveBook(partialBook);
    return partialBook;
  };

  const listTutorThreads = (filters: { bookId?: string; chapterId?: string }, userId = defaultUserId): TutorThread[] => {
    ensureUser(userId);
    const clauses: string[] = ["user_id = ?"];
    const values: string[] = [userId];
    if (filters.bookId) {
      clauses.push("book_id = ?");
      values.push(filters.bookId);
    }
    if (filters.chapterId) {
      clauses.push("chapter_id = ?");
      values.push(filters.chapterId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db.prepare(`SELECT * FROM tutor_threads ${where} ORDER BY updated_at DESC`).all(...values) as Row[];
    if (rows.length === 0 && filters.bookId && filters.chapterId) {
      return [createDefaultTutorThread(filters.bookId, filters.chapterId, userId)];
    }
    return rows.map((row) => mapTutorThread(row, listTutorMessages(asString(row.id))));
  };

  const listTutorMessages = (threadId: string): TutorMessage[] =>
    db
      .prepare("SELECT * FROM tutor_messages WHERE thread_id = ? ORDER BY created_at, rowid")
      .all(threadId)
      .map((row) => mapTutorMessage(row as Row));

  const appendTutorMessage = (threadId: string, payload: PostTutorMessagePayload, userId = defaultUserId): TutorThread => {
    const thread = db.prepare("SELECT * FROM tutor_threads WHERE id = ? AND user_id = ?").get(threadId, userId) as Row | undefined;
    if (!thread) throw new Error("THREAD_NOT_FOUND");

    const createdAt = nowIso();
    insertTutorMessage(db, {
      id: randomUUID(),
      threadId,
      role: payload.role,
      body: payload.body,
      metadata: payload.metadata,
      createdAt
    });

    if (payload.role === "user") {
      insertTutorMessage(db, {
        id: randomUUID(),
        threadId,
        role: "assistant",
        body: buildTutorReply(thread, payload.body),
        metadata: { generated: "contextual" },
        createdAt: nowIso()
      });
    }

    db.prepare("UPDATE tutor_threads SET updated_at = ? WHERE id = ?").run(nowIso(), threadId);
    const updatedThread = db.prepare("SELECT * FROM tutor_threads WHERE id = ?").get(threadId) as Row;
    return mapTutorThread(updatedThread, listTutorMessages(threadId));
  };

  const listUsers = (): UserProfile[] =>
    db
      .prepare("SELECT * FROM users ORDER BY rowid")
      .all()
      .map((row) => mapUserProfile(row as Row));

  const ensureUser = (userId = defaultUserId): UserProfile => {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as Row | undefined;
    if (row) return mapUserProfile(row);

    const timestamp = nowIso();
    const user: UserProfile = {
      id: userId,
      name: userId === defaultUserId ? "Local reader" : userId,
      color: userId === defaultUserId ? "cyan" : "slate",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    upsertUser(db, user);
    ensureUserState(userId);
    return user;
  };

  const createUser = (payload: PostUserProfilePayload): UserProfile => {
    const timestamp = nowIso();
    const user: UserProfile = {
      id: payload.id ?? randomUUID(),
      name: payload.name ?? payload.displayName ?? "Reader",
      color: payload.color,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    upsertUser(db, user);
    ensureUserState(user.id);
    return user;
  };

  const updateUser = (userId: string, payload: PatchUserProfilePayload): UserProfile => {
    const current = ensureUser(userId);
    const updated: UserProfile = {
      ...current,
      ...payload,
      name: payload.name ?? payload.displayName ?? current.name,
      updatedAt: nowIso()
    };
    upsertUser(db, updated);
    return updated;
  };

  const getSyncStatus = (): SyncStatus => {
    ensureSyncMetadata(db);
    const row = db.prepare("SELECT * FROM sync_metadata WHERE id = 'default'").get() as Row | undefined;
    if (!row) throw new Error("SYNC_STATUS_NOT_FOUND");
    return mapSyncStatus(row);
  };

  const activateUser = (userId: string): { user: UserProfile; syncStatus: SyncStatus } => {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as Row | undefined;
    if (!row) throw new Error("USER_NOT_FOUND");
    const timestamp = nowIso();
    db.prepare("UPDATE sync_metadata SET active_user_id = ?, updated_at = ? WHERE id = 'default'").run(userId, timestamp);
    ensureUserState(userId);
    return { user: mapUserProfile(row), syncStatus: getSyncStatus() };
  };

  const buildSnapshot = (exportedAt = nowIso()): SyncSnapshot => {
    const syncStatus = getSyncStatus();
    return {
      version: syncSchemaVersion,
      exportedAt,
      deviceId: syncStatus.deviceId,
      activeProfileId: syncStatus.activeProfileId,
      users: listUsers(),
      books: listBooks("all", syncStatus.activeProfileId),
      readingStates: db
        .prepare("SELECT * FROM reading_states ORDER BY user_id, book_id")
        .all()
        .map((row) => mapReadingState(row as Row)),
      uiStates: db
        .prepare("SELECT * FROM ui_state ORDER BY user_id")
        .all()
        .map((row) => mapUiState(row as Row)),
      generationRuns: db
        .prepare("SELECT * FROM generation_runs ORDER BY created_at, rowid")
        .all()
        .map((row) => {
          const runId = asString((row as Row).id);
          return mapGenerationRun(row as Row, listGenerationChapterRuns(runId), listGenerationArtifacts(runId));
        }),
      tutorThreads: db
        .prepare("SELECT * FROM tutor_threads ORDER BY user_id, updated_at")
        .all()
        .map((row) => mapTutorThread(row as Row, listTutorMessages(asString((row as Row).id))))
    };
  };

  const exportSnapshot = (): SyncSnapshot => {
    const exportedAt = nowIso();
    db.prepare("UPDATE sync_metadata SET last_export_at = ?, updated_at = ? WHERE id = 'default'").run(exportedAt, exportedAt);
    return buildSnapshot(exportedAt);
  };

  const importSnapshot = (payload: ImportSyncSnapshotPayload): SyncSnapshot => {
    const importRows = db.transaction(() => {
      if (payload.mode === "replace") {
        db.prepare("DELETE FROM tutor_messages").run();
        db.prepare("DELETE FROM tutor_threads").run();
        db.prepare("DELETE FROM generation_artifacts").run();
        db.prepare("DELETE FROM generation_chapter_runs").run();
        db.prepare("DELETE FROM generation_runs").run();
        db.prepare("DELETE FROM reading_states").run();
        db.prepare("DELETE FROM ui_state").run();
        db.prepare("DELETE FROM books").run();
        db.prepare("DELETE FROM users WHERE id <> ?").run(defaultUserId);
      }

      for (const user of payload.snapshot.users) upsertUser(db, user);
      ensureUser(defaultUserId);
      for (const book of payload.snapshot.books) saveBook(book);
      for (const state of payload.snapshot.readingStates) upsertReadingState(state);
      for (const uiState of payload.snapshot.uiStates) upsertUiState(uiState);
      for (const run of payload.snapshot.generationRuns) upsertGenerationRun(run, {});
      for (const thread of payload.snapshot.tutorThreads) upsertTutorThread(thread);
      const activeUserId = payload.snapshot.users.some((user) => user.id === payload.snapshot.activeProfileId) ? payload.snapshot.activeProfileId : defaultUserId;
      const timestamp = nowIso();
      db.prepare("UPDATE sync_metadata SET active_user_id = ?, last_import_at = ?, updated_at = ? WHERE id = 'default'").run(activeUserId, timestamp, timestamp);
    });
    importRows();
    return buildSnapshot();
  };

  const seedIfEmpty = () => {
    const count = db.prepare("SELECT COUNT(*) AS count FROM books").get() as { count: number };
    if (count.count > 0) return;

    const seed = db.transaction(() => {
      upsertUser(db, defaultUserProfile());
      for (const book of seedBooks) saveBook(book);
      const activeBook = seedBooks[0];
      const activeChapter = activeBook.chapters.find((chapter) => chapter.id === activeBook.currentChapterId) ?? activeBook.chapters[0];
      if (!activeChapter) return;

      db.prepare(
        `INSERT INTO reading_states (user_id, book_id, chapter_id, progress_percent, scroll_y, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(defaultUserId, activeBook.id, activeChapter.id, activeChapter.progress, 0, seedUiState.updatedAt);

      db.prepare(
        `INSERT INTO ui_state (
          user_id, id, active_book_id, active_chapter_id, view, focus, mobile_panel, preferences_json, updated_at
        ) VALUES (
          @userId, @id, @activeBookId, @activeChapterId, @view, @focus, @mobilePanel, @preferencesJson, @updatedAt
        )`
      ).run({
        ...seedUiState,
        activeChapterId: activeChapter.id,
        focus: seedUiState.focus ? 1 : 0,
        preferencesJson: json(seedUiState.preferences)
      });

      const threadId = "thread-repo-books-chapter-1-2";
      const timestamp = seedUiState.updatedAt;
      db.prepare(
        `INSERT INTO tutor_threads (id, user_id, book_id, chapter_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(threadId, defaultUserId, activeBook.id, activeChapter.id, "폴더를 대단원으로 바꾸기", timestamp, timestamp);
      insertTutorMessage(db, {
        id: "message-repo-books-welcome",
        threadId,
        role: "assistant",
        body: "이 장에서는 파일 트리를 그대로 복사하지 않고 학습 순서로 다시 묶는 이유를 살펴봅니다.",
        metadata: { seed: true },
        createdAt: timestamp
      });
    });
    seed();
  };

  return {
    db,
    seedIfEmpty,
    listUsers,
    ensureUser,
    createUser,
    updateUser,
    activateUser,
    getSyncStatus,
    listBooks,
    getBook,
    getReadingState,
    saveReadingState,
    getUiState,
    saveUiState,
    createGenerationRun,
    getGenerationRun,
    recoverInterruptedGenerationRuns,
    retryFailedGenerationChapters,
    retryGenerationChapter,
    listTutorThreads,
    appendTutorMessage,
    exportSnapshot,
    importSnapshot
  };

  function applyUserReadingState(book: RepoBook, userId: string): RepoBook {
    const state = db.prepare("SELECT * FROM reading_states WHERE user_id = ? AND book_id = ?").get(userId, book.id) as Row | undefined;
    if (!state) return book;
    return {
      ...book,
      currentChapterId: asString(state.chapter_id),
      progress: asNumber(state.progress_percent)
    };
  }

  function attachGenerationRunId(book: RepoBook): RepoBook {
    if (book.status !== "generating") return book;
    const row = db.prepare("SELECT id FROM generation_runs WHERE book_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(book.id) as Row | undefined;
    return row ? { ...book, generationRunId: asString(row.id) } : book;
  }

  function createGeneratingBook(payload: PostGenerationOutlinePayload, bookId: string, runId: string): RepoBook {
    const repoSlug = repositorySlugFromUrl(payload.repoUrl);
    const repoName = repoSlug.split("/").pop() || "repository";
    return {
      id: bookId,
      title: `${repoName} Repo Book`,
      subtitle: `${payload.readerLevel} 독자를 위해 ${payload.bookPurpose} 목적으로 생성 중`,
      repo: repoSlug,
      branch: payload.branch,
      model: `LM Studio SDK · ${payload.model}`,
      updated: "생성 대기 중",
      status: "generating",
      statusLabel: "생성 대기 중",
      accent: "amber",
      progress: 0,
      currentChapterId: "",
      generationRunId: runId,
      parts: [],
      chapters: []
    };
  }

  function generationBookStatusLabel(run: GenerationRun) {
    if (run.status === "failed") return "생성 실패";
    if (run.status === "queued") return "생성 대기 중";
    const active = currentGenerationStepLabel(run.steps);
    return active ? `${active} 중` : "생성 중";
  }

  function ensureUserState(userId: string) {
    ensureUser(userId);
    const existing = db.prepare("SELECT user_id FROM ui_state WHERE user_id = ?").get(userId) as Row | undefined;
    if (existing) return;

    const activeBook = seedBooks.find((book) => getBaseBook(book.id)) ?? listBooks("all", defaultUserId)[0];
    if (!activeBook) return;
    const activeChapter = activeBook.chapters.find((chapter) => chapter.id === activeBook.currentChapterId) ?? activeBook.chapters[0];
    if (!activeChapter) return;

    upsertUiState({
      ...seedUiState,
      userId,
      activeBookId: activeBook.id,
      activeChapterId: activeChapter.id,
      updatedAt: nowIso()
    });
  }

  function upsertReadingState(state: ReadingState) {
    ensureUser(state.userId);
    db.prepare(
      `INSERT INTO reading_states (user_id, book_id, chapter_id, progress_percent, scroll_y, updated_at)
       VALUES (@userId, @bookId, @chapterId, @progressPercent, @scrollY, @updatedAt)
       ON CONFLICT(user_id, book_id) DO UPDATE SET
         chapter_id = excluded.chapter_id,
         progress_percent = excluded.progress_percent,
         scroll_y = excluded.scroll_y,
         updated_at = excluded.updated_at`
    ).run(state);
  }

  function upsertUiState(state: UIState) {
    ensureUser(state.userId);
    db.prepare(
      `INSERT INTO ui_state (
        user_id, id, active_book_id, active_chapter_id, view, focus, mobile_panel, preferences_json, updated_at
      ) VALUES (
        @userId, @id, @activeBookId, @activeChapterId, @view, @focus, @mobilePanel, @preferencesJson, @updatedAt
      )
      ON CONFLICT(user_id) DO UPDATE SET
        active_book_id = excluded.active_book_id,
        active_chapter_id = excluded.active_chapter_id,
        view = excluded.view,
        focus = excluded.focus,
        mobile_panel = excluded.mobile_panel,
        preferences_json = excluded.preferences_json,
        updated_at = excluded.updated_at`
    ).run({
      ...state,
      focus: state.focus ? 1 : 0,
      preferencesJson: json(state.preferences)
    });
  }

  function upsertGenerationRun(run: GenerationRun, payload: Record<string, unknown>) {
    insertGenerationRun.run({
      ...run,
      stepsJson: json(run.steps),
      outlineJson: json(run.outline),
      payloadJson: json(payload)
    });
    db.prepare("DELETE FROM generation_chapter_runs WHERE run_id = ?").run(run.id);
    for (const chapterRun of run.chapterRuns) insertGenerationChapterRun.run(chapterRun);
    db.prepare("DELETE FROM generation_artifacts WHERE run_id = ?").run(run.id);
    for (const artifact of run.artifacts ?? []) {
      insertGenerationArtifact.run({ ...artifact, payloadJson: json(artifact.payload) });
    }
  }

  function upsertTutorThread(thread: TutorThread) {
    ensureUser(thread.userId);
    db.prepare(
      `INSERT INTO tutor_threads (id, user_id, book_id, chapter_id, title, created_at, updated_at)
       VALUES (@id, @userId, @bookId, @chapterId, @title, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         book_id = excluded.book_id,
         chapter_id = excluded.chapter_id,
         title = excluded.title,
         updated_at = excluded.updated_at`
    ).run(thread);
    db.prepare("DELETE FROM tutor_messages WHERE thread_id = ?").run(thread.id);
    for (const message of thread.messages) insertTutorMessage(db, message);
  }

  function createDefaultTutorThread(bookId: string, chapterId: string, userId: string): TutorThread {
    const book = getBook(bookId, userId);
    if (!book) throw new Error("BOOK_NOT_FOUND");
    const chapter = book.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("CHAPTER_NOT_FOUND");

    const timestamp = nowIso();
    const safeUserId = userId.replace(/[^A-Za-z0-9_-]/g, "_");
    const threadId = userId === defaultUserId ? `thread-${bookId}-${chapterId}` : `thread-${safeUserId}-${bookId}-${chapterId}`;
    db.prepare(
      `INSERT INTO tutor_threads (id, user_id, book_id, chapter_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(threadId, userId, bookId, chapterId, chapter.title, timestamp, timestamp);
    insertTutorMessage(db, {
      id: randomUUID(),
      threadId,
      role: "assistant",
      body: chapter.keyQuestion
        ? `이 챕터의 핵심 질문은 "${chapter.keyQuestion}"입니다. 본문, 코드 앵커, 근거 파일을 기준으로 저장소의 책임과 변경 지점을 함께 설명합니다.`
        : "이 챕터는 본문 설명과 코드 근거를 함께 사용해 저장소의 책임, 흐름, 변경 지점을 설명합니다.",
      metadata: { default: true },
      createdAt: timestamp
    });
    const row = db.prepare("SELECT * FROM tutor_threads WHERE id = ?").get(threadId) as Row;
    return mapTutorThread(row, listTutorMessages(threadId));
  }

  function buildTutorReply(thread: Row, question: string) {
    const book = getBook(asString(thread.book_id), asString(thread.user_id));
    const chapter = book?.chapters.find((item) => item.id === asString(thread.chapter_id));
    if (!book || !chapter) return "현재 챕터의 본문과 코드 근거를 기준으로 저장소 책임, 흐름, 변경 지점을 함께 좁혀 보겠습니다.";

    const files = chapter.files.slice(0, 3).join(", ");
    const checkpoint = chapter.checkpoints[0] ?? "핵심 API 경계를 표시";
    const firstGoal = chapter.goals[0] ?? "이 장의 책임을 요약";
    const trimmedQuestion = question.trim().slice(0, 120);
    const anchor = chapter.codeAnchors?.[0];
    return [
      `질문을 ${chapter.title} 맥락으로 보면, ${chapter.keyQuestion ?? firstGoal}가 핵심입니다.`,
      `${files || "챕터의 근거 파일"}와 ${anchor ? `${anchor.filePath}${anchor.symbolName ? `의 ${anchor.symbolName}` : ""}` : "코드 근거"}가 이 답변의 근거입니다.`,
      `특히 ${checkpoint}를 만족하는지 확인하면 변경 판단의 기준이 생깁니다.`,
      trimmedQuestion ? `질문 "${trimmedQuestion}"은 이 책임과 근거의 연결로 좁혀서 답할 수 있습니다.` : ""
    ]
      .filter(Boolean)
      .join(" ");
  }
};

type PlannedPartialChapter = {
  id: string;
  number: string;
  order: number;
  partIndex: number;
  partId: string;
  title: string;
  subtitle: string;
  files: string[];
  goals: string[];
  focus: string;
  checkpoints: string[];
  codePath: string;
  codeLabel: string;
};

type PartialSectionDraft = {
  index: number;
  title: string;
  body: string;
};

type PartialRevisionSection = {
  eyebrow: string;
  title: string;
};

const buildPartialBookFromArtifacts = (base: RepoBook, run: GenerationRun): RepoBook => {
  const orderedArtifacts = [...(run.artifacts ?? [])].sort((a, b) => a.order - b.order);
  const parts = partialParts(base, orderedArtifacts);
  const plannedChapters = partialChapterSpecs(base.id, parts, orderedArtifacts);
  const draftsByKey = new Map<string, PartialSectionDraft[]>();
  const briefsByKey = new Map<string, Record<string, unknown>>();
  const revisionsByKey = new Map<string, PartialRevisionSection[]>();

  for (const artifact of orderedArtifacts) {
    const number = getPayloadString(artifact.payload, "chapterNumber");
    const key = artifact.chapterId ?? number;
    if (!key) continue;

    if (artifact.kind === "chapter_brief") {
      const brief = getPayloadRecord(artifact.payload, "brief");
      if (brief) {
        briefsByKey.set(key, brief);
        if (number) briefsByKey.set(number, brief);
      }
    }

    if (artifact.kind === "section_draft") {
      const body = getPayloadString(artifact.payload, "body").trim();
      if (!body) continue;
      const draft = {
        index: getPayloadNumber(artifact.payload, "sectionIndex") ?? draftsByKey.get(key)?.length ?? 0,
        title: getPayloadString(artifact.payload, "title") || `Section ${(draftsByKey.get(key)?.length ?? 0) + 1}`,
        body
      };
      const current = draftsByKey.get(key) ?? [];
      draftsByKey.set(key, [...current.filter((item) => item.index !== draft.index), draft]);
      if (number) draftsByKey.set(number, draftsByKey.get(key) ?? [draft]);
    }

    if (artifact.kind === "chapter_revision") {
      const sections = getPayloadRecords(artifact.payload, "sections").map((section, index) => ({
        eyebrow: getPayloadString(section, "eyebrow") || `Section ${index + 1}`,
        title: getPayloadString(section, "title") || `Section ${index + 1}`
      }));
      if (sections.length) {
        revisionsByKey.set(key, sections);
        if (number) revisionsByKey.set(number, sections);
      }
    }
  }

  const specs = plannedChapters.length ? plannedChapters : inferredPartialChapterSpecs(base.id, parts, orderedArtifacts, draftsByKey, briefsByKey);
  const chapters = specs
    .map((spec) => partialChapterFromArtifacts(base.id, spec, run, draftsByKey, briefsByKey, revisionsByKey))
    .filter((chapter): chapter is BookChapter => Boolean(chapter))
    .sort((a, b) => a.order - b.order);

  const currentChapterId = base.currentChapterId && chapters.some((chapter) => chapter.id === base.currentChapterId) ? base.currentChapterId : chapters[0]?.id ?? "";
  const readableChapters = chapters.map((chapter) =>
    chapter.id === currentChapterId && chapter.status !== "failed" ? { ...chapter, status: "current" as const } : chapter
  );

  return {
    ...base,
    updated: run.status === "failed" ? "생성 중단" : "생성 중",
    status: base.status,
    statusLabel: partialBookStatusLabel(run, readableChapters.length),
    progress: run.progress,
    currentChapterId,
    parts,
    chapters: readableChapters
  };
};

const partialParts = (base: RepoBook, artifacts: GenerationArtifact[]): BookPart[] => {
  const partPlan = [...artifacts].reverse().find((artifact) => artifact.kind === "part_plan");
  const planned = getPayloadRecords(partPlan?.payload ?? {}, "parts");
  if (!planned.length) return base.parts;
  return planned.map((part, index) => ({
    id: `${base.id}-part-${index + 1}`,
    bookId: base.id,
    order: index,
    title: getPayloadString(part, "title") || `Part ${index + 1}`,
    summary: getPayloadString(part, "summary") || "생성 중인 대단원입니다."
  }));
};

const partialChapterSpecs = (bookId: string, parts: BookPart[], artifacts: GenerationArtifact[]): PlannedPartialChapter[] => {
  const specs: PlannedPartialChapter[] = [];
  let fallbackPartIndex = 0;

  for (const artifact of artifacts.filter((item) => item.kind === "chapter_plan")) {
    const partTitle = getPayloadString(artifact.payload, "part");
    const matchedPartIndex = parts.findIndex((part) => part.title === partTitle);
    const partIndex = matchedPartIndex >= 0 ? matchedPartIndex : fallbackPartIndex;
    fallbackPartIndex += 1;
    const part = ensurePartialPart(parts, bookId, partIndex, partTitle);
    const chapters = getPayloadRecords(artifact.payload, "chapters");
    for (const [chapterIndex, chapter] of chapters.entries()) {
      const number = `${partIndex + 1}.${chapterIndex + 1}`;
      specs.push({
        id: `${bookId}-chapter-${number.replace(".", "-")}`,
        number,
        order: partIndex * 10 + chapterIndex,
        partIndex,
        partId: part.id,
        title: getPayloadString(chapter, "title") || `Chapter ${number}`,
        subtitle: getPayloadString(chapter, "subtitle") || "생성 중인 챕터입니다.",
        files: getPayloadStrings(chapter, "files"),
        goals: getPayloadStrings(chapter, "goals"),
        focus: getPayloadString(chapter, "focus"),
        checkpoints: getPayloadStrings(chapter, "checkpoints"),
        codePath: getPayloadString(chapter, "codePath"),
        codeLabel: getPayloadString(chapter, "codeLabel")
      });
    }
  }

  return specs;
};

const inferredPartialChapterSpecs = (
  bookId: string,
  parts: BookPart[],
  artifacts: GenerationArtifact[],
  draftsByKey: Map<string, PartialSectionDraft[]>,
  briefsByKey: Map<string, Record<string, unknown>>
): PlannedPartialChapter[] => {
  const numbers = new Set<string>();
  for (const artifact of artifacts) {
    const number = getPayloadString(artifact.payload, "chapterNumber");
    if (number && (draftsByKey.has(number) || briefsByKey.has(number))) numbers.add(number);
  }

  return [...numbers].sort(compareChapterNumbers).map((number) => {
    const [partNumber, chapterNumber] = number.split(".").map((value) => Number(value));
    const partIndex = Number.isFinite(partNumber) && partNumber > 0 ? partNumber - 1 : 0;
    const chapterIndex = Number.isFinite(chapterNumber) && chapterNumber > 0 ? chapterNumber - 1 : 0;
    const part = ensurePartialPart(parts, bookId, partIndex);
    const brief = briefsByKey.get(number);
    const title = getPayloadString(brief ?? {}, "title") || `Chapter ${number}`;
    return {
      id: `${bookId}-chapter-${number.replace(".", "-")}`,
      number,
      order: partIndex * 10 + chapterIndex,
      partIndex,
      partId: part.id,
      title,
      subtitle: getPayloadString(brief ?? {}, "responsibility") || "생성 중인 챕터입니다.",
      files: [],
      goals: [],
      focus: "",
      checkpoints: [],
      codePath: "",
      codeLabel: ""
    };
  });
};

const partialChapterFromArtifacts = (
  bookId: string,
  spec: PlannedPartialChapter,
  run: GenerationRun,
  draftsByKey: Map<string, PartialSectionDraft[]>,
  briefsByKey: Map<string, Record<string, unknown>>,
  revisionsByKey: Map<string, PartialRevisionSection[]>
): BookChapter | null => {
  const drafts = [...(draftsByKey.get(spec.id) ?? draftsByKey.get(spec.number) ?? [])].sort((a, b) => a.index - b.index);
  if (!drafts.length) return null;

  const revision = revisionsByKey.get(spec.id) ?? revisionsByKey.get(spec.number) ?? [];
  const brief = briefsByKey.get(spec.id) ?? briefsByKey.get(spec.number) ?? {};
  const anchors = getPayloadRecords(brief, "codeAnchors") as NonNullable<BookChapter["codeAnchors"]>;
  const evidence = getPayloadRecords(brief, "evidence") as NonNullable<BookChapter["evidence"]>;
  const glossary = getPayloadRecords(brief, "glossary") as NonNullable<BookChapter["glossary"]>;
  const recap = getPayloadRecord(brief, "recap") as BookChapter["recap"] | undefined;
  const flow = getPayloadRecord(brief, "flow") as BookChapter["flow"] | undefined;
  const files = spec.files.length ? spec.files : evidence.map((item) => item.filePath).filter(Boolean);
  const goals = spec.goals.length ? spec.goals : [getPayloadString(brief, "keyQuestion")].filter(Boolean);
  const fallbackCheckpoints = recap?.changeEntryPoints?.slice(0, 3) ?? ["부분 생성된 본문과 코드 근거를 대조한다."];
  const checkpoints = spec.checkpoints.length ? spec.checkpoints : fallbackCheckpoints;
  const firstAnchor = anchors[0];
  const sections = drafts.map((draft, index) => ({
    eyebrow: revision[index]?.eyebrow ?? `Draft ${index + 1}`,
    title: revision[index]?.title ?? draft.title,
    body: draft.body
  }));
  const revised = revision.length > 0;

  return {
    id: spec.id,
    bookId,
    partId: spec.partId,
    order: spec.order,
    number: spec.number,
    title: spec.title,
    subtitle: spec.subtitle,
    progress: 0,
    status: revised ? "complete" : "generating",
    estimatedMinutes: Math.max(12, Math.min(52, 8 + sections.length * 4 + files.length * 2)),
    files,
    goals,
    sections,
    code: firstAnchor
      ? {
          path: firstAnchor.filePath,
          label: firstAnchor.claim || spec.codeLabel || "코드 근거",
          lines: firstAnchor.excerptLines ?? []
        }
      : {
          path: spec.codePath || files[0] || "README.md",
          label: spec.codeLabel || "코드 근거",
          lines: ["// 부분 원고에서 코드 앵커를 정리하는 중입니다."]
        },
    notes: [
      { title: "부분 생성본", body: run.status === "failed" ? "생성이 중단되기 전까지 완성된 본문입니다." : "생성 중 먼저 만들어진 본문입니다." },
      ...(spec.focus ? [{ title: "설계 포인트", body: spec.focus }] : [])
    ],
    checkpoints,
    keyQuestion: getPayloadString(brief, "keyQuestion"),
    responsibility: getPayloadString(brief, "responsibility"),
    flow: flow ?? null,
    codeAnchors: anchors,
    evidence,
    glossary,
    recap: recap ?? { understood: [], changeEntryPoints: [], nextQuestions: [] }
  };
};

const ensurePartialPart = (parts: BookPart[], bookId: string, partIndex: number, title = ""): BookPart => {
  while (parts.length <= partIndex) {
    const index = parts.length;
    parts.push({
      id: `${bookId}-part-${index + 1}`,
      bookId,
      order: index,
      title: index === partIndex && title ? title : `Part ${index + 1}`,
      summary: "생성 중인 대단원입니다."
    });
  }
  return parts[partIndex];
};

const partialBookStatusLabel = (run: GenerationRun, readableChapterCount: number) => {
  if (run.status === "failed") return readableChapterCount > 0 ? "생성 중단 · 일부 읽기 가능" : "생성 실패";
  if (readableChapterCount > 0) return "일부 읽기 가능";
  if (run.status === "queued") return "생성 대기 중";
  const active = currentGenerationStepLabel(run.steps);
  return active ? `${active} 중` : "생성 중";
};

const getPayloadRecord = (value: unknown, key: string): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return candidate && typeof candidate === "object" && !Array.isArray(candidate) ? (candidate as Record<string, unknown>) : undefined;
};

const getPayloadRecords = (value: unknown, key: string): Array<Record<string, unknown>> => {
  if (!value || typeof value !== "object") return [];
  const candidate = (value as Record<string, unknown>)[key];
  return Array.isArray(candidate) ? candidate.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
};

const getPayloadString = (value: unknown, key: string): string => {
  if (!value || typeof value !== "object") return "";
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : "";
};

const getPayloadStrings = (value: unknown, key: string): string[] => {
  if (!value || typeof value !== "object") return [];
  const candidate = (value as Record<string, unknown>)[key];
  return Array.isArray(candidate) ? candidate.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
};

const getPayloadNumber = (value: unknown, key: string): number | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
};

const compareChapterNumbers = (left: string, right: string) => {
  const [leftPart, leftChapter] = left.split(".").map((value) => Number(value));
  const [rightPart, rightChapter] = right.split(".").map((value) => Number(value));
  return (leftPart - rightPart) || (leftChapter - rightChapter);
};

const insertTutorMessage = (db: SqliteDatabase, message: TutorMessage) => {
  db.prepare(
    `INSERT INTO tutor_messages (id, thread_id, role, body, metadata_json, created_at)
     VALUES (@id, @threadId, @role, @body, @metadataJson, @createdAt)`
  ).run({ ...message, metadataJson: json(message.metadata) });
};

const mapPart = (row: Row): BookPart => ({
  id: asString(row.id),
  bookId: asString(row.book_id),
  order: asNumber(row.sort_order),
  title: asString(row.title),
  summary: asString(row.summary)
});

const chapterBodyJson = (chapter: BookChapter) => ({
  keyQuestion: chapter.keyQuestion,
  responsibility: chapter.responsibility,
  flow: chapter.flow,
  codeAnchors: chapter.codeAnchors,
  evidence: chapter.evidence,
  glossary: chapter.glossary,
  recap: chapter.recap
});

const mapChapter = (row: Row): BookChapter => {
  const body = parseJson<Partial<BookChapter>>(row.chapter_body_json, {});
  return {
    id: asString(row.id),
    bookId: asString(row.book_id),
    partId: asString(row.part_id),
    order: asNumber(row.sort_order),
    number: asString(row.number),
    title: asString(row.title),
    subtitle: asString(row.subtitle),
    progress: asNumber(row.progress),
    status: asString(row.status) as BookChapter["status"],
    estimatedMinutes: asNumber(row.estimated_minutes),
    files: parseJson<string[]>(row.files_json, []),
    goals: parseJson<string[]>(row.goals_json, []),
    sections: parseJson<BookChapter["sections"]>(row.sections_json, []),
    code: parseJson<BookChapter["code"]>(row.code_json, null),
    notes: parseJson<BookChapter["notes"]>(row.notes_json, []),
    checkpoints: parseJson<string[]>(row.checkpoints_json, []),
    keyQuestion: body.keyQuestion,
    responsibility: body.responsibility,
    flow: body.flow,
    codeAnchors: body.codeAnchors,
    evidence: body.evidence,
    glossary: body.glossary,
    recap: body.recap
  };
};

const mapBook = (row: Row, parts: BookPart[], chapters: BookChapter[]): RepoBook => ({
  id: asString(row.id),
  title: asString(row.title),
  subtitle: asString(row.subtitle),
  repo: asString(row.repo),
  branch: asString(row.branch),
  model: asString(row.model),
  updated: asString(row.updated),
  status: asString(row.status) as RepoBook["status"],
  statusLabel: asString(row.status_label),
  accent: asString(row.accent),
  progress: asNumber(row.progress),
  currentChapterId: asString(row.current_chapter_id),
  parts,
  chapters
});

const mapReadingState = (row: Row): ReadingState => ({
  userId: asString(row.user_id) || defaultUserId,
  bookId: asString(row.book_id),
  chapterId: asString(row.chapter_id),
  progressPercent: asNumber(row.progress_percent),
  scrollY: asNumber(row.scroll_y),
  updatedAt: asString(row.updated_at)
});

const mapUiState = (row: Row): UIState => ({
  id: "default",
  userId: asString(row.user_id) || defaultUserId,
  activeBookId: asString(row.active_book_id),
  activeChapterId: row.active_chapter_id === null ? null : asString(row.active_chapter_id),
  view: asString(row.view) as UIState["view"],
  focus: Boolean(row.focus),
  mobilePanel: asString(row.mobile_panel),
  preferences: parseJson<Record<string, unknown>>(row.preferences_json, {}),
  updatedAt: asString(row.updated_at)
});

const mapGenerationRun = (row: Row, chapterRuns: GenerationChapterRun[], artifacts: GenerationArtifact[] = []): GenerationRun => ({
  id: asString(row.id),
  userId: asString(row.user_id) || defaultUserId,
  bookId: row.book_id === null ? null : asString(row.book_id),
  repoUrl: asString(row.repo_url),
  branch: asString(row.branch),
  model: asString(row.model),
  context: asString(row.context),
  status: asString(row.status) as GenerationRun["status"],
  progress: asNumber(row.progress),
  steps: parseJson<GenerationRun["steps"]>(row.steps_json, []),
  outline: parseJson<GenerationRun["outline"]>(row.outline_json, []),
  chapterRuns,
  artifacts,
  error: asString(row.error),
  createdAt: asString(row.created_at),
  updatedAt: asString(row.updated_at)
});

const mapGenerationChapterRun = (row: Row): GenerationChapterRun => ({
  id: asString(row.id),
  runId: asString(row.run_id),
  chapterId: asString(row.chapter_id),
  order: asNumber(row.sort_order),
  title: asString(row.title),
  status: asString(row.status) as GenerationChapterRun["status"],
  attempts: asNumber(row.attempts),
  source: asString(row.source),
  lastError: row.last_error === null ? null : asString(row.last_error),
  updatedAt: asString(row.updated_at)
});

const mapGenerationArtifact = (row: Row): GenerationArtifact => ({
  id: asString(row.id),
  runId: asString(row.run_id),
  chapterId: row.chapter_id === null ? null : asString(row.chapter_id),
  kind: asString(row.kind),
  order: asNumber(row.sort_order),
  payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
  createdAt: asString(row.created_at)
});

const mapTutorThread = (row: Row, messages: TutorMessage[]): TutorThread => ({
  id: asString(row.id),
  userId: asString(row.user_id) || defaultUserId,
  bookId: asString(row.book_id),
  chapterId: asString(row.chapter_id),
  title: asString(row.title),
  createdAt: asString(row.created_at),
  updatedAt: asString(row.updated_at),
  messages
});

const mapTutorMessage = (row: Row): TutorMessage => ({
  id: asString(row.id),
  threadId: asString(row.thread_id),
  role: asString(row.role) as TutorMessage["role"],
  body: asString(row.body),
  metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
  createdAt: asString(row.created_at)
});

const mapUserProfile = (row: Row): UserProfile => ({
  id: asString(row.id),
  name: asString(row.name),
  color: asString(row.color),
  createdAt: asString(row.created_at),
  updatedAt: asString(row.updated_at)
});

const mapSyncStatus = (row: Row): SyncStatus => ({
  deviceId: asString(row.device_id),
  schemaVersion: asNumber(row.schema_version),
  activeProfileId: asString(row.active_user_id) || defaultUserId,
  lastExportAt: row.last_export_at === null ? null : asString(row.last_export_at),
  lastImportAt: row.last_import_at === null ? null : asString(row.last_import_at),
  updatedAt: asString(row.updated_at)
});

const generationStageDefaults = [
  ["모델 준비", "waiting for LM Studio model readiness"],
  ["저장소 분석", "waiting for repository scan and index"],
  ["대단원 설계", "waiting for part plan"],
  ["소단원 설계", "waiting for chapter plan"],
  ["근거 수집", "waiting for chapter briefs and code anchors"],
  ["본문 생성", "waiting for section drafts"],
  ["챕터 수리", "waiting for revision pass"],
  ["책 일관성 점검", "waiting for coherence pass"]
] as const;

const pendingGenerationSteps = (): GenerationRun["steps"] =>
  generationStageDefaults.map(([label, detail]) => ({ label, state: "pending", detail }));

const runningGenerationSteps = (): GenerationRun["steps"] => stagedGenerationSteps("모델 준비", "checking LM Studio model");

const stagedGenerationSteps = (activeLabel: string, activeDetail: string): GenerationRun["steps"] => {
  const activeIndex = Math.max(0, generationStageDefaults.findIndex(([label]) => label === activeLabel));
  return generationStageDefaults.map(([label, detail], index) => ({
    label,
    state: index < activeIndex ? "complete" : index === activeIndex ? "active" : "pending",
    detail: index === activeIndex ? activeDetail : index < activeIndex ? "complete" : detail
  }));
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "UNKNOWN_ERROR");

const markActiveGenerationStepFailed = (steps: GenerationRun["steps"], detail: string): GenerationRun["steps"] => {
  const activeIndex = steps.findIndex((step) => step.state === "active");
  const failedIndex = activeIndex >= 0 ? activeIndex : 0;
  return steps.map((step, index) => (index === failedIndex ? { ...step, state: "failed", detail } : step));
};

const currentGenerationStepLabel = (steps: GenerationRun["steps"]) =>
  steps.find((step) => step.state === "active" || step.state === "failed")?.label ?? [...steps].reverse().find((step) => step.state === "complete")?.label ?? "";
