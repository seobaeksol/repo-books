import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";

const book = {
  id: "repo-books-book",
  title: "Repo Books를 읽는 책",
  subtitle: "저장소 앱을 기술서처럼 읽는 학습서",
  repo: "suyoungkim/repo-books",
  branch: "main",
  model: "LM Studio · qwen3-coder",
  updated: "오늘 09:12",
  status: "reading",
  statusLabel: "읽는 중",
  accent: "cyan",
  progress: 42,
  currentChapterId: "chapter-1-2",
  parts: [{ id: "part-1", bookId: "repo-books-book", order: 0, title: "Part I. 저장소 지도", summary: "제품 의도와 실행 경로를 먼저 읽습니다." }],
  chapters: [
    {
      id: "chapter-1-1",
      bookId: "repo-books-book",
      partId: "part-1",
      number: "1.1",
      title: "입구 파일과 독자 수준 정하기",
      subtitle: "README와 실행 경로를 연결합니다.",
      order: 0,
      goals: ["저장소 목적을 요약한다."],
      sections: [{ eyebrow: "읽기", title: "첫 장", body: "책의 시작점을 찾습니다." }],
      files: ["README.md"],
      code: { path: "README.md", label: "첫 문서", lines: ["# Repo Books"] },
      notes: [],
      checkpoints: ["첫 실행 경로 확인"],
      estimatedMinutes: 14,
      status: "complete",
      progress: 100
    },
    {
      id: "chapter-1-2",
      bookId: "repo-books-book",
      partId: "part-1",
      number: "1.2",
      title: "폴더를 대단원으로 바꾸기",
      subtitle: "파일 트리를 학습 순서로 재배열합니다.",
      order: 1,
      goals: ["폴더 책임을 요약한다."],
      sections: [{ eyebrow: "흐름", title: "파일 트리는 지도다", body: "목차는 독자의 여행 일정입니다." }],
      files: ["docs/requirements"],
      code: { path: "packages/shared/src/index.ts", label: "목차 fixture", lines: ["const baseChapters = [];"] },
      keyQuestion: "폴더 책임은 책의 장 구조로 어떻게 바뀌는가?",
      responsibility: "docs/requirements와 packages/shared/src/index.ts가 저장소 이해 구조를 함께 만든다.",
      flow: {
        type: "architecture",
        title: "요구사항에서 책 본문으로 이어지는 흐름",
        summary: "요구사항 문서가 챕터 구조를 정하고 shared schema가 reader에 전달한다.",
        diagram: "flowchart TD\n  A[docs/requirements] --> B[packages/shared/src/index.ts]"
      },
      codeAnchors: [
        {
          filePath: "packages/shared/src/index.ts",
          symbolName: "bookChapterSchema",
          lineHint: "L45",
          claim: "packages/shared/src/index.ts는 챕터 구조의 public contract를 증명한다.",
          explanation: "bookChapterSchema가 reader와 API가 공유하는 필드를 고정한다.",
          excerptLines: ["export const bookChapterSchema = z.object({", "  sections: z.array(textSectionSchema)", "});"]
        },
        {
          filePath: "docs/requirements/04-repo-book-structure.md",
          symbolName: "Chapter 본문 패턴",
          lineHint: "L1-L80",
          claim: "docs/requirements/04-repo-book-structure.md는 챕터가 기술서 흐름을 가져야 한다는 요구를 증명한다.",
          explanation: "본문 패턴과 코드 앵커 요구사항이 UI 구조의 기준이 된다.",
          excerptLines: ["# Repo Book 구조와 체크포인트 요구사항"]
        }
      ],
      evidence: [
        {
          filePath: "docs/requirements/04-repo-book-structure.md",
          role: "책 구조 요구사항",
          usedAsEvidence: "Chapter 본문 패턴과 코드 앵커 요구를 제공한다.",
          outOfScope: ""
        },
        {
          filePath: "packages/shared/src/index.ts",
          role: "공유 데이터 계약",
          usedAsEvidence: "BookChapter schema를 통해 API와 UI 필드를 고정한다.",
          outOfScope: ""
        }
      ],
      glossary: [
        {
          term: "BookChapter",
          meaning: "reader가 한 장을 렌더링하기 위해 받는 공유 데이터 단위",
          appearsIn: "packages/shared/src/index.ts",
          relatedAnchors: ["packages/shared/src/index.ts"]
        }
      ],
      recap: {
        understood: ["요구사항과 schema가 챕터 구조를 함께 정한다."],
        changeEntryPoints: ["packages/shared/src/index.ts · bookChapterSchema"],
        nextQuestions: ["본문 구조를 생성기가 어떻게 채우는가?"]
      },
      notes: [],
      checkpoints: ["대단원 이름 확정"],
      estimatedMinutes: 21,
      status: "current",
      progress: 62
    }
  ]
};

const uiState = {
  id: "default",
  activeBookId: "repo-books-book",
  activeChapterId: "chapter-1-2",
  view: "library",
  focus: false,
  mobilePanel: "",
  preferences: { lastRoute: "/library", selectedLibraryFilter: "all" },
  updatedAt: "2026-04-25T09:12:00.000Z"
};

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn()
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/health")) return json({ ok: true, service: "repo-books-api" });
      if (url.startsWith("/api/ui-state/default") && init?.method === "PATCH") return json({ uiState });
      if (url.startsWith("/api/ui-state/default")) return json({ uiState });
      if (url.startsWith("/api/books/")) return json({ book, readingState: { bookId: book.id, chapterId: book.currentChapterId, progressPercent: 62, scrollY: 0, updatedAt: uiState.updatedAt } });
      if (url.startsWith("/api/books?filter=draft")) return json({ books: [] });
      if (url.startsWith("/api/books")) return json({ books: [book] });
      if (url.startsWith("/api/reading-state/")) return json({ readingState: { bookId: book.id, chapterId: book.currentChapterId, progressPercent: 62, scrollY: 0, updatedAt: uiState.updatedAt } });
      if (url.startsWith("/api/tutor/threads")) return json([]);
      return json({}, 404);
    })
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Repo Books web app", () => {
  it("restores the library and renders book shelves", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "책장" })).toBeInTheDocument();
    expect(screen.getAllByText("Repo Books를 읽는 책").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "새 책 만들기" })).toBeInTheDocument();
  });

  it("applies the library status filter through the API", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/library"]}>
        <App />
      </MemoryRouter>
    );

    await screen.findByRole("heading", { name: "책장" });
    await user.click(screen.getByRole("button", { name: "초안" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/books?filter=draft", expect.anything());
    });
  });

  it("renders structured chapter body, evidence, and multiple code anchors", async () => {
    render(
      <MemoryRouter initialEntries={["/books/repo-books-book/chapters/chapter-1-2"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "폴더를 대단원으로 바꾸기" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "폴더 책임은 책의 장 구조로 어떻게 바뀌는가?" })).toBeInTheDocument();
    expect(screen.getByText("요구사항에서 책 본문으로 이어지는 흐름")).toBeInTheDocument();
    expect(screen.getByText("packages/shared/src/index.ts는 챕터 구조의 public contract를 증명한다.")).toBeInTheDocument();
    expect(screen.getByText("BookChapter")).toBeInTheDocument();
  });
});

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" }
    })
  );
}
