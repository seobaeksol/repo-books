import { z } from "zod";

export const bookStatusSchema = z.enum(["reading", "complete", "generating", "draft"]);
export const bookFilterSchema = z.enum(["all", "in_progress", "generating", "draft"]);
export const chapterStatusSchema = z.enum(["complete", "current", "next", "locked", "draft", "generating"]);
export const generationStatusSchema = z.enum(["queued", "running", "complete", "failed"]);
export const generationStepStateSchema = z.enum(["pending", "active", "complete", "failed"]);
export const tutorMessageRoleSchema = z.enum(["user", "assistant", "system"]);
export const readerViewSchema = z.enum(["library", "reader", "generation"]);

export const textSectionSchema = z.object({
  eyebrow: z.string(),
  title: z.string(),
  body: z.string()
});

export const codeExcerptSchema = z.object({
  path: z.string(),
  label: z.string(),
  lines: z.array(z.string())
});

export const chapterNoteSchema = z.object({
  title: z.string(),
  body: z.string()
});

export const bookPartSchema = z.object({
  id: z.string(),
  bookId: z.string(),
  order: z.number().int().nonnegative(),
  title: z.string(),
  summary: z.string()
});

export const bookChapterSchema = z.object({
  id: z.string(),
  bookId: z.string(),
  partId: z.string(),
  order: z.number().int().nonnegative(),
  number: z.string(),
  title: z.string(),
  subtitle: z.string(),
  progress: z.number().min(0).max(100),
  status: chapterStatusSchema,
  estimatedMinutes: z.number().int().positive(),
  files: z.array(z.string()),
  goals: z.array(z.string()),
  sections: z.array(textSectionSchema),
  code: codeExcerptSchema.nullable(),
  notes: z.array(chapterNoteSchema),
  checkpoints: z.array(z.string())
});

export const repoBookSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
  repo: z.string(),
  branch: z.string(),
  model: z.string(),
  updated: z.string(),
  status: bookStatusSchema,
  statusLabel: z.string(),
  accent: z.string(),
  progress: z.number().min(0).max(100),
  currentChapterId: z.string(),
  parts: z.array(bookPartSchema),
  chapters: z.array(bookChapterSchema)
});

export const generationStepSchema = z.object({
  label: z.string(),
  state: generationStepStateSchema,
  detail: z.string()
});

export const generationOutlinePartSchema = z.object({
  part: z.string(),
  summary: z.string(),
  chapters: z.array(z.string())
});

export const generationRunSchema = z.object({
  id: z.string(),
  bookId: z.string().nullable(),
  repoUrl: z.string(),
  branch: z.string(),
  model: z.string(),
  context: z.string(),
  status: generationStatusSchema,
  progress: z.number().min(0).max(100),
  steps: z.array(generationStepSchema),
  outline: z.array(generationOutlinePartSchema),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const readingStateSchema = z.object({
  bookId: z.string(),
  chapterId: z.string(),
  progressPercent: z.number().min(0).max(100),
  scrollY: z.number().nonnegative(),
  updatedAt: z.string()
});

export const tutorMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  role: tutorMessageRoleSchema,
  body: z.string(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string()
});

export const tutorThreadSchema = z.object({
  id: z.string(),
  bookId: z.string(),
  chapterId: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messages: z.array(tutorMessageSchema).default([])
});

export const uiStateSchema = z.object({
  id: z.literal("default"),
  activeBookId: z.string(),
  activeChapterId: z.string().nullable(),
  view: readerViewSchema,
  focus: z.boolean(),
  mobilePanel: z.string(),
  preferences: z.record(z.unknown()).default({}),
  updatedAt: z.string()
});

export const listBooksQuerySchema = z.object({
  filter: bookFilterSchema.default("all")
});

export const patchReadingStateSchema = z.object({
  chapterId: z.string(),
  progressPercent: z.number().min(0).max(100),
  scrollY: z.number().nonnegative().default(0)
});

export const patchUiStateSchema = z.object({
  activeBookId: z.string().optional(),
  activeChapterId: z.string().nullable().optional(),
  view: readerViewSchema.optional(),
  focus: z.boolean().optional(),
  mobilePanel: z.string().optional(),
  preferences: z.record(z.unknown()).optional()
});

export const postGenerationOutlineSchema = z.object({
  repoUrl: z.string().min(1),
  branch: z.string().default("main"),
  model: z.string().default("qwen3-coder 14B"),
  context: z.string().default("128k"),
  audience: z.string().default("유지보수 가능한 junior developer"),
  depth: z.string().default("balanced")
});

export const tutorThreadsQuerySchema = z.object({
  bookId: z.string().optional(),
  chapterId: z.string().optional()
});

export const postTutorMessageSchema = z.object({
  role: tutorMessageRoleSchema.default("user"),
  body: z.string().min(1),
  metadata: z.record(z.unknown()).default({})
});

export type BookStatus = z.infer<typeof bookStatusSchema>;
export type BookFilter = z.infer<typeof bookFilterSchema>;
export type ChapterStatus = z.infer<typeof chapterStatusSchema>;
export type GenerationStatus = z.infer<typeof generationStatusSchema>;
export type GenerationStepState = z.infer<typeof generationStepStateSchema>;
export type TutorMessageRole = z.infer<typeof tutorMessageRoleSchema>;
export type ReaderView = z.infer<typeof readerViewSchema>;
export type TextSection = z.infer<typeof textSectionSchema>;
export type CodeExcerpt = z.infer<typeof codeExcerptSchema>;
export type ChapterNote = z.infer<typeof chapterNoteSchema>;
export type BookPart = z.infer<typeof bookPartSchema>;
export type BookChapter = z.infer<typeof bookChapterSchema>;
export type RepoBook = z.infer<typeof repoBookSchema>;
export type GenerationStep = z.infer<typeof generationStepSchema>;
export type GenerationOutlinePart = z.infer<typeof generationOutlinePartSchema>;
export type GenerationRun = z.infer<typeof generationRunSchema>;
export type ReadingState = z.infer<typeof readingStateSchema>;
export type TutorThread = z.infer<typeof tutorThreadSchema>;
export type TutorMessage = z.infer<typeof tutorMessageSchema>;
export type UIState = z.infer<typeof uiStateSchema>;
export type ListBooksQuery = z.infer<typeof listBooksQuerySchema>;
export type PatchReadingStatePayload = z.infer<typeof patchReadingStateSchema>;
export type PatchUIStatePayload = z.infer<typeof patchUiStateSchema>;
export type PostGenerationOutlinePayload = z.infer<typeof postGenerationOutlineSchema>;
export type TutorThreadsQuery = z.infer<typeof tutorThreadsQuerySchema>;
export type PostTutorMessagePayload = z.infer<typeof postTutorMessageSchema>;

const baseParts: BookPart[] = [
  {
    id: "repo-books-part-1",
    bookId: "repo-books-book",
    order: 0,
    title: "Part I. 저장소 지도",
    summary: "제품 의도, 실행 경로, 폴더 책임을 먼저 읽습니다."
  },
  {
    id: "repo-books-part-2",
    bookId: "repo-books-book",
    order: 1,
    title: "Part II. 화면과 상태",
    summary: "책장 홈, 읽기 화면, 튜터 주석의 UI 계약을 확인합니다."
  },
  {
    id: "repo-books-part-3",
    bookId: "repo-books-book",
    order: 2,
    title: "Part III. 유지보수자의 읽기",
    summary: "변경 전 계약을 찾고 작은 수정으로 이어갑니다."
  }
];

const baseChapters: BookChapter[] = [
  {
    id: "chapter-1-1",
    bookId: "repo-books-book",
    partId: "repo-books-part-1",
    order: 0,
    number: "1.1",
    title: "입구 파일과 독자 수준 정하기",
    subtitle: "README, package scripts, 앱 엔트리부터 책의 난이도와 읽는 순서를 잡습니다.",
    progress: 100,
    status: "complete",
    estimatedMinutes: 14,
    files: ["README.md", "package.json", "apps/web/src/App.tsx"],
    goals: [
      "저장소가 어떤 문제를 푸는지 한 문장으로 요약한다.",
      "실행 스크립트와 첫 화면을 연결한다."
    ],
    sections: [
      {
        eyebrow: "읽는 순서",
        title: "책의 표지는 README가 아니라 실행 경로에서 완성된다",
        body: "LM Studio는 README를 먼저 읽지만, 목차를 확정하기 전에 실행 스크립트와 첫 화면을 함께 대조한다."
      }
    ],
    code: {
      path: "apps/web/src/App.tsx",
      label: "첫 화면 셸",
      lines: ["<main className=\"workspace\" id=\"workspace\">", "  <div className=\"app-view\">{children}</div>"]
    },
    notes: [{ title: "LM Studio 판정", body: "실행 가능한 앱 구조이므로 라우팅과 화면 상태를 먼저 읽는 흐름이 적합합니다." }],
    checkpoints: ["첫 실행 경로 확인", "주요 화면 이름 추출", "책의 독자 수준 확정"]
  },
  {
    id: "chapter-1-2",
    bookId: "repo-books-book",
    partId: "repo-books-part-1",
    order: 1,
    number: "1.2",
    title: "폴더를 대단원으로 바꾸기",
    subtitle: "파일 트리를 그대로 보여주지 않고, 학습 흐름에 맞는 대단원으로 재배열합니다.",
    progress: 62,
    status: "current",
    estimatedMinutes: 21,
    files: ["docs/requirements", "docs/design", "apps/web/src"],
    goals: [
      "폴더 이름을 학습 목적 단위로 번역한다.",
      "읽기 순서와 실제 파일 위치를 분리해서 설명한다."
    ],
    sections: [
      {
        eyebrow: "이번 장",
        title: "파일 트리는 지도이고, 목차는 여행 일정이다",
        body: "좋은 저장소 학습서는 폴더 구조를 그대로 복사하지 않는다. 독자가 개념을 쌓는 순서로 대단원을 만든다."
      },
      {
        eyebrow: "주의",
        title: "한 장에 너무 많은 파일을 넣지 않는다",
        body: "한 챕터는 독자가 머릿속에 보관할 수 있는 작은 코드 묶음이어야 한다."
      }
    ],
    code: {
      path: "packages/shared/src/index.ts",
      label: "목차 fixture",
      lines: ["const baseChapters: BookChapter[] = [", "  { number: \"1.2\", title: \"폴더를 대단원으로 바꾸기\" }", "];"]
    },
    notes: [{ title: "왜 중요한가", body: "목차가 파일 트리와 같으면 책이 아니라 탐색기입니다." }],
    checkpoints: ["폴더 책임 요약", "대단원 이름 확정", "챕터별 읽을 파일 제한"]
  },
  {
    id: "chapter-2-1",
    bookId: "repo-books-book",
    partId: "repo-books-part-2",
    order: 2,
    number: "2.1",
    title: "책장 홈의 정보 구조",
    subtitle: "변환된 저장소를 책처럼 다시 꺼내 읽을 수 있게 정리합니다.",
    progress: 18,
    status: "next",
    estimatedMinutes: 18,
    files: ["apps/web/src/App.tsx", "apps/web/src/styles.css"],
    goals: ["책장, 생성 중, 이어 읽기 영역을 구분한다.", "책 표지에 저장소와 현재 챕터 정보를 함께 담는다."],
    sections: [
      {
        eyebrow: "홈",
        title: "홈은 대시보드가 아니라 책장이다",
        body: "사용자는 저장소 목록을 관리하려고 들어오는 것이 아니라, 어제 읽던 코드를 이어 읽으려고 들어온다."
      }
    ],
    code: {
      path: "apps/web/src/styles.css",
      label: "책장 레이아웃",
      lines: [".shelf-row {", "  display: grid;", "  gap: 14px;", "}"]
    },
    notes: [{ title: "일반 기술서 흐름", body: "표지, 목차, 현재 장, 다음 장이 자연스럽게 이어져야 책처럼 느껴집니다." }],
    checkpoints: ["이어 읽기 책 표시", "생성 상태 분리", "새 저장소 입력 유지"]
  }
];

const makeBook = (overrides: Partial<RepoBook>): RepoBook => {
  const bookId = overrides.id ?? "repo-books-book";
  const parts = baseParts.map((part) => ({ ...part, id: part.id.replace("repo-books", bookId), bookId }));
  const partIdByOrder = new Map(parts.map((part) => [part.order, part.id]));
  const chapters = baseChapters.map((chapter) => ({
    ...chapter,
    id: chapter.id.replace("chapter", `${bookId}-chapter`),
    bookId,
    partId: partIdByOrder.get(chapter.partId.endsWith("-1") ? 0 : chapter.partId.endsWith("-2") ? 1 : 2) ?? parts[0].id
  }));

  return repoBookSchema.parse({
    id: bookId,
    title: "Repo Books를 읽는 책",
    subtitle: "저장소 앱을 기술서처럼 읽고, 화면에서 코드까지 이어가는 학습서",
    repo: "suyoungkim/repo-books",
    branch: "main",
    model: "LM Studio · qwen3-coder",
    updated: "오늘 09:12",
    status: "reading",
    statusLabel: "읽는 중",
    accent: "cyan",
    progress: 42,
    currentChapterId: chapters[1]?.id ?? chapters[0]?.id,
    parts,
    chapters,
    ...overrides
  });
};

export const seedBooks: RepoBook[] = [
  makeBook({ id: "repo-books-book" }),
  makeBook({
    id: "commerce-book",
    title: "Next Commerce 구조 산책",
    subtitle: "상품, 장바구니, 결제 흐름을 유지보수자 관점에서 읽는 책",
    repo: "team/next-commerce",
    branch: "develop",
    model: "LM Studio · llama-3.1-8b",
    updated: "어제 18:40",
    status: "complete",
    statusLabel: "완성",
    accent: "green",
    progress: 78
  }),
  makeBook({
    id: "agent-kit-book",
    title: "Agent Kit 운영 매뉴얼",
    subtitle: "도구 호출, 컨텍스트 관리, 검증 루틴을 장별로 정리한 원고",
    repo: "lab/agent-kit",
    status: "generating",
    statusLabel: "목차 생성 중",
    accent: "amber",
    progress: 31
  }),
  makeBook({
    id: "design-system-book",
    title: "Design System Field Guide",
    subtitle: "토큰, 컴포넌트, 화면 조립 순서로 읽는 프론트엔드 학습서",
    repo: "studio/design-system",
    model: "LM Studio · mistral-nemo",
    updated: "4월 19일",
    status: "draft",
    statusLabel: "초안",
    accent: "rose",
    progress: 12
  })
];

export const seedGenerationOutline: GenerationOutlinePart[] = [
  {
    part: "Part I. 저장소 지도",
    summary: "제품 의도, 실행 경로, 폴더 책임을 먼저 읽습니다.",
    chapters: ["1.1 입구 파일과 독자 수준 정하기", "1.2 폴더를 대단원으로 바꾸기"]
  },
  {
    part: "Part II. 화면과 상태",
    summary: "책장 홈, 읽기 화면, 튜터 주석의 UI 계약을 확인합니다.",
    chapters: ["2.1 책장 홈의 정보 구조", "2.2 읽기 화면의 본문, 코드, 튜터 주석"]
  },
  {
    part: "Part III. 유지보수자의 읽기",
    summary: "변경 전 계약을 찾고 작은 수정으로 이어갑니다.",
    chapters: ["3.1 변경 전에 계약 찾기", "3.2 검증 증거를 챕터 노트로 남기기"]
  }
];

export const seedUiState: UIState = uiStateSchema.parse({
  id: "default",
  activeBookId: "repo-books-book",
  activeChapterId: seedBooks[0]?.currentChapterId ?? null,
  view: "library",
  focus: false,
  mobilePanel: "",
  preferences: {},
  updatedAt: "2026-04-25T00:00:00.000Z"
});
