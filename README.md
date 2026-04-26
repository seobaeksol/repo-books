# Repo Books

Repo Books는 GitHub 저장소를 한 권의 기술서처럼 읽을 수 있게 만드는 로컬 우선 웹앱이다. 저장소 URL을 입력해 책 초안을 만들고, 책장과 reader에서 챕터 단위로 코드를 읽으며 AI tutor 맥락을 저장한다.

현재 MVP는 로컬 저장, 저장소 색인, 장기 실행 repo book 생성을 검증하는 단계다. 생성기는 저장소를 먼저 색인한 뒤 대단원 계획, 소단원 계획, 챕터 근거 수집, section 계획, section 본문 생성, 챕터 수리, 책 일관성 점검을 순차 실행한다. `LM_STUDIO_BASE_URL`이 설정되면 LM Studio의 OpenAI-compatible chat completions를 구조화 JSON 생성 client로 사용하고, 실패한 챕터는 조용히 채우지 않고 `failed` 상태와 generation artifact를 남긴다.

## 주요 기능

- 책장: 최근 읽은 책, 상태 필터, cover grid, 모바일 하단 navigation
- 새 책 생성: repository URL, 모델, 독자 수준, 생성 깊이 입력
- Repository generation: Git checkout, 파일/문서 색인, repo archetype과 evidence 기반 draft book 생성
- Multi-stage generation: 대단원/소단원 계획, chapter brief, section draft, revision, coherence pass
- Generation artifacts: part plan, chapter plan, section draft, revision notes, quality issues 저장
- Background generation: queued/running run polling, SSE event stream, failed chapter repair retry
- Reader: desktop 3열 TOC/page/tutor, mobile TOC/tutor bottom sheet
- Local profiles and sync snapshots: `X-Repo-Books-User` header or `?userId=` scoped reader state, plus JSON export/import
- 상태 복원: 마지막 route, active book/chapter, focus mode, scroll, tutor draft
- 테마: preset theme와 사용자 정의 색상/reader typography
- 로컬 API: Fastify + SQLite 저장소

## Workspace

```text
apps/
  api/      Fastify API, SQLite migration/seed, repository indexer/generator/tutor services
  web/      Vite React TypeScript app
packages/
  shared/   shared domain types, Zod schemas, typed seed fixtures
docs/       requirements, design notes, agent operating model
```

## Requirements

- Node.js compatible with the workspace lockfile
- pnpm 10.30.0

## Setup

```bash
pnpm install
pnpm dev
```

The web app runs at `http://localhost:5173`.
The API runs at `http://localhost:3001`.

SQLite defaults to `.local/repo-books.sqlite`. Override it with:

```bash
REPO_BOOKS_DB_PATH=/path/to/repo-books.sqlite pnpm dev
```

Optional LM Studio structured generation:

```bash
LM_STUDIO_BASE_URL=http://localhost:1234 pnpm dev
```

The structured generation client calls `/v1/chat/completions`. Optional overrides are `LM_STUDIO_MODEL`, `LM_STUDIO_API_KEY`, and `LM_STUDIO_TIMEOUT_MS`.

## Scripts

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:smoke
```

`pnpm test:smoke` runs Playwright against an in-memory API database.

## API Surface

- `GET /api/health`
- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:userId`
- `PATCH /api/users/:userId/activate`
- `GET /api/books?filter=all|in_progress|generating|draft`
- `GET /api/books/:bookId`
- `PATCH /api/reading-state/:bookId`
- `GET /api/ui-state/default`
- `PATCH /api/ui-state/default`
- `POST /api/generation/outline`
- `POST /api/generation/runs`
- `GET /api/generation/runs/:runId`
- `GET /api/generation/runs/:runId/events`
- `POST /api/generation/runs/:runId/chapters/:chapterId/retry`
- `POST /api/generation/runs/:runId/retry-failed-chapters`
- `GET /api/tutor/threads?bookId=&chapterId=`
- `POST /api/tutor/threads/:threadId/messages`
- `GET /api/sync/status`
- `GET|POST /api/sync/export`
- `POST /api/sync/import`

User-scoped routes default to the active local profile. Pass `X-Repo-Books-User: <userId>` or `?userId=<userId>` to read/write another local profile without external sync infrastructure.

## Documentation

- [Documentation index](./docs/README.md)
- [Multi-stage generation architecture](./docs/architecture/multi-stage-generation.md)
- [Requirements](./docs/requirements/README.md)
- [Design principles](./docs/design/liquid-glass-uiux-principles.md)
- [Agent team operating model](./docs/agents/team-operating-model.md)

## Current Scope

Implemented:

- P0 app foundation with persisted local state
- Repository scanner/indexer 기반 book generation and tutor persistence
- esp-rs/esp-hal 전용 5부 14장 생성 profile
- Optional LM Studio structured generation client
- Multi-stage part/chapter/section generation with artifacts and quality gates
- Background generation run polling/SSE and failed chapter repair retry
- Local multi-profile reader state and sync snapshot export/import
- Themeable UI architecture
- Unit, API, and Playwright smoke coverage

Not implemented yet:

- Hosted cloud accounts, remote storage, and real-time multi-device conflict resolution
- Token-level LM streaming into individual chapter prose
