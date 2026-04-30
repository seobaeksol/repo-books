
import {
  DEFAULT_BOOK_PURPOSE,
  DEFAULT_GENERATION_DEPTH,
  DEFAULT_GENERATION_MODEL,
  DEFAULT_READER_LEVEL,
  type BookFilter
} from "@repo-books/shared";
import type { GenerationForm } from "./types";

export const FILTERS: Array<{ value: BookFilter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "in_progress", label: "읽는 중" },
  { value: "generating", label: "생성 중" },
  { value: "draft", label: "초안" }
];

export const STATUS_LABELS: Record<string, string> = {
  draft: "초안",
  generating: "생성 중",
  reading: "읽는 중",
  in_progress: "읽는 중",
  complete: "완성",
  completed: "완성",
  failed: "실패"
};

export const GENERATION_STEPS: Array<{ id: string; label: string; detail: string }> = [
  { id: "model", label: "모델 준비", detail: "LM Studio 모델 확인과 필요 시 로컬 다운로드" },
  { id: "analysis", label: "저장소 분석", detail: "색인, entrypoint, repo archetype 추출" },
  { id: "part", label: "대단원 설계", detail: "저장소 전체 arc와 대단원 목적 구성" },
  { id: "chapter", label: "소단원 설계", detail: "대단원별 핵심 질문과 선후 관계 구성" },
  { id: "brief", label: "근거 수집", detail: "파일 근거, 코드 앵커, glossary 후보 연결" },
  { id: "draft", label: "본문 생성", detail: "section plan과 section draft를 순차 생성" },
  { id: "repair", label: "챕터 수리", detail: "중복 제거, 근거 누락, 흐름 보강" },
  { id: "coherence", label: "책 일관성 점검", detail: "용어, recap, 다음 장 연결 확인" },
  { id: "consistency", label: "일관성 교정", detail: "품질 이슈를 교정하고 재검증" }
];

export const GENERATION_FORM_DEFAULT: GenerationForm = {
  repositoryUrl: "",
  model: DEFAULT_GENERATION_MODEL,
  audience: DEFAULT_READER_LEVEL,
  readerLevel: DEFAULT_READER_LEVEL,
  bookPurpose: DEFAULT_BOOK_PURPOSE,
  depth: DEFAULT_GENERATION_DEPTH,
  customPrompt: ""
};

export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");
