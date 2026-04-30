import type { RepoBook } from "@repo-books/shared";
import type { RepoIndex } from "./indexer.js";

export type RepoBookQualityIssue = {
  severity: "error" | "warning";
  chapterId?: string;
  message: string;
};

const generatedMetaLanguagePatterns: Array<{ label: string; pattern: RegExp }> = [
  { label: "fake OpenAI-compatible", pattern: /fake\s+OpenAI-compatible/i },
  { label: "JSON parsing", pattern: /JSON parsing/i },
  { label: "테스트용 응답", pattern: /테스트용\s*응답/i },
  { label: "프롬프트", pattern: /프롬프트/i },
  { label: "generation adapter", pattern: /\b(?:fake|generation|structured|prose|sdk|lm\s*studio)\s+adapter\b/i },
  { label: "충분히 긴 prose", pattern: /충분히\s*긴\s*prose/i },
  { label: "모델 응답", pattern: /모델\s*응답/i },
  { label: "생성 내부", pattern: /생성\s*(?:파이프라인|내부|시스템|단계|결과|응답|엔진|프롬프트)/i },
  { label: "생성기", pattern: /(?:책|본문|섹션|section|chapter|book)\s*생성기/i },
  { label: "markdown fence", pattern: /```|^#{1,6}\s/m }
];

export function generatedMetaLanguageMatches(text: string) {
  return generatedMetaLanguagePatterns.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}

export function hasGeneratedMetaLanguage(text: string) {
  return generatedMetaLanguageMatches(text).length > 0;
}

export function validateRepoBookQuality(book: RepoBook, index: RepoIndex): RepoBookQualityIssue[] {
  const indexedPaths = new Set(index.files.map((file) => file.path));
  const issues: RepoBookQualityIssue[] = [];
  const sectionBodies = new Map<string, number>();

  for (const chapter of book.chapters) {
    if (chapter.status === "failed") {
      issues.push({ severity: "warning", chapterId: chapter.id, message: "Chapter generation failed and is stored for retry instead of blocking the whole book." });
      continue;
    }

    for (const path of chapter.files) {
      if (!indexedPaths.has(path)) {
        issues.push({ severity: "error", chapterId: chapter.id, message: `Chapter references a file that was not indexed: ${path}` });
      }
    }

    const evidenceCount = (chapter.evidence?.length ?? 0) + (chapter.codeAnchors?.length ?? 0);
    const hasSymbolEvidence = chapter.codeAnchors?.some((anchor) => anchor.symbolName || anchor.lineHint || anchor.excerptLines.length > 0) ?? false;
    if (evidenceCount < 2 && !(chapter.files.length >= 1 && hasSymbolEvidence)) {
      issues.push({ severity: "error", chapterId: chapter.id, message: "Chapter needs at least two evidence items, or one file plus a symbol/config/test anchor." });
    }

    const text = [
      chapter.keyQuestion,
      chapter.responsibility,
      chapter.flow?.summary,
      ...chapter.sections.map((section) => section.body),
      ...(chapter.evidence ?? []).map((item) => `${item.role} ${item.usedAsEvidence}`),
      ...(chapter.codeAnchors ?? []).map((anchor) => `${anchor.claim} ${anchor.explanation}`)
    ]
      .filter(Boolean)
      .join("\n");
    if (hasGeneratedMetaLanguage(text)) {
      issues.push({ severity: "error", chapterId: chapter.id, message: "Chapter body leaks generation/test/meta language." });
    }
    if (!chapter.files.some((path) => text.includes(path)) && !(chapter.codeAnchors ?? []).some((anchor) => text.includes(anchor.filePath))) {
      issues.push({ severity: "warning", chapterId: chapter.id, message: "Chapter prose does not mention its evidence paths directly." });
    }

    for (const body of chapter.sections.map((section) => normalizeBody(section.body))) {
      sectionBodies.set(body, (sectionBodies.get(body) ?? 0) + 1);
    }
  }

  for (const [body, count] of sectionBodies) {
    if (body.length > 120 && count > 2) {
      issues.push({ severity: "warning", message: `Repeated prose template appears in ${count} sections.` });
    }
  }

  return issues;
}

export function assertRepoBookQuality(book: RepoBook, index: RepoIndex) {
  const issues = validateRepoBookQuality(book, index);
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new Error(repoBookQualityFailureMessage(errors));
  }
  return issues;
}

export function repoBookQualityFailureMessage(issues: RepoBookQualityIssue[]) {
  const errors = issues.filter((issue) => issue.severity === "error");
  const message = errors.map((issue) => `${issue.chapterId ?? "book"}: ${issue.message}`).join("; ");
  return `REPO_BOOK_QUALITY_FAILED: ${message}`;
}

function normalizeBody(body: string) {
  return body.replace(/\s+/g, " ").trim();
}
