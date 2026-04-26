import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import {
  listBooksQuerySchema,
  patchReadingStateSchema,
  patchUiStateSchema,
  postGenerationOutlineSchema,
  postTutorMessageSchema,
  tutorThreadsQuerySchema
} from "@repo-books/shared";
import { createRepository, openDatabase, type RepoBooksRepository } from "./db.js";

export type CreateAppOptions = {
  dbPath?: string;
  logger?: boolean;
  seed?: boolean;
};

export type RepoBooksApp = FastifyInstance & {
  repo: RepoBooksRepository;
};

const bookParamsSchema = z.object({ bookId: z.string().min(1) });
const threadParamsSchema = z.object({ threadId: z.string().min(1) });

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
    if (message === "BOOK_NOT_FOUND" || message === "CHAPTER_NOT_FOUND" || message === "THREAD_NOT_FOUND") {
      return reply.status(404).send({ error: message });
    }
    request.log.error(error);
    return reply.status(500).send({ error: "INTERNAL_SERVER_ERROR" });
  });

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/books", async (request) => {
    const query = listBooksQuerySchema.parse(request.query);
    return { books: repo.listBooks(query.filter) };
  });

  app.get("/api/books/:bookId", async (request, reply) => {
    const { bookId } = bookParamsSchema.parse(request.params);
    const book = repo.getBook(bookId);
    if (!book) return reply.status(404).send({ error: "BOOK_NOT_FOUND" });
    return { book, readingState: repo.getReadingState(bookId) };
  });

  app.patch("/api/reading-state/:bookId", async (request) => {
    const { bookId } = bookParamsSchema.parse(request.params);
    const payload = patchReadingStateSchema.parse(request.body);
    return { readingState: repo.saveReadingState(bookId, payload) };
  });

  app.get("/api/ui-state/default", async () => ({ uiState: repo.getUiState() }));

  app.patch("/api/ui-state/default", async (request) => {
    const payload = patchUiStateSchema.parse(request.body);
    return { uiState: repo.saveUiState(payload) };
  });

  app.post("/api/generation/outline", async (request) => {
    const payload = postGenerationOutlineSchema.parse(request.body);
    return repo.createGenerationRun(payload);
  });

  app.get("/api/tutor/threads", async (request) => {
    const query = tutorThreadsQuerySchema.parse(request.query);
    return { threads: repo.listTutorThreads(query) };
  });

  app.post("/api/tutor/threads/:threadId/messages", async (request) => {
    const { threadId } = threadParamsSchema.parse(request.params);
    const payload = postTutorMessageSchema.parse(request.body);
    return { thread: repo.appendTutorMessage(threadId, payload) };
  });

  return app;
};

export const createServer = createApp;
