# Multi-stage Repo Book Generation

Repo Books의 생성 목표는 저장소를 읽는 방법 안내서가 아니라, 생성된 책만 읽어도 저장소의 목적, 구조, 실행 흐름, 변경 지점을 이해할 수 있는 긴 기술서를 만드는 것이다. 이를 위해 생성기는 단일 목차/본문 합성 흐름이 아니라 여러 단계의 장기 실행 파이프라인으로 동작한다.

## Pipeline

```text
scan/index
  -> repository analysis
  -> part plan
  -> chapter plan
  -> chapter brief
  -> section plan
  -> section draft
  -> chapter revise
  -> book coherence pass
  -> quality validation
```

각 단계는 이전 단계 산출물을 입력으로 받아 다음 구조를 만든다.

| 단계 | 산출물 | 목적 |
| --- | --- | --- |
| scan/index | `RepoIndex` | 파일 preview, README heading, manifest, script, dependency, symbol, route, config key, test target 추출 |
| repository analysis | `repository_analysis` artifact | repo archetype, entry file, verification/configuration file, 핵심 흐름 후보 추출 |
| part plan | `part_plan` artifact | 저장소 전체 arc를 4-7개 대단원으로 설계 |
| chapter plan | `chapter_plan` artifact | 각 대단원을 3-6개 소단원과 핵심 질문으로 분해 |
| chapter brief | `chapter_brief` artifact | 소단원 책임, 흐름, code anchor, evidence, glossary, recap 구성 |
| section plan | `section_plan` artifact | 챕터 내부 5-8개 section 설계 |
| section draft | `section_draft` artifact | section별 장문 본문 생성과 evidence 검증 |
| chapter revise | `chapter_revision` artifact | 중복 제거, 흐름 보강, 누락 근거 수리 |
| coherence pass | `book_coherence` artifact | 용어, 순서, recap, 다음 장 연결 점검 |
| quality validation | `quality_issues` artifact | 메타 표현, 근거 없는 단정, 실제 파일 경로 연결 검증 |

## LM Studio Integration

`apps/api/src/generation/proseAdapter.ts`의 structured generation client는 내부적으로 다음 형태를 제공한다.

```ts
generateJson<T>(task, schemaName, context)
```

현재 단계별 schema name은 다음과 같다.

- `RepoBookPartPlan`
- `RepoBookChapterPlan`
- `RepoBookChapterBrief`
- `RepoBookSectionPlan`
- `RepoBookSectionDraft`
- `RepoBookChapterRevision`
- `RepoBookCoherenceReview`

LM Studio가 설정되지 않은 경우에는 저장소 index와 fallback seed를 사용해 로컬 구조화 생성을 수행한다. LM Studio가 설정됐지만 단계별 section draft가 품질 검증을 통과하지 못하면 high-quality mode에서는 deterministic prose로 본문을 조용히 채우지 않는다. 해당 chapter run은 `failed`가 되고, 실패 사유와 draft artifact가 저장된다.

## Quality Gates

본문 section은 다음 조건을 통과해야 한다.

- 최소 분량을 만족해야 한다.
- 본문에 실제 evidence path, code anchor, config, route, symbol, test target 중 하나 이상이 연결되어야 한다.
- `프롬프트`, `JSON parsing`, `adapter`, `모델 응답` 같은 생성 내부 표현이 없어야 한다.
- Markdown-only 응답, code fence, 파일 나열형 본문은 거부한다.

책 단위 validator는 다음을 추가로 확인한다.

- 챕터의 파일 경로가 실제 index에 존재한다.
- 각 챕터는 충분한 evidence 또는 symbol/config/test 근거를 가진다.
- 본문 주장은 `codeAnchors` 또는 `evidence`와 연결된다.
- 품질 이슈는 `quality_issues` artifact로 남긴다.

## Storage And Retry

생성 실행은 `generation_runs`에 저장되고, 챕터별 상태는 `generation_chapter_runs`에 저장된다. 긴 생성 중단, 디버깅, 품질 비교를 위해 단계별 산출물은 `generation_artifacts`에 저장한다.

실패한 챕터 retry는 전체 책을 다시 만들지 않는다. 기존 run/book에 남아 있는 chapter evidence, code anchor, recap을 사용해 해당 챕터의 5-8개 section을 다시 구성하고 `chapter_retry_repair` artifact를 남긴다.

## UI Contract

Reader는 기존 3열 구조를 유지한다. 새 구조의 챕터는 중앙 본문에서 다음 순서로 읽힌다.

```text
핵심 질문
책임
흐름
핵심 구현
근거
변경 판단
Glossary
Recap
```

기존 seed 또는 legacy book처럼 structured body가 없는 책은 `sections` 중심 렌더링으로 fallback한다.
