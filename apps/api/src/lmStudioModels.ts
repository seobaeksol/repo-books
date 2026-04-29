import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LmStudioModelOption, LmStudioModelsResponse } from "@repo-books/shared";

const execFileAsync = promisify(execFile);
const CACHE_TTL_MS = 60_000;
const LIST_TIMEOUT_MS = 15_000;

type CacheEntry = {
  fetchedAt: number;
  cachedAt: string;
  models: Array<Omit<LmStudioModelOption, "cachedAt" | "stale">>;
};

type UnknownRecord = Record<string, unknown>;

let cachedModels: CacheEntry | null = null;
let pendingRefresh: Promise<LmStudioModelsResponse> | null = null;

export async function listLmStudioModels(options: { refresh?: boolean } = {}): Promise<LmStudioModelsResponse> {
  const now = Date.now();
  if (!options.refresh && cachedModels && now - cachedModels.fetchedAt < CACHE_TTL_MS) {
    return cacheResponse(cachedModels, false);
  }

  if (!options.refresh && pendingRefresh) return pendingRefresh;

  pendingRefresh = refreshLmStudioModels()
    .catch((error) => {
      const message = cleanErrorMessage(error instanceof Error ? error.message : String(error));
      if (cachedModels) return { ...cacheResponse(cachedModels, true), error: message };
      return { models: [], cachedAt: null, stale: false, error: message };
    })
    .finally(() => {
      pendingRefresh = null;
    });

  return pendingRefresh;
}

export function resetLmStudioModelCache() {
  cachedModels = null;
  pendingRefresh = null;
}

async function refreshLmStudioModels(): Promise<LmStudioModelsResponse> {
  const command = process.env.LM_STUDIO_LMS_BIN?.trim() || "lms";
  try {
    const output = (await execFileAsync(command, ["ls", "--llm", "--variants", "--json"], {
      timeout: LIST_TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024
    })) as unknown;
    const stdout = typeof output === "string" ? output : isRecord(output) ? stringValue(output.stdout) : "";
    const cachedAt = new Date().toISOString();
    const models = normalizeLmStudioModels(JSON.parse(stdout));
    cachedModels = { fetchedAt: Date.now(), cachedAt, models };
    return cacheResponse(cachedModels, false);
  } catch (error) {
    throw new Error(`LM_STUDIO_MODEL_LIST_FAILED: ${command} ls --llm --variants --json: ${formatExecError(error)}`);
  }
}

function cacheResponse(cache: CacheEntry, stale: boolean): LmStudioModelsResponse {
  return {
    models: cache.models.map((model) => ({ ...model, cachedAt: cache.cachedAt, stale })),
    cachedAt: cache.cachedAt,
    stale
  };
}

function normalizeLmStudioModels(payload: unknown): Array<Omit<LmStudioModelOption, "cachedAt" | "stale">> {
  if (!Array.isArray(payload)) return [];
  const byKey = new Map<string, Omit<LmStudioModelOption, "cachedAt" | "stale">>();

  for (const item of payload) {
    if (!isRecord(item)) continue;
    const base = isRecord(item.model) ? item.model : item;
    const variants = Array.isArray(item.variants) && item.variants.length ? item.variants : [base];
    for (const variant of variants) {
      if (!isRecord(variant)) continue;
      const normalized = normalizeModel(variant, isRecord(base) ? base : undefined);
      if (normalized) byKey.set(normalized.modelKey, normalized);
    }
  }

  return [...byKey.values()].sort(compareModels);
}

function normalizeModel(model: UnknownRecord, base?: UnknownRecord): Omit<LmStudioModelOption, "cachedAt" | "stale"> | null {
  if (stringValue(model.type) !== "llm") return null;
  const modelKey = stringValue(model.modelKey);
  if (!modelKey) return null;
  const path = stringValue(model.path) || stringValue(base?.path) || modelKey.split("@")[0] || modelKey;
  const displayName = stringValue(model.displayName) || stringValue(base?.displayName) || modelKey;
  const publisher = stringValue(model.publisher) || stringValue(base?.publisher) || path.split("/")[0] || "";
  return {
    modelKey,
    displayName,
    path,
    publisher,
    paramsString: stringValue(model.paramsString) || stringValue(base?.paramsString) || undefined,
    quantization: quantizationValue(model.quantization) ?? quantizationValue(base?.quantization),
    sizeBytes: numberValue(model.sizeBytes) ?? numberValue(base?.sizeBytes),
    maxContextLength: numberValue(model.maxContextLength) ?? numberValue(base?.maxContextLength),
    vision: booleanValue(model.vision) ?? booleanValue(base?.vision) ?? false,
    trainedForToolUse: booleanValue(model.trainedForToolUse) ?? booleanValue(base?.trainedForToolUse) ?? false
  };
}

function compareModels(a: Omit<LmStudioModelOption, "cachedAt" | "stale">, b: Omit<LmStudioModelOption, "cachedAt" | "stale">) {
  return (
    a.publisher.localeCompare(b.publisher) ||
    a.path.localeCompare(b.path) ||
    a.displayName.localeCompare(b.displayName) ||
    (a.quantization?.name ?? "").localeCompare(b.quantization?.name ?? "") ||
    a.modelKey.localeCompare(b.modelKey)
  );
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function quantizationValue(value: unknown) {
  if (!isRecord(value)) return null;
  const name = stringValue(value.name);
  const bits = numberValue(value.bits);
  if (!name && bits === null) return null;
  return {
    ...(name ? { name } : {}),
    ...(bits !== null ? { bits } : {})
  };
}

function formatExecError(error: unknown) {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return cleanErrorMessage([record.message, record.stderr, record.stdout].filter(Boolean).join("\n"));
  }
  return cleanErrorMessage(String(error));
}

function cleanErrorMessage(message: string) {
  return message.replace(/\u001b\[[0-9;]*m/g, "").trim();
}
