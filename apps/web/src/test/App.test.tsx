import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GENERATION_MODEL, type LmStudioModelsResponse } from "@repo-books/shared";
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

const generatingBook = {
  ...book,
  id: "generated-sample-service",
  title: "sample-service Repo Book",
  subtitle: "유지보수자 독자를 위해 변경 준비 목적으로 생성 중",
  repo: "example/sample-service",
  model: "LM Studio SDK · google/gemma-4-E4B-it",
  updated: "생성 중",
  status: "generating",
  statusLabel: "본문 생성 중",
  accent: "amber",
  progress: 48,
  currentChapterId: "",
  generationRunId: "run-generating",
  parts: [],
  chapters: []
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

let lmStudioModelsResponse: LmStudioModelsResponse = {
  models: [
    {
      modelKey: "google/gemma-4-e4b@q4_k_m",
      displayName: "Gemma 4 E4B",
      path: "google/gemma-4-e4b",
      publisher: "google",
      paramsString: "7.5B",
      quantization: { name: "Q4_K_M", bits: 4 },
      sizeBytes: 6326936720,
      maxContextLength: 131072,
      vision: true,
      trainedForToolUse: true,
      cachedAt: "2026-04-25T09:12:00.000Z",
      stale: false
    }
  ],
  cachedAt: "2026-04-25T09:12:00.000Z",
  stale: false
};

beforeEach(() => {
  lmStudioModelsResponse = {
    models: [
      {
        modelKey: "google/gemma-4-e4b@q4_k_m",
        displayName: "Gemma 4 E4B",
        path: "google/gemma-4-e4b",
        publisher: "google",
        paramsString: "7.5B",
        quantization: { name: "Q4_K_M", bits: 4 },
        sizeBytes: 6326936720,
        maxContextLength: 131072,
        vision: true,
        trainedForToolUse: true,
        cachedAt: "2026-04-25T09:12:00.000Z",
        stale: false
      }
    ],
    cachedAt: "2026-04-25T09:12:00.000Z",
    stale: false
  };
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn()
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/health")) return json({ ok: true, service: "repo-books-api" });
      if (url.startsWith("/api/lm-studio/models")) return json(lmStudioModelsResponse);
      if (url.startsWith("/api/ui-state/default") && init?.method === "PATCH") return json({ uiState });
      if (url.startsWith("/api/ui-state/default")) return json({ uiState });
      if (url.startsWith("/api/generation/runs") && init?.method === "POST") {
        const placeholderBook = { ...generatingBook, id: "generated-run-1", generationRunId: "run-1", progress: 0, statusLabel: "생성 대기 중" };
        return json({
          generationRun: {
            id: "run-1",
            userId: "local",
            bookId: placeholderBook.id,
            repoUrl: book.repo,
            branch: "main",
            model: DEFAULT_GENERATION_MODEL,
            context: "64k",
            status: "queued",
            progress: 0,
            steps: [
              { label: "모델 준비", state: "pending", detail: "waiting for LM Studio model readiness" },
              { label: "저장소 분석", state: "pending", detail: "waiting for repository scan and index" },
              { label: "대단원 설계", state: "pending", detail: "waiting for part plan" },
              { label: "소단원 설계", state: "pending", detail: "waiting for chapter plan" },
              { label: "근거 수집", state: "pending", detail: "waiting for chapter briefs and code anchors" },
              { label: "본문 생성", state: "pending", detail: "waiting for section drafts" },
              { label: "챕터 수리", state: "pending", detail: "waiting for revision pass" },
              { label: "책 일관성 점검", state: "pending", detail: "waiting for coherence pass" }
            ],
            outline: [],
            chapterRuns: [],
            artifacts: [],
            error: "",
            createdAt: uiState.updatedAt,
            updatedAt: uiState.updatedAt
          },
          book: placeholderBook
        });
      }
      if (url.startsWith("/api/generation/runs/run-1")) {
        return json({
          generationRun: {
            id: "run-1",
            userId: "local",
            bookId: book.id,
            repoUrl: book.repo,
            branch: "main",
            model: DEFAULT_GENERATION_MODEL,
            context: "64k",
            status: "complete",
            progress: 100,
            steps: [
              { label: "모델 준비", state: "complete", detail: "complete" },
              { label: "저장소 분석", state: "complete", detail: "complete" },
              { label: "대단원 설계", state: "complete", detail: "complete" },
              { label: "소단원 설계", state: "complete", detail: "complete" },
              { label: "근거 수집", state: "complete", detail: "complete" },
              { label: "본문 생성", state: "complete", detail: "complete" },
              { label: "챕터 수리", state: "complete", detail: "complete" },
              { label: "책 일관성 점검", state: "complete", detail: "coherence pass complete" }
            ],
            outline: [],
            chapterRuns: [],
            artifacts: [
              {
                id: "artifact-1",
                runId: "run-1",
                chapterId: null,
                kind: "book_coherence",
                order: 0,
                payload: { status: "complete", title: "Repo Books coherence" },
                createdAt: uiState.updatedAt
              }
            ],
            error: "",
            createdAt: uiState.updatedAt,
            updatedAt: uiState.updatedAt
          },
          book
        });
      }
      if (url.startsWith("/api/generation/runs/run-generating")) {
        return json({
          generationRun: {
            id: "run-generating",
            userId: "local",
            bookId: generatingBook.id,
            repoUrl: generatingBook.repo,
            branch: "main",
            model: DEFAULT_GENERATION_MODEL,
            context: "64k",
            status: "running",
            progress: 48,
            steps: [
              { label: "모델 준비", state: "complete", detail: "complete" },
              { label: "저장소 분석", state: "complete", detail: "complete" },
              { label: "대단원 설계", state: "complete", detail: "complete" },
              { label: "소단원 설계", state: "complete", detail: "complete" },
              { label: "근거 수집", state: "active", detail: "chapter brief 생성 중" },
              { label: "본문 생성", state: "pending", detail: "waiting for section drafts" },
              { label: "챕터 수리", state: "pending", detail: "waiting for revision pass" },
              { label: "책 일관성 점검", state: "pending", detail: "waiting for coherence pass" }
            ],
            outline: [],
            chapterRuns: [],
            artifacts: [],
            error: "",
            createdAt: uiState.updatedAt,
            updatedAt: uiState.updatedAt
          },
          book: generatingBook
        });
      }
      if (url.startsWith("/api/books/")) return json({ book, readingState: { bookId: book.id, chapterId: book.currentChapterId, progressPercent: 62, scrollY: 0, updatedAt: uiState.updatedAt } });
      if (url.startsWith("/api/books?filter=generating")) return json({ books: [generatingBook] });
      if (url.startsWith("/api/books?filter=draft")) return json({ books: [] });
      if (url.startsWith("/api/books")) return json({ books: [book, generatingBook] });
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

  it("shows generating books on the shelf and opens their progress", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/library"]}>
        <App />
      </MemoryRouter>
    );

    expect((await screen.findAllByText("sample-service Repo Book")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("본문 생성 중").length).toBeGreaterThan(0);
    expect(screen.getAllByText("48%").length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole("button", { name: "sample-service Repo Book 진행상황 보기" })[0]);

    expect(await screen.findByText("생성 진행상황")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/generation/runs/run-generating", expect.anything());
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

  it("submits model, reader level, and book purpose generation options", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/generation"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "기술서 목차 생성" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("저장소 URL 또는 로컬 경로"), "https://github.com/example/sample-service");
    await waitFor(() => expect(screen.getByLabelText("LM Studio 모델")).toHaveValue("google/gemma-4-e4b@q4_k_m"));
    await user.clear(screen.getByLabelText("LM Studio 모델"));
    await user.type(screen.getByLabelText("LM Studio 모델"), "google/gemma-4-E4B-it");
    await user.selectOptions(screen.getByLabelText("독자 수준"), "유지보수자");
    await user.selectOptions(screen.getByLabelText("책의 목적"), "변경 준비");
    await user.selectOptions(screen.getByLabelText("생성 깊이"), "deep");
    await user.type(screen.getByLabelText("커스텀 프롬프트"), "API 변경 지점을 먼저 다뤄줘.");
    await user.click(screen.getByRole("button", { name: "책 생성" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/generation/runs", expect.objectContaining({ method: "POST" }));
    });
    const call = vi.mocked(fetch).mock.calls.find(([input]) => String(input) === "/api/generation/runs");
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body).toMatchObject({
      model: "google/gemma-4-E4B-it",
      readerLevel: "유지보수자",
      audience: "유지보수자",
      bookPurpose: "변경 준비",
      depth: "deep",
      context: "128k",
      customPrompt: "API 변경 지점을 먼저 다뤄줘."
    });
  });

  it("navigates to the generation progress page and shows recent activity", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/generation"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "기술서 목차 생성" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("저장소 URL 또는 로컬 경로"), "https://github.com/example/sample-service");
    await user.click(screen.getByRole("button", { name: "책 생성" }));

    expect(await screen.findByText("생성 진행상황")).toBeInTheDocument();
    expect(await screen.findByText("생성 완료")).toBeInTheDocument();
    expect(screen.getByText("진행률 100%")).toBeInTheDocument();
    expect(screen.getByLabelText("생성 실행 시간 정보")).toHaveTextContent("마지막 갱신");
    expect(screen.getByText("최근 생성 활동")).toBeInTheDocument();
    expect(screen.getByText("Repo Books coherence")).toBeInTheDocument();
  });

  it("loads available LM Studio model variants into the generation form", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/generation"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "기술서 목차 생성" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("LM Studio 모델")).toHaveValue("google/gemma-4-e4b@q4_k_m"));
    expect(container.querySelector("option[value='google/gemma-4-e4b@q4_k_m']")).toHaveAttribute("label", "Gemma 4 E4B · Q4_K_M");
    expect(screen.getByText(/128k context/)).toBeInTheDocument();
  });

  it("refreshes LM Studio models without overwriting a manually edited model", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/generation"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "기술서 목차 생성" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("LM Studio 모델")).toHaveValue("google/gemma-4-e4b@q4_k_m"));
    await user.clear(screen.getByLabelText("LM Studio 모델"));
    await user.type(screen.getByLabelText("LM Studio 모델"), "custom/local-model");
    lmStudioModelsResponse = {
      models: [
        {
          modelKey: "qwen/qwen3-4b-2507@q4_k_m",
          displayName: "Qwen3 4B",
          path: "qwen/qwen3-4b-2507",
          publisher: "qwen",
          paramsString: "4B",
          quantization: { name: "Q4_K_M", bits: 4 },
          sizeBytes: 2470000000,
          maxContextLength: 262144,
          vision: false,
          trainedForToolUse: true,
          cachedAt: "2026-04-25T09:13:00.000Z",
          stale: false
        }
      ],
      cachedAt: "2026-04-25T09:13:00.000Z",
      stale: false
    };

    await user.click(screen.getByRole("button", { name: "LM Studio 모델 목록 새로고침" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/lm-studio/models?refresh=1", expect.anything());
    });
    expect(screen.getByLabelText("LM Studio 모델")).toHaveValue("custom/local-model");
  });

  it("keeps direct model input available when the LM Studio model list is empty", async () => {
    lmStudioModelsResponse = {
      models: [],
      cachedAt: null,
      stale: false,
      error: "LM_STUDIO_MODEL_LIST_FAILED"
    };

    render(
      <MemoryRouter initialEntries={["/generation"]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByRole("heading", { name: "기술서 목차 생성" })).toBeInTheDocument();
    expect(screen.getByLabelText("LM Studio 모델")).toHaveValue(DEFAULT_GENERATION_MODEL);
    expect(await screen.findByText(/로컬 모델 목록을 불러오지 못해 직접 입력할 수 있습니다/)).toBeInTheDocument();
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
