
import type { BookWithContent } from "../lib/api";
import { chapterStatusLabel, chaptersForPart, hasReadableChapter, partsForBook, relatedFiles } from "../utils/appHelpers";

export function OutlinePreview({ book, onReadBook }: { book: BookWithContent | null; onReadBook: (bookId: string, chapterId?: string) => void }) {
  if (!book) {
    return <div className="empty-state content-surface">아직 생성된 목차가 없습니다.</div>;
  }

  const parts = partsForBook(book);
  if (!parts.length) {
    return <div className="empty-state content-surface">책 목차를 생성하는 중입니다.</div>;
  }

  return (
    <div className="outline-preview">
      {parts.map((part) => {
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
                  <button
                    className={hasReadableChapter(chapter) ? "" : "is-pending"}
                    type="button"
                    onClick={() => onReadBook(book.id, chapter.id)}
                    disabled={!hasReadableChapter(chapter)}
                  >
                    <span>
                      {chapter.number} {chapter.title}
                    </span>
                    <small>
                      {chapterStatusLabel(chapter)} · {relatedFiles(chapter).length || 2} files · {chapter.estimatedMinutes} min
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
