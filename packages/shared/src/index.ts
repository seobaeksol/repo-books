import { z } from "zod";

export const GENERATION_MODEL_OPTIONS = [
  {
    value: "google/gemma-4-e4b",
    label: "Gemma 4 E4B Instruct",
    description: "로컬 노트북에서 빠르게 초안을 만들기 좋은 Gemma 4 모델"
  },
  {
    value: "qwen/qwen3-4b-2507",
    label: "Qwen3 4B 2507",
    description: "lms get으로 자동 준비하기 쉬운 경량 Qwen3 모델"
  },
  {
    value: "google/gemma-4-26b-a4b",
    label: "Gemma 4 26B A4B",
    description: "장문 기술서 구조화와 추론 품질을 우선할 때 적합"
  },
  {
    value: "qwen/qwen3-coder-next",
    label: "Qwen3-Coder-Next",
    description: "복잡한 코드 근거와 agentic codebase 분석에 적합"
  },
  {
    value: "mistralai/mistral-nemo-instruct-2407",
    label: "Mistral Nemo 12B",
    description: "긴 컨텍스트 기반의 빠른 일반 기술서 생성"
  }
] as const;

export const DEFAULT_GENERATION_MODEL = GENERATION_MODEL_OPTIONS[0].value;

export const READER_LEVEL_VALUES = ["입문자", "실무자", "숙련자", "유지보수자", "설계자"] as const;
export const DEFAULT_READER_LEVEL = "실무자";
export const READER_LEVEL_OPTIONS = [
  { value: "입문자", label: "입문자", description: "저장소와 도메인을 처음 접하는 독자에게 용어와 흐름을 단계적으로 설명" },
  { value: "실무자", label: "실무자", description: "코드는 읽을 수 있지만 전체 구조 파악이 필요한 개발자" },
  { value: "숙련자", label: "숙련자", description: "모듈 책임, 경계, tradeoff를 빠르게 파악하려는 개발자" },
  { value: "유지보수자", label: "유지보수자", description: "변경 지점, 회귀 위험, 테스트 근거를 중심으로 읽는 독자" },
  { value: "설계자", label: "설계자", description: "시스템 구조, 확장성, 아키텍처 판단을 검토하는 독자" }
] as const satisfies ReadonlyArray<{ value: (typeof READER_LEVEL_VALUES)[number]; label: string; description: string }>;

export const BOOK_PURPOSE_VALUES = ["온보딩", "구조 이해", "변경 준비", "학습 교재", "운영 참고서"] as const;
export const DEFAULT_BOOK_PURPOSE = "온보딩";
export const BOOK_PURPOSE_OPTIONS = [
  { value: "온보딩", label: "온보딩", description: "처음 합류한 개발자가 저장소를 읽고 기여할 수 있게 구성" },
  { value: "구조 이해", label: "구조 이해", description: "주요 모듈, 실행 흐름, 데이터와 제어 흐름을 큰 그림 중심으로 설명" },
  { value: "변경 준비", label: "변경 준비", description: "리팩터링, 기능 추가, 마이그레이션 전 확인할 책임과 위험을 정리" },
  { value: "학습 교재", label: "학습 교재", description: "강의나 스터디처럼 개념, 예시, 체크포인트를 강화" },
  { value: "운영 참고서", label: "운영 참고서", description: "설정, 배포, 장애 대응, 테스트와 검증 지점을 빠르게 찾게 구성" }
] as const satisfies ReadonlyArray<{ value: (typeof BOOK_PURPOSE_VALUES)[number]; label: string; description: string }>;

export const GENERATION_DEPTH_VALUES = ["light", "balanced", "deep"] as const;
export const GENERATION_DEPTH_OPTIONS = [
  { value: "light", label: "간단히", description: "핵심 목차와 주요 흐름 위주로 빠르게 생성" },
  { value: "balanced", label: "표준", description: "구조, 근거, 변경 포인트를 균형 있게 생성" },
  { value: "deep", label: "자세히", description: "구현 이유, 의존성, 영향 범위까지 자세히 생성" }
] as const satisfies ReadonlyArray<{ value: (typeof GENERATION_DEPTH_VALUES)[number]; label: string; description: string }>;
export const DEFAULT_GENERATION_DEPTH = "balanced";

export const bookStatusSchema = z.enum(["reading", "complete", "generating", "draft"]);
export const bookFilterSchema = z.enum(["all", "in_progress", "generating", "draft"]);
export const chapterStatusSchema = z.enum(["complete", "current", "next", "locked", "draft", "generating", "failed"]);
export const generationStatusSchema = z.enum(["queued", "running", "complete", "failed"]);
export const generationStepStateSchema = z.enum(["pending", "active", "complete", "failed"]);
export const generationChapterRunStatusSchema = z.enum(["queued", "running", "complete", "failed"]);
export const tutorMessageRoleSchema = z.enum(["user", "assistant", "system"]);
export const readerViewSchema = z.enum(["library", "reader", "generation"]);

export const lmStudioQuantizationSchema = z.object({
  name: z.string().optional(),
  bits: z.number().optional()
}).passthrough();

export const lmStudioModelOptionSchema = z.object({
  modelKey: z.string().min(1),
  displayName: z.string(),
  path: z.string(),
  publisher: z.string(),
  paramsString: z.string().optional(),
  quantization: lmStudioQuantizationSchema.nullable(),
  sizeBytes: z.number().nullable(),
  maxContextLength: z.number().nullable(),
  vision: z.boolean(),
  trainedForToolUse: z.boolean(),
  cachedAt: z.string(),
  stale: z.boolean()
});

export const lmStudioModelsResponseSchema = z.object({
  models: z.array(lmStudioModelOptionSchema),
  cachedAt: z.string().nullable(),
  stale: z.boolean(),
  error: z.string().optional()
});

export type LmStudioModelOption = z.infer<typeof lmStudioModelOptionSchema>;
export type LmStudioModelsResponse = z.infer<typeof lmStudioModelsResponseSchema>;

export const userProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().default("cyan"),
  createdAt: z.string(),
  updatedAt: z.string()
});

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

export const chapterFlowSchema = z.object({
  type: z.enum(["architecture", "execution", "data", "configuration", "testing", "concept"]).default("concept"),
  title: z.string(),
  summary: z.string(),
  diagram: z.string().default("")
});

export const codeAnchorSchema = z.object({
  filePath: z.string(),
  symbolName: z.string().default(""),
  lineHint: z.string().default(""),
  claim: z.string(),
  explanation: z.string(),
  excerptLines: z.array(z.string()).default([])
});

export const chapterEvidenceSchema = z.object({
  filePath: z.string(),
  role: z.string(),
  usedAsEvidence: z.string(),
  outOfScope: z.string().default("")
});

export const chapterGlossaryEntrySchema = z.object({
  term: z.string(),
  meaning: z.string(),
  appearsIn: z.string().default(""),
  relatedAnchors: z.array(z.string()).default([])
});

export const chapterRecapSchema = z.object({
  understood: z.array(z.string()).default([]),
  changeEntryPoints: z.array(z.string()).default([]),
  nextQuestions: z.array(z.string()).default([])
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
  checkpoints: z.array(z.string()),
  keyQuestion: z.string().optional(),
  responsibility: z.string().optional(),
  flow: chapterFlowSchema.nullable().optional(),
  codeAnchors: z.array(codeAnchorSchema).optional(),
  evidence: z.array(chapterEvidenceSchema).optional(),
  glossary: z.array(chapterGlossaryEntrySchema).optional(),
  recap: chapterRecapSchema.optional()
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
  generationRunId: z.string().optional(),
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

export const generationChapterRunSchema = z.object({
  id: z.string(),
  runId: z.string(),
  chapterId: z.string(),
  order: z.number().int().nonnegative(),
  title: z.string(),
  status: generationChapterRunStatusSchema,
  attempts: z.number().int().nonnegative(),
  source: z.string(),
  lastError: z.string().nullable(),
  updatedAt: z.string()
});

export const generationArtifactSchema = z.object({
  id: z.string(),
  runId: z.string(),
  chapterId: z.string().nullable(),
  kind: z.string(),
  order: z.number().int().nonnegative(),
  payload: z.record(z.unknown()),
  createdAt: z.string()
});

export const generationRunSchema = z.object({
  id: z.string(),
  userId: z.string().default("local"),
  bookId: z.string().nullable(),
  repoUrl: z.string(),
  branch: z.string(),
  model: z.string(),
  context: z.string(),
  status: generationStatusSchema,
  progress: z.number().min(0).max(100),
  steps: z.array(generationStepSchema),
  outline: z.array(generationOutlinePartSchema),
  chapterRuns: z.array(generationChapterRunSchema).default([]),
  artifacts: z.array(generationArtifactSchema).default([]),
  error: z.string().default(""),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const createProfileSchema = z.object({
  id: z.string().min(1).optional(),
  displayName: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(80).optional(),
  color: z.string().default("cyan")
}).refine((payload) => payload.displayName || payload.name, {
  message: "displayName or name is required"
});

export const patchUserProfileSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(80).optional(),
  color: z.string().min(1).optional()
});

export const syncStatusSchema = z.object({
  deviceId: z.string(),
  schemaVersion: z.number().int().positive(),
  activeProfileId: z.string(),
  lastExportAt: z.string().nullable(),
  lastImportAt: z.string().nullable(),
  updatedAt: z.string()
});

export const readingStateSchema = z.object({
  userId: z.string().default("local"),
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
  userId: z.string().default("local"),
  bookId: z.string(),
  chapterId: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messages: z.array(tutorMessageSchema).default([])
});

export const uiStateSchema = z.object({
  id: z.literal("default"),
  userId: z.string().default("local"),
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

export const postUserProfileSchema = createProfileSchema;

export const postGenerationOutlineSchema = z.object({
  repoUrl: z.string().min(1),
  branch: z.string().default("main"),
  model: z.string().min(1).default(DEFAULT_GENERATION_MODEL),
  context: z.string().default("128k"),
  audience: z.string().min(1).optional(),
  readerLevel: z.enum(READER_LEVEL_VALUES).default(DEFAULT_READER_LEVEL),
  bookPurpose: z.enum(BOOK_PURPOSE_VALUES).default(DEFAULT_BOOK_PURPOSE),
  depth: z.enum(GENERATION_DEPTH_VALUES).default(DEFAULT_GENERATION_DEPTH),
  customPrompt: z.string().max(4000).default(""),
  background: z.boolean().default(false)
}).transform((payload) => ({
  ...payload,
  audience: payload.audience ?? payload.readerLevel,
  customPrompt: payload.customPrompt.trim()
}));

export const tutorThreadsQuerySchema = z.object({
  bookId: z.string().optional(),
  chapterId: z.string().optional()
});

export const postTutorMessageSchema = z.object({
  role: tutorMessageRoleSchema.default("user"),
  body: z.string().min(1),
  metadata: z.record(z.unknown()).default({})
});

export const syncSnapshotSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  deviceId: z.string(),
  activeProfileId: z.string(),
  users: z.array(userProfileSchema),
  books: z.array(repoBookSchema.extend({ userId: z.string().optional() })),
  readingStates: z.array(readingStateSchema),
  uiStates: z.array(uiStateSchema),
  generationRuns: z.array(generationRunSchema),
  tutorThreads: z.array(tutorThreadSchema)
});

export const syncImportSchema = z.object({
  mode: z.enum(["merge", "replace"]).default("merge"),
  snapshot: syncSnapshotSchema
});

export const importSyncSnapshotSchema = syncImportSchema;

export type BookStatus = z.infer<typeof bookStatusSchema>;
export type BookFilter = z.infer<typeof bookFilterSchema>;
export type ChapterStatus = z.infer<typeof chapterStatusSchema>;
export type GenerationStatus = z.infer<typeof generationStatusSchema>;
export type GenerationStepState = z.infer<typeof generationStepStateSchema>;
export type GenerationChapterRunStatus = z.infer<typeof generationChapterRunStatusSchema>;
export type TutorMessageRole = z.infer<typeof tutorMessageRoleSchema>;
export type ReaderView = z.infer<typeof readerViewSchema>;
export type TextSection = z.infer<typeof textSectionSchema>;
export type CodeExcerpt = z.infer<typeof codeExcerptSchema>;
export type ChapterNote = z.infer<typeof chapterNoteSchema>;
export type ChapterFlow = z.infer<typeof chapterFlowSchema>;
export type CodeAnchor = z.infer<typeof codeAnchorSchema>;
export type ChapterEvidence = z.infer<typeof chapterEvidenceSchema>;
export type ChapterGlossaryEntry = z.infer<typeof chapterGlossaryEntrySchema>;
export type ChapterRecap = z.infer<typeof chapterRecapSchema>;
export type BookPart = z.infer<typeof bookPartSchema>;
export type BookChapter = z.infer<typeof bookChapterSchema>;
export type RepoBook = z.infer<typeof repoBookSchema>;
export type GenerationStep = z.infer<typeof generationStepSchema>;
export type GenerationOutlinePart = z.infer<typeof generationOutlinePartSchema>;
export type GenerationChapterRun = z.infer<typeof generationChapterRunSchema>;
export type GenerationArtifact = z.infer<typeof generationArtifactSchema>;
export type GenerationRun = z.infer<typeof generationRunSchema>;
export type UserProfile = z.infer<typeof userProfileSchema>;
export type CreateProfilePayload = z.infer<typeof createProfileSchema>;
export type SyncStatus = z.infer<typeof syncStatusSchema>;
export type SyncSnapshot = z.infer<typeof syncSnapshotSchema>;
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
export type SyncImportPayload = z.infer<typeof syncImportSchema>;
export type PostUserProfilePayload = z.infer<typeof postUserProfileSchema>;
export type PatchUserProfilePayload = z.infer<typeof patchUserProfileSchema>;
export type ImportSyncSnapshotPayload = z.infer<typeof importSyncSnapshotSchema>;

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
  userId: "local",
  activeBookId: "repo-books-book",
  activeChapterId: seedBooks[0]?.currentChapterId ?? null,
  view: "library",
  focus: false,
  mobilePanel: "",
  preferences: {},
  updatedAt: "2026-04-25T00:00:00.000Z"
});
