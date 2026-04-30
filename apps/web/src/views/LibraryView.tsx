
import { Clock3, Folder, Home, Library, Plus, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { BookFilter } from "@repo-books/shared";
import { FILTERS } from "../constants";
import { ProgressBar } from "../components/ProgressBar";
import type { BookWithContent } from "../lib/api";
import {
  coverTheme,
  currentChapter,
  formatUpdated,
  modelName,
  progress,
  recentSortKey,
  repositoryName,
  scrollToSection,
  statusLabel
} from "../utils/appHelpers";

export function LibraryView({
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
  onOpenBook: (book: BookWithContent) => void;
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
  icon: ReactNode;
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

function RecentBook({ book, onOpenBook }: { book: BookWithContent; onOpenBook: (book: BookWithContent) => void }) {
  const chapter = currentChapter(book);
  const actionLabel = book.status === "generating" ? `${book.title} 진행상황 보기` : `${book.title} 읽기`;
  return (
    <article className={`recent-book book-accent-${coverTheme(book)}`}>
      <button className="book-cover" type="button" onClick={() => onOpenBook(book)} aria-label={actionLabel}>
        <span className="book-status">{statusLabel(book)}</span>
        <strong>{book.title}</strong>
        <small>{repositoryName(book)}</small>
      </button>
      <div className="recent-summary">
        <span className="recent-meta">
          {formatUpdated(book)} · {modelName(book)}
        </span>
        <h3>
          {chapter ? `${chapter.number} ${chapter.title}` : statusLabel(book)}
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
  onOpenBook: (book: BookWithContent) => void;
}) {
  const actionLabel = book.status === "generating" ? `${book.title} 진행상황 보기` : `${book.title} 읽기`;
  return (
    <article className={`book-card book-accent-${coverTheme(book)} ${selected ? "is-selected" : ""}`}>
      <button className="book-cover-tile" type="button" onClick={() => onOpenBook(book)} aria-label={actionLabel}>
        <span>{statusLabel(book)}</span>
        <strong>{book.title}</strong>
      </button>
      <div className="book-card-body">
        <button className="book-title-button" type="button" onClick={() => onOpenBook(book)}>
          {book.title}
        </button>
        <small>{repositoryName(book)}</small>
        <p>{book.subtitle}</p>
        <ProgressBar value={progress(book)} />
      </div>
    </article>
  );
}
