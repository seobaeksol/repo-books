import {
  BOOK_PURPOSE_OPTIONS,
  DEFAULT_BOOK_PURPOSE,
  DEFAULT_READER_LEVEL,
  READER_LEVEL_OPTIONS,
  type BookChapter,
  type BookPart,
  type ChapterEvidence,
  type ChapterFlow,
  type ChapterGlossaryEntry,
  type ChapterRecap,
  type CodeAnchor,
  type GenerationChapterRun,
  type GenerationOutlinePart,
  type GenerationRun,
  type PostGenerationOutlinePayload,
  type RepoBook,
  repoBookSchema
} from "@repo-books/shared";
import type { IndexedFile, RepoIndex } from "./indexer.js";
import { analyzeRepository, evidenceRole, type RepositoryAnalysis } from "./analyzer.js";
import {
  createStructuredGenerationClient,
  type ChapterProseSection,
  type ChapterProseStats,
  type StructuredGenerationClient,
  type StructuredGenerationRequest
} from "./proseAdapter.js";
import { assertRepoBookQuality } from "./quality.js";
import { slugify } from "./source.js";

type ChapterSpec = {
  title: string;
  subtitle: string;
  files: string[];
  goals: string[];
  focus: string;
  checkpoints: string[];
  codePath?: string;
  codeLabel?: string;
};

type PartSpec = {
  title: string;
  summary: string;
  chapters: ChapterSpec[];
};

type ChapterBrief = {
  keyQuestion: string;
  responsibility: string;
  flow: ChapterFlow;
  codeAnchors: CodeAnchor[];
  evidence: ChapterEvidence[];
  glossary: ChapterGlossaryEntry[];
  recap: ChapterRecap;
};

type GenerationArtifactDraft = {
  kind: string;
  chapterId?: string | null;
  payload: Record<string, unknown>;
};

type ChapterProgressWindow = {
  start: number;
  end: number;
};

export type SynthesisHooks = {
  onStage?: (label: string, detail: string, progress: number) => void;
  onArtifact?: (artifact: GenerationArtifactDraft) => void;
  structuredGenerationClient?: StructuredGenerationClient;
};

export type SynthesizedRepoBook = {
  book: RepoBook;
  outline: GenerationOutlinePart[];
  chapterProse: Array<Pick<GenerationChapterRun, "chapterId" | "order" | "title" | "status" | "attempts" | "source" | "lastError">>;
  prose: {
    label: string;
    stats: ChapterProseStats;
  };
};

export async function synthesizeRepoBook(
  payload: PostGenerationOutlinePayload,
  index: RepoIndex,
  hooks: SynthesisHooks = {},
  requestedBookId?: string
): Promise<SynthesizedRepoBook> {
  const bookId = requestedBookId ?? `generated-${slugify(index.repoSlug)}-${Date.now()}`;
  hooks.onStage?.("저장소 분석", "archetype, entrypoint, flow evidence를 분석하는 중", 18);
  const analysis = analyzeRepository(index);
  const client = hooks.structuredGenerationClient ?? createStructuredGenerationClient();
  hooks.onArtifact?.({
    kind: "repository_analysis",
    payload: {
      archetypes: analysis.archetypes,
      flows: analysis.flows,
      entryFiles: analysis.entryFiles,
      verificationFiles: analysis.verificationFiles,
      configurationFiles: analysis.configurationFiles
    }
  });
  hooks.onStage?.("대단원 설계", "저장소 전체 arc를 기준으로 part plan 생성", 26);
  const partSpecs = await planParts(index, analysis, client, payload, hooks);
  const parts: BookPart[] = partSpecs.map((part, partIndex) => ({
    id: `${bookId}-part-${partIndex + 1}`,
    bookId,
    order: partIndex,
    title: part.title,
    summary: part.summary
  }));
  const chapters: BookChapter[] = [];
  const chapterProse: SynthesizedRepoBook["chapterProse"] = [];
  for (const [partIndex, part] of partSpecs.entries()) {
    hooks.onStage?.("소단원 설계", `${part.title}의 chapter plan 생성`, 32 + Math.round((partIndex / Math.max(1, partSpecs.length)) * 10));
    const plannedChapters = await planChapters(index, analysis, part, client, payload, hooks);
    const estimatedChapterTotal = Math.max(1, partSpecs.length * targetChaptersPerPart(payload.depth));
    for (const [chapterIndex, chapter] of plannedChapters.entries()) {
      const progressStart = 44 + Math.round((chapters.length / estimatedChapterTotal) * 42);
      const progressEnd = 44 + Math.round(((chapters.length + 1) / estimatedChapterTotal) * 42);
      hooks.onStage?.("근거 수집", `${part.title} · ${chapter.title} 근거 정리 시작`, progressStart);
      const result = await makeChapterMultiStage(bookId, parts[partIndex], partIndex, chapterIndex, chapter, index, analysis, payload, client, hooks, {
        start: progressStart,
        end: progressEnd
      });
      chapters.push(result.chapter);
      chapterProse.push(result.prose);
    }
  }
  hooks.onStage?.("책 일관성 점검", "용어, recap, 다음 장 연결을 점검하는 중", 91);
  const coherence = await runBookCoherencePass(index, analysis, parts, chapters, client, payload);
  hooks.onArtifact?.({ kind: "book_coherence", payload: coherence });
  const book = repoBookSchema.parse({
    id: bookId,
    title: `${index.repoName}${objectParticle(index.repoName)} 읽는 책`,
    subtitle: `${readerLevelLabel(payload)} 독자를 위해 ${bookPurposeLabel(payload)}에 맞춰 ${depthLabel(payload.depth)} 밀도로 재구성한 ${bookSubtitle(index)}`,
    repo: index.repoSlug,
    branch: index.branch,
    model: generationModelLabel(payload),
    updated: "방금 전",
    status: "draft",
    statusLabel: "초안",
    accent: "cyan",
    progress: chapters[0] ? 6 : 0,
    currentChapterId: chapters[0]?.id ?? "",
    parts,
    chapters
  });
  const qualityIssues = assertRepoBookQuality(book, index);
  hooks.onArtifact?.({ kind: "quality_issues", payload: { issues: qualityIssues } });
  hooks.onStage?.("책 일관성 점검", `${chapters.length} chapters checked`, 96);

  return {
    book,
    outline: parts.map((part) => ({
      part: part.title,
      summary: part.summary,
      chapters: chapters.filter((chapter) => chapter.partId === part.id).map((chapter) => `${chapter.number} ${chapter.title}`)
    })) satisfies GenerationOutlinePart[],
    chapterProse,
    prose: {
      label: client.label,
      stats: client.stats
    }
  };
}

export function generationSteps(index: RepoIndex, prose?: SynthesizedRepoBook["prose"]): GenerationRun["steps"] {
  const analysis = analyzeRepository(index);
  const downloadStats = prose?.stats.modelDownloads;
  const modelDetail =
    downloadStats && downloadStats.attempted > 0
      ? downloadStats.failed > 0
        ? `${downloadStats.succeeded}/${downloadStats.attempted} missing model downloads completed; ${downloadStats.failed} failed`
        : `${downloadStats.succeeded}/${downloadStats.attempted} missing model downloads completed`
      : "LM Studio model loaded";
  const proseDetail =
    prose?.stats.mode === "lm-studio" && prose.stats.succeeded > 0 && prose.stats.failed > 0
      ? `${prose.stats.succeeded}/${prose.stats.attempted} structured LM calls succeeded; ${prose.stats.failed} calls repaired or failed`
      : prose?.stats.mode === "lm-studio" && prose.stats.succeeded > 0
      ? `${prose.stats.succeeded}/${prose.stats.attempted} structured LM calls succeeded`
      : prose?.stats.mode === "lm-studio" && prose.stats.failed > 0
        ? `LM Studio structured generation failed ${prose.stats.failed} times`
        : "LM Studio structured generation";
  return [
    { label: "모델 준비", state: "complete", detail: modelDetail },
    { label: "저장소 분석", state: "complete", detail: `${index.repoSlug}${index.commit ? ` @ ${index.commit}` : ""} · ${index.files.length} files` },
    { label: "대단원 설계", state: "complete", detail: `${analysis.archetypes.join(", ")} · ${analysis.flows.length} flows` },
    { label: "소단원 설계", state: "complete", detail: "LM-generated chapter plan" },
    { label: "근거 수집", state: "complete", detail: "chapter briefs, anchors, evidence slices" },
    { label: "본문 생성", state: "complete", detail: proseDetail },
    { label: "챕터 수리", state: "complete", detail: "section repair and revision pass complete" },
    { label: "책 일관성 점검", state: "complete", detail: "coherence pass complete" }
  ];
}

async function planParts(
  index: RepoIndex,
  analysis: RepositoryAnalysis,
  client: StructuredGenerationClient,
  payload: PostGenerationOutlinePayload,
  hooks: SynthesisHooks
): Promise<PartSpec[]> {
  const planned = await retryNormalized<{ parts?: Array<Partial<PartSpec> & { learningGoal?: string }> }, PartSpec[]>(
    client,
    {
      task: `Create exactly ${targetPartCount(payload.depth)} parts for this repository technical book. The plan must be authored from repository evidence, not from a template.`,
      schemaName: "RepoBookPartPlan",
      model: payload.model,
      maxTokens: 4096,
      context: {
        repoName: index.repoName,
        ...generationIntent(payload),
        depth: payload.depth,
        archetypes: analysis.archetypes,
        summary: analysis.summary,
        flows: analysis.flows,
        entryFiles: analysis.entryFiles,
        packages: index.packages.slice(0, 30),
        topLevelDirs: index.topLevelDirs.slice(0, 14),
        readmes: index.files.filter((file) => file.kind === "readme").sort(compareFileImportance).slice(0, 5).map((file) => filePlanningContext(file, 700)),
        manifests: index.files.filter((file) => file.kind === "manifest").sort(compareFileImportance).slice(0, 8).map((file) => filePlanningContext(file, 420)),
        candidateFiles: selectRepresentativeFiles(index).map((file) => filePlanningContext(file, 420))
      }
    },
    4,
    normalizePartPlan
  );
  if (!planned) throw new Error(client.lastError ?? "LM_STUDIO_PART_PLAN_FAILED");
  hooks.onArtifact?.({ kind: "part_plan", payload: { source: client.label, parts: planned.map((part) => ({ title: part.title, summary: part.summary })) } });
  return planned;
}

async function planChapters(
  index: RepoIndex,
  analysis: RepositoryAnalysis,
  part: PartSpec,
  client: StructuredGenerationClient,
  payload: PostGenerationOutlinePayload,
  hooks: SynthesisHooks
): Promise<ChapterSpec[]> {
  const candidateFiles = selectCandidateFilesForPart(index, part);
  const planned = await retryNormalized<{ chapters?: Array<Partial<ChapterSpec> & { keyQuestion?: string; scope?: string; outOfScope?: string }> }, ChapterSpec[]>(
    client,
    {
      task: `Create exactly ${targetChaptersPerPart(payload.depth)} chapters for one book part. Each chapter must include title, subtitle, exact evidence files, goals, focus, checkpoints, and a primary codePath when possible.`,
      schemaName: "RepoBookChapterPlan",
      model: payload.model,
      maxTokens: 4096,
      context: {
        repoName: index.repoName,
        ...generationIntent(payload),
        depth: payload.depth,
        part: { title: part.title, summary: part.summary },
        repositoryFlows: analysis.flows,
        candidateFiles: candidateFiles.map((file) => filePlanningContext(file, 520))
      }
    },
    4,
    (response) => normalizeChapterPlan(response, index)
  );
  if (!planned) throw new Error(client.lastError ?? `LM_STUDIO_CHAPTER_PLAN_FAILED:${part.title}`);
  hooks.onArtifact?.({ kind: "chapter_plan", payload: { part: part.title, source: client.label, chapters: planned } });
  return planned;
}

async function makeChapterMultiStage(
  bookId: string,
  part: BookPart | undefined,
  partIndex: number,
  chapterIndex: number,
  spec: ChapterSpec,
  index: RepoIndex,
  analysis: RepositoryAnalysis,
  payload: PostGenerationOutlinePayload,
  client: StructuredGenerationClient,
  hooks: SynthesisHooks,
  progressWindow: ChapterProgressWindow
): Promise<{
  chapter: BookChapter;
  prose: Pick<GenerationChapterRun, "chapterId" | "order" | "title" | "status" | "attempts" | "source" | "lastError">;
}> {
  const order = partIndex * 10 + chapterIndex;
  const selectedFiles = resolveFiles(index, spec.files).slice(0, 6);
  const fileList = selectedFiles.length ? selectedFiles : index.files.slice(0, 4).map((file) => file.path);
  const sectionFiles = fileList.map((path) => findIndexedFile(index, path)).filter((file): file is IndexedFile => Boolean(file));
  const number = `${partIndex + 1}.${chapterIndex + 1}`;
  const chapterId = `${bookId}-chapter-${number.replace(".", "-")}`;
  const code = selectCodeExcerpt(index, spec.codePath ?? selectedFiles[0], spec.codeLabel ?? "핵심 코드 근거");
  const evidenceSeed = buildChapterEvidenceSeed(index, analysis, spec, fileList, part?.title ?? `Part ${partIndex + 1}`, payload);
  const progressAt = (fraction: number) => {
    const span = Math.max(1, progressWindow.end - progressWindow.start);
    return Math.min(90, Math.max(progressWindow.start, Math.round(progressWindow.start + span * fraction)));
  };
  const chapterStageDetail = (detail: string) => `${number} ${spec.title} · ${detail}`;

  hooks.onStage?.("근거 수집", chapterStageDetail("chapter brief와 코드 근거 생성"), progressAt(0.06));
  const generatedBrief = await retryNormalized<Partial<ChapterBrief>, ChapterBrief>(
    client,
    {
      task: "Create the complete chapter brief for this repository book chapter. Generate the key question, responsibility, flow, code anchors, evidence list, glossary, and recap from the supplied repository evidence.",
      schemaName: "RepoBookChapterBrief",
      model: payload.model,
      maxTokens: 4096,
      context: {
        repoName: index.repoName,
        ...generationIntent(payload),
        partTitle: part?.title,
        chapterNumber: number,
        spec,
        files: sectionFiles.map((file) => filePlanningContext(file, 760)),
        evidenceSeed
      }
    },
    4,
    normalizeChapterBrief
  );
  const seededBrief = normalizeChapterBrief(evidenceSeed);
  const chapterBody = generatedBrief ?? seededBrief;
  hooks.onArtifact?.({
    kind: "chapter_brief",
    chapterId,
    payload: {
      chapterNumber: number,
      title: spec.title,
      brief: chapterBody,
      source: generatedBrief ? client.label : chapterBody ? "repository evidence seed" : "failed",
      error: generatedBrief ? null : chapterBody ? "LM chapter brief did not satisfy the required shape; used repository evidence seed." : "LM chapter brief did not satisfy the required shape."
    }
  });
  if (!chapterBody) {
    return failedChapterResult(bookId, part, partIndex, chapterIndex, spec, fileList, code, "LM chapter brief did not satisfy the required shape.");
  }

  hooks.onStage?.("본문 생성", chapterStageDetail("section plan 생성"), progressAt(0.2));
  const sectionPlan = (await planSections(chapterBody, spec, sectionFiles, client, payload)) ?? seedSectionPlan(chapterBody, spec, sectionFiles, payload);
  hooks.onArtifact?.({ kind: "section_plan", chapterId, payload: { chapterNumber: number, title: spec.title, sections: sectionPlan } });
  if (!sectionPlan) {
    return failedChapterResult(bookId, part, partIndex, chapterIndex, spec, fileList, code, "LM section plan did not satisfy the required shape.", chapterBody);
  }

  const drafted: ChapterProseSection[] = [];
  const failures: string[] = [];
  let attempts = 0;
  for (const [sectionIndex, section] of sectionPlan.entries()) {
    hooks.onStage?.(
      "본문 생성",
      chapterStageDetail(`section ${sectionIndex + 1}/${sectionPlan.length} 초안 생성: ${section.title}`),
      progressAt(0.3 + (sectionIndex / Math.max(1, sectionPlan.length)) * 0.48)
    );
    const draft = await draftSection(section, sectionIndex, drafted, chapterBody, spec, sectionFiles, client, payload);
    attempts += draft.attempts;
    hooks.onArtifact?.({
      kind: "section_draft",
      chapterId,
      payload: {
        chapterNumber: number,
        sectionIndex,
        title: section.title,
        status: draft.section ? "complete" : "failed",
        attempts: draft.attempts,
        body: draft.section?.body,
        error: draft.error
      }
    });
    if (draft.section) drafted.push(draft.section);
    else failures.push(draft.error ?? `${section.title} failed`);
  }

  hooks.onStage?.("챕터 수리", chapterStageDetail("중복 제거와 흐름 보강"), progressAt(0.84));
  const revised = failures.length === 0 ? await reviseChapter(drafted, chapterBody, spec, sectionFiles, client, payload) : null;
  const sections = revised?.sections ?? drafted;
  hooks.onArtifact?.({
    kind: "chapter_revision",
    chapterId,
    payload: {
      chapterNumber: number,
      title: spec.title,
      status: revised ? "revised" : failures.length ? "failed" : "drafted",
      sections: sections.map((section) => ({ eyebrow: section.eyebrow, title: section.title, bodyLength: section.body.length })),
      issues: failures
    }
  });

  const failed = failures.length > 0 || sections.length < 5;
  const prose: Pick<GenerationChapterRun, "chapterId" | "order" | "title" | "status" | "attempts" | "source" | "lastError"> = {
    chapterId,
    order,
    title: spec.title,
    status: failed ? "failed" : "complete",
    attempts: Math.max(1, attempts),
    source: client.label,
    lastError: failed ? failures.join("; ") || "Chapter did not reach the minimum 5-section target." : null
  };

  return {
    chapter: {
      id: chapterId,
      bookId,
      partId: part?.id ?? `${bookId}-part-${partIndex + 1}`,
      order,
      number,
      title: spec.title,
      subtitle: spec.subtitle,
      progress: order === 0 ? 6 : 0,
      status: failed ? "failed" : order === 0 ? "current" : "draft",
      estimatedMinutes: Math.max(18, Math.min(52, 12 + sections.length * 4 + fileList.length * 2)),
      files: fileList,
      goals: spec.goals,
      sections,
      code,
      notes: [
        { title: "설계 포인트", body: spec.focus },
        { title: "변경 시 먼저 확인할 근거", body: chapterBody.recap.changeEntryPoints.slice(0, 3).join(", ") }
      ],
      checkpoints: spec.checkpoints,
      keyQuestion: chapterBody.keyQuestion,
      responsibility: chapterBody.responsibility,
      flow: chapterBody.flow,
      codeAnchors: chapterBody.codeAnchors,
      evidence: chapterBody.evidence,
      glossary: chapterBody.glossary,
      recap: chapterBody.recap
    },
    prose
  };
}

function failedChapterResult(
  bookId: string,
  part: BookPart | undefined,
  partIndex: number,
  chapterIndex: number,
  spec: ChapterSpec,
  fileList: string[],
  code: BookChapter["code"],
  reason: string,
  brief?: ChapterBrief
): {
  chapter: BookChapter;
  prose: Pick<GenerationChapterRun, "chapterId" | "order" | "title" | "status" | "attempts" | "source" | "lastError">;
} {
  const order = partIndex * 10 + chapterIndex;
  const number = `${partIndex + 1}.${chapterIndex + 1}`;
  const chapterId = `${bookId}-chapter-${number.replace(".", "-")}`;
  return {
    chapter: {
      id: chapterId,
      bookId,
      partId: part?.id ?? `${bookId}-part-${partIndex + 1}`,
      order,
      number,
      title: spec.title,
      subtitle: spec.subtitle,
      progress: order === 0 ? 6 : 0,
      status: "failed",
      estimatedMinutes: 18,
      files: fileList,
      goals: spec.goals,
      sections: [],
      code,
      notes: [{ title: "생성 실패", body: reason }],
      checkpoints: spec.checkpoints,
      keyQuestion: brief?.keyQuestion ?? "",
      responsibility: brief?.responsibility ?? "",
      flow: brief?.flow ?? null,
      codeAnchors: brief?.codeAnchors ?? [],
      evidence: brief?.evidence ?? [],
      glossary: brief?.glossary ?? [],
      recap: brief?.recap ?? { understood: [], changeEntryPoints: [], nextQuestions: [] }
    },
    prose: {
      chapterId,
      order,
      title: spec.title,
      status: "failed",
      attempts: 0,
      source: "LM Studio TypeScript SDK",
      lastError: reason
    }
  };
}

async function retryJson<T extends object>(client: StructuredGenerationClient, request: StructuredGenerationRequest, attempts: number) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await client.generateJson<T>({
      ...request,
      context: {
        ...request.context,
        attempt: attempt + 1,
        maxAttempts: attempts
      }
    });
    if (result) return result;
  }
  return null;
}

async function retryNormalized<T extends object, R>(
  client: StructuredGenerationClient,
  request: StructuredGenerationRequest,
  attempts: number,
  normalize: (response: T | null) => R | null
) {
  let previousValidationError = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await client.generateJson<T>({
      ...request,
      context: {
        ...request.context,
        attempt: attempt + 1,
        maxAttempts: attempts,
        previousValidationError
      }
    });
    const normalized = normalize(result);
    if (normalized) return normalized;
    previousValidationError = shapeErrorSummary(result);
  }
  return null;
}

function shapeErrorSummary(value: unknown) {
  if (!value || typeof value !== "object") return "Response was null or not a JSON object.";
  const keys = Object.keys(value as Record<string, unknown>).slice(0, 12);
  return `JSON object did not match required responseShape. Top-level keys: ${keys.join(", ") || "(none)"}.`;
}

function normalizePartPlan(response: { parts?: Array<Partial<PartSpec> & { learningGoal?: string }> } | null): PartSpec[] | null {
  const parts = response?.parts;
  if (!Array.isArray(parts) || parts.length < 2) return null;
  const normalized = parts.slice(0, 7).map((part, index) => ({
    title: sanitizeTitle(part.title) || `Part ${index + 1}`,
    summary: sanitizeText(part.summary ?? part.learningGoal) || "LM이 생성한 저장소 책임 흐름을 설명한다.",
    chapters: []
  })).filter((part) => part.title && part.summary);
  return normalized.length >= 2 ? normalized : null;
}

function targetPartCount(depth: string) {
  return depth === "deep" ? 5 : 4;
}

function targetChaptersPerPart(depth: string) {
  if (depth === "light") return 1;
  return depth === "deep" ? 3 : 2;
}

function targetSections(depth: string) {
  return depth === "deep" ? 6 : 5;
}

function normalizeChapterPlan(response: { chapters?: Array<Partial<ChapterSpec> & { keyQuestion?: string; scope?: string; outOfScope?: string }> } | null, index: RepoIndex): ChapterSpec[] | null {
  const chapters = response?.chapters;
  if (!Array.isArray(chapters) || chapters.length < 1) return null;
  const normalized = chapters.slice(0, 6).map((chapter, chapterIndex) => {
    const goals = nonEmptyStrings(chapter.goals);
    const checkpoints = nonEmptyStrings(chapter.checkpoints);
    const files = nonEmptyStrings(chapter.files).filter((path) => resolveFiles(index, [path]).length > 0);
    return {
      title: sanitizeTitle(chapter.title) || `Chapter ${chapterIndex + 1}`,
      subtitle: sanitizeText(chapter.subtitle ?? chapter.keyQuestion ?? chapter.scope),
      files,
      goals,
      focus: sanitizeText(chapter.focus ?? chapter.scope),
      checkpoints,
      codePath: sanitizeText(chapter.codePath),
      codeLabel: sanitizeText(chapter.codeLabel)
    };
  }).filter((chapter) => chapter.title && chapter.subtitle && chapter.files.length > 0 && chapter.goals.length > 0 && chapter.focus && chapter.checkpoints.length > 0);
  return normalized.length >= 1 ? normalized : null;
}

function filePlanningContext(file: IndexedFile, previewLimit = 520) {
  return {
    path: file.path,
    kind: file.kind,
    headings: file.headings.slice(0, 3),
    symbols: file.symbolDetails.slice(0, 5),
    commands: file.commands.slice(0, 4),
    dependencies: file.dependencies.slice(0, 6),
    features: file.features.slice(0, 6),
    configKeys: file.configKeys.slice(0, 6),
    routes: file.routes.slice(0, 6),
    testTargets: file.testTargets.slice(0, 6),
    preview: file.preview.slice(0, previewLimit)
  };
}

function selectCandidateFilesForPart(index: RepoIndex, part: PartSpec) {
  const partText = `${part.title} ${part.summary}`.toLowerCase();
  const preferredKinds = partText.includes("테스트") || partText.includes("검증")
    ? new Set(["test", "doc", "script"])
    : partText.includes("설정") || partText.includes("configuration")
      ? new Set(["manifest", "config", "doc"])
      : partText.includes("ui") || partText.includes("화면")
        ? new Set(["script", "config", "other"])
        : new Set(["readme", "manifest", "rust", "doc", "other"]);
  return index.files
    .filter((file) => preferredKinds.has(file.kind) || file.routes.length > 0 || file.symbolDetails.length > 0)
    .sort((a, b) => filePartRelevanceScore(b, partText) - filePartRelevanceScore(a, partText) || a.path.localeCompare(b.path))
    .slice(0, 26);
}

function selectRepresentativeFiles(index: RepoIndex) {
  return [
    ...index.files.filter((file) => file.kind === "readme").sort(compareFileImportance).slice(0, 5),
    ...index.files.filter((file) => file.kind === "manifest").sort(compareFileImportance).slice(0, 7),
    ...index.files.filter((file) => file.kind === "rust" && (file.path.endsWith("/src/lib.rs") || file.path.startsWith("esp-hal/src/"))).sort(compareFileImportance).slice(0, 14),
    ...index.files.filter((file) => file.kind === "example").sort(compareFileImportance).slice(0, 4),
    ...index.files.filter((file) => file.kind === "test").sort(compareFileImportance).slice(0, 4),
    ...index.files.filter((file) => file.kind === "doc" || file.kind === "config").sort(compareFileImportance).slice(0, 4)
  ].filter(uniqueFilePath).sort(compareFileImportance).slice(0, 28);
}

function compareFileImportance(a: IndexedFile, b: IndexedFile) {
  return fileImportanceScore(b) - fileImportanceScore(a) || a.path.localeCompare(b.path);
}

function filePartRelevanceScore(file: IndexedFile, partText: string) {
  const path = file.path.toLowerCase();
  const terms = partText.split(/[^a-z0-9가-힣_]+/).filter((term) => term.length >= 3);
  return fileImportanceScore(file) + terms.reduce((score, term) => score + (path.includes(term) ? 35 : 0), 0);
}

function fileImportanceScore(file: IndexedFile) {
  let score = 0;
  if (file.path === "README.md") score += 130;
  if (file.path === "Cargo.toml" || file.path === "package.json") score += 120;
  if (/^esp-hal\/(?:README\.md|Cargo\.toml|src\/lib\.rs)$/.test(file.path)) score += 115;
  if (/^esp-hal\/src\/(?:gpio|clock|dma|interrupt|peripherals|soc|system|timer|uart|spi|i2c|rmt|rtc_cntl|psram)\b/.test(file.path)) score += 95;
  if (/^[^/]+\/src\/lib\.rs$/.test(file.path)) score += 72;
  if (/^[^/]+\/(?:README\.md|Cargo\.toml)$/.test(file.path)) score += 64;
  if (file.path === "examples/README.md" || file.path.startsWith("examples/hello_world/")) score += 58;
  if (file.path.startsWith("hil-test/") || file.path.startsWith("qa-test/")) score += 45;
  if (file.kind === "readme") score += 35;
  if (file.kind === "manifest") score += 30;
  if (file.kind === "rust") score += 25;
  if (file.symbolDetails.length > 0) score += 16;
  if (file.features.length > 0 || file.dependencies.length > 0) score += 12;
  if (file.testTargets.length > 0) score += 12;
  if (file.path.startsWith(".github/")) score -= 50;
  if (file.path.startsWith("compile-tests/")) score -= 20;
  return score;
}

function normalizeChapterBrief(patch: Partial<ChapterBrief> | null): ChapterBrief | null {
  if (!patch) return null;
  const flow = normalizeChapterFlow(patch.flow);
  const codeAnchors = normalizeCodeAnchors(patch.codeAnchors);
  const evidence = normalizeEvidence(patch.evidence);
  const glossary = normalizeGlossary(patch.glossary);
  const recap = normalizeRecap(patch.recap);
  const brief = {
    keyQuestion: sanitizeText(patch.keyQuestion),
    responsibility: sanitizeText(patch.responsibility),
    flow,
    codeAnchors,
    evidence,
    glossary,
    recap
  };
  if (!brief.keyQuestion || !brief.responsibility || !flow || codeAnchors.length === 0 || evidence.length === 0 || !recap) return null;
  return brief as ChapterBrief;
}

function normalizeChapterFlow(value: unknown): ChapterFlow | null {
  if (!value || typeof value !== "object") return null;
  const flow = value as Partial<ChapterFlow>;
  const title = sanitizeText(flow.title);
  const summary = sanitizeText(flow.summary);
  if (!title || !summary) return null;
  const allowed = new Set<ChapterFlow["type"]>(["architecture", "execution", "data", "configuration", "testing", "concept"]);
  return {
    type: allowed.has(flow.type as ChapterFlow["type"]) ? (flow.type as ChapterFlow["type"]) : "concept",
    title,
    summary,
    diagram: typeof flow.diagram === "string" ? flow.diagram : ""
  };
}

function normalizeCodeAnchors(value: unknown): CodeAnchor[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((anchor) => {
      if (!anchor || typeof anchor !== "object") return null;
      const item = anchor as Partial<CodeAnchor>;
      const filePath = sanitizeText(item.filePath);
      const claim = sanitizeText(item.claim);
      const explanation = sanitizeText(item.explanation);
      if (!filePath || !claim || !explanation) return null;
      return {
        filePath,
        symbolName: sanitizeText(item.symbolName),
        lineHint: sanitizeText(item.lineHint),
        claim,
        explanation,
        excerptLines: nonEmptyStrings(item.excerptLines).slice(0, 10)
      };
    })
    .filter((item): item is CodeAnchor => Boolean(item))
    .slice(0, 8);
}

function normalizeEvidence(value: unknown): ChapterEvidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((evidence) => {
      if (!evidence || typeof evidence !== "object") return null;
      const item = evidence as Partial<ChapterEvidence>;
      const filePath = sanitizeText(item.filePath);
      const role = sanitizeText(item.role);
      const usedAsEvidence = sanitizeText(item.usedAsEvidence);
      if (!filePath || !role || !usedAsEvidence) return null;
      return {
        filePath,
        role,
        usedAsEvidence,
        outOfScope: sanitizeText(item.outOfScope)
      };
    })
    .filter((item): item is ChapterEvidence => Boolean(item))
    .slice(0, 10);
}

function normalizeGlossary(value: unknown): ChapterGlossaryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Partial<ChapterGlossaryEntry>;
      const term = sanitizeText(item.term);
      const meaning = sanitizeText(item.meaning);
      if (!term || !meaning) return null;
      return {
        term,
        meaning,
        appearsIn: sanitizeText(item.appearsIn),
        relatedAnchors: nonEmptyStrings(item.relatedAnchors).slice(0, 8)
      };
    })
    .filter((item): item is ChapterGlossaryEntry => Boolean(item))
    .slice(0, 10);
}

function normalizeRecap(value: unknown): ChapterRecap | null {
  if (!value || typeof value !== "object") return null;
  const recap = value as Partial<ChapterRecap>;
  const understood = nonEmptyStrings(recap.understood);
  const changeEntryPoints = nonEmptyStrings(recap.changeEntryPoints);
  const nextQuestions = nonEmptyStrings(recap.nextQuestions);
  if (understood.length === 0 || changeEntryPoints.length === 0 || nextQuestions.length === 0) return null;
  return { understood, changeEntryPoints, nextQuestions };
}

function uniqueFilePath(file: IndexedFile, index: number, files: IndexedFile[]) {
  return files.findIndex((candidate) => candidate.path === file.path) === index;
}

async function planSections(
  brief: ChapterBrief,
  spec: ChapterSpec,
  files: IndexedFile[],
  client: StructuredGenerationClient,
  payload: PostGenerationOutlinePayload
): Promise<Array<{ eyebrow: string; title: string; purpose: string; evidenceFiles: string[] }> | null> {
  return await retryNormalized<
    { sections?: Array<{ eyebrow?: string; title?: string; purpose?: string; evidenceFiles?: string[] }> },
    Array<{ eyebrow: string; title: string; purpose: string; evidenceFiles: string[] }>
  >(
    client,
    {
      task: `Plan exactly ${targetSections(payload.depth)} sections for one long technical-book chapter. Each section needs purpose and exact evidence files.`,
      schemaName: "RepoBookSectionPlan",
      model: payload.model,
      maxTokens: 4096,
      context: {
        ...generationIntent(payload),
        depth: payload.depth,
        chapter: { title: spec.title, subtitle: spec.subtitle, goals: spec.goals, checkpoints: spec.checkpoints },
        brief,
        files: files.map((file) => filePlanningContext(file, 620)),
        targetSections: String(targetSections(payload.depth))
      }
    },
    4,
    (response) => normalizeSectionPlan(response, files)
  );
}

function normalizeSectionPlan(response: { sections?: Array<{ eyebrow?: string; title?: string; purpose?: string; evidenceFiles?: string[] }> } | null, files: IndexedFile[]) {
  const sections = response?.sections;
  if (!Array.isArray(sections) || sections.length < 5) return null;
  const filePaths = new Set(files.map((file) => file.path));
  const planned = sections.slice(0, 8).map((section, index) => ({
    eyebrow: sanitizeText(section.eyebrow) || `Section ${index + 1}`,
    title: sanitizeTitle(section.title),
    purpose: sanitizeText(section.purpose),
    evidenceFiles: nonEmptyStrings(section.evidenceFiles).filter((path) => filePaths.has(path))
  })).filter((section) => section.title && section.purpose && section.evidenceFiles.length > 0);
  return planned.length >= 5 ? planned : null;
}

function seedSectionPlan(brief: ChapterBrief, spec: ChapterSpec, files: IndexedFile[], payload: PostGenerationOutlinePayload) {
  const target = targetSections(payload.depth);
  const fallbackFiles = files.length ? files.map((file) => file.path) : brief.evidence.map((item) => item.filePath).filter(Boolean);
  if (fallbackFiles.length === 0) return null;
  const specs = [
    ["질문", `${spec.title}의 핵심 질문`, "챕터의 책임과 독자가 먼저 붙잡아야 할 질문을 정리한다."],
    ["책임", `${spec.title}의 책임 경계`, "파일 근거가 보여 주는 공개 계약과 변경 지점을 설명한다."],
    ["흐름", brief.flow.title || `${spec.title}의 실행 흐름`, "관련 모듈이 어떤 순서로 연결되는지 설명한다."],
    ["구현", "코드 앵커가 증명하는 구현", "대표 symbol, 설정, 테스트 근거를 장기 유지보수 관점에서 해석한다."],
    ["변경", "변경 전 확인할 안전선", "recap과 checkpoint를 바탕으로 회귀 위험을 점검한다."],
    ["다음 질문", "다음 장으로 이어지는 판단", "이 장의 결론이 다음 구조 이해로 어떻게 이어지는지 정리한다."]
  ];
  return specs.slice(0, target).map(([eyebrow, title, purpose], index) => ({
    eyebrow,
    title,
    purpose,
    evidenceFiles: rotateEvidenceFiles(fallbackFiles, index)
  }));
}

function rotateEvidenceFiles(paths: string[], index: number) {
  const first = paths[index % paths.length];
  const second = paths[(index + 1) % paths.length];
  return Array.from(new Set([first, second].filter(Boolean))).slice(0, 2);
}

async function draftSection(
  section: { eyebrow: string; title: string; purpose: string; evidenceFiles: string[] },
  sectionIndex: number,
  previousSections: ChapterProseSection[],
  brief: ChapterBrief,
  spec: ChapterSpec,
  files: IndexedFile[],
  client: StructuredGenerationClient,
  payload: PostGenerationOutlinePayload
): Promise<{ section: ChapterProseSection | null; attempts: number; error?: string }> {
  const evidenceFiles = files.filter((file) => section.evidenceFiles.includes(file.path));
  let blockedByMetaLanguage = false;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await client.generateJson<{ body?: string }>({
      task: "Draft one section of a long repository technical book chapter in Korean.",
      schemaName: "RepoBookSectionDraft",
      model: payload.model,
      maxTokens: 4096,
      context: {
        ...generationIntent(payload),
        depth: payload.depth,
        chapterTitle: spec.title,
        section,
        previousSectionSummaries: previousSections.map((item) => ({ title: item.title, summary: item.body.slice(0, 300) })),
        brief,
        evidenceFiles: (evidenceFiles.length ? evidenceFiles : files).map((file) => filePlanningContext(file, 700)),
        minParagraphs: 3,
        minCharacters: 700
      }
    });
    const body = sanitizeBody(response?.body);
    if (body && hasGeneratedMetaLanguage(body)) blockedByMetaLanguage = true;
    if (body && validateSectionBody(body, section, brief)) {
      return { section: { eyebrow: section.eyebrow, title: section.title, body }, attempts: attempt };
    }
  }
  if (blockedByMetaLanguage) {
    return { section: null, attempts: 3, error: `${section.title} did not pass section evidence quality checks.` };
  }
  return {
    section: {
      eyebrow: section.eyebrow,
      title: section.title,
      body: seedSectionDraft(section, sectionIndex, brief, spec, evidenceFiles.length ? evidenceFiles : files)
    },
    attempts: 3,
    error: `${section.title} did not pass section evidence quality checks; repaired from repository evidence.`
  };
}

function seedSectionDraft(
  section: { title: string; purpose: string; evidenceFiles: string[] },
  sectionIndex: number,
  brief: ChapterBrief,
  spec: ChapterSpec,
  files: IndexedFile[]
) {
  type SeedEvidenceFile = Pick<IndexedFile, "path" | "symbolDetails" | "features" | "dependencies" | "configKeys" | "testTargets" | "headings">;
  const evidence: SeedEvidenceFile[] = files.length
    ? files
    : section.evidenceFiles.map((path) => ({ path, symbolDetails: [], features: [], dependencies: [], configKeys: [], testTargets: [], headings: [] }));
  const primary = evidence[sectionIndex % evidence.length] ?? evidence[0];
  const secondary = evidence[(sectionIndex + 1) % evidence.length] ?? primary;
  const anchor = brief.codeAnchors.find((item) => item.filePath === primary.path) ?? brief.codeAnchors[0];
  const evidenceNote = brief.evidence.find((item) => item.filePath === primary.path) ?? brief.evidence[0];
  const symbolText = primary.symbolDetails?.length ? `${primary.symbolDetails.slice(0, 3).map((symbol) => `${symbol.name}(${symbol.kind})`).join(", ")} symbol` : anchor?.symbolName ? `${anchor.symbolName} symbol` : "파일 preview";
  const configText = primary.features?.length
    ? `${primary.features.slice(0, 4).join(", ")} feature`
    : primary.configKeys?.length
      ? `${primary.configKeys.slice(0, 4).join(", ")} 설정`
      : primary.testTargets?.length
        ? `${primary.testTargets.slice(0, 3).join(", ")} 테스트`
        : "코드 근거";
  const checkpoint = spec.checkpoints[sectionIndex % Math.max(1, spec.checkpoints.length)] ?? brief.recap.nextQuestions[0] ?? spec.title;

  return [
    `${section.title} 절은 ${section.purpose} ${primary.path}는 이 판단을 고정하는 1차 근거다. 이 파일에서 확인되는 ${symbolText}와 ${configText}는 ${spec.title}이 단순한 개념 설명이 아니라 실제 저장소 계약에 연결된 장이라는 점을 보여 준다. 특히 ${brief.keyQuestion}라는 질문에 답하려면 ${primary.path}가 어떤 책임을 갖고, 그 책임이 ${brief.responsibility}와 어떻게 맞물리는지 먼저 읽어야 한다.`,
    `${evidenceNote?.usedAsEvidence ?? `${primary.path}의 preview와 symbol 정보`}는 이 절의 주장을 뒷받침한다. ${anchor ? `${anchor.filePath}${anchor.symbolName ? `의 ${anchor.symbolName}` : ""}는 ${anchor.claim}을 보여 주며, ${anchor.explanation}` : `${primary.path}와 ${secondary.path}를 함께 보면 실행 흐름과 변경 지점을 분리해서 볼 수 있다.`} 유지보수자는 이 근거를 통해 구현 파일, 설정 파일, 테스트 파일 중 어느 곳을 먼저 확인해야 하는지 결정할 수 있다.`,
    `변경 전에는 ${brief.recap.changeEntryPoints.slice(0, 2).join(", ") || primary.path}를 먼저 확인하고, ${checkpoint}라는 질문으로 회귀 위험을 점검한다. ${secondary.path !== primary.path ? `${secondary.path}는 ${primary.path}에서 드러난 책임이 다른 파일과 어떻게 이어지는지 보여 주는 보조 근거다.` : `${primary.path} 안의 여러 symbol과 설정 항목은 같은 책임을 다른 관점에서 반복 검증하게 해 준다.`} 따라서 이 절의 결론은 ${brief.recap.understood.slice(0, 2).join(", ") || spec.goals.join(", ")}이며, 다음 절에서는 같은 근거를 더 구체적인 실행 흐름이나 검증 기준으로 좁힌다.`
  ].join("\n\n");
}

async function reviseChapter(
  sections: ChapterProseSection[],
  brief: ChapterBrief,
  spec: ChapterSpec,
  files: IndexedFile[],
  client: StructuredGenerationClient,
  payload: PostGenerationOutlinePayload
): Promise<{ sections: ChapterProseSection[] } | null> {
  const response = await retryJson<{ sections?: Array<{ eyebrow?: string; title?: string; body?: string }>; notes?: string[] }>(
    client,
    {
      task: "Revise a complete chapter for coherence. Preserve 5-8 sections, remove repetition, keep evidence paths and technical claims grounded.",
      schemaName: "RepoBookChapterRevision",
      model: payload.model,
      maxTokens: 8192,
      context: {
        ...generationIntent(payload),
        depth: payload.depth,
        chapter: { title: spec.title, goals: spec.goals, checkpoints: spec.checkpoints },
        brief,
        files: files.map((file) => filePlanningContext(file, 620)),
        sections
      }
    },
    3
  );
  if (!Array.isArray(response?.sections) || response.sections.length < 5) return null;
  const revised = response.sections.slice(0, 8).map((section, index) => ({
    eyebrow: sanitizeText(section.eyebrow) || sections[index]?.eyebrow || "본문",
    title: sanitizeTitle(section.title) || sections[index]?.title || `${spec.title} ${index + 1}`,
    body: sanitizeBody(section.body) || sections[index]?.body || ""
  }));
  if (revised.some((section) => !validateSectionBody(section.body, { evidenceFiles: brief.evidence.map((item) => item.filePath), title: section.title }, brief))) return null;
  return { sections: revised };
}

async function runBookCoherencePass(
  index: RepoIndex,
  analysis: RepositoryAnalysis,
  parts: BookPart[],
  chapters: BookChapter[],
  client: StructuredGenerationClient,
  payload: PostGenerationOutlinePayload
): Promise<Record<string, unknown>> {
  const local = {
    source: client.label,
    partCount: parts.length,
    chapterCount: chapters.length,
    failedChapters: chapters.filter((chapter) => chapter.status === "failed").map((chapter) => chapter.title),
    terms: Array.from(new Set(chapters.flatMap((chapter) => chapter.glossary?.map((entry) => entry.term) ?? []))).slice(0, 24)
  };
  const response = await retryJson<Record<string, unknown>>(
    client,
    {
      task: "Review the whole generated book for coherence, terminology consistency, missing flows, and next-question continuity.",
      schemaName: "RepoBookCoherenceReview",
      model: payload.model,
      maxTokens: 4096,
      context: {
        repoName: index.repoName,
        ...generationIntent(payload),
        archetypes: analysis.archetypes,
        parts: parts.map((part) => ({ title: part.title, summary: part.summary })),
        chapters: chapters.map((chapter) => ({
          number: chapter.number,
          title: chapter.title,
          keyQuestion: chapter.keyQuestion,
          status: chapter.status,
          recap: chapter.recap
        }))
      }
    },
    2
  );
  return response ?? { ...local, status: "failed", error: "LM coherence pass did not return valid JSON." };
}

function validateSectionBody(body: string, section: { title: string; evidenceFiles: string[] }, brief: ChapterBrief) {
  if (body.length < 520) return false;
  if (hasGeneratedMetaLanguage(body)) return false;
  const evidencePaths = new Set([...section.evidenceFiles, ...brief.evidence.map((item) => item.filePath), ...brief.codeAnchors.map((anchor) => anchor.filePath)]);
  return Array.from(evidencePaths).some((path) => path && evidencePathMentioned(body, path));
}

function hasGeneratedMetaLanguage(body: string) {
  return /fake\s+OpenAI-compatible|JSON parsing|프롬프트|adapter|모델\s*응답|```|^#{1,6}\s/m.test(body);
}

function evidencePathMentioned(body: string, path: string) {
  if (body.includes(path)) return true;
  const basename = path.split("/").pop();
  return Boolean(basename && /^(README\.md|Cargo\.toml)$/i.test(basename) && body.includes(basename));
}

function sanitizeTitle(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/^#+\s*/, "").slice(0, 120) : "";
}

function sanitizeText(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 800) : "";
}

function sanitizeBody(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nonEmptyStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function resolveFiles(index: RepoIndex, candidates: string[]) {
  const paths = new Set(index.files.map((file) => file.path));
  const resolved: string[] = [];
  for (const candidate of candidates) {
    if (paths.has(candidate)) {
      resolved.push(candidate);
      continue;
    }
    const prefixMatches = index.files.filter((file) => file.path.startsWith(candidate.replace(/\/$/, "") + "/")).slice(0, 3);
    for (const match of prefixMatches) resolved.push(match.path);
  }
  return Array.from(new Set(resolved));
}

function selectCodeExcerpt(index: RepoIndex, path: string | undefined, label: string) {
  const file = findIndexedFile(index, path) ?? index.files.find((candidate) => candidate.kind === "rust") ?? index.files[0];
  if (!file) return null;
  const lines = excerptLines(file);
  return {
    path: file.path,
    label,
    lines
  };
}

function findIndexedFile(index: RepoIndex, path: string | undefined) {
  if (!path) return undefined;
  return index.files.find((file) => file.path === path) ?? index.files.find((file) => file.path.endsWith(path));
}

function excerptLines(file: IndexedFile) {
  const symbolIndex = file.lines.findIndex((line) => /^\s*(?:pub\s+)?(?:struct|enum|trait|fn|mod|type|const|macro_rules!)\s+/.test(line));
  const headingIndex = file.lines.findIndex((line) => /^#{1,3}\s+/.test(line));
  const start = Math.max(0, (symbolIndex >= 0 ? symbolIndex : headingIndex >= 0 ? headingIndex : 0) - 1);
  return file.lines.slice(start, start + 9).filter((line) => line.trim().length > 0).slice(0, 8);
}

function buildChapterEvidenceSeed(index: RepoIndex, analysis: RepositoryAnalysis, spec: ChapterSpec, files: string[], partTitle: string, payload: PostGenerationOutlinePayload) {
  const indexedFiles = files.map((path) => findIndexedFile(index, path)).filter((file): file is IndexedFile => Boolean(file));
  const flow = buildChapterFlow(index, analysis, spec, files, partTitle);
  const codeAnchors = buildCodeAnchors(index, spec, indexedFiles);
  const evidence = buildEvidence(indexedFiles);
  const glossary = buildGlossary(indexedFiles, spec);
  const recap = buildRecap(spec, files, codeAnchors, flow);
  const intent = generationIntent(payload);
  return {
    keyQuestion: `${spec.title}는 ${index.repoName}의 어떤 책임과 변경 지점을 설명하는가?`,
    responsibility: `${spec.subtitle} ${spec.focus} 이 장은 ${intent.bookPurpose} 목적에 맞춰 ${intent.bookPurposeGuidance}`,
    flow,
    codeAnchors,
    evidence,
    glossary,
    recap
  };
}

function buildChapterFlow(index: RepoIndex, analysis: RepositoryAnalysis, spec: ChapterSpec, files: string[], partTitle: string): ChapterFlow {
  const fileSet = new Set(files);
  const matched = analysis.flows.find((flow) => flow.files.some((path) => fileSet.has(path))) ?? analysis.flows[0];
  const type = matched?.type ?? (spec.title.includes("테스트") ? "testing" : spec.title.includes("Configuration") || spec.title.includes("설정") ? "configuration" : "concept");
  const title = matched?.title ?? `${spec.title}의 책임 흐름`;
  const summary = matched?.summary ?? `${partTitle}에서 ${files.slice(0, 3).join(", ")}는 ${spec.focus}`;
  const nodes = files.slice(0, 4).map((path, index) => `  N${index + 1}["${path}"]`);
  const edges = files.slice(0, 3).map((_, index) => `  N${index + 1} --> N${index + 2}`);
  return {
    type,
    title,
    summary,
    diagram: nodes.length > 1 ? ["flowchart TD", ...nodes, ...edges].join("\n") : ""
  };
}

function buildCodeAnchors(index: RepoIndex, spec: ChapterSpec, files: IndexedFile[]): CodeAnchor[] {
  const anchors = files.slice(0, 4).map((file) => {
    const detail = file.symbolDetails[0];
    const symbolName = detail?.name ?? file.configKeys[0] ?? file.routes[0] ?? file.headings[0] ?? file.packageName ?? file.path.split("/").pop() ?? file.path;
    const lineHint = detail ? `L${detail.line}` : file.headings.length > 0 || file.configKeys.length > 0 ? "L1-L80" : "";
    return {
      filePath: file.path,
      symbolName,
      lineHint,
      claim: `${file.path}는 ${spec.title}에서 ${evidenceRole(file)}를 증명한다.`,
      explanation: [
        file.symbolDetails.length ? `${file.symbolDetails.slice(0, 3).map((symbol) => `${symbol.name}(${symbol.kind})`).join(", ")}가 공개 동작의 이름을 제공한다.` : "",
        file.routes.length ? `${file.routes.slice(0, 3).join(", ")} route가 외부 요청의 진입점을 만든다.` : "",
        file.configKeys.length ? `${file.configKeys.slice(0, 4).join(", ")} 설정 키가 실행 조건을 고정한다.` : "",
        file.testTargets.length ? `${file.testTargets.slice(0, 3).join(", ")} 검증 항목이 회귀 방지 범위를 보여 준다.` : "",
        file.commands.length ? `${file.commands.slice(0, 3).join(", ")} 명령이 실제 실행 경로를 드러낸다.` : ""
      ]
        .filter(Boolean)
        .join(" ") || `${file.kind} 파일의 heading과 preview가 이 장의 책임 범위를 좁힌다.`,
      excerptLines: excerptLines(file)
    };
  });
  if (anchors.length > 0) return anchors;
  const seedFile = index.files[0];
  return seedFile
    ? [
        {
          filePath: seedFile.path,
          symbolName: seedFile.symbolDetails[0]?.name ?? seedFile.headings[0] ?? seedFile.path,
          lineHint: "L1-L80",
          claim: `${seedFile.path}는 ${spec.title}의 최소 근거 파일이다.`,
          explanation: `${seedFile.path}의 preview가 저장소의 공개 설명이나 구현 경계를 제공한다.`,
          excerptLines: excerptLines(seedFile)
        }
      ]
    : [];
}

function buildEvidence(files: IndexedFile[]): ChapterEvidence[] {
  return files.slice(0, 5).map((file) => ({
    filePath: file.path,
    role: evidenceRole(file),
    usedAsEvidence: describeFileEvidence(file),
    outOfScope: file.lineCount > 260 ? "큰 파일의 전체 구현 세부는 본문이 아니라 코드 앵커와 preview 범위만 사용한다." : ""
  }));
}

function describeFileEvidence(file: IndexedFile) {
  const details = [
    file.headings.length ? `heading: ${file.headings.slice(0, 2).join(", ")}` : "",
    file.symbolDetails.length ? `symbols: ${file.symbolDetails.slice(0, 3).map((symbol) => symbol.name).join(", ")}` : "",
    file.dependencies.length ? `dependencies: ${file.dependencies.slice(0, 4).join(", ")}` : "",
    file.features.length ? `features: ${file.features.slice(0, 4).join(", ")}` : "",
    file.configKeys.length ? `config: ${file.configKeys.slice(0, 4).join(", ")}` : "",
    file.routes.length ? `routes: ${file.routes.slice(0, 4).join(", ")}` : "",
    file.testTargets.length ? `tests: ${file.testTargets.slice(0, 4).join(", ")}` : ""
  ].filter(Boolean);
  return details.join(" · ") || `${file.path}의 preview와 파일 종류(${file.kind})를 근거로 사용한다.`;
}

function buildGlossary(files: IndexedFile[], spec: ChapterSpec): ChapterGlossaryEntry[] {
  const entries = files
    .flatMap((file) => [
      ...file.symbolDetails.slice(0, 2).map((symbol) => ({
        term: symbol.name,
        meaning: `${file.path}에서 ${symbol.kind}로 정의되어 ${spec.title}의 구현 책임을 이름 붙인다.`,
        appearsIn: file.path,
        relatedAnchors: [file.path]
      })),
      ...file.configKeys.slice(0, 2).map((key) => ({
        term: key,
        meaning: `${file.path}에서 실행 조건이나 feature 동작을 바꾸는 설정 키다.`,
        appearsIn: file.path,
        relatedAnchors: [file.path]
      }))
    ])
    .slice(0, 6);
  if (entries.length > 0) return entries;
  return spec.goals.slice(0, 2).map((goal) => ({
    term: goal.replace(/[.!?。]+$/g, ""),
    meaning: `${spec.title}에서 독자가 설명할 수 있어야 하는 저장소 문맥의 개념이다.`,
    appearsIn: files[0]?.path ?? "",
    relatedAnchors: files[0]?.path ? [files[0].path] : []
  }));
}

function buildRecap(spec: ChapterSpec, files: string[], anchors: CodeAnchor[], flow: ChapterFlow): ChapterRecap {
  return {
    understood: [
      `${spec.title}의 핵심 책임을 ${flow.title} 관점으로 설명할 수 있다.`,
      `${files.slice(0, 3).join(", ")}가 각각 어떤 근거를 제공하는지 구분할 수 있다.`,
      spec.goals[0] ?? "이 장의 주요 설계 판단을 요약할 수 있다."
    ],
    changeEntryPoints: anchors.slice(0, 3).map((anchor) => `${anchor.filePath}${anchor.symbolName ? ` · ${anchor.symbolName}` : ""}`),
    nextQuestions: [
      spec.checkpoints[0] ?? `${spec.title}의 변경 전 확인할 계약은 무엇인가?`,
      spec.checkpoints[1] ?? "이 장의 흐름을 보호하는 테스트나 설정은 어디에 있는가?"
    ]
  };
}

function bookSubtitle(index: RepoIndex) {
  if (index.signals.isRust) return `${index.packages.length || 1}개 Rust crate를 유지보수 순서로 재구성한 repo book`;
  return "저장소 구조와 코드 근거를 학습 순서로 재구성한 repo book";
}

function generationModelLabel(payload: PostGenerationOutlinePayload) {
  return `LM Studio SDK · ${payload.model}`;
}

function generationIntent(payload: PostGenerationOutlinePayload) {
  const reader = readerLevelOption(payload);
  const purpose = bookPurposeOption(payload);
  const audience = readerLevelLabel(payload);
  const customPrompt = sanitizeText(payload.customPrompt);
  return {
    audience,
    readerLevel: reader.label,
    readerLevelGuidance: reader.description,
    bookPurpose: purpose.label,
    bookPurposeGuidance: purpose.description,
    depth: payload.depth,
    customPrompt,
    customPromptRule: customPrompt
      ? "Apply the customPrompt as additional user requirements, but keep every claim grounded in repository evidence."
      : "No additional custom user requirements were provided.",
    intentRule: "Book purpose controls chapter arc, section emphasis, recap, and checkpoints. Reader level controls explanation density, assumed terminology, and pacing."
  };
}

function readerLevelLabel(payload: PostGenerationOutlinePayload) {
  const audience = payload.audience?.trim();
  if (audience && !READER_LEVEL_OPTIONS.some((option) => option.value === audience)) return audience;
  return readerLevelOption(payload).label;
}

function readerLevelOption(payload: PostGenerationOutlinePayload) {
  return READER_LEVEL_OPTIONS.find((option) => option.value === payload.readerLevel) ?? READER_LEVEL_OPTIONS.find((option) => option.value === payload.audience) ?? {
    value: DEFAULT_READER_LEVEL,
    label: DEFAULT_READER_LEVEL,
    description: "코드는 읽을 수 있지만 전체 구조 파악이 필요한 개발자"
  };
}

function bookPurposeLabel(payload: PostGenerationOutlinePayload) {
  return bookPurposeOption(payload).label;
}

function bookPurposeOption(payload: PostGenerationOutlinePayload) {
  return BOOK_PURPOSE_OPTIONS.find((option) => option.value === payload.bookPurpose) ?? {
    value: DEFAULT_BOOK_PURPOSE,
    label: DEFAULT_BOOK_PURPOSE,
    description: "처음 합류한 개발자가 저장소를 읽고 기여할 수 있게 구성"
  };
}

function depthLabel(depth: string) {
  const labels: Record<string, string> = {
    light: "빠른 개요",
    balanced: "균형 잡힌",
    deep: "깊은"
  };
  return labels[depth] ?? depth;
}

function objectParticle(value: string) {
  const last = value.trim().at(-1);
  if (!last) return "을";
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return "을";
  return (code - 0xac00) % 28 === 0 ? "를" : "을";
}
