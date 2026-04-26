import {
  type BookChapter,
  type BookPart,
  type GenerationOutlinePart,
  type GenerationRun,
  type PostGenerationOutlinePayload,
  type RepoBook,
  repoBookSchema
} from "@repo-books/shared";
import type { IndexedFile, RepoIndex } from "./indexer.js";
import { slugify } from "./source.js";

type ChapterSpec = {
  title: string;
  subtitle: string;
  files: string[];
  goals: string[];
  focus: string;
  checkpoints: string[];
  codePath?: string;
  codeLabel?: string;
};

type PartSpec = {
  title: string;
  summary: string;
  chapters: ChapterSpec[];
};

export function synthesizeRepoBook(payload: PostGenerationOutlinePayload, index: RepoIndex) {
  const bookId = `generated-${slugify(index.repoSlug)}-${Date.now()}`;
  const partSpecs = index.signals.isEspHal ? espHalPartSpecs(index) : genericPartSpecs(index);
  const parts: BookPart[] = partSpecs.map((part, partIndex) => ({
    id: `${bookId}-part-${partIndex + 1}`,
    bookId,
    order: partIndex,
    title: part.title,
    summary: part.summary
  }));
  const chapters = partSpecs.flatMap((part, partIndex) =>
    part.chapters.map((chapter, chapterIndex) => makeChapter(bookId, parts[partIndex], partIndex, chapterIndex, chapter, index))
  );
  const book = repoBookSchema.parse({
    id: bookId,
    title: `${index.repoName}${objectParticle(index.repoName)} 읽는 책`,
    subtitle: `${payload.audience} 독자를 위한 ${depthLabel(payload.depth)} 수준의 ${bookSubtitle(index)}`,
    repo: index.repoSlug,
    branch: index.branch,
    model: generationModelLabel(payload),
    updated: "방금 전",
    status: "draft",
    statusLabel: "초안",
    accent: index.signals.isEspHal ? "amber" : "cyan",
    progress: chapters[0] ? 6 : 0,
    currentChapterId: chapters[0]?.id ?? "",
    parts,
    chapters
  });

  return {
    book,
    outline: parts.map((part) => ({
      part: part.title,
      summary: part.summary,
      chapters: chapters.filter((chapter) => chapter.partId === part.id).map((chapter) => `${chapter.number} ${chapter.title}`)
    })) satisfies GenerationOutlinePart[]
  };
}

export function generationSteps(index: RepoIndex): GenerationRun["steps"] {
  return [
    { label: "저장소 checkout", state: "complete", detail: `${index.repoSlug}${index.commit ? ` @ ${index.commit}` : ""}` },
    { label: "파일/문서 색인", state: "complete", detail: `${index.files.length} files, ${index.packages.length} Rust crates` },
    { label: "도메인 프로파일 선택", state: "complete", detail: index.signals.isEspHal ? "esp-hal HAL profile" : "generic repository profile" },
    { label: "책 목차와 챕터 합성", state: "complete", detail: `${index.signals.isEspHal ? "HAL 학습 흐름" : "maintainer reading flow"}으로 재배열` }
  ];
}

function makeChapter(
  bookId: string,
  part: BookPart | undefined,
  partIndex: number,
  chapterIndex: number,
  spec: ChapterSpec,
  index: RepoIndex
): BookChapter {
  const order = partIndex * 10 + chapterIndex;
  const selectedFiles = resolveFiles(index, spec.files).slice(0, 5);
  const code = selectCodeExcerpt(index, spec.codePath ?? selectedFiles[0], spec.codeLabel ?? "핵심 코드 근거");
  const fileList = selectedFiles.length ? selectedFiles : index.files.slice(0, 3).map((file) => file.path);
  const number = `${partIndex + 1}.${chapterIndex + 1}`;

  return {
    id: `${bookId}-chapter-${number.replace(".", "-")}`,
    bookId,
    partId: part?.id ?? `${bookId}-part-${partIndex + 1}`,
    order,
    number,
    title: spec.title,
    subtitle: spec.subtitle,
    progress: order === 0 ? 6 : 0,
    status: order === 0 ? "current" : "draft",
    estimatedMinutes: Math.max(12, Math.min(34, 10 + fileList.length * 3 + spec.goals.length * 2)),
    files: fileList,
    goals: spec.goals,
    sections: [
      {
        eyebrow: "읽기 방향",
        title: `${spec.title}를 먼저 읽어야 하는 이유`,
        body: buildOrientationBody(index, spec, fileList)
      },
      {
        eyebrow: "코드 계약",
        title: "파일이 드러내는 유지보수 계약",
        body: buildContractBody(index, spec, fileList)
      },
      {
        eyebrow: "독서 순서",
        title: "책처럼 읽는 순서",
        body: buildReadingOrderBody(spec, fileList)
      }
    ],
    code,
    notes: [
      {
        title: index.signals.isEspHal ? "esp-hal 튜닝" : "생성 튜닝",
        body: spec.focus
      },
      {
        title: "근거 파일",
        body: fileList.slice(0, 3).join(", ")
      }
    ],
    checkpoints: spec.checkpoints
  };
}

function espHalPartSpecs(index: RepoIndex): PartSpec[] {
  const chips = index.signals.chips.length ? index.signals.chips.join(", ") : "ESP32 계열";
  const peripherals = index.signals.peripherals.slice(0, 10).join(", ") || "GPIO, DMA, SPI, UART";
  return [
    {
      title: "Part I. esp-hal 지형도",
      summary: "저장소가 어떤 칩과 crate를 다루는지, HAL 책의 표지와 목차를 먼저 세운다.",
      chapters: [
        {
          title: "Bare-metal Rust HAL의 약속",
          subtitle: `${chips}를 no_std Rust로 다루기 위해 esp-hal이 어디까지 책임지는지 읽습니다.`,
          files: ["README.md", "esp-hal/README.md", "esp-hal/Cargo.toml"],
          goals: ["지원 칩과 no_std 범위를 구분한다.", "esp-hal이 embedded-hal trait와 어떤 관계인지 파악한다.", "사용자용 문서와 crate README의 역할을 분리한다."],
          focus: "esp-hal은 단일 crate 설명보다 칩 매트릭스, peripheral coverage, release policy가 중요하다. 첫 장은 API 사용법보다 지원 범위와 안정성 계약을 먼저 세운다.",
          checkpoints: ["지원 칩 목록 확인", "no_std HAL 범위 요약", "stable/unstable API 경계 표시"],
          codePath: "esp-hal/README.md",
          codeLabel: "HAL 지원 범위"
        },
        {
          title: "워크스페이스와 crate 생태계",
          subtitle: "루트 Cargo workspace, 제외된 crate, HAL 주변 crate들이 하나의 SDK처럼 움직이는 구조를 읽습니다.",
          files: ["Cargo.toml", "esp-config/Cargo.toml", "esp-println/Cargo.toml", "esp-backtrace/Cargo.toml", "esp-radio/Cargo.toml"],
          goals: ["workspace members와 exclude 목록의 의미를 설명한다.", "esp-config, esp-println, esp-backtrace의 보조 역할을 구분한다.", "crate별 README를 책의 부록으로 배치한다."],
          focus: "esp-hal은 크레이트 하나가 아니라 bare-metal 개발 스택이다. Cargo.toml의 include/exclude 구조를 먼저 읽어야 예제와 테스트가 왜 별도 crate처럼 배치되는지 이해할 수 있다.",
          checkpoints: ["핵심 crate 5개 이름 추출", "workspace exclude 이유 추론", "사용자 crate와 개발 도구 crate 분리"],
          codePath: "Cargo.toml",
          codeLabel: "workspace 구성"
        }
      ]
    },
    {
      title: "Part II. 부팅, 칩 추상화, 시스템 초기화",
      summary: "no_std entry, peripherals singleton, clock/reset, 아키텍처별 runtime을 연결한다.",
      chapters: [
        {
          title: "no_std 엔트리와 peripheral ownership",
          subtitle: "lib.rs와 peripherals 모듈이 안전한 singleton 접근을 어떻게 책의 첫 코드 계약으로 만드는지 읽습니다.",
          files: ["esp-hal/src/lib.rs", "esp-hal/src/peripherals/mod.rs", "esp-hal/src/system.rs"],
          goals: ["crate-level no_std 선언과 feature gate를 확인한다.", "peripheral singleton ownership 패턴을 설명한다.", "초기화 API가 사용자 main과 만나는 지점을 찾는다."],
          focus: "HAL 독자는 먼저 '누가 peripheral을 소유하는가'를 이해해야 한다. 이 장은 타입 안전성, PAC re-export, 초기화 진입점을 하나의 계약으로 묶는다.",
          checkpoints: ["no_std 선언 확인", "peripherals 모듈의 공개 타입 찾기", "초기화 함수와 system split 연결"],
          codePath: "esp-hal/src/lib.rs",
          codeLabel: "crate 진입점"
        },
        {
          title: "Clock, reset, system bring-up",
          subtitle: "clock tree와 system control이 peripheral driver보다 먼저 확정되어야 하는 이유를 읽습니다.",
          files: ["esp-hal/src/clock/mod.rs", "esp-hal/src/system.rs", "esp-hal/src/time.rs", "esp-hal/src/delay.rs"],
          goals: ["clock 설정이 driver API에 주는 제약을 설명한다.", "delay/time 타입이 clock 계약을 어떻게 감싼는지 확인한다.", "system module의 reset/enable 책임을 구분한다."],
          focus: "embedded HAL 책에서 clock은 배경 설정이 아니라 모든 driver 장의 전제다. esp-hal에서는 clock/time/delay를 한 장으로 묶어 이후 peripheral 장의 공통 조건으로 만든다.",
          checkpoints: ["clock source와 frequency 타입 확인", "delay와 time API 관계 정리", "peripheral enable/reset 호출 지점 표시"],
          codePath: "esp-hal/src/clock/mod.rs",
          codeLabel: "clock 계약"
        },
        {
          title: "Xtensa와 RISC-V runtime 경계",
          subtitle: "ESP32 계열이 두 아키텍처를 품기 때문에 runtime, interrupt, backtrace가 어떻게 갈라지는지 읽습니다.",
          files: ["esp-riscv-rt/src/lib.rs", "xtensa-lx-rt/src/lib.rs", "esp-backtrace/src/lib.rs", "esp-hal/src/interrupt/mod.rs"],
          goals: ["RISC-V와 Xtensa runtime crate를 구분한다.", "interrupt abstraction이 아키텍처별 파일로 나뉘는 이유를 설명한다.", "backtrace/debug 지원이 HAL과 어디서 만나는지 찾는다."],
          focus: "esp-hal의 난이도는 peripheral 수보다 아키텍처 이중성에서 나온다. 이 장은 runtime crate와 interrupt module을 함께 읽어 칩별 분기를 책의 구조로 노출한다.",
          checkpoints: ["riscv/xtensa runtime 파일 찾기", "interrupt 아키텍처별 구현 확인", "debug/backtrace crate 역할 요약"],
          codePath: "esp-hal/src/interrupt/mod.rs",
          codeLabel: "interrupt 추상화"
        }
      ]
    },
    {
      title: "Part III. Peripheral driver를 읽는 법",
      summary: `${peripherals} 같은 driver를 ownership, blocking/async, DMA 세 축으로 읽는다.`,
      chapters: [
        {
          title: "GPIO, IO mux, interrupt의 기본 문법",
          subtitle: "가장 자주 만나는 GPIO driver에서 pin type, mode 전환, interrupt 흐름을 익힙니다.",
          files: ["esp-hal/src/gpio/mod.rs", "esp-hal/src/gpio/interrupt.rs", "esp-hal/src/gpio/embedded_hal_impls.rs", "examples/interrupt/gpio/Cargo.toml"],
          goals: ["pin mode와 type-state 패턴을 확인한다.", "embedded-hal trait 구현 위치를 찾는다.", "GPIO interrupt 예제를 driver 코드와 연결한다."],
          focus: "GPIO는 HAL 전체의 축소판이다. type-state, trait impl, interrupt, async 확장이 모두 드러나므로 이 장에서 driver 독해의 기본 문법을 확정한다.",
          checkpoints: ["pin 타입과 mode 전환 API 표시", "embedded-hal impl 파일 확인", "interrupt 예제와 driver 연결"],
          codePath: "esp-hal/src/gpio/mod.rs",
          codeLabel: "GPIO driver"
        },
        {
          title: "Timer, delay, systimer로 시간 모델 잡기",
          subtitle: "blocking delay와 hardware timer가 async runtime 이전에 어떤 시간 기준을 제공하는지 읽습니다.",
          files: ["esp-hal/src/timer/mod.rs", "esp-hal/src/timer/systimer.rs", "esp-hal/src/timer/timg.rs", "esp-hal/src/delay.rs"],
          goals: ["timer group과 systimer 역할을 구분한다.", "delay abstraction과 hardware timer의 차이를 설명한다.", "시간 타입이 examples에서 쓰이는 흐름을 찾는다."],
          focus: "시간 모델을 이해하면 Embassy/async 장이 쉬워진다. timer와 delay를 먼저 읽어 blocking 예제와 async executor가 공유하는 시간 감각을 만든다.",
          checkpoints: ["systimer/timg 파일 비교", "delay API 사용처 찾기", "timer interrupt 가능성 표시"],
          codePath: "esp-hal/src/timer/mod.rs",
          codeLabel: "timer module"
        },
        {
          title: "DMA와 버퍼 ownership",
          subtitle: "SPI/I2S/RMT 같은 고속 peripheral을 이해하기 위해 DMA buffer와 transfer ownership을 먼저 읽습니다.",
          files: ["esp-hal/src/dma/mod.rs", "esp-hal/src/dma/buffers.rs", "esp-hal/src/spi/mod.rs", "esp-hal/src/i2s/mod.rs", "esp-hal/src/rmt.rs"],
          goals: ["DMA channel과 buffer 타입의 책임을 설명한다.", "transfer 시작/완료 시 ownership 이동을 파악한다.", "SPI/I2S/RMT driver가 DMA를 공유하는 방식을 찾는다."],
          focus: "고급 HAL 품질은 DMA API에서 드러난다. esp-hal 책은 peripheral별 API를 나열하지 않고 DMA ownership을 중심 장으로 올려 고속 I/O를 한 번에 이해하게 한다.",
          checkpoints: ["DMA buffer 타입 찾기", "transfer 완료 API 확인", "SPI/I2S/RMT와 DMA 연결"],
          codePath: "esp-hal/src/dma/mod.rs",
          codeLabel: "DMA core"
        },
        {
          title: "UART, SPI, I2C의 trait와 transaction",
          subtitle: "대표 통신 driver가 embedded-hal trait, blocking API, async API를 어떻게 함께 제공하는지 비교합니다.",
          files: ["esp-hal/src/uart/mod.rs", "esp-hal/src/spi/mod.rs", "esp-hal/src/i2c/mod.rs", "examples/async/embassy_spi/Cargo.toml", "examples/async/embassy_serial/Cargo.toml"],
          goals: ["UART/SPI/I2C driver의 공통 생성 패턴을 찾는다.", "embedded-hal trait 구현을 비교한다.", "async 예제가 같은 driver를 어떻게 소비하는지 확인한다."],
          focus: "통신 driver는 사용자 경험의 대부분을 차지한다. 세 driver를 한 장에서 비교하면 esp-hal API가 일관성을 어디까지 유지하는지 평가할 수 있다.",
          checkpoints: ["세 driver init API 비교", "trait impl 위치 찾기", "async 예제 연결"],
          codePath: "esp-hal/src/spi/mod.rs",
          codeLabel: "SPI driver"
        }
      ]
    },
    {
      title: "Part IV. Async, radio, examples",
      summary: "Embassy 통합, Wi-Fi/BLE/radio crate, examples를 실전 레시피로 읽는다.",
      chapters: [
        {
          title: "Embassy async 통합",
          subtitle: "asynch module과 async examples가 blocking HAL 위에 어떤 실행 모델을 얹는지 읽습니다.",
          files: ["esp-hal/src/asynch.rs", "examples/async/embassy_hello_world/Cargo.toml", "examples/async/embassy_multicore/Cargo.toml"],
          goals: ["async feature와 executor 전제를 확인한다.", "blocking driver와 async wrapper의 경계를 설명한다.", "multicore async 예제가 system 장과 이어지는 지점을 찾는다."],
          focus: "async는 별도 제품이 아니라 HAL 사용성의 확장이다. esp-hal에서는 Embassy 예제를 본문 뒤쪽에 배치해 앞 장의 ownership/clock/interrupt 지식을 재사용하게 한다.",
          checkpoints: ["asynch module 공개 API 확인", "Embassy 예제 dependency 확인", "multicore 예제와 system 연결"],
          codePath: "esp-hal/src/asynch.rs",
          codeLabel: "async support"
        },
        {
          title: "Wi-Fi, BLE, IEEE 802.15.4는 왜 별도 축인가",
          subtitle: "esp-radio와 PHY 계층, radio examples를 HAL driver와 구분해 읽습니다.",
          files: ["esp-radio/README.md", "esp-radio/src/lib.rs", "esp-phy/README.md", "examples/wifi/embassy_access_point/Cargo.toml", "examples/ble/scanner/Cargo.toml"],
          goals: ["radio stack이 core esp-hal과 분리된 이유를 설명한다.", "PHY crate와 radio crate의 책임을 구분한다.", "Wi-Fi/BLE 예제를 HAL 책의 응용 장으로 배치한다."],
          focus: "무선 기능은 peripheral driver보다 stack 성격이 강하다. 이 장은 radio를 '고급 주변장치'가 아니라 별도 계층으로 배치해 독자가 기대치를 조정하게 한다.",
          checkpoints: ["esp-radio와 esp-phy README 확인", "Wi-Fi/BLE 예제 dependency 비교", "core HAL과 radio 경계 표시"],
          codePath: "esp-radio/src/lib.rs",
          codeLabel: "radio entry"
        },
        {
          title: "Examples를 학습 레시피로 재배열하기",
          subtitle: "hello_world에서 peripheral, interrupt, OTA, wireless까지 예제를 난이도별로 읽습니다.",
          files: ["examples/README.md", "examples/hello_world/src/main.rs", "examples/peripheral/twai/Cargo.toml", "examples/ota/update/Cargo.toml"],
          goals: ["예제를 디렉토리명이 아니라 학습 난이도 순으로 정렬한다.", "각 예제가 요구하는 선행 장을 연결한다.", "새 사용자가 복사할 첫 예제와 읽을 예제를 구분한다."],
          focus: "수준 높은 책은 examples를 부록에 버리지 않는다. examples는 각 장의 실습문제로 연결되어야 하므로 hello_world, interrupt, peripheral, wireless 순서로 재배열한다.",
          checkpoints: ["첫 실행 예제 선택", "고급 예제 선행 지식 표시", "예제 dependency와 본문 장 연결"],
          codePath: "examples/hello_world/src/main.rs",
          codeLabel: "hello world example"
        }
      ]
    },
    {
      title: "Part V. 검증, 설정, 기여",
      summary: "HIL/QA/compile-tests와 release/migration 문서를 유지보수자의 독서 순서로 묶는다.",
      chapters: [
        {
          title: "HIL, QA, compile-tests로 신뢰도 읽기",
          subtitle: "하드웨어 의존 HAL에서 테스트 구조가 문서만큼 중요한 이유를 확인합니다.",
          files: ["documentation/HIL-GUIDE.md", "hil-test/README.md", "qa-test/README.md", "compile-tests/README.md"],
          goals: ["HIL 테스트가 일반 unit test와 다른 이유를 설명한다.", "compile-tests가 API 안정성을 어떻게 지키는지 확인한다.", "QA crate가 release confidence에 주는 신호를 읽는다."],
          focus: "HAL의 품질은 테스트 파일 수보다 어떤 보드/칩에서 검증되는지에 달려 있다. 마지막부는 테스트 인프라를 책의 품질 증거로 해석한다.",
          checkpoints: ["HIL 실행 조건 확인", "compile-tests 범위 요약", "QA와 release check 연결"],
          codePath: "documentation/HIL-GUIDE.md",
          codeLabel: "HIL guide"
        },
        {
          title: "Configuration, migration, release policy",
          subtitle: "esp_config.yml, migration 문서, release policy를 읽어 유지보수자의 변경 안전선을 세웁니다.",
          files: ["esp-hal/esp_config.yml", "esp-hal/MIGRATING-1.0.0.md", "esp-hal/MIGRATING-1.1.0.md", "documentation/DEVELOPER-GUIDELINES.md", "documentation/CONTRIBUTING.md"],
          goals: ["configuration key가 API surface에 주는 영향을 파악한다.", "migration 문서를 breaking change 지도처럼 읽는다.", "contribution guideline에서 review 기준을 추출한다."],
          focus: "esp-hal 책의 끝은 API 목록이 아니라 변경 안전선이어야 한다. configuration과 migration 문서를 마지막 장으로 두면 독자가 실제 기여나 업그레이드로 넘어갈 수 있다.",
          checkpoints: ["config key 목록 확인", "migration 문서의 breaking change 분류", "기여 전 확인 문서 정리"],
          codePath: "esp-hal/esp_config.yml",
          codeLabel: "HAL configuration"
        }
      ]
    }
  ];
}

function genericPartSpecs(index: RepoIndex): PartSpec[] {
  const primaryDirs = index.topLevelDirs.slice(0, 5).map((dir) => dir.name).join(", ") || "root files";
  const readmes = index.files.filter((file) => file.kind === "readme").map((file) => file.path);
  const manifests = index.files.filter((file) => file.kind === "manifest").map((file) => file.path);
  const sourceFiles = index.files.filter((file) => file.kind === "rust" || file.path.includes("/src/")).map((file) => file.path);
  const tests = index.files.filter((file) => file.kind === "test").map((file) => file.path);
  return [
    {
      title: "Part I. 저장소 지도",
      summary: `${index.repoName}의 목적, 실행 경로, 주요 디렉토리(${primaryDirs})를 먼저 정리한다.`,
      chapters: [
        {
          title: "제품 의도와 첫 실행 경로",
          subtitle: "README와 manifest에서 저장소가 해결하는 문제와 실행 단서를 찾습니다.",
          files: [...readmes, ...manifests],
          goals: ["저장소 목적을 한 문장으로 정리한다.", "실행과 빌드의 첫 명령을 찾는다.", "독자가 먼저 열 파일을 고른다."],
          focus: "README와 manifest는 책의 표지와 판권면이다. 생성기는 이 둘을 먼저 대조해 학습 난이도와 독서 순서를 확정한다.",
          checkpoints: ["README 요약", "manifest 확인", "첫 실행 명령 후보 표시"]
        },
        {
          title: "디렉토리를 대단원으로 번역하기",
          subtitle: "파일 트리를 그대로 복사하지 않고 책임과 학습 순서로 다시 묶습니다.",
          files: index.topLevelDirs.map((dir) => dir.name),
          goals: ["상위 디렉토리별 책임을 분류한다.", "학습 순서와 물리 경로를 분리한다.", "건너뛰어도 되는 파일군을 표시한다."],
          focus: "좋은 repo book은 탐색기 목차가 아니다. 디렉토리를 개념 단위로 번역해야 독자가 순서대로 읽을 수 있다.",
          checkpoints: ["상위 디렉토리 분류", "핵심/보조 경로 구분", "학습 순서 확정"]
        }
      ]
    },
    {
      title: "Part II. 핵심 코드 경로",
      summary: "소스 파일과 모듈 경계를 따라 실제 동작을 읽는다.",
      chapters: [
        {
          title: "엔트리 포인트와 공개 API",
          subtitle: "src/lib, src/main, public exports에서 사용자가 만나는 첫 계약을 찾습니다.",
          files: sourceFiles,
          goals: ["엔트리 파일을 찾는다.", "공개 API와 내부 모듈을 구분한다.", "주요 타입/함수 이름을 추출한다."],
          focus: "공개 API는 저장소가 독자에게 내미는 첫 문장이다. 내부 구현보다 export와 module boundary를 먼저 읽는다.",
          checkpoints: ["엔트리 파일 선택", "공개 symbol 확인", "내부/private 경계 표시"]
        },
        {
          title: "주요 흐름을 코드 근거로 따라가기",
          subtitle: "핵심 소스 파일을 작은 묶음으로 읽으며 구현 흐름을 재구성합니다.",
          files: sourceFiles.slice(1),
          goals: ["핵심 모듈 간 호출 흐름을 찾는다.", "상태나 데이터 구조가 바뀌는 지점을 표시한다.", "예외와 edge case를 확인한다."],
          focus: "코드 장은 긴 파일 설명이 아니라 흐름 설명이어야 한다. 생성기는 관련 파일을 3-5개로 제한해 한 장의 인지 부하를 낮춘다.",
          checkpoints: ["핵심 호출 흐름 표시", "상태 변경 지점 확인", "edge case 목록화"]
        }
      ]
    },
    {
      title: "Part III. 검증과 유지보수",
      summary: "테스트, 문서, 설정을 변경 안전성 관점에서 읽는다.",
      chapters: [
        {
          title: "테스트가 보증하는 계약",
          subtitle: "테스트와 검증 스크립트가 어떤 사용자 흐름을 보호하는지 확인합니다.",
          files: tests,
          goals: ["테스트 종류를 분류한다.", "핵심 수용 기준과 연결한다.", "부족한 검증 영역을 찾는다."],
          focus: "테스트는 책의 연습문제이자 품질 증거다. 구현 설명 뒤에는 항상 어떤 검증이 계약을 지키는지 연결한다.",
          checkpoints: ["테스트 파일 분류", "보호하는 기능 연결", "검증 공백 표시"]
        },
        {
          title: "변경 전 읽어야 할 문서와 설정",
          subtitle: "기여 문서, config, workflow를 유지보수자의 체크리스트로 바꿉니다.",
          files: index.files.filter((file) => ["doc", "config", "script"].includes(file.kind)).map((file) => file.path),
          goals: ["설정 파일의 영향 범위를 파악한다.", "기여 전 읽을 문서를 정리한다.", "릴리스나 배포 경로를 찾는다."],
          focus: "마지막 장은 다음 변경으로 이어져야 한다. 문서와 설정을 유지보수 체크리스트로 묶어 책의 사용성을 높인다.",
          checkpoints: ["주요 설정 파일 확인", "기여 문서 요약", "릴리스/배포 단서 찾기"]
        }
      ]
    }
  ];
}

function resolveFiles(index: RepoIndex, candidates: string[]) {
  const paths = new Set(index.files.map((file) => file.path));
  const resolved: string[] = [];
  for (const candidate of candidates) {
    if (paths.has(candidate)) {
      resolved.push(candidate);
      continue;
    }
    const prefixMatches = index.files.filter((file) => file.path.startsWith(candidate.replace(/\/$/, "") + "/")).slice(0, 3);
    for (const match of prefixMatches) resolved.push(match.path);
  }
  return Array.from(new Set(resolved));
}

function selectCodeExcerpt(index: RepoIndex, path: string | undefined, label: string) {
  const file = findIndexedFile(index, path) ?? index.files.find((candidate) => candidate.kind === "rust") ?? index.files[0];
  if (!file) return null;
  const lines = excerptLines(file);
  return {
    path: file.path,
    label,
    lines
  };
}

function findIndexedFile(index: RepoIndex, path: string | undefined) {
  if (!path) return undefined;
  return index.files.find((file) => file.path === path) ?? index.files.find((file) => file.path.endsWith(path));
}

function excerptLines(file: IndexedFile) {
  const symbolIndex = file.lines.findIndex((line) => /^\s*(?:pub\s+)?(?:struct|enum|trait|fn|mod|type|const|macro_rules!)\s+/.test(line));
  const headingIndex = file.lines.findIndex((line) => /^#{1,3}\s+/.test(line));
  const start = Math.max(0, (symbolIndex >= 0 ? symbolIndex : headingIndex >= 0 ? headingIndex : 0) - 1);
  return file.lines.slice(start, start + 9).filter((line) => line.trim().length > 0).slice(0, 8);
}

function buildOrientationBody(index: RepoIndex, spec: ChapterSpec, files: string[]) {
  const domain = index.signals.isEspHal ? "embedded Rust HAL" : "저장소";
  return `${spec.subtitle} 이 장은 ${domain}를 파일 목록으로 훑지 않고, ${spec.goals[0]}는 목표에서 출발합니다. 근거 파일은 ${files.slice(0, 3).join(", ") || "색인된 핵심 파일"}이며, 독자는 먼저 공개 문서와 엔트리 파일을 대조해 이 장의 책임을 좁힙니다.`;
}

function buildContractBody(index: RepoIndex, spec: ChapterSpec, files: string[]) {
  const symbols = files
    .map((path) => findIndexedFile(index, path)?.symbols.slice(0, 2).join(", "))
    .filter(Boolean)
    .slice(0, 3)
    .join("; ");
  return `코드에서 확인할 계약은 ${spec.focus} ${symbols ? `관련 symbol 단서는 ${symbols}입니다.` : "관련 symbol은 코드 excerpt와 파일 경로에서 확인합니다."} 이 장의 본문은 구현 세부를 모두 나열하기보다, 다음 장을 읽기 전에 반드시 알아야 할 API 경계와 ownership 변화를 표시합니다.`;
}

function buildReadingOrderBody(spec: ChapterSpec, files: string[]) {
  return `읽는 순서는 ${files.slice(0, 4).join(" -> ") || "문서 -> manifest -> source"}입니다. 먼저 문서가 말하는 사용자 경험을 확인하고, 이어 manifest나 module entry에서 feature와 dependency를 확인한 뒤, 마지막으로 driver 또는 test 파일에서 실제 제약을 검증합니다. 체크포인트는 ${spec.checkpoints.slice(0, 2).join(", ")}입니다.`;
}

function bookSubtitle(index: RepoIndex) {
  if (index.signals.isEspHal) {
    const chips = index.signals.chips.length ? `${index.signals.chips.length}개 ESP chip` : "ESP chip";
    return `${chips}과 ${index.packages.length}개 Rust crate를 no_std HAL 관점으로 재구성한 repo book`;
  }
  if (index.signals.isRust) return `${index.packages.length || 1}개 Rust crate를 유지보수 순서로 재구성한 repo book`;
  return "저장소 구조와 코드 근거를 학습 순서로 재구성한 repo book";
}

function generationModelLabel(payload: PostGenerationOutlinePayload) {
  const mode = process.env.LM_STUDIO_BASE_URL ? "LM Studio-ready" : "deterministic scanner";
  return `${mode} · ${payload.model}`;
}

function depthLabel(depth: string) {
  const labels: Record<string, string> = {
    light: "빠른 개요",
    balanced: "균형 잡힌",
    deep: "깊은"
  };
  return labels[depth] ?? depth;
}

function objectParticle(value: string) {
  const last = value.trim().at(-1);
  if (!last) return "을";
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return "을";
  return (code - 0xac00) % 28 === 0 ? "를" : "을";
}
