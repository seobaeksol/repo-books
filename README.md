# Repo Books

Repo Books는 GitHub 저장소를 한 권의 기술서처럼 읽을 수 있게 만드는 로컬 우선 웹앱이다. 저장소 URL을 입력해 책 초안을 만들고, 책장과 reader에서 챕터 단위로 코드를 읽으며 AI tutor 맥락을 저장한다.

현재 MVP는 앱 골격과 로컬 저장 흐름을 검증하는 단계다. 실제 LM Studio 호출과 저장소 분석은 교체 가능한 service port와 mock adapter로 분리되어 있다.

## 주요 기능

- 책장: 최근 읽은 책, 상태 필터, cover grid, 모바일 하단 navigation
- 새 책 생성: repository URL, 모델, 독자 수준, 생성 깊이 입력
- Mock generation: 입력값 기반 draft book과 generation run 생성
- Reader: desktop 3열 TOC/page/tutor, mobile TOC/tutor bottom sheet
- 상태 복원: 마지막 route, active book/chapter, focus mode, scroll, tutor draft
- 테마: preset theme와 사용자 정의 색상/reader typography
- 로컬 API: Fastify + SQLite 저장소

## Workspace

```text
apps/
  api/      Fastify API, SQLite migration/seed, mock generation/tutor services
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
- `GET /api/books?filter=all|in_progress|generating|draft`
- `GET /api/books/:bookId`
- `PATCH /api/reading-state/:bookId`
- `GET /api/ui-state/default`
- `PATCH /api/ui-state/default`
- `POST /api/generation/outline`
- `GET /api/tutor/threads?bookId=&chapterId=`
- `POST /api/tutor/threads/:threadId/messages`

## Documentation

- [Documentation index](./docs/README.md)
- [Requirements](./docs/requirements/README.md)
- [Design principles](./docs/design/liquid-glass-uiux-principles.md)
- [Agent team operating model](./docs/agents/team-operating-model.md)

## Current Scope

Implemented:

- P0 app foundation with persisted local state
- Mock book generation and tutor persistence
- Themeable UI architecture
- Unit, API, and Playwright smoke coverage

Not implemented yet:

- Real LM Studio inference
- Real repository cloning/scanning
- Multi-user or cloud sync
