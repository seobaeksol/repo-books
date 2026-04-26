import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import type { MaterializedRepository } from "./source.js";

export type IndexedFile = {
  path: string;
  extension: string;
  kind: "readme" | "manifest" | "rust" | "example" | "test" | "doc" | "config" | "script" | "other";
  size: number;
  lineCount: number;
  headings: string[];
  symbols: string[];
  packageName: string | null;
  preview: string;
  lines: string[];
};

export type RepoIndex = {
  rootPath: string;
  repoUrl: string;
  repoSlug: string;
  repoName: string;
  branch: string;
  commit: string | null;
  files: IndexedFile[];
  packages: Array<{ name: string; path: string }>;
  topLevelDirs: Array<{ name: string; files: number }>;
  signals: {
    isRust: boolean;
    isEmbedded: boolean;
    isEspHal: boolean;
    noStd: boolean;
    chips: string[];
    peripherals: string[];
    examples: string[];
  };
};

const ignoredDirectories = new Set([
  ".git",
  "target",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__"
]);

const textExtensions = new Set([
  "",
  ".rs",
  ".toml",
  ".md",
  ".yml",
  ".yaml",
  ".json",
  ".sh",
  ".py",
  ".c",
  ".h",
  ".s",
  ".ld",
  ".x",
  ".template",
  ".csv"
]);

export function buildRepoIndex(source: MaterializedRepository): RepoIndex {
  const paths = walk(source.rootPath).slice(0, 1600);
  const files = paths.map((path) => indexFile(source.rootPath, path)).filter((file): file is IndexedFile => Boolean(file));
  const packages = files
    .filter((file) => file.path.endsWith("Cargo.toml") && file.packageName)
    .map((file) => ({ name: file.packageName ?? "", path: file.path }));
  const topLevelDirs = summarizeTopLevelDirs(files);
  const allText = files.map((file) => `${file.path}\n${file.preview}`).join("\n");
  const peripherals = inferPeripherals(files);
  const examples = files
    .filter((file) => file.kind === "example")
    .map((file) => file.path.split("/").slice(0, -1).join("/"))
    .filter(unique)
    .slice(0, 24);

  return {
    rootPath: source.rootPath,
    repoUrl: source.repoUrl,
    repoSlug: source.repoSlug,
    repoName: source.repoName,
    branch: source.branch,
    commit: source.commit,
    files,
    packages,
    topLevelDirs,
    signals: {
      isRust: files.some((file) => file.extension === ".rs") || packages.length > 0,
      isEmbedded: /no_std|embedded-hal|embassy|cortex|riscv|xtensa|peripheral/i.test(allText),
      isEspHal:
        /esp-hal|esp-rs|Espressif|ESP32|xtensa|riscv32im/i.test(allText) ||
        files.some((file) => file.path.startsWith("esp-hal/src/")),
      noStd: /#!\[no_std\]|no_std/i.test(allText),
      chips: inferChips(allText),
      peripherals,
      examples
    }
  };
}

function walk(rootPath: string, current = rootPath): string[] {
  const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      files.push(...walk(rootPath, join(current, entry.name)));
      continue;
    }
    if (!entry.isFile()) continue;
    const fullPath = join(current, entry.name);
    const relativePath = relative(rootPath, fullPath).split(sep).join("/");
    if (isTextCandidate(relativePath, fullPath)) files.push(relativePath);
  }
  return files;
}

function isTextCandidate(path: string, fullPath: string) {
  const extension = extname(path).toLowerCase();
  if (!textExtensions.has(extension)) return false;
  const size = statSync(fullPath).size;
  return size > 0 && size <= 512_000;
}

function indexFile(rootPath: string, path: string): IndexedFile | null {
  const fullPath = join(rootPath, path);
  const size = statSync(fullPath).size;
  const raw = readFileSync(fullPath, "utf8");
  if (raw.includes("\u0000")) return null;
  const lines = raw.split(/\r?\n/);
  return {
    path,
    extension: extname(path).toLowerCase(),
    kind: classifyFile(path),
    size,
    lineCount: lines.length,
    headings: extractHeadings(lines),
    symbols: extractSymbols(lines),
    packageName: path.endsWith("Cargo.toml") ? extractCargoPackageName(raw) : null,
    preview: lines.slice(0, 80).join("\n"),
    lines: lines.slice(0, 260)
  };
}

function classifyFile(path: string): IndexedFile["kind"] {
  const lower = path.toLowerCase();
  if (lower.endsWith("readme.md")) return "readme";
  if (lower.endsWith("cargo.toml") || lower.endsWith("package.json")) return "manifest";
  if (lower.startsWith("examples/")) return "example";
  if (lower.includes("test") || lower.startsWith("hil-test/") || lower.startsWith("qa-test/") || lower.startsWith("compile-tests/")) return "test";
  if (lower.startsWith("documentation/") || lower.startsWith("docs/") || lower.endsWith(".md")) return "doc";
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".toml") || lower.endsWith(".yml") || lower.endsWith(".yaml") || lower.endsWith(".json")) return "config";
  if (lower.endsWith(".sh") || lower.endsWith(".py")) return "script";
  return "other";
}

function extractHeadings(lines: string[]) {
  return lines
    .map((line) => line.match(/^#{1,4}\s+(.+)$/)?.[1]?.trim())
    .filter((value): value is string => Boolean(value))
    .slice(0, 12);
}

function extractSymbols(lines: string[]) {
  return lines
    .map((line) => line.match(/^\s*(?:pub\s+)?(?:async\s+)?(?:struct|enum|trait|fn|mod|type|const|macro_rules!)\s+([A-Za-z0-9_]+)/)?.[0]?.trim())
    .filter((value): value is string => Boolean(value))
    .slice(0, 20);
}

function extractCargoPackageName(raw: string) {
  return raw.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1] ?? null;
}

function summarizeTopLevelDirs(files: IndexedFile[]) {
  const counts = new Map<string, number>();
  for (const file of files) {
    const [head] = file.path.split("/");
    counts.set(head ?? file.path, (counts.get(head ?? file.path) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, files: count }))
    .sort((a, b) => b.files - a.files)
    .slice(0, 20);
}

function inferChips(text: string) {
  const chips = ["ESP32", "ESP32-C2", "ESP32-C3", "ESP32-C5", "ESP32-C6", "ESP32-C61", "ESP32-H2", "ESP32-S2", "ESP32-S3"];
  return chips.filter((chip) => new RegExp(`\\b${chip}\\b`, "i").test(text));
}

function inferPeripherals(files: IndexedFile[]) {
  const names = new Set<string>();
  for (const file of files) {
    const match = file.path.match(/^esp-hal\/src\/([^/]+)/);
    if (!match?.[1]) continue;
    const ignored = new Set(["lib.rs", "fmt.rs", "macros.rs", "private.rs", "sync.rs", "time.rs"]);
    if (!ignored.has(match[1])) names.add(match[1].replace(/\.rs$/, ""));
  }
  return Array.from(names).sort().slice(0, 40);
}

function unique<T>(value: T, index: number, values: T[]) {
  return values.indexOf(value) === index;
}
