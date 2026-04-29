import type { IndexedFile, RepoIndex } from "./indexer.js";

export type RepositoryArchetype = "web-app" | "api-service" | "rust-library" | "embedded-hal" | "cli" | "monorepo" | "library";

export type RepositoryFlow = {
  id: string;
  type: "architecture" | "execution" | "data" | "configuration" | "testing" | "concept";
  title: string;
  summary: string;
  files: string[];
};

export type RepositoryAnalysis = {
  archetypes: RepositoryArchetype[];
  summary: string;
  flows: RepositoryFlow[];
  entryFiles: string[];
  verificationFiles: string[];
  configurationFiles: string[];
};

export function analyzeRepository(index: RepoIndex): RepositoryAnalysis {
  const archetypes = inferArchetypes(index);
  const entryFiles = selectEntryFiles(index);
  const configurationFiles = index.files
    .filter((file) => file.kind === "manifest" || file.configKeys.length > 0)
    .sort(compareByRepositoryImportance)
    .map((file) => file.path)
    .slice(0, 12);
  const verificationFiles = index.files
    .filter((file) => file.kind === "test" || file.testTargets.length > 0)
    .sort(compareByRepositoryImportance)
    .map((file) => file.path)
    .slice(0, 12);
  const flows = buildFlows(index, archetypes, entryFiles, configurationFiles, verificationFiles);

  return {
    archetypes,
    summary: `${index.repoName} is classified as ${archetypes.join(", ")} with ${entryFiles.length || 1} likely entry surface and ${verificationFiles.length} verification file groups.`,
    flows,
    entryFiles,
    verificationFiles,
    configurationFiles
  };
}

export function evidenceRole(file: IndexedFile) {
  if (file.kind === "readme") return "제품 목적과 첫 실행 경험";
  if (file.kind === "manifest") return "빌드, 의존성, feature 계약";
  if (file.kind === "test") return "동작 보증과 회귀 방지";
  if (file.routes.length > 0) return "외부 API와 요청 흐름";
  if (file.configKeys.length > 0) return "설정값이 런타임에 주는 영향";
  if (file.kind === "rust" || file.path.includes("/src/")) return "핵심 구현과 공개 symbol";
  if (file.kind === "doc") return "운영/기여 판단 근거";
  return "보조 근거";
}

function inferArchetypes(index: RepoIndex): RepositoryArchetype[] {
  const archetypes = new Set<RepositoryArchetype>();
  if (index.signals.isEmbedded || index.signals.noStd) archetypes.add("embedded-hal");
  if (index.signals.isRust) archetypes.add("rust-library");
  if (index.packages.length > 1 || index.topLevelDirs.some((dir) => ["apps", "packages", "crates"].includes(dir.name))) archetypes.add("monorepo");
  if (index.files.some((file) => file.routes.length > 0 || file.path.includes("/api/"))) archetypes.add("api-service");
  if (index.files.some((file) => /src\/(App|main)\.(tsx|jsx|ts|js)$/.test(file.path) || file.dependencies.some((dependency) => /react|vite|next/.test(dependency)))) {
    archetypes.add("web-app");
  }
  if (index.files.some((file) => file.path.includes("/bin/") || file.commands.some((command) => /^bin:|^start:/.test(command)))) archetypes.add("cli");
  if (archetypes.size === 0) archetypes.add("library");
  return Array.from(archetypes);
}

function selectEntryFiles(index: RepoIndex) {
  const preferred = [
    "README.md",
    "package.json",
    "Cargo.toml",
    "apps/api/src/app.ts",
    "apps/api/src/index.ts",
    "apps/web/src/App.tsx",
    "apps/web/src/main.tsx",
    "src/lib.rs",
    "src/main.rs"
  ];
  const paths = new Set(index.files.map((file) => file.path));
  const entries = preferred.filter((path) => paths.has(path));
  const discovered = index.files
    .filter((file) => file.path.endsWith("/src/main.rs") || file.path.endsWith("/src/lib.rs") || file.path.endsWith("/src/app.ts") || file.path.endsWith("/src/App.tsx"))
    .sort(compareByRepositoryImportance)
    .map((file) => file.path);
  return Array.from(new Set([...entries, ...discovered])).slice(0, 12);
}

function compareByRepositoryImportance(a: IndexedFile, b: IndexedFile) {
  return repositoryImportanceScore(b) - repositoryImportanceScore(a) || a.path.localeCompare(b.path);
}

function repositoryImportanceScore(file: IndexedFile) {
  let score = 0;
  if (file.path === "README.md") score += 120;
  if (file.path === "Cargo.toml" || file.path === "package.json") score += 110;
  if (/^esp-hal\/(?:README\.md|Cargo\.toml|src\/lib\.rs)$/.test(file.path)) score += 105;
  if (/^esp-hal\/src\/(?:gpio|clock|dma|interrupt|peripherals|soc|system|timer|uart|spi|i2c|rmt|rtc_cntl|psram)\b/.test(file.path)) score += 90;
  if (/^[^/]+\/src\/lib\.rs$/.test(file.path)) score += 70;
  if (/^[^/]+\/(?:README\.md|Cargo\.toml)$/.test(file.path)) score += 62;
  if (file.path.startsWith("examples/README.md") || file.path.startsWith("examples/hello_world/")) score += 58;
  if (file.path.startsWith("hil-test/") || file.path.startsWith("qa-test/")) score += 45;
  if (file.kind === "readme") score += 35;
  if (file.kind === "manifest") score += 30;
  if (file.kind === "rust") score += 25;
  if (file.symbolDetails.length > 0) score += 18;
  if (file.features.length > 0 || file.dependencies.length > 0) score += 12;
  if (file.testTargets.length > 0) score += 12;
  if (file.path.startsWith(".github/")) score -= 45;
  if (file.path.startsWith("compile-tests/")) score -= 15;
  return score;
}

function buildFlows(
  index: RepoIndex,
  archetypes: RepositoryArchetype[],
  entryFiles: string[],
  configurationFiles: string[],
  verificationFiles: string[]
): RepositoryFlow[] {
  const flows: RepositoryFlow[] = [];
  flows.push({
    id: "entry-model",
    type: "architecture",
    title: "저장소 책임과 엔트리 표면",
    summary: `${index.repoName}의 목적은 README/manifest와 엔트리 파일에서 드러나는 공개 사용 경험을 중심으로 이해한다.`,
    files: entryFiles.slice(0, 5)
  });
  if (archetypes.includes("api-service")) {
    flows.push({
      id: "request-flow",
      type: "execution",
      title: "API 요청이 저장소 내부 상태로 연결되는 흐름",
      summary: "Route handler, repository layer, persistence 코드가 외부 요청을 데이터 변경으로 바꾸는 경로를 설명한다.",
      files: index.files.filter((file) => file.routes.length > 0 || file.path.includes("/db.")).map((file) => file.path).slice(0, 6)
    });
  }
  if (archetypes.includes("web-app")) {
    flows.push({
      id: "ui-state-flow",
      type: "data",
      title: "UI 상태가 API와 reader 화면으로 이어지는 흐름",
      summary: "React entry, API client, reader state가 책장과 챕터 화면을 어떻게 갱신하는지 설명한다.",
      files: index.files.filter((file) => /apps\/web\/src\/(App|main|lib\/api)/.test(file.path)).map((file) => file.path).slice(0, 6)
    });
  }
  if (configurationFiles.length > 0) {
    flows.push({
      id: "configuration-flow",
      type: "configuration",
      title: "설정과 의존성이 런타임 계약을 정하는 방식",
      summary: "Manifest, config key, script는 실행 가능성, 기능 범위, 로컬 개발 조건을 고정한다.",
      files: configurationFiles.slice(0, 6)
    });
  }
  if (verificationFiles.length > 0) {
    flows.push({
      id: "verification-flow",
      type: "testing",
      title: "테스트가 보증하는 사용자 흐름과 변경 안전선",
      summary: "테스트와 검증 문서는 핵심 계약이 어떤 회귀로부터 보호되는지 보여 준다.",
      files: verificationFiles.slice(0, 6)
    });
  }
  return flows.filter((flow) => flow.files.length > 0).slice(0, 8);
}
