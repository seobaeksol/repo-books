import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import {
  importSyncSnapshotSchema,
  lmStudioModelsResponseSchema,
  listBooksQuerySchema,
  patchUserProfileSchema,
  patchReadingStateSchema,
  patchUiStateSchema,
  postGenerationOutlineSchema,
  postTutorMessageSchema,
  postUserProfileSchema,
  tutorThreadsQuerySchema
} from "@repo-books/shared";
import { createRepository, defaultUserId, openDatabase, type RepoBooksRepository } from "./db.js";
import { listLmStudioModels } from "./lmStudioModels.js";

export type CreateAppOptions = {
  dbPath?: string;
  logger?: boolean;
  seed?: boolean;
};

export type RepoBooksApp = FastifyInstance & {
  repo: RepoBooksRepository;
};

const bookParamsSchema = z.object({ bookId: z.string().min(1) });
const generationRunParamsSchema = z.object({ runId: z.string().min(1) });
const generationChapterRunParamsSchema = z.object({ runId: z.string().min(1), chapterId: z.string().min(1) });
const threadParamsSchema = z.object({ threadId: z.string().min(1) });
const userParamsSchema = z.object({ userId: z.string().min(1) });
const profileParamsSchema = z.object({ profileId: z.string().min(1) });
const userSelectionQuerySchema = z.object({ userId: z.string().min(1).optional() }).passthrough();
const lmStudioModelsQuerySchema = z.object({ refresh: z.string().optional() }).passthrough();

const resolveUserId = (request: { query: unknown; headers: Record<string, string | string[] | undefined> }, fallbackUserId = defaultUserId) => {
  const query = userSelectionQuerySchema.safeParse(request.query);
  if (query.success && query.data.userId) return query.data.userId;

  const header = request.headers["x-repo-books-user"];
  if (Array.isArray(header)) return header[0] ?? fallbackUserId;
  return header ?? fallbackUserId;
};

export const createApp = async (options: CreateAppOptions = {}): Promise<RepoBooksApp> => {
  const app = Fastify({ logger: options.logger ?? false }) as unknown as RepoBooksApp;
  const db = openDatabase(options.dbPath);
  const repo = createRepository(db);
  app.decorate("repo", repo);

  if (options.seed ?? true) repo.seedIfEmpty();

  await app.register(cors, { origin: true });

  app.addHook("onClose", async () => {
    db.close();
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ZodError) {
      void request;
      return reply.status(400).send({ error: "BAD_REQUEST", issues: error.issues });
    }
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    if (
      message === "BOOK_NOT_FOUND" ||
      message === "CHAPTER_NOT_FOUND" ||
      message === "THREAD_NOT_FOUND" ||
      message === "GENERATION_RUN_NOT_FOUND" ||
      message === "CHAPTER_RUN_NOT_FOUND" ||
      message === "USER_NOT_FOUND"
    ) {
      return reply.status(404).send({ error: message });
    }
    if (message === "GENERATION_RUN_BUSY") return reply.status(409).send({ error: message });
    request.log.error(error);
    return reply.status(500).send({ error: "INTERNAL_SERVER_ERROR" });
  });

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/lm-studio/models", async (request) => {
    const query = lmStudioModelsQuerySchema.parse(request.query);
    return lmStudioModelsResponseSchema.parse(await listLmStudioModels({ refresh: query.refresh === "1" || query.refresh === "true" }));
  });

  const activeUserId = () => repo.getSyncStatus().activeProfileId;
  const requestUserId = (request: { query: unknown; headers: Record<string, string | string[] | undefined> }) => resolveUserId(request, activeUserId());
  const profilePayload = () => {
    const syncStatus = repo.getSyncStatus();
    const users = repo.listUsers();
    return { users, profiles: users, activeUserId: syncStatus.activeProfileId, activeProfileId: syncStatus.activeProfileId, syncStatus };
  };

  app.get("/api/users", async (request) => {
    void request;
    return profilePayload();
  });

  app.post("/api/users", async (request) => {
    const payload = postUserProfileSchema.parse(request.body);
    return { user: repo.createUser(payload) };
  });

  app.patch("/api/users/:userId", async (request) => {
    const { userId } = userParamsSchema.parse(request.params);
    const payload = patchUserProfileSchema.parse(request.body);
    return { user: repo.updateUser(userId, payload) };
  });

  app.patch("/api/users/:userId/activate", async (request) => {
    const { userId } = userParamsSchema.parse(request.params);
    return repo.activateUser(userId);
  });

  app.get("/api/profiles", async () => profilePayload());

  app.post("/api/profiles", async (request) => {
    const payload = postUserProfileSchema.parse(request.body);
    return { profile: repo.createUser(payload) };
  });

  app.patch("/api/profiles/:profileId", async (request) => {
    const { profileId } = profileParamsSchema.parse(request.params);
    const payload = patchUserProfileSchema.parse(request.body);
    return { profile: repo.updateUser(profileId, payload) };
  });

  app.patch("/api/profiles/:profileId/activate", async (request) => {
    const { profileId } = profileParamsSchema.parse(request.params);
    const result = repo.activateUser(profileId);
    return { profile: result.user, syncStatus: result.syncStatus };
  });

  app.get("/api/books", async (request) => {
    const query = listBooksQuerySchema.parse(request.query);
    const userId = requestUserId(request);
    repo.ensureUser(userId);
    return { books: repo.listBooks(query.filter, userId) };
  });

  app.get("/api/books/:bookId", async (request, reply) => {
    const { bookId } = bookParamsSchema.parse(request.params);
    const userId = requestUserId(request);
    repo.ensureUser(userId);
    const book = repo.getBook(bookId, userId);
    if (!book) return reply.status(404).send({ error: "BOOK_NOT_FOUND" });
    return { book, readingState: repo.getReadingState(bookId, userId) };
  });

  app.patch("/api/reading-state/:bookId", async (request) => {
    const { bookId } = bookParamsSchema.parse(request.params);
    const userId = requestUserId(request);
    const payload = patchReadingStateSchema.parse(request.body);
    return { readingState: repo.saveReadingState(bookId, payload, userId) };
  });

  app.get("/api/ui-state/default", async (request) => {
    const userId = requestUserId(request);
    return { uiState: repo.getUiState(userId) };
  });

  app.patch("/api/ui-state/default", async (request) => {
    const userId = requestUserId(request);
    const payload = patchUiStateSchema.parse(request.body);
    return { uiState: repo.saveUiState(payload, userId) };
  });

  app.post("/api/generation/outline", async (request) => {
    const userId = requestUserId(request);
    const payload = postGenerationOutlineSchema.parse(request.body);
    return await repo.createGenerationRun(payload, userId);
  });

  app.post("/api/generation/runs", async (request, reply) => {
    const userId = requestUserId(request);
    const payload = postGenerationOutlineSchema.parse(request.body);
    const result = await repo.createGenerationRun({ ...payload, background: true }, userId);
    return reply.status(202).send(result);
  });

  app.get("/api/generation/runs/:runId", async (request, reply) => {
    const { runId } = generationRunParamsSchema.parse(request.params);
    const generationRun = repo.getGenerationRun(runId);
    if (!generationRun) return reply.status(404).send({ error: "GENERATION_RUN_NOT_FOUND" });
    const book = generationRun.bookId ? repo.getBook(generationRun.bookId, generationRun.userId) : null;
    return { generationRun, run: generationRun, book };
  });

  app.get("/api/generation/runs/:runId/events", async (request, reply) => {
    const { runId } = generationRunParamsSchema.parse(request.params);
    if (!repo.getGenerationRun(runId)) return reply.status(404).send({ error: "GENERATION_RUN_NOT_FOUND" });

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    let interval: NodeJS.Timeout | undefined;
    let closed = false;
    const close = () => {
      closed = true;
      if (interval) clearInterval(interval);
    };
    request.raw.on("close", close);

    const sendSnapshot = () => {
      if (closed) return;
      const generationRun = repo.getGenerationRun(runId);
      if (!generationRun) {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: "GENERATION_RUN_NOT_FOUND" })}\n\n`);
        reply.raw.end();
        close();
        return;
      }

      const book = generationRun.bookId ? repo.getBook(generationRun.bookId, generationRun.userId) : null;
      reply.raw.write(`event: generation\ndata: ${JSON.stringify({ generationRun, run: generationRun, book })}\n\n`);
      if (generationRun.status === "complete" || generationRun.status === "failed") {
        reply.raw.end();
        close();
      }
    };

    sendSnapshot();
    if (!closed) interval = setInterval(sendSnapshot, 500);
  });

  app.post("/api/generation/runs/:runId/retry-failed-chapters", async (request) => {
    const { runId } = generationRunParamsSchema.parse(request.params);
    return await repo.retryFailedGenerationChapters(runId);
  });

  app.post("/api/generation/runs/:runId/chapters/:chapterId/retry", async (request) => {
    const { runId, chapterId } = generationChapterRunParamsSchema.parse(request.params);
    return await repo.retryGenerationChapter(runId, chapterId);
  });

  app.get("/api/tutor/threads", async (request) => {
    const userId = requestUserId(request);
    const query = tutorThreadsQuerySchema.parse(request.query);
    return { threads: repo.listTutorThreads(query, userId) };
  });

  app.post("/api/tutor/threads/:threadId/messages", async (request) => {
    const { threadId } = threadParamsSchema.parse(request.params);
    const userId = requestUserId(request);
    const payload = postTutorMessageSchema.parse(request.body);
    return { thread: repo.appendTutorMessage(threadId, payload, userId) };
  });

  app.get("/api/sync/status", async () => ({ syncStatus: repo.getSyncStatus() }));

  app.get("/api/sync/export", async () => ({ snapshot: repo.exportSnapshot(), syncStatus: repo.getSyncStatus() }));

  app.post("/api/sync/export", async () => ({ snapshot: repo.exportSnapshot(), syncStatus: repo.getSyncStatus() }));

  app.post("/api/sync/import", async (request) => {
    const payload = importSyncSnapshotSchema.parse(request.body);
    return { snapshot: repo.importSnapshot(payload), syncStatus: repo.getSyncStatus() };
  });

  return app;
};

export const createServer = createApp;
