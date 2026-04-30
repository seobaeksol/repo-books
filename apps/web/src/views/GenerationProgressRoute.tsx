
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, BookOpenCheck, ChevronLeft, Loader2, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { GenerationStep } from "@repo-books/shared";
import { GENERATION_STEPS } from "../constants";
import { api, type GenerationResult } from "../lib/api";
import { queryKeys } from "../lib/query";
import {
  clampPercent,
  currentGenerationStep,
  elapsedMilliseconds,
  firstChapter,
  firstReadableChapter,
  formatDuration,
  generationActivityItems,
  generationStatusIcon,
  generationStatusLabel,
  generationStatusTitle,
  generationStatusTone,
  generationStepState,
  statusLabel,
  stepIcon
} from "../utils/appHelpers";
import { OutlinePreview } from "./OutlinePreview";

export function GenerationProgressRoute({
  onBack,
  onReadBook,
  onGenerated
}: {
  onBack: () => void;
  onReadBook: (bookId: string, chapterId?: string) => void;
  onGenerated: (result: GenerationResult) => void;
}) {
  const { runId = "" } = useParams();
  const queryClient = useQueryClient();
  const [runtimeNow, setRuntimeNow] = useState(() => Date.now());
  const [actionError, setActionError] = useState<string | null>(null);
  const generationQuery = useQuery({
    queryKey: queryKeys.generationRun(runId),
    queryFn: () => api.getGenerationRun(runId),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = (query.state.data as GenerationResult | undefined)?.run.status;
      return status === "queued" || status === "running" ? 500 : false;
    }
  });
  const retryMutation = useMutation({
    mutationFn: (targetRunId: string) => api.retryFailedGenerationChapters(targetRunId)
  });
  const resumeMutation = useMutation({
    mutationFn: (targetRunId: string) => api.resumeGenerationRun(targetRunId)
  });
  const result = generationQuery.data ?? null;
  const loading = generationQuery.isLoading;
  const retrying = retryMutation.isPending;
  const resuming = resumeMutation.isPending;
  const error =
    actionError ??
    (generationQuery.error instanceof Error ? generationQuery.error.message : generationQuery.error ? "생성 진행상황을 불러오지 못했습니다." : null);
  const displayBook = result?.book ?? null;
  const running = result?.run.status === "queued" || result?.run.status === "running";
  const failedChapterCount = result?.run.chapterRuns?.filter((chapter) => chapter.status === "failed").length ?? 0;
  const canRetryFailedChapters = Boolean(result?.run.id) && failedChapterCount > 0 && !running && !retrying && !resuming;
  const canResumeGeneration = Boolean(result?.run.id) && result?.run.status === "failed" && !running && !retrying && !resuming;
  const readableChapter = firstReadableChapter(displayBook);
  const canReadBook = Boolean(displayBook?.chapters?.length && readableChapter && !retrying && !resuming);
  const readActionLabel = result?.run.status === "complete" ? "읽기 시작" : "부분 읽기";
  const displaySteps: GenerationStep[] =
    result?.run.steps ??
    GENERATION_STEPS.map((step) => ({
      label: step.label,
      detail: step.detail,
      state: generationStepState(step.id, "model", false)
    }));

  useEffect(() => {
    if (result?.book) onGenerated(result);
  }, [result, onGenerated]);

  useEffect(() => {
    if (!running && !retrying && !resuming) return;
    setRuntimeNow(Date.now());
    const interval = window.setInterval(() => setRuntimeNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [running, retrying, resuming]);

  useEffect(() => {
    if (result) setRuntimeNow(Date.now());
  }, [result?.run.updatedAt, result]);

  async function retryFailedChapters() {
    if (!result?.run.id) return;
    setRuntimeNow(Date.now());
    setActionError(null);
    try {
      const nextResult = await retryMutation.mutateAsync(result.run.id);
      queryClient.setQueryData(queryKeys.generationRun(nextResult.run.id), nextResult);
      if (nextResult.book) onGenerated(nextResult);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "실패한 챕터 재시도에 실패했습니다.");
    }
  }

  async function resumeGeneration() {
    if (!result?.run.id) return;
    setRuntimeNow(Date.now());
    setActionError(null);
    try {
      const nextResult = await resumeMutation.mutateAsync(result.run.id);
      queryClient.setQueryData(queryKeys.generationRun(nextResult.run.id), nextResult);
      void queryClient.invalidateQueries({ queryKey: queryKeys.generationRun(nextResult.run.id) });
      if (nextResult.book) onGenerated(nextResult);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "중단된 생성을 이어서 시작하지 못했습니다.");
    }
  }

  return (
    <section className="generation-view" aria-labelledby="generation-progress-title">
      <div className="screen-toolbar command-surface" aria-label="생성 진행상황 화면 이동">
        <button className="text-button" type="button" onClick={onBack}>
          <ChevronLeft />
          <span>책장으로 돌아가기</span>
        </button>
        <div className="toolbar-title">
          <span className={`state-dot state-dot--${result?.run.status === "complete" ? "ready" : "draft"}`} />
          <strong>생성 진행상황</strong>
        </div>
        <button
          className="primary-action"
          type="button"
          onClick={() => displayBook && onReadBook(displayBook.id, readableChapter?.id ?? displayBook.currentChapterId ?? firstChapter(displayBook)?.id)}
          disabled={!canReadBook}
        >
          <BookOpenCheck />
          <span>{readActionLabel}</span>
        </button>
      </div>

      <div className="generation-progress-grid">
        <aside className="runtime-panel panel-surface" aria-labelledby="generation-progress-title">
          <div className="section-title" id="generation-progress-title">
            <Activity />
            <span>Generation run</span>
          </div>
          <GenerationRunSummary result={result} running={loading || running || retrying || resuming} now={runtimeNow} error={error} />
          <div className="step-list">
            {displaySteps.map((step, index) => {
              const state = step.state;
              return (
                <div key={`${step.label}-${index}`} className={`step-item is-${state}`}>
                  <span className="step-marker">{stepIcon(state)}</span>
                  <div>
                    <strong>{step.label}</strong>
                    <small>{step.detail}</small>
                  </div>
                </div>
              );
            })}
          </div>
          <GenerationActivityLog result={result} />
          {result?.run.chapterRuns?.length ? (
            <div className="chapter-job-list" aria-label="챕터 생성 작업">
              <div className="chapter-job-list__header">
                <span>Chapter jobs</span>
                {failedChapterCount ? <strong>{failedChapterCount} failed</strong> : <strong>complete</strong>}
              </div>
              {result.run.chapterRuns.slice(0, 6).map((chapter) => (
                <div key={chapter.id} className={`chapter-job is-${chapter.status}`}>
                  <span className="state-dot" />
                  <span>{chapter.title}</span>
                  <small>{chapter.status} · {chapter.source}</small>
                </div>
              ))}
            </div>
          ) : null}
          <div className="action-cluster">
            <button className="primary-action" type="button" onClick={resumeGeneration} disabled={!canResumeGeneration}>
              {resuming ? <Loader2 className="spin" /> : <RefreshCcw />}
              <span>{resuming ? "이어 생성 요청 중" : "이어 생성"}</span>
            </button>
            <button className="secondary-action" type="button" onClick={retryFailedChapters} disabled={!canRetryFailedChapters}>
              {retrying ? <Loader2 className="spin" /> : <RefreshCcw />}
              <span>실패 챕터 재시도</span>
            </button>
          </div>
          <dl className="metric-list">
            <div>
              <dt>Context</dt>
              <dd>{result?.run.context ?? "64k"}</dd>
            </div>
            <div>
              <dt>Branch</dt>
              <dd>{result?.run.branch ?? "main"}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{result?.run.model ?? "LM Studio"}</dd>
            </div>
            <div>
              <dt>Output</dt>
              <dd>{result?.run.status === "complete" ? "book draft" : displayBook?.chapters?.length ? "partial draft" : "generating book"}</dd>
            </div>
          </dl>
        </aside>

        <section className="outline-panel" aria-labelledby="progress-outline-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Generated outline</p>
              <h2 id="progress-outline-title">책의 목차</h2>
            </div>
            <span className="outline-confidence">
              <span className="state-dot state-dot--ready" />
              {result?.run.status === "complete"
                ? "indexed coherent"
                : displayBook?.chapters?.length
                  ? statusLabel(displayBook)
                  : generationStatusLabel(result?.run.status ?? "queued")}
            </span>
          </div>
          <OutlinePreview book={displayBook} onReadBook={onReadBook} />
        </section>
      </div>
    </section>
  );
}

function GenerationRunSummary({
  result,
  running,
  now,
  error
}: {
  result: GenerationResult | null;
  running: boolean;
  now: number;
  error: string | null;
}) {
  const run = result?.run;
  const activeStep = run ? currentGenerationStep(run.steps) : null;
  const progressValue = clampPercent(run?.progress ?? (running ? 2 : 0));
  const elapsedMs = run ? elapsedMilliseconds(run.createdAt, now) : 0;
  const updatedMs = run ? elapsedMilliseconds(run.updatedAt, now) : 0;
  const waitingLong = Boolean(running && run && run.status === "running" && updatedMs >= 20_000);
  const tone = generationStatusTone(run?.status, running, waitingLong, Boolean(error));
  const title = generationStatusTitle(run?.status, running, waitingLong, Boolean(error));
  const detail = error ?? activeStep?.detail ?? (running ? "서버에 생성 실행을 요청하는 중입니다." : "저장소와 모델을 입력하면 생성 실행이 시작됩니다.");

  return (
    <div className={`run-status-card is-${tone}`} role="status" aria-live="polite" aria-label="생성 상태 요약">
      <div className="run-status-main">
        <span className="run-status-icon">{generationStatusIcon(tone, running)}</span>
        <div>
          <strong>{title}</strong>
          <small>{detail}</small>
        </div>
      </div>
      <div className="run-progress" aria-label={`생성 진행률 ${progressValue}%`}>
        <span>진행률 {progressValue}%</span>
        <div className="progress-track">
          <span style={{ width: `${progressValue}%` }} />
        </div>
      </div>
      <div className="run-status-meta" aria-label="생성 실행 시간 정보">
        <span>{run ? `경과 ${formatDuration(elapsedMs)}` : "경과 00:00"}</span>
        <span>{run ? `마지막 갱신 ${formatDuration(updatedMs)} 전` : "아직 서버 갱신 없음"}</span>
        <span>{run ? generationStatusLabel(run.status) : running ? "요청 중" : "대기"}</span>
      </div>
      {waitingLong ? (
        <p className="run-status-warning">
          현재 단계가 오래 실행 중입니다. 오류가 발생하면 실패 상태와 원인이 이 패널에 표시됩니다.
        </p>
      ) : null}
    </div>
  );
}

function GenerationActivityLog({ result }: { result: GenerationResult | null }) {
  const activities = generationActivityItems(result?.run.artifacts ?? []);

  if (!result) {
    return <p className="runtime-hint">생성이 시작되면 단계별 산출물과 최근 활동이 여기에 표시됩니다.</p>;
  }

  if (!activities.length) {
    return <p className="runtime-hint">현재 단계가 완료되면 저장소 분석, 목차 계획, 섹션 초안 같은 활동이 기록됩니다.</p>;
  }

  return (
    <div className="activity-log" aria-label="최근 생성 활동">
      <div className="activity-log__header">
        <span>최근 생성 활동</span>
        <strong>{result.run.artifacts.length} artifacts</strong>
      </div>
      <ol>
        {activities.map((activity) => (
          <li key={activity.id}>
            <span className="activity-kind">{activity.kind}</span>
            <span>{activity.title}</span>
            <small>{activity.meta}</small>
          </li>
        ))}
      </ol>
    </div>
  );
}
