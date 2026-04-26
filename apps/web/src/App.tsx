import {
  Activity,
  BookOpen,
  BookOpenCheck,
  BookmarkCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  File,
  FileCode2,
  Focus,
  Folder,
  Home,
  Library,
  ListTree,
  Loader2,
  MessageSquareText,
  Palette,
  Plus,
  SendHorizontal,
  Settings2,
  Sparkles,
  Target,
  X
} from "lucide-react";
import type { CSSProperties, FormEvent, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import type { BookChapter, BookFilter, GenerationStep, ReadingState, UIState } from "@repo-books/shared";
import { api, BookWithContent, GenerationResult, TutorThreadWithMessages } from "./lib/api";
import {
  colorInputValue,
  customThemeFields,
  DEFAULT_THEME_ID,
  getThemePreset,
  normalizeThemeId,
  normalizeThemeOverrides,
  numericInputValue,
  themePresets,
  themeStyleFor,
  themeVariablesFor,
  type ThemeId,
  type ThemeOverrides,
  type ThemeVariable
} from "./design/themes";

type MobilePanel = "" | "toc" | "mentor";
type StudioStatus = "ready" | "offline" | "error";
type RunStepState = "pending" | "active" | "complete" | "failed";
type PersistedPatch = Partial<UIState> & {
  lastRoute?: string;
  selectedLibraryFilter?: BookFilter;
  draftTutorMessage?: string;
  focusModeEnabled?: boolean;
  activeBookId?: string;
  activeChapterId?: string | null;
  themeId?: ThemeId;
  customThemeOverrides?: ThemeOverrides;
};

const FILTERS: Array<{ value: BookFilter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "in_progress", label: "읽는 중" },
  { value: "generating", label: "생성 중" },
  { value: "draft", label: "초안" }
];

const STATUS_LABELS: Record<string, string> = {
  draft: "초안",
  generating: "생성 중",
  reading: "읽는 중",
  in_progress: "읽는 중",
  complete: "완성",
  completed: "완성",
  failed: "실패"
};

const GENERATION_STEPS: Array<{ id: string; label: string; detail: string }> = [
  { id: "scan", label: "저장소 입력 검증", detail: "URL, 모델, 독자 수준 확인" },
  { id: "toc", label: "대단원 초안", detail: "파일 트리가 아니라 학습 순서로 재배열" },
  { id: "chapter", label: "챕터별 코드 근거", detail: "관련 파일과 코드 앵커를 목차에 연결" },
  { id: "done", label: "책 초안 저장", detail: "SQLite에 이어 읽기 가능한 상태로 저장" }
];

const GENERATION_FORM_DEFAULT = {
  repositoryUrl: "https://github.com/esp-rs/esp-hal",
  model: "qwen3-coder 14B",
  audience: "유지보수 가능한 junior developer",
  depth: "balanced"
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [booted, setBooted] = useState(false);
  const [books, setBooks] = useState<BookWithContent[]>([]);
  const [activeBook, setActiveBook] = useState<BookWithContent | null>(null);
  const [bookFilter, setBookFilter] = useState<BookFilter>("all");
  const [focusMode, setFocusMode] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("");
  const [studioStatus, setStudioStatus] = useState<StudioStatus>("offline");
  const [tutorDraft, setTutorDraft] = useState("");
  const [themeId, setThemeId] = useState<ThemeId>(DEFAULT_THEME_ID);
  const [customThemeOverrides, setCustomThemeOverrides] = useState<ThemeOverrides>({});
  const uiPreferencesRef = useRef<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  const currentView = location.pathname.startsWith("/generation")
    ? "generation"
    : location.pathname.startsWith("/books/")
      ? "reader"
      : "library";

  const saveUIState = useCallback(
    (patch: PersistedPatch) => {
      const preferences = uiPreferencesRef.current;
      const nextPreferences = {
        ...preferences,
        lastRoute: patch.lastRoute ?? preferences.lastRoute ?? location.pathname,
        selectedLibraryFilter: patch.selectedLibraryFilter ?? preferences.selectedLibraryFilter ?? bookFilter,
        draftTutorMessage: patch.draftTutorMessage ?? preferences.draftTutorMessage ?? tutorDraft,
        themeId: patch.themeId ?? preferences.themeId ?? themeId,
        customThemeOverrides: patch.customThemeOverrides ?? preferences.customThemeOverrides ?? customThemeOverrides
      };
      uiPreferencesRef.current = nextPreferences;
      void api.saveUIState({
        activeBookId: patch.activeBookId,
        activeChapterId: patch.activeChapterId,
        view: patch.view ?? routeToView(patch.lastRoute ?? location.pathname),
        focus: patch.focus ?? patch.focusModeEnabled ?? focusMode,
        mobilePanel: "",
        preferences: nextPreferences
      });
    },
    [bookFilter, customThemeOverrides, focusMode, location.pathname, themeId, tutorDraft]
  );

  const loadBooks = useCallback(async (filter: BookFilter) => {
    const nextBooks = await api.listBooks(filter);
    setBooks(nextBooks);
    return nextBooks;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        const [health, uiState] = await Promise.all([
          api.health().catch(() => null),
          api.getUIState().catch(() => null)
        ]);
        if (cancelled) return;

        setStudioStatus(health?.ok ? "ready" : "offline");
        const preferences = uiState?.preferences ?? {};
        uiPreferencesRef.current = preferences;
        const restoredFilter = normalizeFilter(preferences.selectedLibraryFilter);
        setBookFilter(restoredFilter);
        setFocusMode(Boolean(uiState?.focus));
        setTutorDraft(typeof preferences.draftTutorMessage === "string" ? preferences.draftTutorMessage : "");
        setThemeId(normalizeThemeId(preferences.themeId));
        setCustomThemeOverrides(normalizeThemeOverrides(preferences.customThemeOverrides));

        const nextBooks = await loadBooks(restoredFilter);
        if (cancelled) return;

        const activeBookId = getString(uiState, "activeBookId") || nextBooks[0]?.id;
        const initialBook = activeBookId ? await api.getBook(activeBookId).catch(() => nextBooks[0]) : nextBooks[0];
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
  }, [loadBooks, location.pathname, navigate]);

  useEffect(() => {
    if (!booted || location.pathname === "/") return;
    saveUIState({ lastRoute: location.pathname });
  }, [booted, location.pathname, saveUIState]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (mobilePanel) {
        setMobilePanel("");
        return;
      }
      if (focusMode) {
        setFocusMode(false);
        saveUIState({ focusModeEnabled: false });
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusMode, mobilePanel, saveUIState]);

  async function openBook(bookId: string, chapterId?: string) {
    const book = await api.getBook(bookId);
    const targetChapterId = chapterId || book.currentChapterId || firstChapter(book)?.id;
    const targetChapter = book.chapters?.find((chapter) => chapter.id === targetChapterId) ?? firstChapter(book);
    setActiveBook(book);
    if (!targetChapterId) return;
    setMobilePanel("");
    navigate(`/books/${book.id}/chapters/${targetChapterId}`);
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
      lastRoute: `/books/${book.id}/chapters/${targetChapterId}`
    });
  }

  async function selectFilter(filter: BookFilter) {
    setBookFilter(filter);
    const nextBooks = await loadBooks(filter);
    if (nextBooks[0] && !nextBooks.some((book) => book.id === activeBook?.id)) {
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
    const targetBook = activeBook ?? books[0];
    if (!targetBook) return;
    void openBook(targetBook.id);
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
      goToReader={goToReader}
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
              onOpenBook={(bookId) => void openBook(bookId)}
              onCreateBook={goToGeneration}
            />
          }
        />
        <Route
          path="/generation"
          element={
            <GenerationView
              activeBook={activeBook}
              onBack={goToLibrary}
              onReadBook={(bookId, chapterId) => void openBook(bookId, chapterId)}
              onGenerated={(result) => {
                setActiveBook(result.book);
                setBooks((current) => upsertBook(current, result.book));
              }}
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

function AppFrame({
  children,
  view,
  focusMode,
  mobilePanel,
  studioStatus,
  themeId,
  customThemeOverrides,
  onThemeChange,
  onCustomThemeChange,
  goToLibrary,
  goToGeneration,
  goToReader
}: {
  children: React.ReactNode;
  view: string;
  focusMode: boolean;
  mobilePanel: MobilePanel;
  studioStatus: StudioStatus;
  themeId: ThemeId;
  customThemeOverrides: ThemeOverrides;
  onThemeChange: (themeId: ThemeId) => void;
  onCustomThemeChange: (overrides: ThemeOverrides) => void;
  goToLibrary: () => void;
  goToGeneration: () => void;
  goToReader?: () => void;
}) {
  const location = useLocation();

  return (
    <div
      className="app-shell"
      data-view={view}
      data-focus={String(focusMode)}
      data-mobile-panel={mobilePanel}
      data-theme={themeId}
      style={themeStyleFor(themeId, customThemeOverrides) as CSSProperties}
    >
      <header className="top-bar command-surface" aria-label="앱 명령 막대">
        <button className="brand-mark" type="button" onClick={goToLibrary} aria-label="Repo Books 책장으로 이동">
          <span className="brand-icon" aria-hidden="true">
            <BookOpen />
          </span>
          <span className="brand-copy">
            <strong>Repo Books</strong>
            <small>Repository Bookshelf</small>
          </span>
        </button>
        <div className="top-actions">
          <ThemeMenu
            themeId={themeId}
            customThemeOverrides={customThemeOverrides}
            onThemeChange={onThemeChange}
            onCustomThemeChange={onCustomThemeChange}
          />
          <div className={`studio-status is-${studioStatus}`} aria-label={`LM Studio ${studioStatus}`}>
            <span className={`state-dot state-dot--${studioStatus}`} />
            <span>LM Studio</span>
            <strong>{studioStatus}</strong>
          </div>
        </div>
      </header>

      <main className="workspace" id="workspace" tabIndex={-1}>
        <div className="app-view">{children}</div>
      </main>

      <nav className="mobile-library-nav command-surface" aria-label="모바일 책장 탐색">
        <button
          className={`mobile-nav-button ${location.pathname.startsWith("/library") ? "active" : ""}`}
          type="button"
          onClick={goToLibrary}
          aria-current={location.pathname.startsWith("/library") ? "page" : undefined}
          aria-label="책장"
        >
          <Library />
          <span>책장</span>
        </button>
        <button
          className={`mobile-nav-button ${location.pathname.startsWith("/generation") ? "active" : ""}`}
          type="button"
          onClick={goToGeneration}
          aria-current={location.pathname.startsWith("/generation") ? "page" : undefined}
          aria-label="새 책"
        >
          <Plus />
          <span>새 책</span>
        </button>
        <button
          className={`mobile-nav-button ${location.pathname.startsWith("/books/") ? "active" : ""}`}
          type="button"
          onClick={goToReader}
          disabled={!goToReader}
          aria-current={location.pathname.startsWith("/books/") ? "page" : undefined}
          aria-label="읽기"
        >
          <BookOpen />
          <span>읽기</span>
        </button>
      </nav>
    </div>
  );
}

function ThemeMenu({
  themeId,
  customThemeOverrides,
  onThemeChange,
  onCustomThemeChange
}: {
  themeId: ThemeId;
  customThemeOverrides: ThemeOverrides;
  onThemeChange: (themeId: ThemeId) => void;
  onCustomThemeChange: (overrides: ThemeOverrides) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeTheme = themeId === "custom" ? "Custom" : getThemePreset(themeId).label;
  const customVariables = themeVariablesFor("custom", customThemeOverrides);

  function selectTheme(nextThemeId: ThemeId) {
    onThemeChange(nextThemeId);
    setOpen(false);
  }

  function updateCustomVariable(variable: ThemeVariable, value: string) {
    const nextOverrides = { ...customThemeOverrides, [variable]: value };
    if (variable === "--app-bg") {
      nextOverrides["--app-bg-gradient"] = `linear-gradient(180deg, ${value}, ${value})`;
    }
    onCustomThemeChange(nextOverrides);
  }

  return (
    <div className="theme-menu-wrap">
      <button className="theme-trigger" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Palette />
        <span>테마</span>
        <strong>{activeTheme}</strong>
      </button>
      {open ? (
        <div className="theme-popover command-surface" role="dialog" aria-label="테마 설정">
          <div className="theme-options" role="radiogroup" aria-label="테마 선택">
            {themePresets.map((theme) => (
              <button
                key={theme.id}
                className="theme-option"
                type="button"
                role="radio"
                aria-checked={themeId === theme.id}
                onClick={() => selectTheme(theme.id)}
              >
                <span className="theme-swatch" style={swatchStyle(theme.variables)} />
                <span>
                  <strong>{theme.label}</strong>
                  <small>{theme.description}</small>
                </span>
              </button>
            ))}
            <button className="theme-option" type="button" role="radio" aria-checked={themeId === "custom"} onClick={() => onThemeChange("custom")}>
              <span className="theme-swatch" style={swatchStyle(customVariables)} />
              <span>
                <strong>Custom</strong>
                <small>사용자 정의</small>
              </span>
            </button>
          </div>

          <div className="theme-custom-grid" aria-label="사용자 정의 테마">
            {customThemeFields.map((field) => (
              <label key={field.variable}>
                <span>{field.label}</span>
                <input
                  type="color"
                  value={colorInputValue(customVariables[field.variable])}
                  onChange={(event) => updateCustomVariable(field.variable, event.target.value)}
                />
              </label>
            ))}
          </div>

          <label className="theme-range-row">
            <span>본문 크기</span>
            <input
              type="range"
              min="0.92"
              max="1.14"
              step="0.01"
              value={numericInputValue(customVariables["--reader-font-scale"], 1)}
              onChange={(event) => updateCustomVariable("--reader-font-scale", event.target.value)}
            />
          </label>
          <label className="theme-range-row">
            <span>줄 간격</span>
            <input
              type="range"
              min="1.55"
              max="2.1"
              step="0.05"
              value={numericInputValue(customVariables["--reader-line-height"], 1.85)}
              onChange={(event) => updateCustomVariable("--reader-line-height", event.target.value)}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

function LibraryView({
  books,
  activeBookId,
  filter,
  onFilterChange,
  onOpenBook,
  onCreateBook
}: {
  books: BookWithContent[];
  activeBookId?: string;
  filter: BookFilter;
  onFilterChange: (filter: BookFilter) => Promise<void>;
  onOpenBook: (bookId: string) => void;
  onCreateBook: () => void;
}) {
  const recentBooks = [...books]
    .sort((a, b) => recentSortKey(b).localeCompare(recentSortKey(a)))
    .slice(0, 3);

  return (
    <section className="library-view" aria-labelledby="library-title">
      <div className="books-layout">
        <aside className="books-sidebar panel-surface" aria-label="책장 탐색">
          <div className="sidebar-title">
            <p className="eyebrow">Library</p>
            <strong>Repo Books</strong>
          </div>
          <nav className="sidebar-nav" aria-label="책장 컬렉션">
            <SidebarButton active={filter === "all"} icon={<Home />} label="홈" onClick={() => void onFilterChange("all")} />
            <SidebarButton icon={<Clock3 />} label="최근 읽은 책" count={recentBooks.length} onClick={() => scrollToSection("recent-title")} />
            <SidebarButton icon={<Library />} label="내 책" count={books.length} onClick={() => scrollToSection("shelf-title")} />
            <SidebarButton icon={<Folder />} label="컬렉션" onClick={() => scrollToSection("collection-strip")} />
            <SidebarButton
              active={filter === "generating"}
              icon={<Sparkles />}
              label="생성 중"
              count={books.filter((book) => book.status === "generating").length}
              onClick={() => void onFilterChange("generating")}
            />
          </nav>
          <button className="primary-action sidebar-create" type="button" onClick={onCreateBook}>
            <Plus />
            <span>새 책 만들기</span>
          </button>
        </aside>

        <div className="books-main">
          <header className="library-header">
            <div>
              <p className="eyebrow">Home</p>
              <h1 id="library-title">책장</h1>
            </div>
          </header>

          <section className="recent-section" aria-labelledby="recent-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Recent</p>
                <h2 id="recent-title">최근 읽은 책</h2>
              </div>
            </div>
            <div className="recent-row" aria-live="polite">
              {recentBooks.map((book) => (
                <RecentBook key={book.id} book={book} onOpenBook={onOpenBook} />
              ))}
            </div>
          </section>

          <section className="collection-strip" id="collection-strip" aria-label="컬렉션과 상태 필터">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                className={`collection-chip ${filter === item.value ? "is-active" : ""}`}
                type="button"
                aria-pressed={filter === item.value}
                onClick={() => void onFilterChange(item.value)}
              >
                {item.label}
              </button>
            ))}
          </section>

          <section className="shelf-section" aria-labelledby="shelf-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Library</p>
                <h2 id="shelf-title">내 책</h2>
              </div>
              <span className="wire-note">cover grid</span>
            </div>
            <div className="shelf-row" aria-live="polite">
              {books.map((book) => (
                <BookCard key={book.id} book={book} selected={book.id === activeBookId} onOpenBook={onOpenBook} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

function SidebarButton({
  icon,
  label,
  count,
  active = false,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button className={`sidebar-nav-button ${active ? "active" : ""}`} type="button" aria-current={active ? "page" : undefined} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {typeof count === "number" ? <small>{count}</small> : null}
    </button>
  );
}

function RecentBook({ book, onOpenBook }: { book: BookWithContent; onOpenBook: (bookId: string) => void }) {
  const chapter = currentChapter(book);
  return (
    <article className={`recent-book book-accent-${coverTheme(book)}`}>
      <button className="book-cover" type="button" onClick={() => onOpenBook(book.id)} aria-label={`${book.title} 읽기`}>
        <span className="book-status">{statusLabel(book)}</span>
        <strong>{book.title}</strong>
        <small>{repositoryName(book)}</small>
      </button>
      <div className="recent-summary">
        <span className="recent-meta">
          {formatUpdated(book)} · {modelName(book)}
        </span>
        <h3>
          {chapter?.number} {chapter?.title}
        </h3>
        <ProgressBar value={progress(book)} />
      </div>
    </article>
  );
}

function BookCard({
  book,
  selected,
  onOpenBook
}: {
  book: BookWithContent;
  selected: boolean;
  onOpenBook: (bookId: string) => void;
}) {
  return (
    <article className={`book-card book-accent-${coverTheme(book)} ${selected ? "is-selected" : ""}`}>
      <button className="book-cover-tile" type="button" onClick={() => onOpenBook(book.id)} aria-label={`${book.title} 읽기`}>
        <span>{statusLabel(book)}</span>
        <strong>{book.title}</strong>
      </button>
      <div className="book-card-body">
        <button className="book-title-button" type="button" onClick={() => onOpenBook(book.id)}>
          {book.title}
        </button>
        <small>{repositoryName(book)}</small>
        <p>{book.subtitle}</p>
        <ProgressBar value={progress(book)} />
      </div>
    </article>
  );
}

function GenerationView({
  activeBook,
  onBack,
  onReadBook,
  onGenerated
}: {
  activeBook: BookWithContent | null;
  onBack: () => void;
  onReadBook: (bookId: string, chapterId?: string) => void;
  onGenerated: (result: GenerationResult) => void;
}) {
  const [form, setForm] = useState(GENERATION_FORM_DEFAULT);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const displayBook = result?.book ?? activeBook;
  const canReadBook = Boolean(displayBook) && !running;

  async function runGenerate(event?: FormEvent) {
    event?.preventDefault();
    setRunning(true);
    setError(null);
    try {
      const nextResult = await api.generateOutline(form);
      setResult(nextResult);
      onGenerated(nextResult);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "목차 생성에 실패했습니다.");
    } finally {
      setRunning(false);
    }
  }

  const runPhase = result ? generationRunPhase(result.run.status) : running ? "toc" : "scan";
  const displaySteps: GenerationStep[] =
    result?.run.steps ??
    GENERATION_STEPS.map((step) => ({
      label: step.label,
      detail: step.detail,
      state: generationStepState(step.id, runPhase, running || Boolean(result))
    }));

  return (
    <section className="generation-view" aria-labelledby="generation-title">
      <div className="screen-toolbar command-surface" aria-label="목차 생성 화면 이동">
        <button className="text-button" type="button" onClick={onBack}>
          <ChevronLeft />
          <span>책장으로 돌아가기</span>
        </button>
        <div className="toolbar-title">
          <span className="state-dot state-dot--draft" />
          <strong>목차 생성</strong>
        </div>
        <button
          className="primary-action"
          type="button"
          onClick={() => displayBook && onReadBook(displayBook.id, displayBook.currentChapterId ?? firstChapter(displayBook)?.id)}
          disabled={!canReadBook}
        >
          <BookOpenCheck />
          <span>읽기 시작</span>
        </button>
      </div>

      <div className="generation-grid">
        <aside className="builder-panel content-surface" aria-labelledby="generation-title">
          <div className="screen-kicker">
            <span className="state-dot state-dot--draft" />
            <span>TOC builder</span>
            <span>{running ? "generating" : "drafting"}</span>
          </div>
          <h1 id="generation-title">기술서 목차 생성</h1>
          <form className="repo-form" onSubmit={runGenerate}>
            <label htmlFor="generation-repo">Repository URL or local path</label>
            <input
              id="generation-repo"
              type="text"
              value={form.repositoryUrl}
              onChange={(event) => setForm({ ...form, repositoryUrl: event.target.value })}
              required
            />
            <label htmlFor="model-select">LM Studio model</label>
            <select id="model-select" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })}>
              <option>qwen3-coder 14B</option>
              <option>llama-3.1-8b</option>
              <option>mistral-nemo</option>
            </select>
            <label htmlFor="reader-level">Reader level</label>
            <select id="reader-level" value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value })}>
              <option>유지보수 가능한 junior developer</option>
              <option>처음 보는 저장소를 읽는 designer-engineer</option>
              <option>리팩터링을 준비하는 maintainer</option>
            </select>
            <label htmlFor="generation-depth">Generation depth</label>
            <select id="generation-depth" value={form.depth} onChange={(event) => setForm({ ...form, depth: event.target.value })}>
              <option value="light">light</option>
              <option value="balanced">balanced</option>
              <option value="deep">deep</option>
            </select>
            <div className="action-cluster">
              <button className="primary-action" type="submit" disabled={running}>
                {running ? <Loader2 className="spin" /> : <Sparkles />}
                <span>{running ? "생성 중" : "다시 생성"}</span>
              </button>
              <button
                className="secondary-action"
                type="button"
                onClick={() => displayBook && onReadBook(displayBook.id, displayBook.currentChapterId ?? firstChapter(displayBook)?.id)}
                disabled={!canReadBook}
              >
                <BookOpenCheck />
                <span>읽기 시작</span>
              </button>
            </div>
          </form>
          {error ? <p className="form-error">{error}</p> : null}
        </aside>

        <section className="outline-panel" aria-labelledby="outline-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Generated outline</p>
              <h2 id="outline-title">책의 목차</h2>
            </div>
            <span className="outline-confidence">
              <span className="state-dot state-dot--ready" />
              indexed coherent
            </span>
          </div>
          <OutlinePreview book={displayBook} onReadBook={onReadBook} />
        </section>

        <aside className="runtime-panel panel-surface" aria-labelledby="runtime-title">
          <div className="section-title" id="runtime-title">
            <Activity />
            <span>Generation run</span>
          </div>
          <div className="step-list">
            {displaySteps.map((step, index) => {
              const state = step.state;
              return (
                <div key={`${step.label}-${index}`} className={`step-item is-${state}`}>
                  <span className="step-marker">{stepIcon(state)}</span>
                  <div>
                    <strong>{step.label}</strong>
                    <small>{step.detail}</small>
                  </div>
                </div>
              );
            })}
          </div>
          <dl className="metric-list">
            <div>
              <dt>Context</dt>
              <dd>{result?.run.context ?? (form.depth === "deep" ? "128k" : "64k")}</dd>
            </div>
            <div>
              <dt>Branch</dt>
              <dd>{result?.run.branch ?? "main"}</dd>
            </div>
            <div>
              <dt>Output</dt>
              <dd>book draft</dd>
            </div>
          </dl>
        </aside>
      </div>
    </section>
  );
}

function OutlinePreview({ book, onReadBook }: { book: BookWithContent | null; onReadBook: (bookId: string, chapterId?: string) => void }) {
  if (!book) {
    return <div className="empty-state content-surface">아직 생성된 목차가 없습니다.</div>;
  }

  return (
    <div className="outline-preview">
      {partsForBook(book).map((part) => {
        const chapters = chaptersForPart(book, part.id);
        return (
          <article className="outline-part" key={part.id}>
            <header>
              <h3>{part.title}</h3>
              <p>{part.summary}</p>
            </header>
            <ol>
              {chapters.map((chapter) => (
                <li key={chapter.id}>
                  <button type="button" onClick={() => onReadBook(book.id, chapter.id)}>
                    <span>
                      {chapter.number} {chapter.title}
                    </span>
                    <small>
                      {relatedFiles(chapter).length || 2} files · {chapter.estimatedMinutes} min
                    </small>
                  </button>
                </li>
              ))}
            </ol>
          </article>
        );
      })}
    </div>
  );
}

function ReaderRoute({
  activeBook,
  focusMode,
  mobilePanel,
  tutorDraft,
  setTutorDraft,
  setFocusMode,
  setMobilePanel,
  openBook,
  onBookLoaded,
  saveUIState
}: {
  activeBook: BookWithContent | null;
  focusMode: boolean;
  mobilePanel: MobilePanel;
  tutorDraft: string;
  setTutorDraft: (value: string) => void;
  setFocusMode: (value: boolean) => void;
  setMobilePanel: (panel: MobilePanel) => void;
  openBook: (bookId: string, chapterId?: string) => void;
  onBookLoaded: (book: BookWithContent) => void;
  saveUIState: (patch: Partial<UIState> & Record<string, unknown>) => void;
}) {
  const { bookId = "", chapterId = "" } = useParams();
  const [book, setBook] = useState<BookWithContent | null>(activeBook?.id === bookId ? activeBook : null);
  const [threads, setThreads] = useState<TutorThreadWithMessages[]>([]);
  const [sending, setSending] = useState(false);
  const [readerSettingsOpen, setReaderSettingsOpen] = useState(false);
  const restoredScrollKey = useRef("");
  const scrollSaveTimer = useRef<number | undefined>();
  const tocPanelRef = useRef<HTMLElement>(null);
  const mentorPanelRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!bookId) return;
      const nextBook = activeBook?.id === bookId ? activeBook : await api.getBook(bookId);
      if (cancelled) return;
      setBook(nextBook);
      onBookLoaded(nextBook);
      const nextThreads = await api.listTutorThreads(bookId, chapterId).catch(() => []);
      if (!cancelled) setThreads(nextThreads);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [activeBook, bookId, chapterId, onBookLoaded]);

  const chapter = useMemo(() => book?.chapters?.find((item) => item.id === chapterId) ?? currentChapter(book), [book, chapterId]);
  const chapterList = book?.chapters ?? [];
  const chapterIndex = chapter ? chapterList.findIndex((item) => item.id === chapter.id) : -1;
  const previousChapter = chapterIndex > 0 ? chapterList[chapterIndex - 1] : null;
  const nextChapter = chapterIndex >= 0 && chapterIndex < chapterList.length - 1 ? chapterList[chapterIndex + 1] : null;

  useEffect(() => {
    if (!book || !chapter) return;
    saveUIState({ activeBookId: book.id, activeChapterId: chapter.id });
  }, [book, chapter, saveUIState]);

  useEffect(() => {
    if (!mobilePanel) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = mobilePanel === "toc" ? tocPanelRef.current : mentorPanelRef.current;

    requestAnimationFrame(() => {
      const target = panel ? (focusableElements(panel)[0] ?? panel) : null;
      target?.focus();
    });

    function trapFocus(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const activePanel = mobilePanel === "toc" ? tocPanelRef.current : mentorPanelRef.current;
      if (!activePanel) return;
      const focusable = focusableElements(activePanel);
      if (!focusable.length) {
        event.preventDefault();
        activePanel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", trapFocus);
    return () => {
      document.removeEventListener("keydown", trapFocus);
      previousFocusRef.current?.focus();
    };
  }, [mobilePanel]);

  useEffect(() => {
    if (!book || !chapter) return;
    const workspace = document.querySelector("#workspace");
    const readingState = book.readingState;
    const key = `${book.id}:${chapter.id}:${readingState?.updatedAt ?? ""}`;
    if (!workspace || restoredScrollKey.current === key) return;

    restoredScrollKey.current = key;
    const top = readingState?.chapterId === chapter.id ? readingState.scrollY : 0;
    requestAnimationFrame(() => {
      workspace.scrollTo({ top, behavior: "auto" });
    });
  }, [book, chapter]);

  useEffect(() => {
    if (!book || !chapter) return;
    const workspace = document.querySelector("#workspace");
    if (!workspace) return;

    const saveScroll = () => {
      window.clearTimeout(scrollSaveTimer.current);
      scrollSaveTimer.current = window.setTimeout(() => {
        void api.saveReadingState(book.id, {
          chapterId: chapter.id,
          progressPercent: chapterProgress(chapter),
          scrollY: Math.max(0, Math.round(workspace.scrollTop))
        } as Partial<ReadingState>);
      }, 250);
    };

    workspace.addEventListener("scroll", saveScroll, { passive: true });
    return () => {
      workspace.removeEventListener("scroll", saveScroll);
      window.clearTimeout(scrollSaveTimer.current);
      void api.saveReadingState(book.id, {
        chapterId: chapter.id,
        progressPercent: chapterProgress(chapter),
        scrollY: Math.max(0, Math.round(workspace.scrollTop))
      } as Partial<ReadingState>);
    };
  }, [book, chapter]);

  async function submitTutor(event: FormEvent) {
    event.preventDefault();
    if (!book || !chapter || !tutorDraft.trim()) return;
    setSending(true);
    try {
      const thread = threads[0] ?? (await api.listTutorThreads(book.id, chapter.id))[0];
      if (!thread) throw new Error("튜터 대화 스레드를 만들 수 없습니다.");
      const updated = await api.sendTutorMessage(thread.id, tutorDraft.trim());
      setThreads((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
      setTutorDraft("");
    } finally {
      setSending(false);
    }
  }

  if (!book || !chapter) {
    return <div className="empty-state content-surface">책을 불러오는 중입니다.</div>;
  }

  function updateFocusMode(nextFocusMode: boolean) {
    setFocusMode(nextFocusMode);
    saveUIState({ focusModeEnabled: nextFocusMode, focus: nextFocusMode });
  }

  return (
    <section className="reader-view" aria-labelledby="reader-title">
      <div className="reader-shell">
        <ReaderToc
          book={book}
          activeChapter={chapter}
          isOpen={mobilePanel === "toc"}
          panelRef={tocPanelRef}
          onSelect={(target) => openBook(book.id, target)}
          setMobilePanel={setMobilePanel}
        />
        <BookPage book={book} chapter={chapter} />
        <MentorPanel
          chapter={chapter}
          threads={threads}
          draft={tutorDraft}
          sending={sending}
          isOpen={mobilePanel === "mentor"}
          panelRef={mentorPanelRef}
          setDraft={setTutorDraft}
          onSubmit={submitTutor}
          setMobilePanel={setMobilePanel}
        />
      </div>

      <div className="reading-controls command-surface" aria-label="읽기 제어">
        <button
          className="text-button"
          type="button"
          aria-label="이전 장"
          onClick={() => previousChapter && openBook(book.id, previousChapter.id)}
          disabled={!previousChapter}
        >
          <ChevronLeft />
          <span>이전 장</span>
        </button>
        <button
          className="text-button mobile-panel-trigger"
          type="button"
          aria-label="목차 열기"
          onClick={() => {
            setReaderSettingsOpen(false);
            setMobilePanel("toc");
          }}
          aria-expanded={mobilePanel === "toc"}
        >
          <ListTree />
          <span>목차</span>
        </button>
        <div className="reading-progress" aria-label="현재 책 진행률">
          <span>{progress(book)}%</span>
          <div className="progress-track">
            <span style={{ width: `${progress(book)}%` }} />
          </div>
        </div>
        <button
          className="text-button mobile-panel-trigger"
          type="button"
          aria-label="튜터 주석 열기"
          onClick={() => {
            setReaderSettingsOpen(false);
            setMobilePanel("mentor");
          }}
          aria-expanded={mobilePanel === "mentor"}
        >
          <MessageSquareText />
          <span>튜터</span>
        </button>
        <button className="text-button" type="button" aria-label="포커스 모드 전환" onClick={() => updateFocusMode(!focusMode)} aria-pressed={focusMode}>
          <Focus />
          <span>포커스</span>
        </button>
        <div className="reader-settings-wrap">
          <button
            className="text-button"
            type="button"
            aria-label="보기 설정"
            aria-haspopup="menu"
            aria-expanded={readerSettingsOpen}
            onClick={() => setReaderSettingsOpen((open) => !open)}
          >
            <Settings2 />
            <span>보기</span>
          </button>
          {readerSettingsOpen ? (
            <div className="reader-settings-menu command-surface" role="menu" aria-label="보기 설정">
              <button type="button" role="menuitemcheckbox" aria-checked={!focusMode} onClick={() => updateFocusMode(false)}>
                기본 폭
              </button>
              <button type="button" role="menuitemcheckbox" aria-checked={focusMode} onClick={() => updateFocusMode(true)}>
                집중 폭
              </button>
            </div>
          ) : null}
        </div>
        <button
          className="primary-action"
          type="button"
          aria-label="다음 장"
          onClick={() => nextChapter && openBook(book.id, nextChapter.id)}
          disabled={!nextChapter}
        >
          <span>다음 장</span>
          <ChevronRight />
        </button>
      </div>
    </section>
  );
}

function ReaderToc({
  book,
  activeChapter,
  isOpen,
  panelRef,
  onSelect,
  setMobilePanel
}: {
  book: BookWithContent;
  activeChapter: BookChapter;
  isOpen: boolean;
  panelRef: RefObject<HTMLElement>;
  onSelect: (chapterId: string) => void;
  setMobilePanel: (panel: MobilePanel) => void;
}) {
  return (
    <aside
      className="reader-toc panel-surface"
      id="reader-toc"
      aria-labelledby="toc-title"
      role={isOpen ? "dialog" : undefined}
      aria-modal={isOpen ? true : undefined}
      tabIndex={isOpen ? -1 : undefined}
      ref={panelRef}
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">Contents</p>
          <h2 id="toc-title">목차</h2>
        </div>
        <button className="icon-button mobile-only" type="button" onClick={() => setMobilePanel("")} aria-label="목차 닫기">
          <X />
        </button>
      </div>
      <div className="toc-list">
        {partsForBook(book).map((part) => (
          <section className="toc-part" key={part.id}>
            <h3>{part.title}</h3>
            <ol>
              {chaptersForPart(book, part.id).map((chapter) => {
                const files = relatedFiles(chapter).slice(0, 2);
                return (
                  <li key={chapter.id}>
                    <button className={chapter.id === activeChapter.id ? "is-active" : ""} type="button" onClick={() => onSelect(chapter.id)}>
                      <span className="chapter-number">{chapter.number}</span>
                      <span>
                        <strong>{chapter.title}</strong>
                        <small>
                          {chapterProgress(chapter)}% · {chapter.estimatedMinutes}분
                        </small>
                        {files.length ? (
                          <span className="toc-files">
                            {files.map((file) => (
                              <small key={file}>{file}</small>
                            ))}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </aside>
  );
}

function BookPage({ book, chapter }: { book: BookWithContent; chapter: BookChapter }) {
  const code = firstCodeAnchor(chapter);
  return (
    <article className="book-page" id="book-page" aria-labelledby="reader-title" aria-live="polite">
      <header className="page-head">
        <div className="screen-kicker">
          <span>{repositoryName(book)}</span>
          <span>{partTitle(book, chapter)}</span>
          <span>{chapter.estimatedMinutes} min</span>
        </div>
        <p className="chapter-number-label">Chapter {chapter.number}</p>
        <h1 id="reader-title">{chapter.title}</h1>
        <p>{chapter.subtitle}</p>
      </header>

      <section className="goal-block" aria-label="이번 장의 목표">
        <div className="section-title">
          <Target />
          <span>이번 장에서 남길 것</span>
        </div>
        <ol>
          {objectives(chapter).map((goal) => (
            <li key={goal}>{goal}</li>
          ))}
        </ol>
      </section>

      <section className="reading-flow" aria-label="챕터 본문">
        {sections(chapter).map((section) => (
          <article className="chapter-section" key={`${section.eyebrow}-${section.title}`}>
            <p className="eyebrow">{section.eyebrow}</p>
            <h2>{section.title}</h2>
            <p>{section.body}</p>
          </article>
        ))}
      </section>

      <section className="code-panel" aria-label="코드 근거">
        <div className="code-toolbar">
          <div>
            <FileCode2 />
            <span title={code.path}>{code.path}</span>
          </div>
          <span>{code.label}</span>
        </div>
        <pre>
          <code>{code.lines.join("\n")}</code>
        </pre>
      </section>

      <section className="checkpoint-panel" aria-label="챕터 체크포인트">
        <div className="section-title">
          <BookmarkCheck />
          <span>챕터를 덮기 전</span>
        </div>
        <div className="checkpoint-list">
          {checkpoints(chapter).map((item, index) => (
            <label className="checkpoint-item" key={item}>
              <input type="checkbox" defaultChecked={index < Math.ceil(chapterProgress(chapter) / 40)} />
              <span>{item}</span>
            </label>
          ))}
        </div>
      </section>

      <footer className="page-foot">
        <span>{book.title}</span>
        <strong>{chapter.number}</strong>
      </footer>
    </article>
  );
}

function MentorPanel({
  chapter,
  threads,
  draft,
  sending,
  isOpen,
  panelRef,
  setDraft,
  onSubmit,
  setMobilePanel
}: {
  chapter: BookChapter;
  threads: TutorThreadWithMessages[];
  draft: string;
  sending: boolean;
  isOpen: boolean;
  panelRef: RefObject<HTMLElement>;
  setDraft: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  setMobilePanel: (panel: MobilePanel) => void;
}) {
  const messages = threads.flatMap((thread) => thread.messages ?? []).slice(-4);
  return (
    <aside
      className="mentor-panel panel-surface"
      id="mentor-panel"
      aria-labelledby="mentor-title"
      role={isOpen ? "dialog" : undefined}
      aria-modal={isOpen ? true : undefined}
      tabIndex={isOpen ? -1 : undefined}
      ref={panelRef}
    >
      <div className="panel-header">
        <div>
          <p className="eyebrow">Margin tutor</p>
          <h2 id="mentor-title">튜터 주석</h2>
        </div>
        <button className="icon-button mobile-only" type="button" onClick={() => setMobilePanel("")} aria-label="튜터 주석 닫기">
          <X />
        </button>
      </div>
      <div className="mentor-notes">
        <div className="file-chip-stack" aria-label="관련 파일">
          {relatedFiles(chapter).map((file) => (
            <span key={file}>
              <File />
              {file}
            </span>
          ))}
        </div>
        <div className="note-stack">
          {mentorNotes(chapter).map((note) => (
            <article className="mentor-note" key={note.title}>
              <strong>{note.title}</strong>
              <p>{note.body}</p>
            </article>
          ))}
          {messages.map((message) => (
            <article className={`mentor-note ${message.role === "user" ? "mentor-note--prompt" : ""}`} key={message.id}>
              <strong>{message.role === "user" ? "질문 기록" : "튜터 답변"}</strong>
              <p>{message.body}</p>
            </article>
          ))}
        </div>
        <div className="mentor-note mentor-note--prompt">
          <strong>추천 질문</strong>
          <p>이 챕터의 파일을 실제 코드 수정 순서로 다시 정렬해줘.</p>
        </div>
      </div>
      <form className="chat-form" aria-label="현재 챕터에 질문" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="chat-input">
          튜터에게 질문
        </label>
        <input
          id="chat-input"
          type="text"
          placeholder="이 챕터에서 헷갈리는 지점"
          autoComplete="off"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" aria-label="질문 보내기" disabled={sending || !draft.trim()}>
          {sending ? <Loader2 className="spin" /> : <SendHorizontal />}
        </button>
      </form>
    </aside>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="book-progress">
      <span>{value}%</span>
      <div className="progress-track">
        <span style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function upsertBook(books: BookWithContent[], book: BookWithContent) {
  return books.some((item) => item.id === book.id) ? books.map((item) => (item.id === book.id ? book : item)) : [book, ...books];
}

function swatchStyle(variables: Record<ThemeVariable, string>) {
  return {
    background: `linear-gradient(135deg, ${variables["--app-bg"]} 0 38%, ${variables["--surface"]} 38% 70%, ${variables["--accent"]} 70%)`
  } as CSSProperties;
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function focusableElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => element.getClientRects().length > 0);
}

function normalizeFilter(value: unknown): BookFilter {
  return FILTERS.some((item) => item.value === value) ? (value as BookFilter) : "all";
}

function routeToView(route: string): UIState["view"] {
  if (route.startsWith("/generation")) return "generation";
  if (route.startsWith("/books/")) return "reader";
  return "library";
}

function getString(value: unknown, key: string): string {
  if (!value || typeof value !== "object") return "";
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : "";
}

function currentChapter(book: BookWithContent | null | undefined) {
  if (!book?.chapters?.length) return undefined;
  return book.chapters.find((chapter) => chapter.id === book.currentChapterId) ?? book.chapters[0];
}

function firstChapter(book: BookWithContent | null | undefined) {
  return book?.chapters?.[0];
}

function progress(book: BookWithContent) {
  return clampPercent(Number(getNumber(book, "progressPercent") ?? getNumber(book, "progress") ?? 0));
}

function chapterProgress(chapter: BookChapter) {
  return clampPercent(Number(getNumber(chapter, "progressPercent") ?? getNumber(chapter, "progress") ?? 0));
}

function getNumber(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" ? candidate : undefined;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}

function repositoryName(book: BookWithContent) {
  return getString(book, "repositoryName") || getString(book, "repo") || getString(book, "repositoryUrl") || "local/repository";
}

function modelName(book: BookWithContent) {
  return getString(book, "lmStudioModel") || getString(book, "model") || "LM Studio";
}

function formatUpdated(book: BookWithContent) {
  return getString(book, "updated") || (getString(book, "lastReadAt") ? "최근 읽음" : "방금 전");
}

function recentSortKey(book: BookWithContent) {
  return getString(book, "lastReadAt") || getString(book, "updatedAt") || getString(book, "updated");
}

function statusLabel(book: BookWithContent) {
  return getString(book, "statusLabel") || STATUS_LABELS[book.status] || book.status;
}

function coverTheme(book: BookWithContent) {
  return getString(book, "coverTheme") || getString(book, "accent") || "cyan";
}

function partsForBook(book: BookWithContent) {
  if (book.parts?.length) return book.parts;
  const titles = Array.from(new Set((book.chapters ?? []).map((chapter) => getString(chapter, "part") || chapter.partId || "part")));
  return titles.map((title, index) => ({ id: title, title, summary: index === 0 ? "제품 의도와 실행 경로를 먼저 읽습니다." : "화면과 코드 근거를 학습 순서로 연결합니다." }));
}

function chaptersForPart(book: BookWithContent, partId: string) {
  return (book.chapters ?? []).filter((chapter) => chapter.partId === partId || getString(chapter, "part") === partId);
}

function partTitle(book: BookWithContent, chapter: BookChapter) {
  return book.parts?.find((part) => part.id === chapter.partId)?.title || getString(chapter, "part") || chapter.partId;
}

function objectives(chapter: BookChapter) {
  const legacy = chapter as unknown as { objectives?: string[]; goals?: string[] };
  return legacy.objectives?.length ? legacy.objectives : (legacy.goals ?? []);
}

function sections(chapter: BookChapter) {
  return (
    (chapter.sections as Array<{ eyebrow?: string; title: string; body: string }> | undefined)?.map((section) => ({
      eyebrow: section.eyebrow ?? "본문",
      title: section.title,
      body: section.body
    })) ?? [{ eyebrow: "본문", title: chapter.title, body: chapter.subtitle }]
  );
}

function relatedFiles(chapter: BookChapter) {
  const legacy = chapter as unknown as { relatedFiles?: string[]; files?: string[] };
  return legacy.relatedFiles?.length ? legacy.relatedFiles : (legacy.files ?? []);
}

function firstCodeAnchor(chapter: BookChapter) {
  const fromAnchors = (chapter as unknown as { codeAnchors?: Array<{ path?: string; label?: string; lines?: string[] }> }).codeAnchors?.[0];
  const fromLegacy = (chapter as unknown as { code?: { path?: string; label?: string; lines?: string[] } }).code;
  return {
    path: fromAnchors?.path ?? fromLegacy?.path ?? relatedFiles(chapter)[0] ?? "README.md",
    label: fromAnchors?.label ?? fromLegacy?.label ?? "코드 근거",
    lines: fromAnchors?.lines ?? fromLegacy?.lines ?? ["// 저장소 색인 결과에서 코드 근거를 추출하는 중입니다."]
  };
}

function checkpoints(chapter: BookChapter) {
  return chapter.checkpoints?.length ? chapter.checkpoints : ["이 장의 목적을 한 문장으로 요약한다."];
}

function mentorNotes(chapter: BookChapter) {
  const notes = (chapter as unknown as { notes?: Array<{ title: string; body: string }> }).notes;
  if (notes?.length) return notes;
  return [
    {
      title: "현재 챕터 맥락",
      body: `${relatedFiles(chapter).slice(0, 2).join(", ") || "관련 파일"}을 중심으로 답변합니다.`
    }
  ];
}

function generationStepState(stepId: string, phase: string, hasRun: boolean): RunStepState {
  const order = ["scan", "toc", "chapter", "done"];
  const phaseIndex = order.indexOf(phase);
  const stepIndex = order.indexOf(stepId);
  if (!hasRun && stepId !== "scan") return "pending";
  if (phase === "failed") return stepId === "scan" ? "failed" : "pending";
  if (stepIndex < phaseIndex || phase === "done") return "complete";
  if (stepIndex === phaseIndex) return "active";
  return "pending";
}

function generationRunPhase(status: string) {
  if (status === "complete") return "done";
  if (status === "failed") return "failed";
  return "toc";
}

function stepIcon(state: RunStepState) {
  if (state === "complete") return <Check />;
  if (state === "active") return <Loader2 className="spin" />;
  if (state === "failed") return <X />;
  return <Circle />;
}
