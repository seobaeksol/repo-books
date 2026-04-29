# Repo Books 문서

이 디렉토리는 Repo Books의 제품 요구사항, 생성 아키텍처, UI 원칙, 에이전트 협업 규칙을 정리한다.

## 문서 지도

| 위치 | 내용 |
| --- | --- |
| [requirements/README.md](./requirements/README.md) | 제품 요구사항과 MVP 수용 기준 |
| [architecture/multi-stage-generation.md](./architecture/multi-stage-generation.md) | 저장소를 긴 기술서로 변환하는 다단계 생성 파이프라인 |
| [design/liquid-glass-uiux-principles.md](./design/liquid-glass-uiux-principles.md) | UI/UX 설계 원칙 |
| [wireframes/apple-books-repo-books-flow.md](./wireframes/apple-books-repo-books-flow.md) | 책장, 생성, reader 흐름 와이어프레임 |
| [agents/team-operating-model.md](./agents/team-operating-model.md) | Codex 에이전트 팀 운영 모델 |

## 구현 기준

- 앱 코드는 `apps/web`과 `apps/api`에 있다.
- 공유 타입, Zod schema, seed fixture는 `packages/shared`에 있다.
- 이전 정적 목업과 생성된 스크린샷 산출물은 저장소에 보관하지 않는다.

## MVP 상태

현재 구현은 로컬 실행 가능한 MVP 기반이다. 저장소 분석은 로컬 API의 indexer/analyzer가 수행하고, 생성기는 LM Studio 모델 준비, 대단원 계획, 소단원 계획, 챕터 근거 수집, section 계획, section 본문 생성, 챕터 수리, 책 일관성 점검을 순차 실행한다. 생성 화면은 `lms ls --llm --variants --json` 모델 목록, 독자 수준, 책의 목적, 생성 깊이, 커스텀 프롬프트를 받아 background generation run을 시작한다. 선택 모델이 로컬에 없으면 `lms get <model>`을 한 번 실행한 뒤 로드를 재시도한다. 실패한 section/chapter는 deterministic prose로 조용히 채우지 않고 실패 상태와 artifact를 남기며, 실패 챕터 retry도 같은 LM 생성 파이프라인을 다시 실행한다. 사용자별 읽기/UI/tutor 상태는 로컬 profile로 분리하고, JSON sync snapshot을 export/import할 수 있다.
