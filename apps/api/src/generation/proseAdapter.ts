import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { LMStudioClient } from "@lmstudio/sdk";

export type ChapterProseSection = {
  eyebrow: string;
  title: string;
  body: string;
};

export type StructuredGenerationRequest = {
  task: string;
  schemaName: string;
  context: Record<string, unknown>;
  model?: string;
  maxTokens?: number;
};

export type StructuredGenerationClient = {
  readonly label: string;
  readonly available: boolean;
  readonly stats: ChapterProseStats;
  readonly lastError: string | null;
  prepareModel(model?: string, onStatus?: (detail: string) => void): Promise<void>;
  generateJson<T extends object>(request: StructuredGenerationRequest): Promise<T | null>;
};

export type ChapterProseStats = {
  attempted: number;
  succeeded: number;
  failed: number;
  disabled: boolean;
  mode: "deterministic" | "lm-studio";
  modelDownloads: {
    attempted: number;
    succeeded: number;
    failed: number;
  };
};

type PredictionResult = {
  content?: string;
  parsed?: unknown;
};

const execFileAsync = promisify(execFile);

export function createStructuredGenerationClient(): StructuredGenerationClient {
  return new LmStudioSdkStructuredGenerationClient();
}

class LmStudioSdkStructuredGenerationClient implements StructuredGenerationClient {
  readonly label = "LM Studio TypeScript SDK";
  readonly available = true;
  lastError: string | null = null;
  readonly stats: ChapterProseStats = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    disabled: false,
    mode: "lm-studio",
    modelDownloads: {
      attempted: 0,
      succeeded: 0,
      failed: 0
    }
  };

  private readonly client = new LMStudioClient(lmStudioClientOptions());
  private readonly modelHandles = new Map<string, Promise<{ respond: (chat: unknown, opts: Record<string, unknown>) => Promise<PredictionResult> }>>();
  private readonly modelDownloads = new Map<string, Promise<void>>();

  async prepareModel(model: string | undefined, onStatus?: (detail: string) => void) {
    const modelKey = resolveModelKey(model);
    onStatus?.(modelKey ? `LM Studio 모델 ${modelKey} 확인 중` : "LM Studio에 로드된 기본 모델 확인 중");
    await this.modelFor(modelKey, onStatus);
  }

  async generateJson<T extends object>(request: StructuredGenerationRequest): Promise<T | null> {
    this.stats.attempted += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), lmStudioTimeoutMs());
    try {
      const model = await this.modelFor(resolveModelKey(request.model));
      const result = await model.respond(buildStructuredChat(request), {
        temperature: lmStudioTemperature(),
        maxTokens: request.maxTokens ?? 4096,
        structured: { type: "json" },
        signal: controller.signal
      });
      const payload = parseStructuredResult<T>(result);
      this.stats.succeeded += 1;
      this.lastError = null;
      return payload;
    } catch (error) {
      this.stats.failed += 1;
      this.lastError = error instanceof Error ? error.message : "LM_STUDIO_SDK_ERROR";
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private modelFor(modelKey: string, onStatus?: (detail: string) => void) {
    const cacheKey = modelKey || "__loaded__";
    const cached = this.modelHandles.get(cacheKey);
    if (cached) return cached;
    const handle = this.loadModel(modelKey, onStatus)
      .then((model) => model as { respond: (chat: unknown, opts: Record<string, unknown>) => Promise<PredictionResult> })
      .catch((error) => {
        this.modelHandles.delete(cacheKey);
        throw error;
      });
    this.modelHandles.set(cacheKey, handle);
    return handle;
  }

  private async loadModel(modelKey: string, onStatus?: (detail: string) => void) {
    try {
      return await sdkModel(this.client, modelKey);
    } catch (error) {
      if (!modelKey || !shouldAutoDownloadModel(error)) throw error;
      onStatus?.(`로컬 모델 ${modelKey}을 찾지 못해 lms get 실행 중`);
      await this.downloadModel(modelKey);
      onStatus?.(`로컬 모델 ${modelKey} 다운로드 완료, LM Studio 모델 로드 재시도 중`);
      return await sdkModel(this.client, modelKey);
    }
  }

  private downloadModel(modelKey: string) {
    const cached = this.modelDownloads.get(modelKey);
    if (cached) return cached;
    this.stats.modelDownloads.attempted += 1;
    const pending = runLmsGet(modelKey)
      .then(() => {
        this.stats.modelDownloads.succeeded += 1;
      })
      .catch((error) => {
        this.stats.modelDownloads.failed += 1;
        throw error;
      })
      .finally(() => {
        this.modelDownloads.delete(modelKey);
      });
    this.modelDownloads.set(modelKey, pending);
    return pending;
  }
}

function sdkModel(client: LMStudioClient, modelKey: string) {
  const opts = lmStudioLoadOptions();
  return Promise.resolve(modelKey ? client.llm.model(modelKey, opts) : client.llm.model());
}

function buildStructuredChat(request: StructuredGenerationRequest) {
  return [
    {
      role: "system",
      content:
        "You are a repository-to-book generation engine. Return only valid JSON for the requested schema. Use only supplied repository evidence. Do not include markdown, code fences, prompts, model commentary, or unsupported repository claims."
    },
    {
      role: "user",
      content: JSON.stringify({
        task: request.task,
        schemaName: request.schemaName,
        responseShape: responseShape(request.schemaName),
        constraints: [
          "Return exactly one JSON object that matches responseShape.",
          "Use only supplied repository evidence.",
          "Every generated claim must be grounded in file paths, symbols, routes, config keys, headings, tests, or provided excerpts.",
          "Generate the book structure and prose yourself; do not copy fallback outlines or deterministic template text.",
          "Write Korean technical-book content unless a file path, symbol, package name, command, or API identifier must stay as-is.",
          "Do not mention prompts, adapters, fake responses, JSON parsing, or generation internals."
        ],
        context: request.context
      })
    }
  ];
}

function responseShape(schemaName: string) {
  const shapes: Record<string, unknown> = {
    RepoBookPartPlan: {
      parts: [
        {
          title: "Part I. ...",
          summary: "What this part teaches from the supplied repository evidence."
        }
      ]
    },
    RepoBookChapterPlan: {
      chapters: [
        {
          title: "Chapter title",
          subtitle: "Short technical subtitle",
          files: ["exact/indexed/path.rs"],
          goals: ["Reader-visible learning goal"],
          focus: "The specific repository responsibility explained in this chapter.",
          checkpoints: ["Question the reader can answer after the chapter"],
          codePath: "exact/indexed/path.rs",
          codeLabel: "Why this file is the primary code anchor"
        }
      ]
    },
    RepoBookChapterBrief: {
      keyQuestion: "Question answered by this chapter",
      responsibility: "Repository responsibility described with file evidence",
      flow: {
        type: "architecture",
        title: "Flow title",
        summary: "Grounded flow summary",
        diagram: "flowchart TD\\n  A[\"file\"] --> B[\"file\"]"
      },
      codeAnchors: [
        {
          filePath: "exact/indexed/path.rs",
          symbolName: "SymbolName",
          lineHint: "L10",
          claim: "Grounded claim",
          explanation: "Why the anchor proves the claim",
          excerptLines: ["short source excerpt"]
        }
      ],
      evidence: [
        {
          filePath: "exact/indexed/path.rs",
          role: "Evidence role",
          usedAsEvidence: "How this file supports the chapter",
          outOfScope: "What not to infer"
        }
      ],
      glossary: [{ term: "Term", meaning: "Meaning in this repository", appearsIn: "exact/indexed/path.rs", relatedAnchors: ["exact/indexed/path.rs"] }],
      recap: {
        understood: ["What the reader now understands"],
        changeEntryPoints: ["exact/indexed/path.rs · SymbolName"],
        nextQuestions: ["What to inspect next"]
      }
    },
    RepoBookSectionPlan: {
      sections: [
        {
          eyebrow: "Section label",
          title: "Section title",
          purpose: "Why this section exists",
          evidenceFiles: ["exact/indexed/path.rs"]
        }
      ]
    },
    RepoBookSectionDraft: {
      body: "Three Korean paragraphs. Mention at least one exact evidence file path from evidenceFiles."
    },
    RepoBookChapterRevision: {
      sections: [{ eyebrow: "Section label", title: "Section title", body: "Revised body that preserves exact evidence file paths." }],
      notes: ["Coherence note"]
    },
    RepoBookCoherenceReview: {
      status: "ok",
      terminology: ["Term consistency note"],
      missingFlows: ["Any missing flow"],
      nextQuestionContinuity: ["Continuity note"]
    }
  };
  return shapes[schemaName] ?? { result: "JSON object" };
}

function parseStructuredResult<T extends object>(result: PredictionResult): T {
  const parsed = result.parsed ?? JSON.parse(extractJsonObject(result.content ?? ""));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("LM_STUDIO_JSON_OBJECT_REQUIRED");
  return parsed as T;
}

function extractJsonObject(content: string) {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("LM_STUDIO_JSON_NOT_FOUND");
  return trimmed.slice(start, end + 1);
}

async function runLmsGet(modelKey: string) {
  const command = process.env.LM_STUDIO_LMS_BIN?.trim() || "lms";
  try {
    await execFileAsync(command, ["get", modelKey], {
      timeout: lmStudioModelDownloadTimeoutMs(),
      maxBuffer: 20 * 1024 * 1024
    });
  } catch (error) {
    throw new Error(`LM_STUDIO_MODEL_DOWNLOAD_FAILED: ${command} get ${modelKey}: ${formatExecError(error)}`);
  }
}

function shouldAutoDownloadModel(error: unknown) {
  if (!lmStudioAutoDownloadEnabled()) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /cannot\s+find|not\s+found|missing|unavailable|not\s+available|not\s+loaded|no\s+model|does\s+not\s+exist/i.test(message);
}

function resolveModelKey(model: string | undefined) {
  return model?.trim() || process.env.LM_STUDIO_MODEL?.trim() || process.env.DEFAULT_LM_STUDIO_MODEL?.trim() || "";
}

function lmStudioClientOptions() {
  const baseUrl = lmStudioSdkBaseUrl();
  return baseUrl ? { baseUrl, verboseErrorMessages: true } : { verboseErrorMessages: true };
}

function lmStudioSdkBaseUrl() {
  const value = process.env.LM_STUDIO_SDK_BASE_URL?.trim() || process.env.LM_STUDIO_BASE_URL?.trim();
  if (!value) return "";
  const withoutApiPath = value.replace(/\/(?:api\/)?v1\/?$/i, "").replace(/\/$/, "");
  if (withoutApiPath.startsWith("http://")) return `ws://${withoutApiPath.slice("http://".length)}`;
  if (withoutApiPath.startsWith("https://")) return `wss://${withoutApiPath.slice("https://".length)}`;
  return withoutApiPath;
}

function lmStudioTimeoutMs() {
  const value = Number(process.env.LM_STUDIO_TIMEOUT_MS ?? Number(process.env.LM_STUDIO_TIMEOUT_SECONDS ?? 120) * 1000);
  if (!Number.isFinite(value) || value <= 0) return 120_000;
  return Math.min(value, 600_000);
}

function lmStudioLoadOptions() {
  const contextLength = lmStudioContextLength();
  return {
    verbose: false,
    ...(contextLength ? { config: { contextLength } } : {})
  };
}

function lmStudioContextLength() {
  const value = parseContextLength(process.env.LM_STUDIO_CONTEXT_LENGTH ?? process.env.LM_STUDIO_CONTEXT ?? "32768");
  if (!Number.isFinite(value) || value <= 0) return 32768;
  return Math.max(4096, Math.min(131_072, value));
}

function parseContextLength(value: string) {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*k$/);
  if (match?.[1]) return Math.round(Number(match[1]) * 1024);
  return Number(normalized);
}

function lmStudioModelDownloadTimeoutMs() {
  const value = Number(process.env.LM_STUDIO_MODEL_DOWNLOAD_TIMEOUT_MS ?? Number(process.env.LM_STUDIO_MODEL_DOWNLOAD_TIMEOUT_SECONDS ?? 30 * 60) * 1000);
  if (!Number.isFinite(value) || value <= 0) return 30 * 60_000;
  return Math.min(value, 120 * 60_000);
}

function lmStudioAutoDownloadEnabled() {
  const value = process.env.LM_STUDIO_AUTO_DOWNLOAD?.trim().toLowerCase();
  return value !== "0" && value !== "false" && value !== "off";
}

function lmStudioTemperature() {
  const value = Number(process.env.LM_STUDIO_TEMPERATURE ?? 0.2);
  if (!Number.isFinite(value)) return 0.2;
  return Math.max(0, Math.min(1, value));
}

function formatExecError(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const details = [error.message];
  const maybeOutput = error as Error & { stderr?: unknown; stdout?: unknown; code?: unknown };
  if (maybeOutput.code !== undefined) details.push(`code=${String(maybeOutput.code)}`);
  if (typeof maybeOutput.stderr === "string" && maybeOutput.stderr.trim()) details.push(maybeOutput.stderr.trim());
  if (typeof maybeOutput.stdout === "string" && maybeOutput.stdout.trim()) details.push(maybeOutput.stdout.trim());
  return details.join(" ");
}
