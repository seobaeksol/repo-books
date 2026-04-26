# 데이터와 비기능 요구사항

## 주요 데이터 모델

### RepoBook

| 필드 | 설명 |
| --- | --- |
| id | 책 ID |
| title | 책 제목 |
| subtitle | 짧은 부제 |
| repositoryUrl | 원본 저장소 URL 또는 경로 |
| repositoryName | 표시용 저장소명 |
| coverTheme | 책 표지 색상/스타일 |
| lmStudioModel | 생성에 사용한 모델 |
| audience | 독자 수준 |
| status | `draft`, `generating`, `in_progress`, `completed`, `failed` |
| progressPercent | 전체 진행률 |
| currentChapterId | 마지막으로 읽은 Chapter ID |
| lastReadAt | 마지막 열람 시각 |
| createdAt | 생성 시각 |
| updatedAt | 수정 시각 |

### BookPart

| 필드 | 설명 |
| --- | --- |
| id | Part ID |
| bookId | 책 ID |
| title | Part 제목 |
| summary | Part 요약 |
| order | 정렬 순서 |
| chapterIds | 포함 Chapter ID 목록 |
| progressPercent | Part 진행률 |

### BookChapter

| 필드 | 설명 |
| --- | --- |
| id | Chapter ID |
| bookId | 책 ID |
| partId | Part ID |
| number | `1.1`, `1.2` 같은 표시 번호 |
| title | Chapter 제목 |
| subtitle | 짧은 부제 |
| objectives | 읽기 목표 목록 |
| sections | 본문 섹션 목록 |
| relatedFiles | 관련 파일 목록 |
| codeAnchors | 코드 앵커 목록 |
| checkpoints | 체크포인트 목록 |
| estimatedMinutes | 예상 읽기 시간 |
| status | `not_started`, `in_progress`, `current`, `completed`, `failed` |
| scrollPosition | 마지막 읽은 위치 |

### GenerationRun

| 필드 | 설명 |
| --- | --- |
| id | 생성 실행 ID |
| bookId | 책 ID |
| repositorySnapshotId | 분석 스냅샷 ID |
| model | 사용 모델 |
| phase | `scan`, `toc`, `chapter`, `repair`, `done`, `failed` |
| progressPercent | 생성 진행률 |
| errorMessage | 실패 메시지 |
| rawResponseRef | 원문 응답 보존 위치 |
| createdAt | 생성 시작 시각 |
| completedAt | 완료 시각 |

### ReadingState

| 필드 | 설명 |
| --- | --- |
| bookId | 책 ID |
| chapterId | Chapter ID |
| progressPercent | Chapter 진행률 |
| scrollPosition | 본문 스크롤 위치 |
| completedCheckpointIds | 완료한 체크포인트 ID 목록 |
| focusModeEnabled | 포커스 모드 여부 |
| tocPanelOpen | 목차 패널 열림 여부 |
| tutorPanelOpen | AI 패널 열림 여부 |
| updatedAt | 수정 시각 |

### TutorThread

| 필드 | 설명 |
| --- | --- |
| id | 대화 ID |
| bookId | 책 ID |
| chapterId | Chapter ID |
| title | 대화 제목 |
| createdAt | 생성 시각 |
| updatedAt | 수정 시각 |

### TutorMessage

| 필드 | 설명 |
| --- | --- |
| id | 메시지 ID |
| threadId | 대화 ID |
| role | `user`, `tutor`, `system` |
| content | 메시지 내용 |
| relatedAnchors | 답변과 연결된 코드 앵커 |
| createdAt | 생성 시각 |

### UIState

| 필드 | 설명 |
| --- | --- |
| lastRoute | 마지막 화면 위치 |
| selectedLibraryFilter | 책장 필터 |
| selectedCollectionId | 선택한 컬렉션 |
| bottomNavTab | 모바일 하단 탭 |
| draftTutorMessage | AI 입력 초안 |
| generationFormDraft | 목차 생성 입력 초안 |

## 실시간 저장 요구사항

다음 데이터는 실시간 또는 짧은 지연 저장 방식으로 보존한다.

- 책 생성 입력값
- 생성된 목차와 Chapter 본문
- 최근 읽은 책 순서
- 현재 Chapter 위치
- 본문 스크롤 위치
- 체크포인트 완료 상태
- AI Tutor 대화 메시지
- AI 입력 초안
- 목차/AI 패널 열림 상태
- 포커스 모드 상태

## 저장 정책

- 사용자 입력 초안은 디바운스 저장한다.
- 책 생성 결과, Chapter 본문, AI 응답은 즉시 저장한다.
- Chapter 이동과 읽기 위치는 짧은 지연 저장을 허용한다.
- 저장 실패 시 UI에 저장 실패 상태를 표시한다.
- 저장 실패 데이터는 재시도 큐에 보관한다.

## 로컬 우선 데이터 원칙

- MVP는 로컬 실행과 로컬 저장을 기본 전제로 한다.
- 저장소 내용과 읽기 기록은 사용자의 명시적 동의 없이 외부 서버로 전송하지 않는다.
- LM Studio가 로컬에서 동작한다는 전제하에 모델 요청도 로컬 네트워크 범위에서 처리한다.
- 민감 파일은 기본 제외 목록에 포함할 수 있어야 한다.
- 사용자는 추가 제외 패턴을 설정할 수 있어야 한다.

## 성능 요구사항

| 항목 | 요구사항 |
| --- | --- |
| 책장 로딩 | 일반적인 로컬 데이터 기준 1초 이내 |
| 최근 읽은 책 갱신 | Chapter 열람 후 즉시 반영 |
| Reader 전환 | 저장된 Chapter 기준 1초 이내 |
| AI 응답 | 스트리밍 또는 생성 중 표시 제공 |
| 저장소 분석 | 진행률과 현재 단계 표시 |
| 긴 저장소 처리 | 파일 제외, 청크, 요약으로 컨텍스트 크기 제어 |

## 접근성 요구사항

- 주요 버튼과 bottom navigation은 키보드로 접근 가능해야 한다.
- LM Studio 연결 상태는 색만으로 표현하지 않는다.
- 책 진행률, 생성 실패, 읽기 상태는 텍스트와 아이콘을 함께 사용한다.
- 목차와 AI bottom sheet는 스크린 리더에서 역할과 닫기 동작이 명확해야 한다.
- 긴 코드와 긴 AI 답변은 화면을 깨지 않고 읽을 수 있어야 한다.

## 오류 처리 요구사항

| 오류 | 처리 |
| --- | --- |
| 저장소 URL/경로 오류 | 입력 확인 메시지와 재입력 안내 |
| LM Studio 연결 오류 | 책장 상태 표시, 설정 확인, 재시도 제공 |
| 모델 응답 오류 | 재시도 버튼과 오류 상세 보기 |
| 목차 생성 실패 | 분석 결과 유지 후 재생성 가능 |
| Chapter 생성 실패 | 해당 Chapter만 재시도 가능 |
| 저장 실패 | 자동 재시도와 사용자 알림 |
| 컨텍스트 초과 | 관련 파일 축소 또는 요약 후 재시도 |

## 보안과 개인정보

- 저장소 경로, 책 본문, 읽기 기록은 로컬 저장을 기본값으로 한다.
- 모델 요청 로그에 전체 파일 내용이 무분별하게 남지 않도록 한다.
- 제외 패턴에 포함된 파일은 분석, 프롬프트, 로그에 포함하지 않는다.
- 외부 GitHub URL을 다루는 경우 사용자에게 네트워크 접근 사실을 명확히 알려야 한다.
