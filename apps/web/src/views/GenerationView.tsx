
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Loader2, MessageSquareText, RefreshCcw, Sparkles } from "lucide-react";
import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BOOK_PURPOSE_OPTIONS,
  GENERATION_DEPTH_OPTIONS,
  GENERATION_MODEL_OPTIONS,
  READER_LEVEL_OPTIONS,
  type LmStudioModelOption
} from "@repo-books/shared";
import { GENERATION_FORM_DEFAULT } from "../constants";
import { api, type GenerationResult } from "../lib/api";
import { queryKeys } from "../lib/query";
import { lmStudioModelDescription, lmStudioModelLabel } from "../utils/appHelpers";

export function GenerationView({
  onBack,
  onGenerated
}: {
  onBack: () => void;
  onGenerated: (result: GenerationResult) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(GENERATION_FORM_DEFAULT);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lmStudioModels, setLmStudioModels] = useState<LmStudioModelOption[]>([]);
  const [lmStudioModelsLoading, setLmStudioModelsLoading] = useState(false);
  const [lmStudioModelError, setLmStudioModelError] = useState<string | null>(null);
  const modelEditedRef = useRef(false);
  const selectedLmStudioModel = lmStudioModels.find((option) => option.modelKey === form.model);
  const selectedPresetModel = GENERATION_MODEL_OPTIONS.find((option) => option.value === form.model);
  const modelOptions = lmStudioModels.length
    ? lmStudioModels.map((option) => ({ value: option.modelKey, label: lmStudioModelLabel(option) }))
    : GENERATION_MODEL_OPTIONS;
  const modelDescription = lmStudioModelsLoading
    ? "로컬 LM Studio 모델 목록을 확인하는 중입니다."
    : selectedLmStudioModel
      ? lmStudioModelDescription(selectedLmStudioModel)
      : lmStudioModelError && !lmStudioModels.length
        ? `로컬 모델 목록을 불러오지 못해 직접 입력할 수 있습니다. ${lmStudioModelError}`
        : selectedPresetModel?.description ?? "LM Studio에 등록된 모델 ID를 직접 입력할 수 있습니다.";
  const selectedReaderLevel = READER_LEVEL_OPTIONS.find((option) => option.value === form.readerLevel) ?? READER_LEVEL_OPTIONS[0];
  const selectedBookPurpose = BOOK_PURPOSE_OPTIONS.find((option) => option.value === form.bookPurpose) ?? BOOK_PURPOSE_OPTIONS[0];
  const selectedDepth = GENERATION_DEPTH_OPTIONS.find((option) => option.value === form.depth) ?? GENERATION_DEPTH_OPTIONS[1];
  const startGenerationMutation = useMutation({
    mutationFn: api.startGenerationRun,
    onSuccess: (nextResult) => {
      queryClient.setQueryData(queryKeys.generationRun(nextResult.run.id), nextResult);
      if (nextResult.book) queryClient.setQueryData(queryKeys.book(nextResult.book.id), nextResult.book);
    }
  });

  const loadLmStudioModels = useCallback(async (refresh = false) => {
    setLmStudioModelsLoading(true);
    try {
      if (refresh) await queryClient.invalidateQueries({ queryKey: queryKeys.lmStudioModels() });
      const response = await queryClient.fetchQuery({
        queryKey: queryKeys.lmStudioModels(),
        queryFn: () => api.listLmStudioModels(refresh)
      });
      setLmStudioModels(response.models);
      setLmStudioModelError(response.error ?? null);
      if (response.models.length) {
        setForm((current) => {
          if (modelEditedRef.current || response.models.some((model) => model.modelKey === current.model)) return current;
          return { ...current, model: response.models[0].modelKey };
        });
      }
    } catch (reason) {
      setLmStudioModelError(reason instanceof Error ? reason.message : "로컬 모델 목록을 불러오지 못했습니다.");
    } finally {
      setLmStudioModelsLoading(false);
    }
  }, [queryClient]);

  useEffect(() => {
    void loadLmStudioModels(false);
  }, [loadLmStudioModels]);

  async function runGenerate(event?: FormEvent) {
    event?.preventDefault();
    const nextForm = { ...form };
    setRunning(true);
    setError(null);
    try {
      const nextResult = await startGenerationMutation.mutateAsync(nextForm);
      if (nextResult.book) onGenerated(nextResult);
      navigate(`/generation/runs/${nextResult.run.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "책 생성에 실패했습니다.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="generation-view" aria-labelledby="generation-title">
      <div className="screen-toolbar command-surface" aria-label="목차 생성 화면 이동">
        <button className="text-button" type="button" onClick={onBack}>
          <ChevronLeft />
          <span>책장으로 돌아가기</span>
        </button>
        <div className="toolbar-title">
          <span className="state-dot state-dot--draft" />
          <strong>목차 생성</strong>
        </div>
        <button className="primary-action" type="submit" form="generation-form" disabled={running}>
          {running ? <Loader2 className="spin" /> : <Sparkles />}
          <span>{running ? "요청 중" : "책 생성"}</span>
        </button>
      </div>

      <form id="generation-form" className="generation-grid" onSubmit={runGenerate}>
        <aside className="builder-panel content-surface" aria-labelledby="generation-title">
          <div className="screen-kicker">
            <span className="state-dot state-dot--draft" />
            <span>Book setup</span>
            <span>{running ? "generating" : "drafting"}</span>
          </div>
          <h1 id="generation-title">기술서 목차 생성</h1>
          <p className="builder-summary">저장소를 분석해 새 기술서의 목차와 챕터 흐름을 생성합니다. 생성이 시작되면 진행 화면으로 이동합니다.</p>
          <div className="form-section">
            <span className="form-section-title">저장소</span>
            <label htmlFor="generation-repo">저장소 URL 또는 로컬 경로</label>
            <input
              id="generation-repo"
              type="text"
              value={form.repositoryUrl}
              placeholder="https://github.com/owner/repo 또는 /local/path"
              onChange={(event) => setForm({ ...form, repositoryUrl: event.target.value })}
              required
            />
            <label htmlFor="model-select">LM Studio 모델</label>
            <div className="model-input-row">
              <input
                id="model-select"
                list="model-presets"
                type="text"
                value={form.model}
                aria-describedby="model-select-hint"
                onChange={(event) => {
                  modelEditedRef.current = true;
                  setForm({ ...form, model: event.target.value });
                }}
                required
              />
              <button
                className="model-refresh-button"
                type="button"
                aria-label="LM Studio 모델 목록 새로고침"
                title="LM Studio 모델 목록 새로고침"
                onClick={() => loadLmStudioModels(true)}
                disabled={lmStudioModelsLoading}
              >
                {lmStudioModelsLoading ? <Loader2 className="spin" /> : <RefreshCcw />}
              </button>
            </div>
            <datalist id="model-presets">
              {modelOptions.map((option) => (
                <option key={option.value} value={option.value} label={option.label} />
              ))}
            </datalist>
            <p className="field-hint" id="model-select-hint">{modelDescription}</p>
          </div>
          <div className="form-section">
            <span className="form-section-title">책 설정</span>
            <label htmlFor="reader-level">독자 수준</label>
            <select
              id="reader-level"
              value={form.readerLevel}
              aria-describedby="reader-level-hint"
              onChange={(event) => {
                const readerLevel = event.target.value;
                setForm({ ...form, readerLevel, audience: readerLevel });
              }}
            >
              {READER_LEVEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="field-hint" id="reader-level-hint">{selectedReaderLevel.description}</p>
            <label htmlFor="book-purpose">책의 목적</label>
            <select
              id="book-purpose"
              value={form.bookPurpose}
              aria-describedby="book-purpose-hint"
              onChange={(event) => setForm({ ...form, bookPurpose: event.target.value })}
            >
              {BOOK_PURPOSE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="field-hint" id="book-purpose-hint">{selectedBookPurpose.description}</p>
            <label htmlFor="generation-depth">생성 깊이</label>
            <select id="generation-depth" value={form.depth} aria-describedby="generation-depth-hint" onChange={(event) => setForm({ ...form, depth: event.target.value })}>
              {GENERATION_DEPTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="field-hint" id="generation-depth-hint">{selectedDepth.description}</p>
          </div>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </aside>

        <aside className="prompt-panel panel-surface" aria-labelledby="custom-prompt-title">
          <div className="section-title" id="custom-prompt-title">
            <MessageSquareText />
            <span>추가 요구</span>
          </div>
          <label htmlFor="custom-prompt">커스텀 프롬프트</label>
          <textarea
            id="custom-prompt"
            className="custom-prompt-textarea"
            value={form.customPrompt}
            maxLength={4000}
            aria-describedby="custom-prompt-hint"
            placeholder="예: API 변경 지점을 먼저 다루고, 테스트 전략을 각 장의 체크포인트에 포함해줘."
            onChange={(event) => setForm({ ...form, customPrompt: event.target.value })}
          />
          <p className="field-hint" id="custom-prompt-hint">
            생성할 책에 추가로 반영할 요구를 적습니다. 저장소 근거와 선택한 책 설정 안에서 적용됩니다.
          </p>
          <dl className="metric-list">
            <div>
              <dt>Context</dt>
              <dd>{form.depth === "deep" ? "128k" : "64k"}</dd>
            </div>
            <div>
              <dt>Purpose</dt>
              <dd>{selectedBookPurpose.label}</dd>
            </div>
            <div>
              <dt>Reader</dt>
              <dd>{selectedReaderLevel.label}</dd>
            </div>
          </dl>
        </aside>
      </form>
    </section>
  );
}
