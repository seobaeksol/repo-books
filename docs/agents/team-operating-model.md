# Repo Books Agent Team Operating Model

이 문서는 Repo Books 작업에서 리더/메인 개발자가 동료 에이전트들을 언제, 어떤 순서로 활용할지 정리한 운영 기준이다. 목표는 병렬화 자체가 아니라, 결정 품질과 구현 속도, 검증 품질을 함께 올리는 것이다.

## Team Roles

| Role | Agent | Primary Use |
| --- | --- | --- |
| 리더 / 메인 개발자 | current Codex session | 목표 해석, 작업 분해, 핵심 구현, 통합, 최종 결정 |
| 창의 전략가 | `creative_strategist` | 아이디어, 문제 framing, 기획, 옵션 비교, 의사결정 초안 |
| 보조 개발자 | `assistant_developer` | 분리 가능한 구현, 리팩터, mock data, 테스트 보강 |
| 제품 디자이너 | `product_designer` | UI/UX 구조, Liquid Glass 적용, visual polish, asset/spec |
| QA 엔지니어 | `qa_engineer` | 완료된 작업 검증, 회귀/누락/접근성/반응형 피드백 |

## Default Workflow

1. 리더가 사용자 목표와 현재 repo 상태를 확인한다.
2. 모호하거나 창의적 판단이 필요한 경우 `creative_strategist`가 먼저 문제를 구조화한다.
3. UI/UX 또는 시각 방향이 필요한 경우 `product_designer`에게 구현 전 방향을 받는다.
4. 리더가 핵심 구조와 통합 지점을 직접 구현한다.
5. 분리 가능한 작업은 `assistant_developer`에게 명확한 파일/모듈 소유권과 함께 위임한다.
6. 유의미한 변경 단위가 완성되면 `qa_engineer`가 검증한다.
7. 리더가 QA 피드백을 반영하고 최종 상태, URL, 테스트 결과를 사용자에게 보고한다.

## When to Use Creative Strategist

`creative_strategist`는 다음 상황에서 먼저 호출한다.

- 사용자가 “아이디어”, “기획”, “방향”, “가능성”, “전략”, “제품 구조”를 요청한다.
- 구현 전에 2개 이상의 접근법 중 선택해야 한다.
- 기능의 성공 기준, 사용자 가치, MVP 범위, non-goal이 불명확하다.
- UI를 만들기 전 정보 구조와 핵심 경험을 정해야 한다.
- 기술 구현보다 제품 판단이나 작업 순서가 더 큰 리스크다.

출력은 항상 실행 가능한 형태여야 한다.

- 추천 방향
- 대안과 tradeoff
- 성공 기준
- 리스크와 검증 방법
- 디자이너/개발자/QA에게 넘길 hand-off brief

## Delegation Patterns

### 1. Product/Feature Ideation

- `creative_strategist`: 문제 정의, 사용자 시나리오, MVP 범위, 옵션 비교
- `product_designer`: 선택된 방향을 화면 구조와 상호작용으로 구체화
- 리더: 구현 범위 확정과 핵심 구조 작성
- `assistant_developer`: mock data, 독립 컴포넌트, 보조 화면 구현
- `qa_engineer`: 수용 기준과 edge case 검증

### 2. UI/UX Mock-up

- `creative_strategist`: 화면의 목적, 우선순위, 주요 상태 정의
- `product_designer`: Liquid Glass 적용 위치, 레이아웃, 접근성, responsive 기준 정의
- 리더: app shell, interaction, integration 구현
- `assistant_developer`: static data, fixture, 반복 UI 조각 담당
- `qa_engineer`: desktop/tablet/mobile, console, accessibility basics 확인

### 3. Large Implementation

- 리더: 아키텍처, shared contract, 위험도가 높은 파일
- `assistant_developer`: 독립 가능한 파일/모듈
- `product_designer`: UI 변경이 있을 경우 parallel design review
- `qa_engineer`: 구현 완료 후 또는 중간 checkpoint에서 검증
- `creative_strategist`: 범위가 커지거나 우선순위 재조정이 필요할 때만 재투입

### 4. Investigation / Research

- 리더: repo truth와 현재 제약 확인
- `creative_strategist`: 조사 질문을 구조화하고 decision matrix 작성
- 필요 시 authoritative source 확인은 리더가 수행한다.
- 결과가 UI로 이어지면 `product_designer`, 구현으로 이어지면 `assistant_developer`, 품질 확인은 `qa_engineer`에게 넘긴다.

## Delegation Rules

- 한 에이전트에게 한 번에 하나의 명확한 책임을 준다.
- 코드 변경 작업은 파일/모듈 소유권을 명시한다.
- 병렬 작업은 write scope가 겹치지 않게 나눈다.
- 리더가 바로 해야 하는 critical path 작업은 위임하지 않는다.
- 디자인/기획 에이전트에게 구현을 맡기지 않는다. 단, 문서 작성 범위를 명확히 준 경우는 예외다.
- QA는 기본적으로 read-only로 유지한다.
- 모든 agent output은 리더가 통합 판단한다.

## Handoff Templates

### Creative Strategist

```text
Goal:
Context:
Unknowns:
Output needed:
- recommended direction
- 2-4 alternatives with tradeoffs
- success criteria
- handoff notes for design/dev/QA
Do not edit files unless explicitly assigned.
```

### Product Designer

```text
Goal:
Relevant docs:
Target screen/state:
Liquid Glass constraints:
Output needed:
- layout and hierarchy
- interaction states
- responsive/accessibility notes
- implementation-ready notes
Do not edit files unless explicitly assigned.
```

### Assistant Developer

```text
Goal:
Owned files/modules:
Do not touch:
Expected behavior:
Validation:
Final response:
- changed files
- behavior summary
- commands/results
- risks
```

### QA Engineer

```text
Goal:
Changed files/URL:
Acceptance criteria:
Focus areas:
Output findings first, ordered by severity.
Do not edit files.
```

## Current Defaults

- All custom agents use `gpt-5.5` with `model_reasoning_effort = "high"`.
- Team size starts with 5 roles including the leader.
- Default maximum threads remain 12, but extra agents should be spawned only when work is genuinely parallel.
- Liquid Glass design guidance lives in `docs/design/liquid-glass-uiux-principles.md` and should be treated as the UI/UX baseline.
