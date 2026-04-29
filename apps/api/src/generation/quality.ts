import type { RepoBook } from "@repo-books/shared";
import type { RepoIndex } from "./indexer.js";

export type RepoBookQualityIssue = {
  severity: "error" | "warning";
  chapterId?: string;
  message: string;
};

const antiMetaPatterns = [
  /fake\s+OpenAI-compatible/i,
  /JSON parsing/i,
  /테스트용\s*응답/i,
  /프롬프트/i,
  /adapter/i,
  /충분히\s*긴\s*prose/i,
  /모델\s*응답/i,
  /생성기/
];

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
    if (antiMetaPatterns.some((pattern) => pattern.test(text))) {
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
    const message = errors.map((issue) => `${issue.chapterId ?? "book"}: ${issue.message}`).join("; ");
    throw new Error(`REPO_BOOK_QUALITY_FAILED: ${message}`);
  }
  return issues;
}

function normalizeBody(body: string) {
  return body.replace(/\s+/g, " ").trim();
}
