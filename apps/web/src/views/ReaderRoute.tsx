
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  File,
  FileCode2,
  Focus,
  ListTree,
  Loader2,
  MessageSquareText,
  SendHorizontal,
  Settings2,
  Target,
  X
} from "lucide-react";
import type { FormEvent, RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import type { BookChapter, ReadingState, UIState } from "@repo-books/shared";
import { FlowChart } from "../components/FlowChart";
import { HighlightedCodeBlock } from "../components/HighlightedCodeBlock";
import { api, type BookWithContent, type TutorThreadWithMessages } from "../lib/api";
import { queryKeys } from "../lib/query";
import type { MobilePanel } from "../types";
import {
  chapterProgress,
  chaptersForPart,
  checkpoints,
  codeAnchors,
  currentChapter,
  evidenceRows,
  firstCodeAnchor,
  focusableElements,
  glossaryEntries,
  hasStructuredChapterBody,
  mentorNotes,
  objectives,
  partTitle,
  partsForBook,
  progress,
  proseParagraphs,
  recapItems,
  relatedFiles,
  repositoryName,
  sections
} from "../utils/appHelpers";

export function ReaderRoute({
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
  const queryClient = useQueryClient();
  const bookQuery = useQuery({
    queryKey: queryKeys.book(bookId),
    queryFn: () => api.getBook(bookId),
    enabled: Boolean(bookId),
    initialData: activeBook?.id === bookId ? activeBook : undefined
  });
  const threadsQuery = useQuery({
    queryKey: queryKeys.tutorThreads(bookId, chapterId),
    queryFn: () => api.listTutorThreads(bookId, chapterId),
    enabled: Boolean(bookId && chapterId)
  });
  const sendTutorMutation = useMutation({
    mutationFn: ({ threadId, content }: { threadId: string; content: string }) => api.sendTutorMessage(threadId, content)
  });
  const book = bookQuery.data ?? null;
  const threads = threadsQuery.data ?? [];
  const sending = sendTutorMutation.isPending;
  const [readerSettingsOpen, setReaderSettingsOpen] = useState(false);
  const restoredScrollKey = useRef("");
  const scrollSaveTimer = useRef<number | undefined>();
  const tocPanelRef = useRef<HTMLElement>(null);
  const mentorPanelRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (book) onBookLoaded(book);
  }, [book, onBookLoaded]);

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
    const workspace = document.querySelector("#reader-scroll") ?? document.querySelector("#workspace");
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
    const workspace = document.querySelector("#reader-scroll") ?? document.querySelector("#workspace");
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
    const thread =
      threads[0] ??
      (
        await queryClient.fetchQuery({
          queryKey: queryKeys.tutorThreads(book.id, chapter.id),
          queryFn: () => api.listTutorThreads(book.id, chapter.id)
        })
      )[0];
    if (!thread) throw new Error("튜터 대화 스레드를 만들 수 없습니다.");
    const updated = await sendTutorMutation.mutateAsync({ threadId: thread.id, content: tutorDraft.trim() });
    queryClient.setQueryData<TutorThreadWithMessages[]>(queryKeys.tutorThreads(book.id, chapter.id), (current = []) => [
      updated,
      ...current.filter((item) => item.id !== updated.id)
    ]);
    setTutorDraft("");
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
      <div className="reader-shell" id="reader-scroll">
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
          className="text-button mobile-panel-trigger toc-panel-trigger"
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
          className="text-button mobile-panel-trigger mentor-panel-trigger"
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
  const structured = hasStructuredChapterBody(chapter);
  const anchors = codeAnchors(chapter);
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

      {structured ? (
        <section className="chapter-brief" aria-label="챕터 핵심 질문">
          <div>
            <p className="eyebrow">핵심 질문</p>
            <h2>{chapter.keyQuestion}</h2>
          </div>
          <p>{chapter.responsibility}</p>
        </section>
      ) : null}

      <section className="reading-flow" aria-label="챕터 본문">
        {sections(chapter).map((section) => (
          <article className="chapter-section" key={`${section.eyebrow}-${section.title}`}>
            <p className="eyebrow">{section.eyebrow}</p>
            <h2>{section.title}</h2>
            <div className="section-body">
              {proseParagraphs(section.body).map((paragraph, index) => (
                <p key={`${section.title}-${index}`}>{paragraph}</p>
              ))}
            </div>
          </article>
        ))}
      </section>

      {structured && chapter.flow ? (
        <section className="flow-panel" aria-label="챕터 흐름">
          <div className="section-title">
            <ListTree />
            <span>{chapter.flow.title}</span>
          </div>
          <p>{chapter.flow.summary}</p>
          {chapter.flow.diagram ? <FlowChart diagram={chapter.flow.diagram} title={chapter.flow.title} summary={chapter.flow.summary} /> : null}
        </section>
      ) : null}

      <section className="code-panel" aria-label="코드 근거">
        <div className="code-toolbar">
          <div>
            <FileCode2 />
            <span title={anchors[0]?.filePath ?? code.path}>{anchors[0]?.filePath ?? code.path}</span>
          </div>
          <span>{anchors.length ? `${anchors.length} anchors` : code.label}</span>
        </div>
        {anchors.length ? (
          <div className="anchor-stack">
            {anchors.map((anchor) => (
              <article className="code-anchor" key={`${anchor.filePath}-${anchor.symbolName}-${anchor.lineHint}`}>
                <div>
                  <strong>{anchor.symbolName || anchor.filePath}</strong>
                  <span>{anchor.filePath}{anchor.lineHint ? ` · ${anchor.lineHint}` : ""}</span>
                </div>
                <p>{anchor.claim}</p>
                <p>{anchor.explanation}</p>
                {anchor.excerptLines.length ? <HighlightedCodeBlock lines={anchor.excerptLines} filePath={anchor.filePath} lineHint={anchor.lineHint} /> : null}
              </article>
            ))}
          </div>
        ) : (
          <HighlightedCodeBlock lines={code.lines} filePath={code.path} />
        )}
      </section>

      {structured ? (
        <section className="evidence-panel" aria-label="파일 근거">
          <div className="section-title">
            <File />
            <span>근거와 범위</span>
          </div>
          <div className="evidence-table">
            {evidenceRows(chapter).map((item) => (
              <article key={`${item.filePath}-${item.role}`}>
                <strong>{item.filePath}</strong>
                <span>{item.role}</span>
                <p>{item.usedAsEvidence}</p>
                {item.outOfScope ? <small>{item.outOfScope}</small> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

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

      {structured ? (
        <section className="recap-panel" aria-label="챕터 요약">
          <div className="section-title">
            <BookmarkCheck />
            <span>Recap</span>
          </div>
          <div className="recap-grid">
            <article>
              <strong>이제 이해한 것</strong>
              <ul>{recapItems(chapter, "understood").map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
            <article>
              <strong>변경 시 볼 지점</strong>
              <ul>{recapItems(chapter, "changeEntryPoints").map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
            <article>
              <strong>다음 질문</strong>
              <ul>{recapItems(chapter, "nextQuestions").map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
          </div>
          {glossaryEntries(chapter).length ? (
            <div className="glossary-list">
              {glossaryEntries(chapter).map((entry) => (
                <span key={`${entry.term}-${entry.appearsIn}`} title={entry.meaning}>
                  {entry.term}
                </span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

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
