import {
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

type GenerationArtifactDraft = {
  kind: string;
  chapterId?: string | null;
  payload: Record<string, unknown>;
};

export type SynthesisHooks = {
  onStage?: (label: string, detail: string, progress: number) => void;
  onArtifact?: (artifact: GenerationArtifactDraft) => void;
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

export async function synthesizeRepoBook(payload: PostGenerationOutlinePayload, index: RepoIndex, hooks: SynthesisHooks = {}): Promise<SynthesizedRepoBook> {
  const bookId = `generated-${slugify(index.repoSlug)}-${Date.now()}`;
  hooks.onStage?.("저장소 분석", "archetype, entrypoint, flow evidence를 분석하는 중", 18);
  const analysis = analyzeRepository(index);
  const fallbackPartSpecs = index.signals.isEspHal ? espHalPartSpecs(index) : genericPartSpecs(index);
  const client = createStructuredGenerationClient();
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
  const partSpecs = await planParts(index, analysis, fallbackPartSpecs, client, payload, hooks);
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
    const plannedChapters = await planChapters(index, analysis, part, fallbackPartSpecs[partIndex]?.chapters ?? part.chapters, client, payload, hooks);
    for (const [chapterIndex, chapter] of plannedChapters.entries()) {
      const progressBase = 44 + Math.round(((chapters.length + 1) / Math.max(1, partSpecs.flatMap((item) => item.chapters).length)) * 42);
      hooks.onStage?.("본문 생성", `${part.title} · ${chapter.title}`, progressBase);
      const result = await makeChapterMultiStage(bookId, parts[partIndex], partIndex, chapterIndex, chapter, index, analysis, payload, client, hooks);
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
    subtitle: `${payload.audience} 독자를 위한 ${depthLabel(payload.depth)} 수준의 ${bookSubtitle(index)}`,
    repo: index.repoSlug,
    branch: index.branch,
    model: generationModelLabel(payload),
    updated: "방금 전",
    status: "draft",
    statusLabel: "초안",
    accent: index.signals.isEspHal ? "amber" : "cyan",
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
      label: client.available ? client.label : "local deterministic multi-stage",
      stats: client.stats
    }
  };
}

export function generationSteps(index: RepoIndex, prose?: SynthesizedRepoBook["prose"]): GenerationRun["steps"] {
  const analysis = analyzeRepository(index);
  const proseDetail =
    prose?.stats.mode === "lm-studio" && prose.stats.succeeded > 0 && prose.stats.failed > 0
      ? `${prose.stats.succeeded}/${prose.stats.attempted} structured LM calls succeeded; ${prose.stats.failed} calls repaired or failed`
      : prose?.stats.mode === "lm-studio" && prose.stats.succeeded > 0
      ? `${prose.stats.succeeded}/${prose.stats.attempted} structured LM calls succeeded`
      : prose?.stats.mode === "lm-studio" && prose.stats.failed > 0
        ? `LM Studio structured generation failed ${prose.stats.failed} times`
        : "local structured generation";
  return [
    { label: "저장소 분석", state: "complete", detail: `${index.repoSlug}${index.commit ? ` @ ${index.commit}` : ""} · ${index.files.length} files` },
    { label: "대단원 설계", state: "complete", detail: `${analysis.archetypes.join(", ")} · ${analysis.flows.length} flows` },
    { label: "소단원 설계", state: "complete", detail: `${index.signals.isEspHal ? "HAL" : "repository"} chapter plan` },
    { label: "근거 수집", state: "complete", detail: "chapter briefs, anchors, evidence slices" },
    { label: "본문 생성", state: "complete", detail: proseDetail },
    { label: "챕터 수리", state: "complete", detail: "section repair and revision pass complete" },
    { label: "책 일관성 점검", state: "complete", detail: "coherence pass complete" }
  ];
}

async function planParts(
  index: RepoIndex,
  analysis: RepositoryAnalysis,
  fallbackPartSpecs: PartSpec[],
  client: StructuredGenerationClient,
  payload: PostGenerationOutlinePayload,
  hooks: SynthesisHooks
): Promise<PartSpec[]> {
  const response = client.available
    ? await retryJson<{ parts?: Array<Partial<PartSpec> & { learningGoal?: string }> }>(
        client,
        {
          task: "Create a 4-7 part technical book plan for this repository.",
          schemaName: "RepoBookPartPlan",
          maxTokens: 4096,
          context: {
            repoName: index.repoName,
            audience: payload.audience,
            depth: payload.depth,
            archetypes: analysis.archetypes,
            summary: analysis.summary,
            flows: analysis.flows,
            entryFiles: analysis.entryFiles,
            topLevelDirs: index.topLevelDirs,
            readmes: index.files.filter((file) => file.kind === "readme").slice(0, 8).map(filePlanningContext),
            manifests: index.files.filter((file) => file.kind === "manifest").slice(0, 10).map(filePlanningContext),
            fallbackParts: fallbackPartSpecs.map((part) => ({ title: part.title, summary: part.summary }))
          }
        },
        3
      )
    : null;
  const planned = normalizePartPlan(response, fallbackPartSpecs);
  hooks.onArtifact?.({ kind: "part_plan", payload: { source: client.available && response ? client.label : "fallback seed", parts: planned.map((part) => ({ title: part.title, summary: part.summary })) } });
  return planned;
}

async function planChapters(
  index: RepoIndex,
  analysis: RepositoryAnalysis,
  part: PartSpec,
  fallbackChapters: ChapterSpec[],
  client: StructuredGenerationClient,
  payload: PostGenerationOutlinePayload,
  hooks: SynthesisHooks
): Promise<ChapterSpec[]> {
  const response = client.available
    ? await retryJson<{ chapters?: Array<Partial<ChapterSpec> & { keyQuestion?: string; scope?: string; outOfScope?: string }> }>(
        client,
        {
          task: "Create 3-6 chapters for one book part. Each chapter must have a key question, evidence files, scope, and checkpoints.",
          schemaName: "RepoBookChapterPlan",
          maxTokens: 4096,
          context: {
            repoName: index.repoName,
            audience: payload.audience,
            depth: payload.depth,
            part: { title: part.title, summary: part.summary },
            repositoryFlows: analysis.flows,
            candidateFiles: selectCandidateFilesForPart(index, part).map(filePlanningContext),
            fallbackChapters
          }
        },
        3
      )
    : null;
  const planned = normalizeChapterPlan(response, fallbackChapters);
  hooks.onArtifact?.({ kind: "chapter_plan", payload: { part: part.title, source: client.available && response ? client.label : "fallback seed", chapters: planned } });
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
  hooks: SynthesisHooks
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
  let chapterBody = buildChapterBody(index, analysis, spec, fileList, part?.title ?? `Part ${partIndex + 1}`);

  const brief = client.available
    ? await retryJson<Partial<ReturnType<typeof buildChapterBody>>>(
        client,
        {
          task: "Improve this chapter brief using the evidence. Preserve concrete file paths and avoid unsupported claims.",
          schemaName: "RepoBookChapterBrief",
          maxTokens: 4096,
          context: {
            repoName: index.repoName,
            partTitle: part?.title,
            chapterNumber: number,
            spec,
            files: sectionFiles.map(filePlanningContext),
            baseBrief: chapterBody
          }
        },
        3
      )
    : null;
  if (brief) chapterBody = mergeChapterBrief(chapterBody, brief);
  hooks.onArtifact?.({ kind: "chapter_brief", chapterId, payload: { chapterNumber: number, title: spec.title, brief: chapterBody, source: brief ? client.label : "local brief" } });

  const sectionPlan = await planSections(chapterBody, spec, sectionFiles, client, payload);
  hooks.onArtifact?.({ kind: "section_plan", chapterId, payload: { chapterNumber: number, title: spec.title, sections: sectionPlan } });

  const drafted: ChapterProseSection[] = [];
  const failures: string[] = [];
  let attempts = 0;
  for (const [sectionIndex, section] of sectionPlan.entries()) {
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
    source: client.available ? client.label : "local deterministic multi-stage",
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

function normalizePartPlan(response: { parts?: Array<Partial<PartSpec> & { learningGoal?: string }> } | null, fallback: PartSpec[]): PartSpec[] {
  const parts = response?.parts;
  if (!Array.isArray(parts) || parts.length < 2) return fallback;
  return parts.slice(0, 7).map((part, index) => ({
    title: sanitizeTitle(part.title) || fallback[index]?.title || `Part ${index + 1}`,
    summary: sanitizeText(part.summary ?? part.learningGoal) || fallback[index]?.summary || "저장소 책임을 기술서 흐름으로 설명한다.",
    chapters: fallback[index]?.chapters ?? fallback[0]?.chapters ?? []
  }));
}

function normalizeChapterPlan(response: { chapters?: Array<Partial<ChapterSpec> & { keyQuestion?: string; scope?: string; outOfScope?: string }> } | null, fallback: ChapterSpec[]): ChapterSpec[] {
  const chapters = response?.chapters;
  if (!Array.isArray(chapters) || chapters.length < 2) return fallback;
  return chapters.slice(0, 6).map((chapter, index) => {
    const fallbackChapter = fallback[index] ?? fallback[0];
    const goals = nonEmptyStrings(chapter.goals).length ? nonEmptyStrings(chapter.goals) : fallbackChapter?.goals ?? [];
    const checkpoints = nonEmptyStrings(chapter.checkpoints).length ? nonEmptyStrings(chapter.checkpoints) : fallbackChapter?.checkpoints ?? [];
    return {
      title: sanitizeTitle(chapter.title) || fallbackChapter?.title || `Chapter ${index + 1}`,
      subtitle: sanitizeText(chapter.subtitle ?? chapter.keyQuestion ?? chapter.scope) || fallbackChapter?.subtitle || "저장소 책임과 구현 흐름을 설명합니다.",
      files: nonEmptyStrings(chapter.files).length ? nonEmptyStrings(chapter.files) : fallbackChapter?.files ?? [],
      goals: goals.length ? goals : ["저장소 책임을 설명한다.", "구현 근거와 변경 지점을 연결한다."],
      focus: sanitizeText(chapter.focus ?? chapter.scope) || fallbackChapter?.focus || "이 장은 관련 파일이 맡는 시스템 책임과 변경 위험을 설명한다.",
      checkpoints: checkpoints.length ? checkpoints : ["핵심 근거 설명", "변경 지점 확인"],
      codePath: sanitizeText(chapter.codePath) || fallbackChapter?.codePath,
      codeLabel: sanitizeText(chapter.codeLabel) || fallbackChapter?.codeLabel
    };
  });
}

function filePlanningContext(file: IndexedFile) {
  return {
    path: file.path,
    kind: file.kind,
    headings: file.headings.slice(0, 4),
    symbols: file.symbolDetails.slice(0, 8),
    commands: file.commands.slice(0, 6),
    dependencies: file.dependencies.slice(0, 8),
    features: file.features.slice(0, 8),
    configKeys: file.configKeys.slice(0, 8),
    routes: file.routes.slice(0, 8),
    testTargets: file.testTargets.slice(0, 8),
    preview: file.preview.slice(0, 900)
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
    .slice(0, 40);
}

function mergeChapterBrief(base: ReturnType<typeof buildChapterBody>, patch: Partial<ReturnType<typeof buildChapterBody>>) {
  return {
    ...base,
    keyQuestion: sanitizeText(patch.keyQuestion) || base.keyQuestion,
    responsibility: sanitizeText(patch.responsibility) || base.responsibility,
    flow: patch.flow && patch.flow.title && patch.flow.summary ? patch.flow : base.flow,
    codeAnchors: Array.isArray(patch.codeAnchors) && patch.codeAnchors.length ? patch.codeAnchors : base.codeAnchors,
    evidence: Array.isArray(patch.evidence) && patch.evidence.length ? patch.evidence : base.evidence,
    glossary: Array.isArray(patch.glossary) && patch.glossary.length ? patch.glossary : base.glossary,
    recap: patch.recap && (patch.recap.understood?.length || patch.recap.changeEntryPoints?.length || patch.recap.nextQuestions?.length) ? patch.recap : base.recap
  };
}

async function planSections(
  brief: ReturnType<typeof buildChapterBody>,
  spec: ChapterSpec,
  files: IndexedFile[],
  client: StructuredGenerationClient,
  payload: PostGenerationOutlinePayload
): Promise<Array<{ eyebrow: string; title: string; purpose: string; evidenceFiles: string[] }>> {
  const local = localSectionPlan(brief, spec, files);
  if (!client.available) return local;
  const response = await retryJson<{ sections?: Array<{ eyebrow?: string; title?: string; purpose?: string; evidenceFiles?: string[] }> }>(
    client,
    {
      task: "Plan 5-8 sections for one long technical-book chapter. Each section needs purpose and evidence files.",
      schemaName: "RepoBookSectionPlan",
      maxTokens: 4096,
      context: {
        audience: payload.audience,
        depth: payload.depth,
        chapter: { title: spec.title, subtitle: spec.subtitle, goals: spec.goals, checkpoints: spec.checkpoints },
        brief,
        files: files.map(filePlanningContext),
        targetSections: "5-8"
      }
    },
    3
  );
  const sections = response?.sections;
  if (!Array.isArray(sections) || sections.length < 5) return local;
  return sections.slice(0, 8).map((section, index) => ({
    eyebrow: sanitizeText(section.eyebrow) || local[index]?.eyebrow || `Section ${index + 1}`,
    title: sanitizeTitle(section.title) || local[index]?.title || `${spec.title} ${index + 1}`,
    purpose: sanitizeText(section.purpose) || local[index]?.purpose || brief.responsibility,
    evidenceFiles: nonEmptyStrings(section.evidenceFiles).length ? nonEmptyStrings(section.evidenceFiles) : local[index]?.evidenceFiles ?? files.slice(0, 2).map((file) => file.path)
  }));
}

function localSectionPlan(brief: ReturnType<typeof buildChapterBody>, spec: ChapterSpec, files: IndexedFile[]) {
  const evidenceFiles = files.map((file) => file.path);
  return [
    { eyebrow: "핵심 질문", title: brief.keyQuestion, purpose: "이 장이 답해야 할 시스템 질문과 책임을 고정한다.", evidenceFiles: evidenceFiles.slice(0, 3) },
    { eyebrow: "책임 경계", title: `${spec.title}의 저장소 책임`, purpose: brief.responsibility, evidenceFiles: evidenceFiles.slice(0, 4) },
    { eyebrow: "흐름", title: brief.flow?.title ?? `${spec.title}의 실행 흐름`, purpose: brief.flow?.summary ?? spec.focus, evidenceFiles: evidenceFiles.slice(0, 4) },
    { eyebrow: "핵심 구현", title: "코드 앵커가 증명하는 구현 계약", purpose: "공개 symbol, route, config key, test target을 본문 주장과 연결한다.", evidenceFiles: brief.codeAnchors.slice(0, 4).map((anchor) => anchor.filePath) },
    { eyebrow: "변경 판단", title: `${spec.title}를 변경할 때의 안전선`, purpose: "변경 전 확인할 파일과 깨질 수 있는 계약을 설명한다.", evidenceFiles: brief.recap.changeEntryPoints.map((entry) => entry.split(" · ")[0]).slice(0, 4) },
    { eyebrow: "검증과 다음 질문", title: "이 장에서 얻은 판단 기준", purpose: "체크포인트, recap, 다음 장으로 이어질 질문을 정리한다.", evidenceFiles: evidenceFiles.slice(-3) }
  ].map((section) => ({
    ...section,
    evidenceFiles: section.evidenceFiles.length ? Array.from(new Set(section.evidenceFiles)) : evidenceFiles.slice(0, 2)
  }));
}

async function draftSection(
  section: { eyebrow: string; title: string; purpose: string; evidenceFiles: string[] },
  sectionIndex: number,
  previousSections: ChapterProseSection[],
  brief: ReturnType<typeof buildChapterBody>,
  spec: ChapterSpec,
  files: IndexedFile[],
  client: StructuredGenerationClient,
  payload: PostGenerationOutlinePayload
): Promise<{ section: ChapterProseSection | null; attempts: number; error?: string }> {
  const evidenceFiles = files.filter((file) => section.evidenceFiles.includes(file.path));
  if (!client.available) {
    return { section: localSectionDraft(section, sectionIndex, previousSections, brief, spec, evidenceFiles.length ? evidenceFiles : files), attempts: 1 };
  }
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await client.generateJson<{ body?: string }>({
      task: "Draft one section of a long repository technical book chapter in Korean.",
      schemaName: "RepoBookSectionDraft",
      maxTokens: 4096,
      context: {
        audience: payload.audience,
        depth: payload.depth,
        chapterTitle: spec.title,
        section,
        previousSectionSummaries: previousSections.map((item) => ({ title: item.title, summary: item.body.slice(0, 300) })),
        brief,
        evidenceFiles: (evidenceFiles.length ? evidenceFiles : files).map(filePlanningContext),
        minParagraphs: 3,
        minCharacters: 700
      }
    });
    const body = sanitizeBody(response?.body);
    if (body && validateSectionBody(body, section, brief)) {
      return { section: { eyebrow: section.eyebrow, title: section.title, body }, attempts: attempt };
    }
  }
  return { section: null, attempts: 3, error: `${section.title} did not pass section evidence quality checks.` };
}

function localSectionDraft(
  section: { eyebrow: string; title: string; purpose: string; evidenceFiles: string[] },
  sectionIndex: number,
  previousSections: ChapterProseSection[],
  brief: ReturnType<typeof buildChapterBody>,
  spec: ChapterSpec,
  files: IndexedFile[]
): ChapterProseSection {
  const evidence = brief.evidence.filter((item) => section.evidenceFiles.includes(item.filePath)).slice(0, 3);
  const anchors = brief.codeAnchors.filter((anchor) => section.evidenceFiles.includes(anchor.filePath)).slice(0, 3);
  const evidenceText = evidence.length
    ? evidence.map((item) => `${item.filePath}는 ${item.role} 근거로 ${item.usedAsEvidence}`).join(" ")
    : files.slice(0, 3).map((file) => `${file.path}는 ${evidenceRole(file)} 근거를 제공한다`).join(" ");
  const anchorText = anchors.length
    ? anchors.map((anchor) => `${anchor.filePath}${anchor.symbolName ? `의 ${anchor.symbolName}` : ""}는 ${anchor.claim}`).join(" ")
    : brief.codeAnchors.slice(0, 2).map((anchor) => `${anchor.filePath}는 ${anchor.explanation}`).join(" ");
  const previous = previousSections.at(-1)?.title;
  const next = spec.checkpoints[sectionIndex % Math.max(1, spec.checkpoints.length)] ?? spec.goals[0] ?? "핵심 책임을 설명한다";
  return {
    eyebrow: section.eyebrow,
    title: section.title,
    body: [
      `${section.purpose} ${brief.keyQuestion}라는 질문은 ${spec.title}를 단순 파일 묶음이 아니라 ${brief.responsibility}라는 저장소 책임으로 이해하게 만든다. ${evidenceText}`,
      `${anchorText} 이 근거들은 본문 주장이 실제 파일, symbol, 설정 또는 테스트와 연결되어 있음을 보여 준다. ${previous ? `앞 절의 ${previous}에서 세운 책임 경계는 여기서 더 구체적인 구현 계약으로 내려온다.` : "첫 절에서는 이 장 전체의 기준이 되는 공개 표면과 책임 경계를 먼저 확정한다."}`,
      `변경 시에는 ${brief.recap.changeEntryPoints.slice(0, 3).join(", ") || section.evidenceFiles.join(", ")}를 기준으로 영향 범위를 판단한다. 이 절을 마치면 ${next}라는 체크포인트를 파일 근거와 함께 설명할 수 있어야 하며, 그 설명이 다음 절의 구현 흐름으로 이어진다.`
    ].join("\n\n")
  };
}

async function reviseChapter(
  sections: ChapterProseSection[],
  brief: ReturnType<typeof buildChapterBody>,
  spec: ChapterSpec,
  files: IndexedFile[],
  client: StructuredGenerationClient,
  payload: PostGenerationOutlinePayload
): Promise<{ sections: ChapterProseSection[] } | null> {
  if (!client.available) return { sections };
  const response = await retryJson<{ sections?: Array<{ eyebrow?: string; title?: string; body?: string }>; notes?: string[] }>(
    client,
    {
      task: "Revise a complete chapter for coherence. Preserve 5-8 sections, remove repetition, keep evidence paths and technical claims grounded.",
      schemaName: "RepoBookChapterRevision",
      maxTokens: 8192,
      context: {
        audience: payload.audience,
        depth: payload.depth,
        chapter: { title: spec.title, goals: spec.goals, checkpoints: spec.checkpoints },
        brief,
        files: files.map(filePlanningContext),
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
    source: client.available ? client.label : "local coherence check",
    partCount: parts.length,
    chapterCount: chapters.length,
    failedChapters: chapters.filter((chapter) => chapter.status === "failed").map((chapter) => chapter.title),
    terms: Array.from(new Set(chapters.flatMap((chapter) => chapter.glossary?.map((entry) => entry.term) ?? []))).slice(0, 24)
  };
  if (!client.available) return local;
  const response = await retryJson<Record<string, unknown>>(
    client,
    {
      task: "Review the whole generated book for coherence, terminology consistency, missing flows, and next-question continuity.",
      schemaName: "RepoBookCoherenceReview",
      maxTokens: 4096,
      context: {
        repoName: index.repoName,
        audience: payload.audience,
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
  return response ?? local;
}

function validateSectionBody(body: string, section: { title: string; evidenceFiles: string[] }, brief: ReturnType<typeof buildChapterBody>) {
  if (body.length < 520) return false;
  if (/fake\s+OpenAI-compatible|JSON parsing|프롬프트|adapter|모델\s*응답|```|^#{1,6}\s/m.test(body)) return false;
  const evidencePaths = new Set([...section.evidenceFiles, ...brief.evidence.map((item) => item.filePath), ...brief.codeAnchors.map((anchor) => anchor.filePath)]);
  return Array.from(evidencePaths).some((path) => path && body.includes(path));
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

function espHalPartSpecs(index: RepoIndex): PartSpec[] {
  const chips = index.signals.chips.length ? index.signals.chips.join(", ") : "ESP32 계열";
  const peripherals = index.signals.peripherals.slice(0, 10).join(", ") || "GPIO, DMA, SPI, UART";
  return [
    {
      title: "Part I. esp-hal 지형도",
      summary: "저장소가 어떤 칩과 crate를 다루는지, HAL 책의 표지와 목차를 먼저 세운다.",
      chapters: [
        {
          title: "Bare-metal Rust HAL의 약속",
          subtitle: `${chips}를 no_std Rust로 다루기 위해 esp-hal이 어디까지 책임지는지 읽습니다.`,
          files: ["README.md", "esp-hal/README.md", "esp-hal/Cargo.toml"],
          goals: ["지원 칩과 no_std 범위를 구분한다.", "esp-hal이 embedded-hal trait와 어떤 관계인지 파악한다.", "사용자용 문서와 crate README의 역할을 분리한다."],
          focus: "esp-hal은 단일 crate 설명보다 칩 매트릭스, peripheral coverage, release policy가 중요하다. 첫 장은 API 사용법보다 지원 범위와 안정성 계약을 먼저 세운다.",
          checkpoints: ["지원 칩 목록 확인", "no_std HAL 범위 요약", "stable/unstable API 경계 표시"],
          codePath: "esp-hal/README.md",
          codeLabel: "HAL 지원 범위"
        },
        {
          title: "워크스페이스와 crate 생태계",
          subtitle: "루트 Cargo workspace, 제외된 crate, HAL 주변 crate들이 하나의 SDK처럼 움직이는 구조를 읽습니다.",
          files: ["Cargo.toml", "esp-config/Cargo.toml", "esp-println/Cargo.toml", "esp-backtrace/Cargo.toml", "esp-radio/Cargo.toml"],
          goals: ["workspace members와 exclude 목록의 의미를 설명한다.", "esp-config, esp-println, esp-backtrace의 보조 역할을 구분한다.", "crate별 README를 책의 부록으로 배치한다."],
          focus: "esp-hal은 크레이트 하나가 아니라 bare-metal 개발 스택이다. Cargo.toml의 include/exclude 구조를 먼저 읽어야 예제와 테스트가 왜 별도 crate처럼 배치되는지 이해할 수 있다.",
          checkpoints: ["핵심 crate 5개 이름 추출", "workspace exclude 이유 추론", "사용자 crate와 개발 도구 crate 분리"],
          codePath: "Cargo.toml",
          codeLabel: "workspace 구성"
        }
      ]
    },
    {
      title: "Part II. 부팅, 칩 추상화, 시스템 초기화",
      summary: "no_std entry, peripherals singleton, clock/reset, 아키텍처별 runtime을 연결한다.",
      chapters: [
        {
          title: "no_std 엔트리와 peripheral ownership",
          subtitle: "lib.rs와 peripherals 모듈이 안전한 singleton 접근을 어떻게 책의 첫 코드 계약으로 만드는지 읽습니다.",
          files: ["esp-hal/src/lib.rs", "esp-hal/src/peripherals/mod.rs", "esp-hal/src/system.rs"],
          goals: ["crate-level no_std 선언과 feature gate를 확인한다.", "peripheral singleton ownership 패턴을 설명한다.", "초기화 API가 사용자 main과 만나는 지점을 찾는다."],
          focus: "HAL 독자는 먼저 '누가 peripheral을 소유하는가'를 이해해야 한다. 이 장은 타입 안전성, PAC re-export, 초기화 진입점을 하나의 계약으로 묶는다.",
          checkpoints: ["no_std 선언 확인", "peripherals 모듈의 공개 타입 찾기", "초기화 함수와 system split 연결"],
          codePath: "esp-hal/src/lib.rs",
          codeLabel: "crate 진입점"
        },
        {
          title: "Clock, reset, system bring-up",
          subtitle: "clock tree와 system control이 peripheral driver보다 먼저 확정되어야 하는 이유를 읽습니다.",
          files: ["esp-hal/src/clock/mod.rs", "esp-hal/src/system.rs", "esp-hal/src/time.rs", "esp-hal/src/delay.rs"],
          goals: ["clock 설정이 driver API에 주는 제약을 설명한다.", "delay/time 타입이 clock 계약을 어떻게 감싼는지 확인한다.", "system module의 reset/enable 책임을 구분한다."],
          focus: "embedded HAL 책에서 clock은 배경 설정이 아니라 모든 driver 장의 전제다. esp-hal에서는 clock/time/delay를 한 장으로 묶어 이후 peripheral 장의 공통 조건으로 만든다.",
          checkpoints: ["clock source와 frequency 타입 확인", "delay와 time API 관계 정리", "peripheral enable/reset 호출 지점 표시"],
          codePath: "esp-hal/src/clock/mod.rs",
          codeLabel: "clock 계약"
        },
        {
          title: "Xtensa와 RISC-V runtime 경계",
          subtitle: "ESP32 계열이 두 아키텍처를 품기 때문에 runtime, interrupt, backtrace가 어떻게 갈라지는지 읽습니다.",
          files: ["esp-riscv-rt/src/lib.rs", "xtensa-lx-rt/src/lib.rs", "esp-backtrace/src/lib.rs", "esp-hal/src/interrupt/mod.rs"],
          goals: ["RISC-V와 Xtensa runtime crate를 구분한다.", "interrupt abstraction이 아키텍처별 파일로 나뉘는 이유를 설명한다.", "backtrace/debug 지원이 HAL과 어디서 만나는지 찾는다."],
          focus: "esp-hal의 난이도는 peripheral 수보다 아키텍처 이중성에서 나온다. 이 장은 runtime crate와 interrupt module을 함께 읽어 칩별 분기를 책의 구조로 노출한다.",
          checkpoints: ["riscv/xtensa runtime 파일 찾기", "interrupt 아키텍처별 구현 확인", "debug/backtrace crate 역할 요약"],
          codePath: "esp-hal/src/interrupt/mod.rs",
          codeLabel: "interrupt 추상화"
        }
      ]
    },
    {
      title: "Part III. Peripheral driver를 읽는 법",
      summary: `${peripherals} 같은 driver를 ownership, blocking/async, DMA 세 축으로 읽는다.`,
      chapters: [
        {
          title: "GPIO, IO mux, interrupt의 기본 문법",
          subtitle: "가장 자주 만나는 GPIO driver에서 pin type, mode 전환, interrupt 흐름을 익힙니다.",
          files: ["esp-hal/src/gpio/mod.rs", "esp-hal/src/gpio/interrupt.rs", "esp-hal/src/gpio/embedded_hal_impls.rs", "examples/interrupt/gpio/Cargo.toml"],
          goals: ["pin mode와 type-state 패턴을 확인한다.", "embedded-hal trait 구현 위치를 찾는다.", "GPIO interrupt 예제를 driver 코드와 연결한다."],
          focus: "GPIO는 HAL 전체의 축소판이다. type-state, trait impl, interrupt, async 확장이 모두 드러나므로 이 장에서 driver 독해의 기본 문법을 확정한다.",
          checkpoints: ["pin 타입과 mode 전환 API 표시", "embedded-hal impl 파일 확인", "interrupt 예제와 driver 연결"],
          codePath: "esp-hal/src/gpio/mod.rs",
          codeLabel: "GPIO driver"
        },
        {
          title: "Timer, delay, systimer로 시간 모델 잡기",
          subtitle: "blocking delay와 hardware timer가 async runtime 이전에 어떤 시간 기준을 제공하는지 읽습니다.",
          files: ["esp-hal/src/timer/mod.rs", "esp-hal/src/timer/systimer.rs", "esp-hal/src/timer/timg.rs", "esp-hal/src/delay.rs"],
          goals: ["timer group과 systimer 역할을 구분한다.", "delay abstraction과 hardware timer의 차이를 설명한다.", "시간 타입이 examples에서 쓰이는 흐름을 찾는다."],
          focus: "시간 모델을 이해하면 Embassy/async 장이 쉬워진다. timer와 delay를 먼저 읽어 blocking 예제와 async executor가 공유하는 시간 감각을 만든다.",
          checkpoints: ["systimer/timg 파일 비교", "delay API 사용처 찾기", "timer interrupt 가능성 표시"],
          codePath: "esp-hal/src/timer/mod.rs",
          codeLabel: "timer module"
        },
        {
          title: "DMA와 버퍼 ownership",
          subtitle: "SPI/I2S/RMT 같은 고속 peripheral을 이해하기 위해 DMA buffer와 transfer ownership을 먼저 읽습니다.",
          files: ["esp-hal/src/dma/mod.rs", "esp-hal/src/dma/buffers.rs", "esp-hal/src/spi/mod.rs", "esp-hal/src/i2s/mod.rs", "esp-hal/src/rmt.rs"],
          goals: ["DMA channel과 buffer 타입의 책임을 설명한다.", "transfer 시작/완료 시 ownership 이동을 파악한다.", "SPI/I2S/RMT driver가 DMA를 공유하는 방식을 찾는다."],
          focus: "고급 HAL 품질은 DMA API에서 드러난다. esp-hal 책은 peripheral별 API를 나열하지 않고 DMA ownership을 중심 장으로 올려 고속 I/O를 한 번에 이해하게 한다.",
          checkpoints: ["DMA buffer 타입 찾기", "transfer 완료 API 확인", "SPI/I2S/RMT와 DMA 연결"],
          codePath: "esp-hal/src/dma/mod.rs",
          codeLabel: "DMA core"
        },
        {
          title: "UART, SPI, I2C의 trait와 transaction",
          subtitle: "대표 통신 driver가 embedded-hal trait, blocking API, async API를 어떻게 함께 제공하는지 비교합니다.",
          files: ["esp-hal/src/uart/mod.rs", "esp-hal/src/spi/mod.rs", "esp-hal/src/i2c/mod.rs", "examples/async/embassy_spi/Cargo.toml", "examples/async/embassy_serial/Cargo.toml"],
          goals: ["UART/SPI/I2C driver의 공통 생성 패턴을 찾는다.", "embedded-hal trait 구현을 비교한다.", "async 예제가 같은 driver를 어떻게 소비하는지 확인한다."],
          focus: "통신 driver는 사용자 경험의 대부분을 차지한다. 세 driver를 한 장에서 비교하면 esp-hal API가 일관성을 어디까지 유지하는지 평가할 수 있다.",
          checkpoints: ["세 driver init API 비교", "trait impl 위치 찾기", "async 예제 연결"],
          codePath: "esp-hal/src/spi/mod.rs",
          codeLabel: "SPI driver"
        }
      ]
    },
    {
      title: "Part IV. Async, radio, examples",
      summary: "Embassy 통합, Wi-Fi/BLE/radio crate, examples를 실전 레시피로 읽는다.",
      chapters: [
        {
          title: "Embassy async 통합",
          subtitle: "asynch module과 async examples가 blocking HAL 위에 어떤 실행 모델을 얹는지 읽습니다.",
          files: ["esp-hal/src/asynch.rs", "examples/async/embassy_hello_world/Cargo.toml", "examples/async/embassy_multicore/Cargo.toml"],
          goals: ["async feature와 executor 전제를 확인한다.", "blocking driver와 async wrapper의 경계를 설명한다.", "multicore async 예제가 system 장과 이어지는 지점을 찾는다."],
          focus: "async는 별도 제품이 아니라 HAL 사용성의 확장이다. esp-hal에서는 Embassy 예제를 본문 뒤쪽에 배치해 앞 장의 ownership/clock/interrupt 지식을 재사용하게 한다.",
          checkpoints: ["asynch module 공개 API 확인", "Embassy 예제 dependency 확인", "multicore 예제와 system 연결"],
          codePath: "esp-hal/src/asynch.rs",
          codeLabel: "async support"
        },
        {
          title: "Wi-Fi, BLE, IEEE 802.15.4는 왜 별도 축인가",
          subtitle: "esp-radio와 PHY 계층, radio examples를 HAL driver와 구분해 읽습니다.",
          files: ["esp-radio/README.md", "esp-radio/src/lib.rs", "esp-phy/README.md", "examples/wifi/embassy_access_point/Cargo.toml", "examples/ble/scanner/Cargo.toml"],
          goals: ["radio stack이 core esp-hal과 분리된 이유를 설명한다.", "PHY crate와 radio crate의 책임을 구분한다.", "Wi-Fi/BLE 예제를 HAL 책의 응용 장으로 배치한다."],
          focus: "무선 기능은 peripheral driver보다 stack 성격이 강하다. 이 장은 radio를 '고급 주변장치'가 아니라 별도 계층으로 배치해 독자가 기대치를 조정하게 한다.",
          checkpoints: ["esp-radio와 esp-phy README 확인", "Wi-Fi/BLE 예제 dependency 비교", "core HAL과 radio 경계 표시"],
          codePath: "esp-radio/src/lib.rs",
          codeLabel: "radio entry"
        },
        {
          title: "Examples를 학습 레시피로 재배열하기",
          subtitle: "hello_world에서 peripheral, interrupt, OTA, wireless까지 예제를 난이도별로 읽습니다.",
          files: ["examples/README.md", "examples/hello_world/src/main.rs", "examples/peripheral/twai/Cargo.toml", "examples/ota/update/Cargo.toml"],
          goals: ["예제를 디렉토리명이 아니라 학습 난이도 순으로 정렬한다.", "각 예제가 요구하는 선행 장을 연결한다.", "새 사용자가 복사할 첫 예제와 읽을 예제를 구분한다."],
          focus: "수준 높은 책은 examples를 부록에 버리지 않는다. examples는 각 장의 실습문제로 연결되어야 하므로 hello_world, interrupt, peripheral, wireless 순서로 재배열한다.",
          checkpoints: ["첫 실행 예제 선택", "고급 예제 선행 지식 표시", "예제 dependency와 본문 장 연결"],
          codePath: "examples/hello_world/src/main.rs",
          codeLabel: "hello world example"
        }
      ]
    },
    {
      title: "Part V. 검증, 설정, 기여",
      summary: "HIL/QA/compile-tests와 release/migration 문서가 변경 안전성을 어떻게 보증하는지 묶는다.",
      chapters: [
        {
          title: "HIL, QA, compile-tests로 신뢰도 읽기",
          subtitle: "하드웨어 의존 HAL에서 테스트 구조가 문서만큼 중요한 이유를 확인합니다.",
          files: ["documentation/HIL-GUIDE.md", "hil-test/README.md", "qa-test/README.md", "compile-tests/README.md"],
          goals: ["HIL 테스트가 일반 unit test와 다른 이유를 설명한다.", "compile-tests가 API 안정성을 어떻게 지키는지 확인한다.", "QA crate가 release confidence에 주는 신호를 읽는다."],
          focus: "HAL의 품질은 테스트 파일 수보다 어떤 보드/칩에서 검증되는지에 달려 있다. 마지막부는 테스트 인프라를 책의 품질 증거로 해석한다.",
          checkpoints: ["HIL 실행 조건 확인", "compile-tests 범위 요약", "QA와 release check 연결"],
          codePath: "documentation/HIL-GUIDE.md",
          codeLabel: "HIL guide"
        },
        {
          title: "Configuration, migration, release policy",
          subtitle: "esp_config.yml, migration 문서, release policy를 읽어 유지보수자의 변경 안전선을 세웁니다.",
          files: ["esp-hal/esp_config.yml", "esp-hal/MIGRATING-1.0.0.md", "esp-hal/MIGRATING-1.1.0.md", "documentation/DEVELOPER-GUIDELINES.md", "documentation/CONTRIBUTING.md"],
          goals: ["configuration key가 API surface에 주는 영향을 파악한다.", "migration 문서를 breaking change 지도처럼 읽는다.", "contribution guideline에서 review 기준을 추출한다."],
          focus: "esp-hal 책의 끝은 API 목록이 아니라 변경 안전선이어야 한다. configuration과 migration 문서를 마지막 장으로 두면 독자가 실제 기여나 업그레이드로 넘어갈 수 있다.",
          checkpoints: ["config key 목록 확인", "migration 문서의 breaking change 분류", "기여 전 확인 문서 정리"],
          codePath: "esp-hal/esp_config.yml",
          codeLabel: "HAL configuration"
        }
      ]
    }
  ];
}

function genericPartSpecs(index: RepoIndex): PartSpec[] {
  const primaryDirs = index.topLevelDirs.slice(0, 5).map((dir) => dir.name).join(", ") || "root files";
  const readmes = index.files.filter((file) => file.kind === "readme").map((file) => file.path);
  const manifests = index.files.filter((file) => file.kind === "manifest").map((file) => file.path);
  const sourceFiles = index.files.filter((file) => file.kind === "rust" || file.path.includes("/src/")).map((file) => file.path);
  const tests = index.files.filter((file) => file.kind === "test").map((file) => file.path);
  return [
    {
      title: "Part I. 저장소 지도",
      summary: `${index.repoName}의 목적, 실행 경로, 주요 디렉토리(${primaryDirs})를 먼저 정리한다.`,
      chapters: [
        {
          title: "제품 의도와 첫 실행 경로",
          subtitle: "README와 manifest에서 저장소가 해결하는 문제와 실행 단서를 찾습니다.",
          files: [...readmes, ...manifests],
          goals: ["저장소 목적을 한 문장으로 정리한다.", "실행과 빌드의 첫 명령을 찾는다.", "독자가 먼저 열 파일을 고른다."],
          focus: "README와 manifest는 저장소의 공개 약속과 실행 조건을 함께 드러낸다. 이 둘을 대조하면 제품 목적, 첫 실행 경로, 의존성 계약이 한 장의 시스템 개요로 연결된다.",
          checkpoints: ["README 요약", "manifest 확인", "첫 실행 명령 후보 표시"]
        },
        {
          title: "디렉토리를 대단원으로 번역하기",
          subtitle: "물리 폴더를 책임, 흐름, 변경 지점 단위로 다시 묶습니다.",
          files: index.topLevelDirs.map((dir) => dir.name),
          goals: ["상위 디렉토리별 책임을 분류한다.", "학습 순서와 물리 경로를 분리한다.", "건너뛰어도 되는 파일군을 표시한다."],
          focus: "좋은 repo book은 탐색기 목차가 아니다. 디렉토리를 개념 단위로 번역해야 독자가 순서대로 읽을 수 있다.",
          checkpoints: ["상위 디렉토리 분류", "핵심/보조 경로 구분", "학습 순서 확정"]
        }
      ]
    },
    {
      title: "Part II. 핵심 코드 경로",
      summary: "소스 파일과 모듈 경계를 따라 실제 동작을 읽는다.",
      chapters: [
        {
          title: "엔트리 포인트와 공개 API",
          subtitle: "src/lib, src/main, public exports에서 사용자가 만나는 첫 계약을 찾습니다.",
          files: sourceFiles,
          goals: ["엔트리 파일을 찾는다.", "공개 API와 내부 모듈을 구분한다.", "주요 타입/함수 이름을 추출한다."],
          focus: "공개 API는 저장소가 독자에게 내미는 첫 문장이다. 내부 구현보다 export와 module boundary를 먼저 읽는다.",
          checkpoints: ["엔트리 파일 선택", "공개 symbol 확인", "내부/private 경계 표시"]
        },
        {
          title: "주요 흐름을 코드 근거로 따라가기",
          subtitle: "핵심 소스 파일을 작은 묶음으로 읽으며 구현 흐름을 재구성합니다.",
          files: sourceFiles.slice(1),
          goals: ["핵심 모듈 간 호출 흐름을 찾는다.", "상태나 데이터 구조가 바뀌는 지점을 표시한다.", "예외와 edge case를 확인한다."],
          focus: "코드 장은 긴 파일 설명이 아니라 흐름 설명이어야 한다. 관련 파일을 작은 묶음으로 제한하면 상태 변화, 호출 경계, 예외 처리를 한 책임 안에서 이해할 수 있다.",
          checkpoints: ["핵심 호출 흐름 표시", "상태 변경 지점 확인", "edge case 목록화"]
        }
      ]
    },
    {
      title: "Part III. 검증과 유지보수",
      summary: "테스트, 문서, 설정을 변경 안전성 관점에서 읽는다.",
      chapters: [
        {
          title: "테스트가 보증하는 계약",
          subtitle: "테스트와 검증 스크립트가 어떤 사용자 흐름을 보호하는지 확인합니다.",
          files: tests,
          goals: ["테스트 종류를 분류한다.", "핵심 수용 기준과 연결한다.", "부족한 검증 영역을 찾는다."],
          focus: "테스트는 책의 연습문제이자 품질 증거다. 구현 설명 뒤에는 항상 어떤 검증이 계약을 지키는지 연결한다.",
          checkpoints: ["테스트 파일 분류", "보호하는 기능 연결", "검증 공백 표시"]
        },
        {
          title: "변경 전 읽어야 할 문서와 설정",
          subtitle: "기여 문서, config, workflow를 유지보수자의 체크리스트로 바꿉니다.",
          files: index.files.filter((file) => ["doc", "config", "script"].includes(file.kind)).map((file) => file.path),
          goals: ["설정 파일의 영향 범위를 파악한다.", "기여 전 읽을 문서를 정리한다.", "릴리스나 배포 경로를 찾는다."],
          focus: "마지막 장은 다음 변경으로 이어져야 한다. 문서와 설정을 유지보수 체크리스트로 묶어 책의 사용성을 높인다.",
          checkpoints: ["주요 설정 파일 확인", "기여 문서 요약", "릴리스/배포 단서 찾기"]
        }
      ]
    }
  ];
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

function buildChapterBody(index: RepoIndex, analysis: RepositoryAnalysis, spec: ChapterSpec, files: string[], partTitle: string) {
  const indexedFiles = files.map((path) => findIndexedFile(index, path)).filter((file): file is IndexedFile => Boolean(file));
  const flow = buildChapterFlow(index, analysis, spec, files, partTitle);
  const codeAnchors = buildCodeAnchors(index, spec, indexedFiles);
  const evidence = buildEvidence(indexedFiles);
  const glossary = buildGlossary(indexedFiles, spec);
  const recap = buildRecap(spec, files, codeAnchors, flow);
  return {
    keyQuestion: `${spec.title}는 ${index.repoName}의 어떤 책임과 변경 지점을 설명하는가?`,
    responsibility: `${spec.subtitle} ${spec.focus}`,
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
  const fallback = index.files[0];
  return fallback
    ? [
        {
          filePath: fallback.path,
          symbolName: fallback.symbolDetails[0]?.name ?? fallback.headings[0] ?? fallback.path,
          lineHint: "L1-L80",
          claim: `${fallback.path}는 ${spec.title}의 최소 근거 파일이다.`,
          explanation: `${fallback.path}의 preview가 저장소의 공개 설명이나 구현 경계를 제공한다.`,
          excerptLines: excerptLines(fallback)
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

function buildQuestionBody(index: RepoIndex, spec: ChapterSpec, files: string[], body: ReturnType<typeof buildChapterBody>) {
  const anchors = body.codeAnchors.slice(0, 3).map((anchor) => `${anchor.filePath}${anchor.symbolName ? `의 ${anchor.symbolName}` : ""}`).join(", ");
  return `${body.keyQuestion} 이 질문의 답은 ${index.repoName}의 파일 배치를 설명하는 데서 끝나지 않고, ${body.responsibility}라는 책임을 실제 근거와 연결하는 데 있다. 이 장은 ${files.slice(0, 3).join(", ")}를 중심으로 ${anchors || "색인된 공개 표면"}이 어떤 계약을 드러내는지 설명한다.`;
}

function buildFlowBody(spec: ChapterSpec, files: string[], body: ReturnType<typeof buildChapterBody>) {
  const evidence = body.evidence.slice(0, 3).map((item) => `${item.filePath}(${item.role})`).join(", ");
  return `${body.flow?.summary ?? spec.focus} ${evidence}가 이 흐름의 근거다. ${files.slice(0, 4).join(" -> ")}는 탐색 순서가 아니라 책임이 전달되는 경계로 다루며, 각 파일은 사용자 경험, 설정, 구현, 검증 중 하나의 역할을 맡는다.`;
}

function buildImplementationBody(spec: ChapterSpec, files: string[], body: ReturnType<typeof buildChapterBody>) {
  const changes = body.recap.changeEntryPoints.slice(0, 3).join(", ");
  const checkpoints = spec.checkpoints.slice(0, 2).join(", ");
  return `구현을 변경할 때는 ${changes || files.slice(0, 2).join(", ")}를 먼저 확인해야 한다. ${body.codeAnchors.slice(0, 3).map((anchor) => anchor.claim).join(" ")} 체크포인트는 ${checkpoints}이며, 이 기준을 통과하면 이 장의 설명을 실제 유지보수 판단에 사용할 수 있다.`;
}

function bookSubtitle(index: RepoIndex) {
  if (index.signals.isEspHal) {
    const chips = index.signals.chips.length ? `${index.signals.chips.length}개 ESP chip` : "ESP chip";
    return `${chips}과 ${index.packages.length}개 Rust crate를 no_std HAL 관점으로 재구성한 repo book`;
  }
  if (index.signals.isRust) return `${index.packages.length || 1}개 Rust crate를 유지보수 순서로 재구성한 repo book`;
  return "저장소 구조와 코드 근거를 학습 순서로 재구성한 repo book";
}

function generationModelLabel(payload: PostGenerationOutlinePayload) {
  const mode = process.env.LM_STUDIO_BASE_URL ? "LM Studio-ready" : "deterministic scanner";
  return `${mode} · ${payload.model}`;
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
