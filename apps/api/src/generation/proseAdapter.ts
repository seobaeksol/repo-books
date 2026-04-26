import type { ChapterEvidence, ChapterFlow, ChapterGlossaryEntry, ChapterRecap, CodeAnchor } from "@repo-books/shared";
import type { IndexedFile } from "./indexer.js";

export type ChapterProseSection = {
  eyebrow: string;
  title: string;
  body: string;
};

export type ChapterProseRequest = {
  repoName: string;
  audience: string;
  depth: string;
  model: string;
  partTitle: string;
  chapterNumber: string;
  chapterTitle: string;
  subtitle: string;
  goals: string[];
  focus: string;
  checkpoints: string[];
  keyQuestion: string;
  responsibility: string;
  flow: ChapterFlow | null | undefined;
  codeAnchors: CodeAnchor[];
  evidence: ChapterEvidence[];
  glossary: ChapterGlossaryEntry[];
  recap: ChapterRecap;
  files: IndexedFile[];
  baseSections: ChapterProseSection[];
};

export interface ChapterProseAdapter {
  readonly label: string;
  readonly stats: ChapterProseStats;
  expandChapterSections(request: ChapterProseRequest): Promise<ChapterProseSection[] | null>;
}

export type StructuredGenerationRequest = {
  task: string;
  schemaName: string;
  context: Record<string, unknown>;
  maxTokens?: number;
};

export type StructuredGenerationClient = {
  readonly label: string;
  readonly available: boolean;
  readonly stats: ChapterProseStats;
  generateJson<T extends object>(request: StructuredGenerationRequest): Promise<T | null>;
};

export type ChapterProseStats = {
  attempted: number;
  succeeded: number;
  failed: number;
  disabled: boolean;
  mode: "deterministic" | "lm-studio";
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type ExpandedSectionsPayload = {
  sections?: Array<Partial<ChapterProseSection>>;
};

const disallowedBodyPatterns = [
  /fake\s+OpenAI-compatible/i,
  /JSON parsing/i,
  /이\s*테스트/i,
  /테스트용\s*응답/i,
  /프롬프트/i,
  /adapter/i,
  /충분히\s*긴\s*prose/i,
  /모델\s*응답/i,
  /생성기/,
  /```/,
  /^#{1,6}\s/m
];

export function createChapterProseAdapter(): ChapterProseAdapter {
  const baseUrl = process.env.LM_STUDIO_BASE_URL?.trim();
  if (!baseUrl) return deterministicProseAdapter;
  return new LmStudioProseAdapter(baseUrl);
}

export function createStructuredGenerationClient(): StructuredGenerationClient {
  const baseUrl = process.env.LM_STUDIO_BASE_URL?.trim();
  if (!baseUrl) return unavailableStructuredClient;
  return new LmStudioStructuredGenerationClient(baseUrl);
}

export const deterministicProseAdapter: ChapterProseAdapter = {
  label: "deterministic scanner",
  stats: {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    disabled: false,
    mode: "deterministic"
  },
  async expandChapterSections(request) {
    return request.baseSections.map((section, index) => ({
      ...section,
      body: expandDeterministically(request, section, index)
    }));
  }
};

class LmStudioProseAdapter implements ChapterProseAdapter {
  readonly label = "LM Studio chat completions";
  readonly stats: ChapterProseStats = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    disabled: false,
    mode: "lm-studio"
  };
  private disabled = false;

  constructor(private readonly baseUrl: string) {}

  async expandChapterSections(request: ChapterProseRequest): Promise<ChapterProseSection[] | null> {
    if (this.disabled) return null;
    this.stats.attempted += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), lmStudioTimeoutMs());
    try {
      const response = await fetch(chatCompletionsUrl(this.baseUrl), {
        method: "POST",
        headers: lmStudioHeaders(),
        body: JSON.stringify(buildChatCompletionPayload(request)),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`LM_STUDIO_HTTP_${response.status}`);
      const expanded = parseExpandedSections(await response.text(), request.baseSections);
      if (!expanded) throw new Error("LM_STUDIO_EMPTY_PROSE");
      this.stats.succeeded += 1;
      return expanded;
    } catch {
      this.stats.failed += 1;
      this.disabled = true;
      this.stats.disabled = true;
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

const unavailableStructuredClient: StructuredGenerationClient = {
  label: "local deterministic planner",
  available: false,
  stats: {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    disabled: false,
    mode: "deterministic"
  },
  async generateJson() {
    return null;
  }
};

class LmStudioStructuredGenerationClient implements StructuredGenerationClient {
  readonly label = "LM Studio structured generation";
  readonly available = true;
  readonly stats: ChapterProseStats = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    disabled: false,
    mode: "lm-studio"
  };

  constructor(private readonly baseUrl: string) {}

  async generateJson<T extends object>(request: StructuredGenerationRequest): Promise<T | null> {
    this.stats.attempted += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), lmStudioTimeoutMs());
    try {
      const response = await fetch(chatCompletionsUrl(this.baseUrl), {
        method: "POST",
        headers: lmStudioHeaders(),
        body: JSON.stringify({
          model: process.env.LM_STUDIO_MODEL?.trim() || process.env.DEFAULT_LM_STUDIO_MODEL || "qwen3-coder 14B",
          temperature: 0.15,
          max_tokens: request.maxTokens ?? 4096,
          messages: [
            {
              role: "system",
              content:
                "You are a repository-to-book planning engine. Return only valid JSON. Do not include markdown, code fences, prompts, model commentary, or unsupported repository claims."
            },
            {
              role: "user",
              content: JSON.stringify({
                task: request.task,
                schemaName: request.schemaName,
                constraints: [
                  "Use only supplied repository evidence.",
                  "Prefer system explanation over file navigation.",
                  "Every generated section must be grounded in file paths, symbols, routes, config keys, headings, or tests.",
                  "Do not mention prompts, adapters, fake responses, JSON parsing, or generation internals."
                ],
                context: request.context
              })
            }
          ]
        }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`LM_STUDIO_HTTP_${response.status}`);
      const raw = await response.text();
      const parsed = JSON.parse(raw) as ChatCompletionResponse;
      const content = parsed.choices?.[0]?.message?.content;
      if (!content) throw new Error("LM_STUDIO_EMPTY_JSON");
      const payload = JSON.parse(extractJsonObject(content)) as T;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("LM_STUDIO_JSON_OBJECT_REQUIRED");
      this.stats.succeeded += 1;
      return payload;
    } catch {
      this.stats.failed += 1;
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildChatCompletionPayload(request: ChapterProseRequest) {
  return {
    model: process.env.LM_STUDIO_MODEL?.trim() || request.model,
    temperature: 0.2,
    max_tokens: maxTokensForDepth(request.depth),
    messages: [
      {
        role: "system",
        content:
          "You turn repository chapter briefs and evidence into Korean long-form technical book prose. Return only JSON with a sections array. Do not invent APIs that are not supported by supplied anchors, evidence, or files."
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "Rewrite each base section into 2-3 cohesive Korean paragraphs that explain how this repository works.",
          constraints: [
            "Keep the original eyebrow and title for each section.",
            "Use the key question, responsibility, flow, codeAnchors, evidence, glossary, and checkpoints as source of truth.",
            "Explain system behavior, module responsibility, data/control flow, and change risks. Do not explain how to read the repository.",
            "Every important claim should mention a supplied file path, symbol, route, config key, heading, or test target.",
            "Write narrative body text, not outline bullets.",
            "Avoid markdown headings and code fences inside body.",
            "Do not mention prompts, model responses, adapters, tests for this generator, JSON parsing, fake responses, or prose length."
          ],
          repoName: request.repoName,
          audience: request.audience,
          depth: request.depth,
          partTitle: request.partTitle,
          chapterNumber: request.chapterNumber,
          chapterTitle: request.chapterTitle,
          subtitle: request.subtitle,
          goals: request.goals,
          focus: request.focus,
          checkpoints: request.checkpoints,
          keyQuestion: request.keyQuestion,
          responsibility: request.responsibility,
          flow: request.flow,
          codeAnchors: request.codeAnchors,
          evidence: request.evidence,
          glossary: request.glossary,
          recap: request.recap,
          files: request.files.map(fileContext),
          baseSections: request.baseSections
        })
      }
    ]
  };
}

function fileContext(file: IndexedFile) {
  return {
    path: file.path,
    kind: file.kind,
    headings: file.headings.slice(0, 5),
    symbols: file.symbols.slice(0, 8),
    symbolDetails: file.symbolDetails.slice(0, 8),
    commands: file.commands.slice(0, 8),
    dependencies: file.dependencies.slice(0, 12),
    features: file.features.slice(0, 12),
    configKeys: file.configKeys.slice(0, 12),
    routes: file.routes.slice(0, 12),
    testTargets: file.testTargets.slice(0, 12),
    preview: file.preview.slice(0, 1200)
  };
}

function parseExpandedSections(raw: string, baseSections: ChapterProseSection[]) {
  const response = JSON.parse(raw) as ChatCompletionResponse;
  const content = response.choices?.[0]?.message?.content;
  if (!content) return null;
  const payload = JSON.parse(extractJsonObject(content)) as ExpandedSectionsPayload;
  const sections = payload.sections;
  if (!Array.isArray(sections) || sections.length !== baseSections.length) return null;

  const expanded = sections.map((section, index) => {
    const base = baseSections[index];
    const body = typeof section.body === "string" ? section.body.trim() : "";
    if (!base || body.length < 240) return null;
    if (disallowedBodyPatterns.some((pattern) => pattern.test(body))) return null;
    return {
      eyebrow: base.eyebrow,
      title: base.title,
      body
    };
  });
  if (expanded.some((section) => section === null)) return null;
  return expanded as ChapterProseSection[];
}

function extractJsonObject(content: string) {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("LM_STUDIO_JSON_NOT_FOUND");
  return trimmed.slice(start, end + 1);
}

function expandDeterministically(request: ChapterProseRequest, section: ChapterProseSection, index: number) {
  const files = request.files.length ? request.files : [];
  const primaryFiles = files.slice(0, 3).map((file) => file.path);
  const evidence = summarizeEvidence(files, request.evidence);
  const anchors = request.codeAnchors.slice(0, 3);
  const anchorText = anchors.map((anchor) => `${anchor.filePath}${anchor.symbolName ? `의 ${anchor.symbolName}` : ""}${anchor.lineHint ? `(${anchor.lineHint})` : ""}`).join(", ");
  const checkpoint = request.checkpoints[index] ?? request.checkpoints[0] ?? "핵심 근거를 표시한다.";
  const depthPhrase = request.depth === "deep" ? "세부 구현의 이유와 변경 여파까지" : request.depth === "light" ? "핵심 책임 위주로" : "구조와 근거를 균형 있게";

  if (index === 0) {
    return [
      `${request.keyQuestion} ${request.subtitle} ${request.responsibility} 이 장의 답은 ${primaryFiles.join(", ") || request.repoName}가 맡는 책임을 하나의 시스템 설명으로 묶을 때 드러난다. ${anchorText || "제공된 코드 앵커"}는 이 책임이 문서, manifest, source, test 중 어디에서 실제 계약으로 굳어지는지 보여 준다.`,
      `${evidence} 따라서 본문은 ${depthPhrase} 설명한다. ${request.repoName}의 이 영역은 파일 이름보다 책임 경계가 더 중요하며, public symbol, route, config key, test target이 같은 방향을 가리킬 때 독자는 구현 의도와 변경 위험을 함께 이해할 수 있다.`,
      `${request.focus} 이 판단은 ${checkpoint}라는 확인 기준으로 닫힌다. 이 장을 마치면 ${request.goals.slice(0, 2).join(" ")}라는 목표를 저장소 내부 근거로 설명할 수 있어야 하고, 다음 장에서는 여기서 확정한 책임 경계를 더 좁은 구현 흐름으로 이어 간다.`
    ].join("\n\n");
  }

  if (index === 1) {
    return [
      `${request.flow?.title ?? section.title}는 ${request.flow?.summary ?? request.focus} ${primaryFiles.join(", ") || "제공된 파일"}가 이 흐름의 구체 근거다. 이 장에서는 각 파일을 독립 요약으로 다루지 않고, 사용자 경험이나 런타임 조건이 어떤 모듈 경계와 검증 근거를 통과하는지 설명한다.`,
      `${evidence} 이 근거는 API 경계와 내부 구현 경계를 구분하게 해 준다. 공개 타입이나 함수는 호출자가 기대하는 안정성을 보여 주고, manifest와 config key는 기능이 활성화되는 조건을 고정하며, 테스트나 예제는 그 기대가 실제 흐름에서 보호되는 범위를 드러낸다.`,
      `그래서 ${request.chapterTitle}의 핵심은 구현 세부를 모두 압축하는 것이 아니라 변경 전에 놓치면 위험한 전제를 앞으로 끌어오는 데 있다. ${request.recap.changeEntryPoints.slice(0, 3).join(", ") || anchorText}를 변경 진입점으로 삼으면 ownership, feature gate, 검증 책임이 어디에서 이어지는지 유지한 채 다음 구현 영역으로 넘어갈 수 있다.`
    ].join("\n\n");
  }

  return [
    `${request.chapterTitle}를 고치거나 디버깅할 때의 첫 판단 기준은 ${request.recap.changeEntryPoints.slice(0, 3).join(", ") || primaryFiles.join(", ")}다. 이 지점들은 ${anchors.map((anchor) => anchor.claim).join(" ")}라는 주장과 연결되어 있으므로, 변경 영향은 파일 목록이 아니라 책임과 근거의 연결로 추적해야 한다.`,
    `${evidence} 이 근거를 기준으로 보면 ${request.audience} 독자에게 필요한 정보는 모든 파일의 축약본이 아니다. 어떤 symbol이 외부 계약을 만들고, 어떤 config key가 실행 조건을 바꾸며, 어떤 테스트가 회귀를 막는지 알 수 있어야 저장소를 열지 않아도 시스템의 작동 방식을 설명할 수 있다.`,
    `마지막으로 ${checkpoint}를 확인하면서 장을 닫는다. ${request.recap.understood.slice(0, 3).join(" ")} 다음 질문은 ${request.recap.nextQuestions.slice(0, 2).join(" ")}이며, 이 질문이 다음 장의 책임과 연결될 때 책 전체는 파일 안내가 아니라 저장소 이해를 대체하는 기술서로 작동한다.`
  ].join("\n\n");
}

function summarizeEvidence(files: IndexedFile[], evidenceItems: ChapterEvidence[]) {
  const symbols = files.flatMap((file) => file.symbolDetails.slice(0, 3).map((symbol) => `${symbol.name}(${symbol.kind})`)).slice(0, 8);
  const headings = files.flatMap((file) => file.headings.slice(0, 2)).slice(0, 5);
  const evidence = evidenceItems.slice(0, 3).map((item) => `${item.filePath}: ${item.usedAsEvidence}`);
  if (evidence.length > 0) return `근거는 ${evidence.join(" / ")}이다.`;
  if (symbols.length > 0 && headings.length > 0) return `근거 symbol은 ${symbols.join(", ")}이고 문서 heading은 ${headings.join(", ")}이다.`;
  if (symbols.length > 0) return `근거 symbol은 ${symbols.join(", ")}이다.`;
  if (headings.length > 0) return `근거 heading은 ${headings.join(", ")}이다.`;
  return "근거는 파일 경로, preview, 코드 excerpt가 드러내는 책임 범위다.";
}

function lmStudioHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  const apiKey = process.env.LM_STUDIO_API_KEY?.trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function chatCompletionsUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/$/, "");
  return trimmed.endsWith("/v1") ? `${trimmed}/chat/completions` : `${trimmed}/v1/chat/completions`;
}

function lmStudioTimeoutMs() {
  const value = Number(process.env.LM_STUDIO_TIMEOUT_MS ?? Number(process.env.LM_STUDIO_TIMEOUT_SECONDS ?? 8) * 1000);
  if (!Number.isFinite(value) || value <= 0) return 8_000;
  return Math.min(value, 120_000);
}

function maxTokensForDepth(depth: string) {
  if (depth === "deep") return 2400;
  if (depth === "light") return 1000;
  return 1600;
}
