# Repo Books 요구사항 문서

이 디렉토리는 GitHub 저장소를 한 권의 기술서처럼 변환해 읽는 Repo Books 웹앱의 요구사항을 정리한다. 현재 제품 기준은 `web-mockup`의 Apple Books형 책장, 목차 생성, 읽기 화면이다.

## 문서 구조

| 문서 | 목적 |
| --- | --- |
| [01-product-overview.md](./01-product-overview.md) | 제품 목표, 사용자, 범위, 핵심 용어 |
| [02-user-flows.md](./02-user-flows.md) | 책장, 새 책 생성, 목차 생성, 읽기 흐름 |
| [03-functional-requirements.md](./03-functional-requirements.md) | 기능 요구사항과 수용 기준 |
| [04-repo-book-structure.md](./04-repo-book-structure.md) | 책 목차, 챕터, 체크포인트 요구사항 |
| [05-apple-books-ui.md](./05-apple-books-ui.md) | Apple Books형 책장과 읽기 UI 요구사항 |
| [06-ai-tutor-and-lm-studio.md](./06-ai-tutor-and-lm-studio.md) | LM Studio 기반 책 생성과 AI margin tutor 요구사항 |
| [07-data-and-nonfunctional-requirements.md](./07-data-and-nonfunctional-requirements.md) | 데이터 모델, 저장, 접근성, 비기능 요구사항 |

## 제품 한 줄 설명

Repo Books는 GitHub 저장소를 LM Studio 모델로 분석해 대단원/챕터 목차를 가진 repo book으로 만들고, 사용자가 Apple Books 같은 책장과 reader에서 코드를 책처럼 읽으며 AI에게 질문할 수 있게 하는 웹앱이다.

## 우선순위 기준

| 우선순위 | 의미 |
| --- | --- |
| P0 | MVP에서 반드시 필요 |
| P1 | 초기 릴리스 품질을 위해 중요 |
| P2 | 후속 개선 또는 확장 기능 |
