import type {
  BookChapter,
  BookFilter,
  GenerationRun,
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
  audience: string;
  depth: string;
};

export type GenerationResult = {
  run: GenerationRun;
  book: BookWithContent;
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
    throw new Error(message || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

const unwrap = <T>(value: unknown, key: string): T => {
  if (value && typeof value === "object" && key in value) {
    return (value as Record<string, unknown>)[key] as T;
  }
  return value as T;
};

export const api = {
  health: () => request<{ ok: boolean; service: string }>("/api/health"),
  listBooks: async (filter: BookFilter = "all") => unwrap<BookWithContent[]>(await request(`/api/books?filter=${filter}`), "books"),
  getBook: async (bookId: string) => {
    const payload = await request(`/api/books/${bookId}`);
    const book = unwrap<BookWithContent>(payload, "book");
    const readingState = payload && typeof payload === "object" ? (payload as { readingState?: ReadingState }).readingState : undefined;
    return { ...book, readingState };
  },
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
  generateOutline: async (payload: GenerationInput) => {
    const response = await request<{ generationRun?: GenerationRun; run?: GenerationRun; book?: BookWithContent }>("/api/generation/outline", {
      method: "POST",
      body: JSON.stringify({
        repoUrl: payload.repositoryUrl,
        model: payload.model,
        audience: payload.audience,
        depth: payload.depth,
        branch: "main",
        context: payload.depth === "deep" ? "128k" : "64k"
      })
    });
    const run = response.generationRun ?? response.run;
    if (!run) throw new Error("Generation response did not include a run.");
    const book = response.book ?? (run.bookId ? await api.getBook(run.bookId) : undefined);
    if (!book) throw new Error("Generation response did not include a book draft.");
    return { run, book };
  },
  listTutorThreads: async (bookId: string, chapterId: string) =>
    unwrap<TutorThreadWithMessages[]>(await request(`/api/tutor/threads?bookId=${bookId}&chapterId=${chapterId}`), "threads"),
  sendTutorMessage: (threadId: string, content: string) =>
    request<{ thread?: TutorThreadWithMessages } | TutorThreadWithMessages>(`/api/tutor/threads/${threadId}/messages`, {
      method: "POST",
      body: JSON.stringify({ role: "user", body: content })
    }).then((value) => unwrap<TutorThreadWithMessages>(value, "thread"))
};
