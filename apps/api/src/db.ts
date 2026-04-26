import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  type BookChapter,
  type BookFilter,
  type BookPart,
  type GenerationRun,
  type PatchReadingStatePayload,
  type PatchUIStatePayload,
  type PostGenerationOutlinePayload,
  type PostTutorMessagePayload,
  type ReadingState,
  type RepoBook,
  type TutorMessage,
  type TutorThread,
  type UIState,
  seedBooks,
  seedUiState
} from "@repo-books/shared";
import { buildRepoIndex } from "./generation/indexer.js";
import { generationSteps, synthesizeRepoBook } from "./generation/synthesizer.js";
import { materializeRepository } from "./generation/source.js";

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
      checkpoints_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reading_states (
      book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      progress_percent REAL NOT NULL,
      scroll_y REAL NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generation_runs (
      id TEXT PRIMARY KEY,
      book_id TEXT REFERENCES books(id) ON DELETE SET NULL,
      repo_url TEXT NOT NULL,
      branch TEXT NOT NULL,
      model TEXT NOT NULL,
      context TEXT NOT NULL,
      status TEXT NOT NULL,
      progress REAL NOT NULL,
      steps_json TEXT NOT NULL,
      outline_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tutor_threads (
      id TEXT PRIMARY KEY,
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
      id TEXT PRIMARY KEY,
      active_book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      active_chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
      view TEXT NOT NULL,
      focus INTEGER NOT NULL,
      mobile_panel TEXT NOT NULL,
      preferences_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
};

export const createRepository = (db: SqliteDatabase) => {
  const insertBook = db.prepare(`
    INSERT INTO books (
      id, title, subtitle, repo, branch, model, updated, status, status_label, accent, progress, current_chapter_id
    ) VALUES (
      @id, @title, @subtitle, @repo, @branch, @model, @updated, @status, @statusLabel, @accent, @progress, @currentChapterId
    )
  `);

  const insertPart = db.prepare(`
    INSERT INTO parts (id, book_id, sort_order, title, summary)
    VALUES (@id, @bookId, @order, @title, @summary)
  `);

  const insertChapter = db.prepare(`
    INSERT INTO chapters (
      id, book_id, part_id, sort_order, number, title, subtitle, progress, status, estimated_minutes,
      files_json, goals_json, sections_json, code_json, notes_json, checkpoints_json
    ) VALUES (
      @id, @bookId, @partId, @order, @number, @title, @subtitle, @progress, @status, @estimatedMinutes,
      @filesJson, @goalsJson, @sectionsJson, @codeJson, @notesJson, @checkpointsJson
    )
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
        checkpointsJson: json(chapter.checkpoints)
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

  const getBook = (bookId: string): RepoBook | null => {
    const row = db.prepare("SELECT * FROM books WHERE id = ?").get(bookId) as Row | undefined;
    if (!row) return null;
    return mapBook(row, getParts(bookId), getChapters(bookId));
  };

  const listBooks = (filter: BookFilter): RepoBook[] => {
    const statusFilter = filter === "in_progress" ? "reading" : filter === "all" ? null : filter;
    const rows = statusFilter
      ? db.prepare("SELECT * FROM books WHERE status = ? ORDER BY rowid").all(statusFilter)
      : db.prepare("SELECT * FROM books ORDER BY rowid").all();
    return rows.map((row) => {
      const bookId = asString((row as Row).id);
      return mapBook(row as Row, getParts(bookId), getChapters(bookId));
    });
  };

  const getReadingState = (bookId: string): ReadingState | null => {
    const row = db.prepare("SELECT * FROM reading_states WHERE book_id = ?").get(bookId) as Row | undefined;
    return row ? mapReadingState(row) : null;
  };

  const saveReadingState = (bookId: string, payload: PatchReadingStatePayload): ReadingState => {
    const book = getBook(bookId);
    if (!book) throw new Error("BOOK_NOT_FOUND");
    if (!book.chapters.some((chapter) => chapter.id === payload.chapterId)) throw new Error("CHAPTER_NOT_FOUND");

    const updatedAt = nowIso();
    db.prepare(
      `INSERT INTO reading_states (book_id, chapter_id, progress_percent, scroll_y, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(book_id) DO UPDATE SET
         chapter_id = excluded.chapter_id,
         progress_percent = excluded.progress_percent,
         scroll_y = excluded.scroll_y,
         updated_at = excluded.updated_at`
    ).run(bookId, payload.chapterId, payload.progressPercent, payload.scrollY, updatedAt);
    db.prepare("UPDATE books SET current_chapter_id = ?, progress = ?, updated = ? WHERE id = ?").run(
      payload.chapterId,
      payload.progressPercent,
      "방금 전",
      bookId
    );
    return { bookId, chapterId: payload.chapterId, progressPercent: payload.progressPercent, scrollY: payload.scrollY, updatedAt };
  };

  const getUiState = (): UIState => {
    const row = db.prepare("SELECT * FROM ui_state WHERE id = 'default'").get() as Row | undefined;
    if (!row) throw new Error("UI_STATE_NOT_FOUND");
    return mapUiState(row);
  };

  const saveUiState = (payload: PatchUIStatePayload): UIState => {
    const current = getUiState();
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
       WHERE id = 'default'`
    ).run({
      ...next,
      focus: next.focus ? 1 : 0,
      preferencesJson: json(next.preferences)
    });
    return next;
  };

  const createGenerationRun = (payload: PostGenerationOutlinePayload): { generationRun: GenerationRun; book: RepoBook } => {
    const timestamp = nowIso();
    const source = materializeRepository(payload.repoUrl, payload.branch);
    const index = buildRepoIndex(source);
    const { book, outline } = synthesizeRepoBook(payload, index);
    const run: GenerationRun = {
      id: randomUUID(),
      bookId: book.id,
      repoUrl: payload.repoUrl,
      branch: index.branch,
      model: payload.model,
      context: payload.context,
      status: "complete",
      progress: 100,
      steps: generationSteps(index),
      outline,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const save = db.transaction(() => {
      saveBook(book);
      db.prepare(
        `INSERT INTO generation_runs (
          id, book_id, repo_url, branch, model, context, status, progress, steps_json, outline_json, created_at, updated_at
        ) VALUES (
          @id, @bookId, @repoUrl, @branch, @model, @context, @status, @progress, @stepsJson, @outlineJson, @createdAt, @updatedAt
        )`
      ).run({ ...run, stepsJson: json(run.steps), outlineJson: json(run.outline) });
      db.prepare(
        `INSERT INTO reading_states (book_id, chapter_id, progress_percent, scroll_y, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(book.id, book.currentChapterId, book.progress, 0, timestamp);
    });
    save();
    return { generationRun: run, book };
  };

  const listTutorThreads = (filters: { bookId?: string; chapterId?: string }): TutorThread[] => {
    const clauses: string[] = [];
    const values: string[] = [];
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
      return [createDefaultTutorThread(filters.bookId, filters.chapterId)];
    }
    return rows.map((row) => mapTutorThread(row, listTutorMessages(asString(row.id))));
  };

  const listTutorMessages = (threadId: string): TutorMessage[] =>
    db
      .prepare("SELECT * FROM tutor_messages WHERE thread_id = ? ORDER BY created_at, rowid")
      .all(threadId)
      .map((row) => mapTutorMessage(row as Row));

  const appendTutorMessage = (threadId: string, payload: PostTutorMessagePayload): TutorThread => {
    const thread = db.prepare("SELECT * FROM tutor_threads WHERE id = ?").get(threadId) as Row | undefined;
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

  const seedIfEmpty = () => {
    const count = db.prepare("SELECT COUNT(*) AS count FROM books").get() as { count: number };
    if (count.count > 0) return;

    const seed = db.transaction(() => {
      for (const book of seedBooks) saveBook(book);
      const activeBook = seedBooks[0];
      const activeChapter = activeBook.chapters.find((chapter) => chapter.id === activeBook.currentChapterId) ?? activeBook.chapters[0];
      if (!activeChapter) return;

      db.prepare(
        `INSERT INTO reading_states (book_id, chapter_id, progress_percent, scroll_y, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(activeBook.id, activeChapter.id, activeChapter.progress, 0, seedUiState.updatedAt);

      db.prepare(
        `INSERT INTO ui_state (
          id, active_book_id, active_chapter_id, view, focus, mobile_panel, preferences_json, updated_at
        ) VALUES (
          @id, @activeBookId, @activeChapterId, @view, @focus, @mobilePanel, @preferencesJson, @updatedAt
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
        `INSERT INTO tutor_threads (id, book_id, chapter_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(threadId, activeBook.id, activeChapter.id, "폴더를 대단원으로 바꾸기", timestamp, timestamp);
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
    listBooks,
    getBook,
    getReadingState,
    saveReadingState,
    getUiState,
    saveUiState,
    createGenerationRun,
    listTutorThreads,
    appendTutorMessage
  };

  function createDefaultTutorThread(bookId: string, chapterId: string): TutorThread {
    const book = getBook(bookId);
    if (!book) throw new Error("BOOK_NOT_FOUND");
    const chapter = book.chapters.find((item) => item.id === chapterId);
    if (!chapter) throw new Error("CHAPTER_NOT_FOUND");

    const timestamp = nowIso();
    const threadId = `thread-${bookId}-${chapterId}`;
    db.prepare(
      `INSERT INTO tutor_threads (id, book_id, chapter_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(threadId, bookId, chapterId, chapter.title, timestamp, timestamp);
    insertTutorMessage(db, {
      id: randomUUID(),
      threadId,
      role: "assistant",
      body: "이 챕터를 읽을 때는 먼저 목표와 관련 파일을 확인한 뒤, 본문에서 제시하는 코드 근거를 따라가면 됩니다.",
      metadata: { default: true },
      createdAt: timestamp
    });
    const row = db.prepare("SELECT * FROM tutor_threads WHERE id = ?").get(threadId) as Row;
    return mapTutorThread(row, listTutorMessages(threadId));
  }

  function buildTutorReply(thread: Row, question: string) {
    const book = getBook(asString(thread.book_id));
    const chapter = book?.chapters.find((item) => item.id === asString(thread.chapter_id));
    if (!book || !chapter) return "이 장에서는 먼저 관련 파일을 2-3개로 좁히고, 목표와 체크포인트를 기준으로 읽는 것이 좋습니다.";

    const files = chapter.files.slice(0, 3).join(", ");
    const checkpoint = chapter.checkpoints[0] ?? "핵심 API 경계를 표시";
    const firstGoal = chapter.goals[0] ?? "이 장의 책임을 요약";
    const trimmedQuestion = question.trim().slice(0, 120);
    return [
      `질문을 ${chapter.title} 맥락으로 보면, 먼저 ${files || "챕터의 근거 파일"}을 열고 ${firstGoal}하는 흐름이 좋습니다.`,
      `특히 ${checkpoint}를 확인하면 다음 장으로 넘어갈 기준이 생깁니다.`,
      trimmedQuestion ? `질문 "${trimmedQuestion}"에 대한 답은 본문 전체보다 이 체크포인트를 통과했는지로 좁혀서 판단하세요.` : ""
    ]
      .filter(Boolean)
      .join(" ");
  }
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

const mapChapter = (row: Row): BookChapter => ({
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
  checkpoints: parseJson<string[]>(row.checkpoints_json, [])
});

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
  bookId: asString(row.book_id),
  chapterId: asString(row.chapter_id),
  progressPercent: asNumber(row.progress_percent),
  scrollY: asNumber(row.scroll_y),
  updatedAt: asString(row.updated_at)
});

const mapUiState = (row: Row): UIState => ({
  id: "default",
  activeBookId: asString(row.active_book_id),
  activeChapterId: row.active_chapter_id === null ? null : asString(row.active_chapter_id),
  view: asString(row.view) as UIState["view"],
  focus: Boolean(row.focus),
  mobilePanel: asString(row.mobile_panel),
  preferences: parseJson<Record<string, unknown>>(row.preferences_json, {}),
  updatedAt: asString(row.updated_at)
});

const mapTutorThread = (row: Row, messages: TutorMessage[]): TutorThread => ({
  id: asString(row.id),
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
