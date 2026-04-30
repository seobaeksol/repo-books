
import type { BookFilter } from "@repo-books/shared";
import { create } from "zustand";
import { DEFAULT_THEME_ID, type ThemeId, type ThemeOverrides } from "../design/themes";
import type { BookWithContent } from "../lib/api";
import type { MobilePanel, StudioStatus } from "../types";

type AppStore = {
  booted: boolean;
  books: BookWithContent[];
  activeBook: BookWithContent | null;
  bookFilter: BookFilter;
  focusMode: boolean;
  mobilePanel: MobilePanel;
  studioStatus: StudioStatus;
  tutorDraft: string;
  themeId: ThemeId;
  customThemeOverrides: ThemeOverrides;
  uiPreferences: Record<string, unknown>;
  error: string | null;
  setBooted: (booted: boolean) => void;
  setBooks: (books: BookWithContent[]) => void;
  upsertBook: (book: BookWithContent) => void;
  setActiveBook: (book: BookWithContent | null) => void;
  setBookFilter: (filter: BookFilter) => void;
  setFocusMode: (focusMode: boolean) => void;
  setMobilePanel: (panel: MobilePanel) => void;
  setStudioStatus: (status: StudioStatus) => void;
  setTutorDraft: (draft: string) => void;
  setThemeId: (themeId: ThemeId) => void;
  setCustomThemeOverrides: (overrides: ThemeOverrides) => void;
  setUIPreferences: (preferences: Record<string, unknown>) => void;
  setError: (error: string | null) => void;
};

export const useAppStore = create<AppStore>((set) => ({
  booted: false,
  books: [],
  activeBook: null,
  bookFilter: "all",
  focusMode: false,
  mobilePanel: "",
  studioStatus: "offline",
  tutorDraft: "",
  themeId: DEFAULT_THEME_ID,
  customThemeOverrides: {},
  uiPreferences: {},
  error: null,
  setBooted: (booted) => set({ booted }),
  setBooks: (books) => set({ books }),
  upsertBook: (book) =>
    set((state) => ({
      books: state.books.some((item) => item.id === book.id) ? state.books.map((item) => (item.id === book.id ? book : item)) : [book, ...state.books]
    })),
  setActiveBook: (activeBook) => set({ activeBook }),
  setBookFilter: (bookFilter) => set({ bookFilter }),
  setFocusMode: (focusMode) => set({ focusMode }),
  setMobilePanel: (mobilePanel) => set({ mobilePanel }),
  setStudioStatus: (studioStatus) => set({ studioStatus }),
  setTutorDraft: (tutorDraft) => set({ tutorDraft }),
  setThemeId: (themeId) => set({ themeId }),
  setCustomThemeOverrides: (customThemeOverrides) => set({ customThemeOverrides }),
  setUIPreferences: (uiPreferences) => set({ uiPreferences }),
  setError: (error) => set({ error })
}));
