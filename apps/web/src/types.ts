
import type { BookFilter, UIState } from "@repo-books/shared";
import type { ThemeId, ThemeOverrides } from "./design/themes";

export type MobilePanel = "" | "toc" | "mentor";
export type StudioStatus = "ready" | "offline" | "error";
export type RunStepState = "pending" | "active" | "complete" | "failed";

export type GenerationForm = {
  repositoryUrl: string;
  model: string;
  audience: string;
  readerLevel: string;
  bookPurpose: string;
  depth: string;
  customPrompt: string;
};

export type PersistedPatch = Partial<UIState> & {
  lastRoute?: string;
  selectedLibraryFilter?: BookFilter;
  draftTutorMessage?: string;
  focusModeEnabled?: boolean;
  activeBookId?: string;
  activeChapterId?: string | null;
  themeId?: ThemeId;
  customThemeOverrides?: ThemeOverrides;
};
