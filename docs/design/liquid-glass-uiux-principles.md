# Apple Books형 Repo Books UI/UX Principles

Repo Books의 현재 UI 기준은 Apple Books식 책장과 ebook reader다. Liquid Glass 계열 표현은 앱의 구조와 조작 레이어를 보조하는 정도로만 사용하고, 본문 읽기와 코드 이해를 방해하지 않는다.

## 제품 구조

Repo Books는 세 개의 핵심 화면으로 구성한다.

| 화면 | 역할 |
| --- | --- |
| 책장 | 변환된 저장소 책을 고르고 최근 읽은 책을 이어서 여는 공간 |
| 목차 생성 | 저장소를 입력하고 LM Studio로 책 목차와 Chapter를 만드는 작업 공간 |
| 읽기 | ebook reader 본문에 목차와 AI Tutor 여백을 결합한 공간 |

책장은 입력 도구가 아니라 library다. 저장소 URL, 생성 설정, 분석 세부 정보는 목차 생성 화면에만 둔다.

## 공통 Shell 원칙

- 상단에는 앱명과 LM Studio 상태만 둔다.
- 상단 GitHub 주소 입력창은 두지 않는다.
- 상단 전역 화면 전환 탭은 두지 않는다.
- 상단 `새 책` 버튼은 두지 않는다.
- 데스크톱 이동은 sidebar로 처리한다.
- 모바일과 태블릿 compact 화면 이동은 bottom navigation과 sheet로 처리한다.

LM Studio 상태는 작고 명확한 상태 표시로 유지한다. 모델명과 분석 세부 정보는 목차 생성 화면에서 다룬다.

## 책장 원칙

### Desktop

Mac Books 앱처럼 좌측 sidebar와 library grid를 사용한다.

- 좌측 sidebar: 홈, 최근 읽은 책, 내 책, 컬렉션, 생성 중, `새 책 만들기`
- 본문 상단: Home 제목
- 본문 첫 영역: 최근 읽은 책 shelf
- 본문 두 번째 영역: 상태 필터
- 본문 세 번째 영역: 내 책 cover grid

책장 본문은 책 목록과 필터만 포함한다. 저장소 입력과 생성 설정은 목차 생성 화면에서만 다룬다.

### iPad/iPhone

Home/Library 중심의 단일 컬럼을 사용한다.

- 상단: 앱명과 LM Studio 상태
- 본문: 최근 읽은 책, 상태 필터, 내 책 grid
- 하단 navigation: 책장, 새 책, 읽기
- 목차와 AI Tutor는 필요할 때 bottom sheet로 표시

좁은 화면에서는 조작 버튼보다 책 표지와 최근 읽은 위치가 먼저 보여야 한다.

## 표지와 Grid

책 카드는 실제 ebook cover처럼 단순한 사각 표지로 보이게 한다.

- 표지: 제목, 상태 badge, 은은한 cover tone
- 메타: 저장소명, 현재 Chapter, 진행률
- 진행률은 텍스트와 bar를 함께 사용
- 긴 제목은 줄바꿈 또는 clamp로 처리
- 카드마다 설명문을 길게 넣지 않음

상태 필터는 `전체`, `읽는 중`, `생성 중`, `초안`을 기본으로 한다.

## 목차 생성 화면 원칙

목차 생성 화면은 책을 만드는 작업 공간이다.

- 화면 자체 toolbar에 `책장으로 돌아가기`, 제목, `읽기 시작`을 둔다.
- 저장소 URL/경로 입력은 이 화면에서만 노출한다.
- LM Studio 모델, 독자 수준, 생성 깊이를 이 화면에서 설정한다.
- 분석 단계와 실패 상태는 진행 패널에서 표시한다.
- 생성된 Part/Chapter 목차는 책 목차처럼 읽히게 배치한다.

## 읽기 화면 원칙

읽기 화면은 본문이 중심이다.

- Desktop: 좌측 목차, 중앙 book page, 우측 AI Tutor
- Mobile: 중앙 본문을 기본으로 두고 목차/AI를 bottom sheet로 표시
- 하단 reading controls는 이전/다음, 목차, AI, 포커스, 보기 설정을 제공
- AI Tutor는 본문을 대체하지 않고 여백에서 질문을 받는다.
- 코드 앵커는 본문 흐름 속에서 근거를 연결하는 보조 요소다.

포커스 모드에서는 목차와 AI를 숨기고 본문 폭을 확장한다.

## Liquid Glass 적용 원칙

Liquid Glass 표현은 기능 레이어에만 제한한다.

**적합한 위치**

- top shell
- sidebar
- bottom navigation
- reading controls
- AI Tutor inspector 또는 sheet
- 주요 toolbar action

**부적합한 위치**

- 책 본문
- 코드 블록
- 긴 AI 답변 본문
- 책 표지 전체
- 반복 card의 장식 배경
- 단순 배경 효과

본문, 코드, AI 답변은 solid 또는 standard material surface를 사용해 가독성을 우선한다.

## 색과 밀도

- 와이어프레임 단계에서는 낮은 충실도의 선, 면, 라벨을 우선한다.
- 브랜드 색은 주요 상태와 선택 항목에 제한적으로 사용한다.
- 한 화면이 단일 색상 계열로만 보이지 않게 한다.
- 코드와 긴 문장은 대비가 충분한 배경 위에 둔다.
- 버튼 텍스트는 모든 viewport에서 잘리지 않아야 한다.

## 모션과 패널

- sheet, inspector, panel은 호출한 컨트롤과 관계가 보이게 열린다.
- 모바일 목차와 AI는 하단 controls 위로 올라오는 bottom sheet로 처리한다.
- Reduce Motion 환경에서는 패널 전환이 즉시 전환되어도 정보 구조가 유지되어야 한다.
- 패널이 열릴 때 본문을 완전히 잃어버리지 않도록 닫기와 복귀 동작을 명확히 제공한다.

## 접근성 체크리스트

- 주요 액션은 키보드로 접근 가능해야 한다.
- bottom navigation과 sidebar item은 현재 선택 상태를 텍스트와 시각 상태로 함께 표현한다.
- LM Studio 연결 상태는 색만으로 표현하지 않는다.
- 생성 실패, 읽는 중, 완료 상태는 텍스트 badge를 함께 사용한다.
- 목차/AI sheet는 스크린 리더에서 제목, 역할, 닫기 동작이 명확해야 한다.
- Dynamic Type 또는 브라우저 확대 상태에서도 책 카드와 controls가 겹치지 않아야 한다.

## 리뷰 체크리스트

- 책장 상단과 본문이 책 선택에 필요한 정보만 담고 있는가?
- Desktop 책장이 sidebar + 최근 읽은 책 + 내 책 grid 구조인가?
- Mobile 책장이 단일 컬럼 + bottom navigation 구조인가?
- 새 책 만들기 진입이 sidebar 또는 bottom navigation으로 가능한가?
- 목차 생성 화면에서만 저장소 입력과 생성 설정을 다루는가?
- 읽기 화면이 목차, 본문, AI Tutor, reading controls를 유지하는가?
- AI Tutor가 본문을 대체하지 않고 읽기 중 대화 창구로 동작하는가?
- 코드와 본문은 glass 없이 충분히 읽기 쉬운가?
