
import { QueryClient } from "@tanstack/react-query";
import type { BookFilter } from "@repo-books/shared";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 0
    }
  }
});

export const queryKeys = {
  health: () => ["health"] as const,
  uiState: () => ["ui-state", "default"] as const,
  books: (filter: BookFilter) => ["books", filter] as const,
  book: (bookId: string) => ["book", bookId] as const,
  lmStudioModels: () => ["lm-studio-models"] as const,
  generationRun: (runId: string) => ["generation-run", runId] as const,
  tutorThreads: (bookId: string, chapterId: string) => ["tutor-threads", bookId, chapterId] as const
};
