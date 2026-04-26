# Repo Books 문서

이 디렉토리는 Repo Books의 제품 요구사항, UI 원칙, 에이전트 협업 규칙을 정리한다.

## 문서 지도

| 위치 | 내용 |
| --- | --- |
| [requirements/README.md](./requirements/README.md) | 제품 요구사항과 MVP 수용 기준 |
| [design/liquid-glass-uiux-principles.md](./design/liquid-glass-uiux-principles.md) | UI/UX 설계 원칙 |
| [wireframes/apple-books-repo-books-flow.md](./wireframes/apple-books-repo-books-flow.md) | 책장, 생성, reader 흐름 와이어프레임 |
| [agents/team-operating-model.md](./agents/team-operating-model.md) | Codex 에이전트 팀 운영 모델 |

## 구현 기준

- 앱 코드는 `apps/web`과 `apps/api`에 있다.
- 공유 타입, Zod schema, seed fixture는 `packages/shared`에 있다.
- 이전 정적 목업과 생성된 스크린샷 산출물은 저장소에 보관하지 않는다.

## MVP 상태

현재 구현은 로컬 실행 가능한 MVP 기반이다. 저장소 분석은 로컬 API의 deterministic scanner와 `esp-hal` 튜닝 profile로 수행하며, LM Studio 추론 호출은 아직 연결하지 않았다.
