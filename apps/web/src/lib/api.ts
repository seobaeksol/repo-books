import type {
  BookChapter,
  BookFilter,
  GenerationRun,
  LmStudioModelsResponse,
  ReadingState,
  RepoBook,
  TutorMessage,
  TutorThread,
  UIState
} from "@repo-books/shared";

export type BookWithContent = RepoBook & {
  parts?: Array<{ id: string; title: string; summary?: string; chapterIds?: string[] }>;
  chapters?: BookChapter[];
  readingState?: ReadingState | null;
};

export type GenerationInput = {
  repositoryUrl: string;
  model: string;
  audience?: string;
  readerLevel: string;
  bookPurpose: string;
  depth: string;
  customPrompt?: string;
  background?: boolean;
};

export type GenerationResult = {
  run: GenerationRun;
  book: BookWithContent | null;
};

export type TutorThreadWithMessages = TutorThread & {
  messages?: TutorMessage[];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(stripAnsi(message || `Request failed: ${response.status}`));
  }

  return (await response.json()) as T;
}

const stripAnsi = (value: string) => value.replace(/\u001b\[[0-9;]*m/g, "");

const unwrap = <T>(value: unknown, key: string): T => {
  if (value && typeof value === "object" && key in value) {
    return (value as Record<string, unknown>)[key] as T;
  }
  return value as T;
};

const getBookById = async (bookId: string) => {
  const payload = await request(`/api/books/${bookId}`);
  const book = unwrap<BookWithContent>(payload, "book");
  const readingState = payload && typeof payload === "object" ? (payload as { readingState?: ReadingState }).readingState : undefined;
  return { ...book, readingState };
};

const normalizeGenerationResult = async (response: { generationRun?: GenerationRun; run?: GenerationRun; book?: BookWithContent | null }): Promise<GenerationResult> => {
  const run = response.generationRun ?? response.run;
  if (!run) throw new Error("Generation response did not include a run.");
  const book = response.book ?? (run.bookId ? await getBookById(run.bookId) : null);
  return { run, book };
};

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const api = {
  health: () => request<{ ok: boolean; service: string }>("/api/health"),
  listLmStudioModels: (refresh = false) => request<LmStudioModelsResponse>(`/api/lm-studio/models${refresh ? "?refresh=1" : ""}`),
  listBooks: async (filter: BookFilter = "all") => unwrap<BookWithContent[]>(await request(`/api/books?filter=${filter}`), "books"),
  getBook: getBookById,
  saveReadingState: (bookId: string, payload: Partial<ReadingState>) =>
    request<{ readingState?: ReadingState } | ReadingState>(`/api/reading-state/${bookId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }).then((value) => unwrap<ReadingState>(value, "readingState")),
  getUIState: async () => unwrap<UIState>(await request("/api/ui-state/default"), "uiState"),
  saveUIState: (payload: Partial<UIState>) =>
    request<{ uiState?: UIState } | UIState>("/api/ui-state/default", {
      method: "PATCH",
      body: JSON.stringify(payload)
    }).then((value) => unwrap<UIState>(value, "uiState")),
  getGenerationRun: async (runId: string) => normalizeGenerationResult(await request(`/api/generation/runs/${runId}`)),
  retryFailedGenerationChapters: async (runId: string) =>
    normalizeGenerationResult(await request(`/api/generation/runs/${runId}/retry-failed-chapters`, { method: "POST" })),
  startGenerationRun: async (payload: GenerationInput) =>
    normalizeGenerationResult(await request<{ generationRun?: GenerationRun; run?: GenerationRun; book?: BookWithContent | null }>("/api/generation/runs", {
      method: "POST",
      body: JSON.stringify({
        repoUrl: payload.repositoryUrl,
        model: payload.model,
        audience: payload.audience ?? payload.readerLevel,
        readerLevel: payload.readerLevel,
        bookPurpose: payload.bookPurpose,
        depth: payload.depth,
        customPrompt: payload.customPrompt ?? "",
        branch: "main",
        context: payload.depth === "deep" ? "128k" : "64k",
        background: payload.background ?? true
      })
    })),
  generateOutline: async (payload: GenerationInput, onUpdate?: (result: GenerationResult) => void) => {
    let result = await api.startGenerationRun(payload);
    onUpdate?.(result);

    while (result.run.status === "queued" || result.run.status === "running") {
      await delay(500);
      result = await api.getGenerationRun(result.run.id);
      onUpdate?.(result);
    }

    if (result.run.status === "failed") throw new Error(stripAnsi(result.run.error || "목차 생성에 실패했습니다."));
    if (!result.book) throw new Error("Generation response did not include a book draft.");
    return result;
  },
  listTutorThreads: async (bookId: string, chapterId: string) =>
    unwrap<TutorThreadWithMessages[]>(await request(`/api/tutor/threads?bookId=${bookId}&chapterId=${chapterId}`), "threads"),
  sendTutorMessage: (threadId: string, content: string) =>
    request<{ thread?: TutorThreadWithMessages } | TutorThreadWithMessages>(`/api/tutor/threads/${threadId}/messages`, {
      method: "POST",
      body: JSON.stringify({ role: "user", body: content })
    }).then((value) => unwrap<TutorThreadWithMessages>(value, "thread"))
};
