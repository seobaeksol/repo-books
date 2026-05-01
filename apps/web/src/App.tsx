
import { Loader2 } from "lucide-react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { BookFilter, ReadingState } from "@repo-books/shared";
import { AppFrame } from "./components/AppFrame";
import { normalizeThemeId, normalizeThemeOverrides, type ThemeId, type ThemeOverrides } from "./design/themes";
import { api, type BookWithContent, type GenerationResult } from "./lib/api";
import { queryClient, queryKeys } from "./lib/query";
import { useAppStore } from "./store/appStore";
import type { PersistedPatch } from "./types";
import { GenerationProgressRoute } from "./views/GenerationProgressRoute";
import { GenerationView } from "./views/GenerationView";
import { LibraryView } from "./views/LibraryView";
import { ReaderRoute } from "./views/ReaderRoute";
import { chapterProgress, firstChapter, getString, normalizeFilter, progress, routeToView } from "./utils/appHelpers";

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

function AppContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const booted = useAppStore((state) => state.booted);
  const books = useAppStore((state) => state.books);
  const activeBook = useAppStore((state) => state.activeBook);
  const bookFilter = useAppStore((state) => state.bookFilter);
  const focusMode = useAppStore((state) => state.focusMode);
  const mobilePanel = useAppStore((state) => state.mobilePanel);
  const studioStatus = useAppStore((state) => state.studioStatus);
  const tutorDraft = useAppStore((state) => state.tutorDraft);
  const themeId = useAppStore((state) => state.themeId);
  const customThemeOverrides = useAppStore((state) => state.customThemeOverrides);
  const error = useAppStore((state) => state.error);
  const setBooted = useAppStore((state) => state.setBooted);
  const setBooks = useAppStore((state) => state.setBooks);
  const upsertBook = useAppStore((state) => state.upsertBook);
  const setActiveBook = useAppStore((state) => state.setActiveBook);
  const setBookFilter = useAppStore((state) => state.setBookFilter);
  const setFocusMode = useAppStore((state) => state.setFocusMode);
  const setMobilePanel = useAppStore((state) => state.setMobilePanel);
  const setStudioStatus = useAppStore((state) => state.setStudioStatus);
  const setTutorDraft = useAppStore((state) => state.setTutorDraft);
  const setThemeId = useAppStore((state) => state.setThemeId);
  const setCustomThemeOverrides = useAppStore((state) => state.setCustomThemeOverrides);
  const setUIPreferences = useAppStore((state) => state.setUIPreferences);
  const setError = useAppStore((state) => state.setError);

  const currentView = location.pathname.startsWith("/generation")
    ? "generation"
    : location.pathname.startsWith("/books/")
      ? "reader"
      : "library";

  const saveUIState = useCallback(
    (patch: PersistedPatch) => {
      const state = useAppStore.getState();
      const preferences = state.uiPreferences;
      const nextPreferences = {
        ...preferences,
        lastRoute: patch.lastRoute ?? preferences.lastRoute ?? location.pathname,
        selectedLibraryFilter: patch.selectedLibraryFilter ?? preferences.selectedLibraryFilter ?? state.bookFilter,
        draftTutorMessage: patch.draftTutorMessage ?? preferences.draftTutorMessage ?? state.tutorDraft,
        themeId: patch.themeId ?? preferences.themeId ?? state.themeId,
        customThemeOverrides: patch.customThemeOverrides ?? preferences.customThemeOverrides ?? state.customThemeOverrides
      };
      setUIPreferences(nextPreferences);
      void api.saveUIState({
        activeBookId: patch.activeBookId,
        activeChapterId: patch.activeChapterId,
        view: patch.view ?? routeToView(patch.lastRoute ?? location.pathname),
        focus: patch.focus ?? patch.focusModeEnabled ?? state.focusMode,
        mobilePanel: "",
        preferences: nextPreferences
      });
    },
    [location.pathname, setUIPreferences]
  );

  const loadBooks = useCallback(
    async (filter: BookFilter) => {
      const nextBooks = await queryClient.fetchQuery({
        queryKey: queryKeys.books(filter),
        queryFn: () => api.listBooks(filter)
      });
      setBooks(nextBooks);
      return nextBooks;
    },
    [setBooks]
  );

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        const [health, uiState] = await Promise.all([
          queryClient.fetchQuery({ queryKey: queryKeys.health(), queryFn: api.health }).catch(() => null),
          queryClient.fetchQuery({ queryKey: queryKeys.uiState(), queryFn: api.getUIState }).catch(() => null)
        ]);
        if (cancelled) return;

        setStudioStatus(health?.ok ? "ready" : "offline");
        const preferences = uiState?.preferences ?? {};
        setUIPreferences(preferences);
        const restoredFilter = normalizeFilter(preferences.selectedLibraryFilter);
        setBookFilter(restoredFilter);
        setFocusMode(Boolean(uiState?.focus));
        setTutorDraft(typeof preferences.draftTutorMessage === "string" ? preferences.draftTutorMessage : "");
        setThemeId(normalizeThemeId(preferences.themeId));
        setCustomThemeOverrides(normalizeThemeOverrides(preferences.customThemeOverrides));

        const nextBooks = await loadBooks(restoredFilter);
        if (cancelled) return;

        const activeBookId = getString(uiState, "activeBookId") || nextBooks[0]?.id;
        const initialBook = activeBookId
          ? await queryClient.fetchQuery({ queryKey: queryKeys.book(activeBookId), queryFn: () => api.getBook(activeBookId) }).catch(() => nextBooks[0])
          : nextBooks[0];
        if (initialBook) setActiveBook(initialBook);

        if (location.pathname === "/") {
          const restoredRoute = (typeof preferences.lastRoute === "string" ? preferences.lastRoute : "") || "/library";
          navigate(restoredRoute, { replace: true });
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "앱 초기화에 실패했습니다.");
      } finally {
        if (!cancelled) setBooted(true);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [loadBooks, location.pathname, navigate, setActiveBook, setBookFilter, setBooted, setCustomThemeOverrides, setError, setFocusMode, setStudioStatus, setThemeId, setTutorDraft, setUIPreferences]);

  useEffect(() => {
    if (!booted || location.pathname === "/") return;
    saveUIState({ lastRoute: location.pathname });
  }, [booted, location.pathname, saveUIState]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (useAppStore.getState().mobilePanel) {
        setMobilePanel("");
        return;
      }
      if (useAppStore.getState().focusMode) {
        setFocusMode(false);
        saveUIState({ focusModeEnabled: false });
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveUIState, setFocusMode, setMobilePanel]);

  async function openBook(bookId: string, chapterId?: string) {
    const book = await queryClient.fetchQuery({ queryKey: queryKeys.book(bookId), queryFn: () => api.getBook(bookId) });
    const targetChapterId = chapterId || book.currentChapterId || firstChapter(book)?.id;
    const targetChapter = book.chapters?.find((chapter) => chapter.id === targetChapterId) ?? firstChapter(book);
    setActiveBook(book);
    if (!targetChapterId) return;
    setMobilePanel("");
    navigate("/books/" + book.id + "/chapters/" + targetChapterId);
    if (chapterId) {
      await api.saveReadingState(book.id, {
        chapterId: targetChapterId,
        progressPercent: targetChapter ? chapterProgress(targetChapter) : progress(book),
        scrollY: 0
      } as Partial<ReadingState>);
    }
    saveUIState({
      activeBookId: book.id,
      activeChapterId: targetChapterId,
      lastRoute: "/books/" + book.id + "/chapters/" + targetChapterId
    });
  }

  async function selectFilter(filter: BookFilter) {
    setBookFilter(filter);
    await queryClient.invalidateQueries({ queryKey: queryKeys.books(filter) });
    const nextBooks = await loadBooks(filter);
    if (nextBooks[0] && !nextBooks.some((book) => book.id === useAppStore.getState().activeBook?.id)) {
      setActiveBook(nextBooks[0]);
    }
    saveUIState({ selectedLibraryFilter: filter });
  }

  function goToGeneration() {
    setMobilePanel("");
    navigate("/generation");
  }

  function goToLibrary() {
    setMobilePanel("");
    navigate("/library");
  }

  function goToReader() {
    const state = useAppStore.getState();
    const targetBook = state.activeBook ?? state.books[0];
    if (!targetBook) return;
    void openBook(targetBook.id);
  }

  const rememberGenerationResult = useCallback(
    (result: GenerationResult) => {
      const generatedBook = result.book;
      queryClient.setQueryData(queryKeys.generationRun(result.run.id), result);
      if (!generatedBook) return;
      queryClient.setQueryData(queryKeys.book(generatedBook.id), generatedBook);
      setActiveBook(generatedBook);
      upsertBook(generatedBook);
    },
    [setActiveBook, upsertBook]
  );

  function openLibraryBook(book: BookWithContent) {
    if (book.status === "generating" && book.generationRunId) {
      setActiveBook(book);
      navigate("/generation/runs/" + book.generationRunId);
      return;
    }
    void openBook(book.id);
  }

  function updateTheme(nextThemeId: ThemeId) {
    setThemeId(nextThemeId);
    saveUIState({ themeId: nextThemeId });
  }

  function updateCustomTheme(nextOverrides: ThemeOverrides) {
    setThemeId("custom");
    setCustomThemeOverrides(nextOverrides);
    saveUIState({ themeId: "custom", customThemeOverrides: nextOverrides });
  }

  if (!booted) {
    return (
      <AppFrame
        view={currentView}
        focusMode={focusMode}
        mobilePanel={mobilePanel}
        studioStatus={studioStatus}
        themeId={themeId}
        customThemeOverrides={customThemeOverrides}
        onThemeChange={updateTheme}
        onCustomThemeChange={updateCustomTheme}
        goToLibrary={goToLibrary}
        goToGeneration={goToGeneration}
      >
        <div className="empty-state content-surface" role="status">
          <Loader2 className="spin" />
          <strong>Repo Books를 여는 중</strong>
        </div>
      </AppFrame>
    );
  }

  return (
    <AppFrame
      view={currentView}
      focusMode={focusMode}
      mobilePanel={mobilePanel}
      studioStatus={studioStatus}
      themeId={themeId}
      customThemeOverrides={customThemeOverrides}
      onThemeChange={updateTheme}
      onCustomThemeChange={updateCustomTheme}
      goToLibrary={goToLibrary}
      goToGeneration={goToGeneration}
      goToReader={currentView === "generation" ? undefined : goToReader}
    >
      {error ? <div className="app-error content-surface">{error}</div> : null}
      <Routes>
        <Route path="/" element={<Navigate to="/library" replace />} />
        <Route
          path="/library"
          element={
            <LibraryView
              books={books}
              activeBookId={activeBook?.id}
              filter={bookFilter}
              onFilterChange={selectFilter}
              onOpenBook={openLibraryBook}
              onCreateBook={goToGeneration}
            />
          }
        />
        <Route
          path="/generation"
          element={
            <GenerationView
              onBack={goToLibrary}
              onGenerated={rememberGenerationResult}
            />
          }
        />
        <Route
          path="/generation/runs/:runId"
          element={
            <GenerationProgressRoute
              onBack={goToLibrary}
              onReadBook={(bookId, chapterId) => void openBook(bookId, chapterId)}
              onGenerated={rememberGenerationResult}
            />
          }
        />
        <Route
          path="/books/:bookId/chapters/:chapterId"
          element={
            <ReaderRoute
              activeBook={activeBook}
              focusMode={focusMode}
              mobilePanel={mobilePanel}
              tutorDraft={tutorDraft}
              setTutorDraft={(value) => {
                setTutorDraft(value);
                saveUIState({ draftTutorMessage: value });
              }}
              setFocusMode={(value) => {
                setFocusMode(value);
                saveUIState({ focusModeEnabled: value });
              }}
              setMobilePanel={setMobilePanel}
              openBook={(bookId, chapterId) => void openBook(bookId, chapterId)}
              onBookLoaded={setActiveBook}
              saveUIState={saveUIState}
            />
          }
        />
      </Routes>
      <div className="mobile-backdrop" hidden={!mobilePanel} onClick={() => setMobilePanel("")} />
    </AppFrame>
  );
}
