
import { Check, Circle, Clock3, Loader2, X } from "lucide-react";
import type { CSSProperties } from "react";
import type { BookChapter, BookFilter, GenerationArtifact, GenerationStep, LmStudioModelOption, UIState } from "@repo-books/shared";
import { FILTERS, FOCUSABLE_SELECTOR, STATUS_LABELS } from "../constants";
import type { ThemeVariable } from "../design/themes";
import type { BookWithContent } from "../lib/api";
import type { RunStepState } from "../types";

export function upsertBook(books: BookWithContent[], book: BookWithContent) {
  return books.some((item) => item.id === book.id) ? books.map((item) => (item.id === book.id ? book : item)) : [book, ...books];
}

export function swatchStyle(variables: Record<ThemeVariable, string>) {
  return {
    background: `linear-gradient(135deg, ${variables["--app-bg"]} 0 38%, ${variables["--surface"]} 38% 70%, ${variables["--accent"]} 70%)`
  } as CSSProperties;
}

export function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function focusableElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => element.getClientRects().length > 0);
}

export function normalizeFilter(value: unknown): BookFilter {
  return FILTERS.some((item) => item.value === value) ? (value as BookFilter) : "all";
}

export function routeToView(route: string): UIState["view"] {
  if (route.startsWith("/generation")) return "generation";
  if (route.startsWith("/books/")) return "reader";
  return "library";
}

export function getString(value: unknown, key: string): string {
  if (!value || typeof value !== "object") return "";
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : "";
}

export function currentChapter(book: BookWithContent | null | undefined) {
  if (!book?.chapters?.length) return undefined;
  return book.chapters.find((chapter) => chapter.id === book.currentChapterId) ?? book.chapters[0];
}

export function firstChapter(book: BookWithContent | null | undefined) {
  return book?.chapters?.[0];
}

export function firstReadableChapter(book: BookWithContent | null | undefined) {
  if (!book?.chapters?.length) return undefined;
  const current = book.chapters.find((chapter) => chapter.id === book.currentChapterId && hasReadableChapter(chapter));
  return current ?? book.chapters.find(hasReadableChapter);
}

export function hasReadableChapter(chapter: BookChapter) {
  return Boolean(chapter.sections?.some((section) => section.body.trim().length > 0));
}

export function progress(book: BookWithContent) {
  return clampPercent(Number(getNumber(book, "progressPercent") ?? getNumber(book, "progress") ?? 0));
}

export function chapterProgress(chapter: BookChapter) {
  return clampPercent(Number(getNumber(chapter, "progressPercent") ?? getNumber(chapter, "progress") ?? 0));
}

export function getNumber(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" ? candidate : undefined;
}

export function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}

export function repositoryName(book: BookWithContent) {
  return getString(book, "repositoryName") || getString(book, "repo") || getString(book, "repositoryUrl") || "local/repository";
}

export function modelName(book: BookWithContent) {
  return getString(book, "lmStudioModel") || getString(book, "model") || "LM Studio";
}

export function lmStudioModelLabel(model: LmStudioModelOption) {
  const quantization = model.quantization?.name ? ` · ${model.quantization.name}` : "";
  return `${model.displayName}${quantization}`;
}

export function lmStudioModelDescription(model: LmStudioModelOption) {
  const details = [
    model.paramsString,
    model.quantization?.name,
    model.maxContextLength ? `${Math.round(model.maxContextLength / 1024)}k context` : "",
    model.trainedForToolUse ? "tool use" : "",
    model.vision ? "vision" : ""
  ].filter(Boolean);
  return `${model.modelKey}${details.length ? ` · ${details.join(" · ")}` : ""}`;
}

export function formatUpdated(book: BookWithContent) {
  return getString(book, "updated") || (getString(book, "lastReadAt") ? "최근 읽음" : "방금 전");
}

export function recentSortKey(book: BookWithContent) {
  return getString(book, "lastReadAt") || getString(book, "updatedAt") || getString(book, "updated");
}

export function statusLabel(book: BookWithContent) {
  return getString(book, "statusLabel") || STATUS_LABELS[book.status] || book.status;
}

export function chapterStatusLabel(chapter: BookChapter) {
  const labels: Record<string, string> = {
    complete: "생성됨",
    current: "읽는 중",
    generating: "작성 중",
    draft: "초안",
    failed: "실패",
    next: "다음",
    locked: "대기"
  };
  return labels[chapter.status] ?? chapter.status;
}

export function coverTheme(book: BookWithContent) {
  return getString(book, "coverTheme") || getString(book, "accent") || "cyan";
}

export function partsForBook(book: BookWithContent) {
  if (book.parts?.length) return book.parts;
  const titles = Array.from(new Set((book.chapters ?? []).map((chapter) => getString(chapter, "part") || chapter.partId || "part")));
  return titles.map((title, index) => ({ id: title, title, summary: index === 0 ? "제품 의도와 실행 경로를 먼저 읽습니다." : "화면과 코드 근거를 학습 순서로 연결합니다." }));
}

export function chaptersForPart(book: BookWithContent, partId: string) {
  return (book.chapters ?? []).filter((chapter) => chapter.partId === partId || getString(chapter, "part") === partId);
}

export function partTitle(book: BookWithContent, chapter: BookChapter) {
  return book.parts?.find((part) => part.id === chapter.partId)?.title || getString(chapter, "part") || chapter.partId;
}

export function objectives(chapter: BookChapter) {
  const legacy = chapter as unknown as { objectives?: string[]; goals?: string[] };
  return legacy.objectives?.length ? legacy.objectives : (legacy.goals ?? []);
}

export function sections(chapter: BookChapter) {
  return (
    (chapter.sections as Array<{ eyebrow?: string; title: string; body: string }> | undefined)?.map((section) => ({
      eyebrow: section.eyebrow ?? "본문",
      title: section.title,
      body: section.body
    })) ?? [{ eyebrow: "본문", title: chapter.title, body: chapter.subtitle }]
  );
}

export function proseParagraphs(body: string) {
  return body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

export function relatedFiles(chapter: BookChapter) {
  const legacy = chapter as unknown as { relatedFiles?: string[]; files?: string[] };
  return legacy.relatedFiles?.length ? legacy.relatedFiles : (legacy.files ?? []);
}

export function hasStructuredChapterBody(chapter: BookChapter) {
  return Boolean(chapter.keyQuestion || chapter.responsibility || chapter.flow || chapter.codeAnchors?.length || chapter.evidence?.length || chapter.recap);
}

export function codeAnchors(chapter: BookChapter) {
  return chapter.codeAnchors ?? [];
}

export function firstCodeAnchor(chapter: BookChapter) {
  const fromAnchors = (chapter as unknown as { codeAnchors?: Array<{ path?: string; label?: string; lines?: string[] }> }).codeAnchors?.[0];
  const fromLegacy = (chapter as unknown as { code?: { path?: string; label?: string; lines?: string[] } }).code;
  return {
    path: (fromAnchors as { filePath?: string } | undefined)?.filePath ?? fromAnchors?.path ?? fromLegacy?.path ?? relatedFiles(chapter)[0] ?? "README.md",
    label: (fromAnchors as { claim?: string } | undefined)?.claim ?? fromAnchors?.label ?? fromLegacy?.label ?? "코드 근거",
    lines: (fromAnchors as { excerptLines?: string[] } | undefined)?.excerptLines ?? fromAnchors?.lines ?? fromLegacy?.lines ?? ["// 저장소 색인 결과에서 코드 근거를 추출하는 중입니다."]
  };
}

export function evidenceRows(chapter: BookChapter) {
  return chapter.evidence ?? [];
}

export function glossaryEntries(chapter: BookChapter) {
  return chapter.glossary ?? [];
}

export function recapItems(chapter: BookChapter, key: "understood" | "changeEntryPoints" | "nextQuestions") {
  return chapter.recap?.[key] ?? [];
}

export function checkpoints(chapter: BookChapter) {
  return chapter.checkpoints?.length ? chapter.checkpoints : ["이 장의 목적을 한 문장으로 요약한다."];
}

export function mentorNotes(chapter: BookChapter) {
  const notes = (chapter as unknown as { notes?: Array<{ title: string; body: string }> }).notes;
  if (notes?.length) return notes;
  return [
    {
      title: "현재 챕터 맥락",
      body: `${relatedFiles(chapter).slice(0, 2).join(", ") || "관련 파일"}을 중심으로 답변합니다.`
    }
  ];
}

export function currentGenerationStep(steps: GenerationStep[]) {
  return steps.find((step) => step.state === "active" || step.state === "failed") ?? [...steps].reverse().find((step) => step.state === "complete") ?? steps[0] ?? null;
}

export function generationStatusTone(status: string | undefined, running: boolean, waitingLong: boolean, hasError: boolean) {
  if (hasError || status === "failed") return "failed";
  if (status === "complete") return "complete";
  if (waitingLong) return "waiting";
  if (running || status === "running") return "running";
  if (status === "queued") return "queued";
  return "idle";
}

export function generationStatusTitle(status: string | undefined, running: boolean, waitingLong: boolean, hasError: boolean) {
  if (hasError || status === "failed") return "생성 실패";
  if (status === "complete") return "생성 완료";
  if (waitingLong) return "서버 응답 대기 중";
  if (status === "queued") return "생성 대기 중";
  if (running || status === "running") return "생성 진행 중";
  return "생성 준비";
}

export function generationStatusIcon(tone: string, running: boolean) {
  if (tone === "complete") return <Check />;
  if (tone === "failed") return <X />;
  if (tone === "queued") return <Clock3 />;
  if (tone === "running" || tone === "waiting" || running) return <Loader2 className="spin" />;
  return <Circle />;
}

export function generationStatusLabel(status: string) {
  if (status === "queued") return "대기 중";
  if (status === "running") return "실행 중";
  if (status === "complete") return "완료";
  if (status === "failed") return "실패";
  return status;
}

export function generationActivityItems(artifacts: GenerationArtifact[]) {
  return [...artifacts]
    .sort((a, b) => a.order - b.order)
    .slice(-5)
    .reverse()
    .map((artifact) => {
      const title = generationArtifactTitle(artifact);
      const meta = [formatClockTime(artifact.createdAt), generationArtifactMeta(artifact)].filter(Boolean).join(" · ");
      return {
        id: artifact.id,
        kind: generationArtifactKindLabel(artifact.kind),
        title,
        meta
      };
    });
}

export function generationArtifactTitle(artifact: GenerationArtifact) {
  const payload = artifact.payload;
  const chapterNumber = getString(payload, "chapterNumber");
  const title = getString(payload, "title") || getString(payload, "part") || generationArtifactKindLabel(artifact.kind);
  const sectionIndex = getNumber(payload, "sectionIndex");
  const section = artifact.kind === "section_draft" && sectionIndex !== undefined ? `section ${sectionIndex + 1}` : "";
  return [chapterNumber, section, title].filter(Boolean).join(" · ");
}

export function generationArtifactMeta(artifact: GenerationArtifact) {
  const payload = artifact.payload;
  const status = getString(payload, "status");
  const source = getString(payload, "source");
  const attempts = getNumber(payload, "attempts");
  return [status, source, attempts ? `${attempts} attempts` : ""].filter(Boolean).join(" · ");
}

export function generationArtifactKindLabel(kind: string) {
  const labels: Record<string, string> = {
    repository_analysis: "저장소 분석",
    part_plan: "대단원 계획",
    chapter_plan: "소단원 계획",
    chapter_brief: "근거 수집",
    section_plan: "섹션 계획",
    section_draft: "섹션 초안",
    chapter_revision: "챕터 수리",
    book_coherence: "일관성 점검",
    book_consistency_repair: "일관성 교정",
    quality_issues: "품질 점검"
  };
  return labels[kind] ?? kind;
}

export function elapsedMilliseconds(value: string, now: number) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, now - parsed);
}

export function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatClockTime(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "";
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(parsed);
}

export function generationStepState(stepId: string, phase: string, hasRun: boolean): RunStepState {
  const order = ["model", "analysis", "part", "chapter", "brief", "draft", "repair", "coherence"];
  const phaseIndex = order.indexOf(phase);
  const stepIndex = order.indexOf(stepId);
  if (!hasRun && stepId !== "model") return "pending";
  if (phase === "failed") return stepId === "model" ? "failed" : "pending";
  if (stepIndex < phaseIndex || phase === "coherence") return "complete";
  if (stepIndex === phaseIndex) return "active";
  return "pending";
}

export function generationRunPhase(status: string) {
  if (status === "complete") return "coherence";
  if (status === "failed") return "failed";
  return "draft";
}

export function stepIcon(state: RunStepState) {
  if (state === "complete") return <Check />;
  if (state === "active") return <Loader2 className="spin" />;
  if (state === "failed") return <X />;
  return <Circle />;
}
