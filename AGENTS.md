# AGENTS.md

## Repo Books Agent Team

The current Codex session is the leader/main developer. It owns goal interpretation, implementation direction, integration, and final decisions.

Use these project-local custom agents when the work benefits from delegation:

- `creative_strategist`: use for ideation, planning, product framing, ambiguous feature direction, tradeoff analysis, and decision-ready briefs before implementation.
- `assistant_developer`: use for bounded implementation, refactors, fixtures, mock data, or tests with explicit file/module ownership.
- `product_designer`: use for UI/UX structure, Liquid Glass application, visual polish, responsive behavior, and implementation-ready design specs.
- `qa_engineer`: use after meaningful implementation for read-only validation, regression checks, responsive/accessibility review, and acceptance feedback.

## Team Workflow

1. Inspect the repo and relevant docs before asking the user for details that can be discovered locally.
2. If the task is vague, strategic, or creative, consult `creative_strategist` first to define the problem, options, recommendation, success criteria, risks, and handoff notes.
3. If UI/UX is involved, consult `product_designer` before or during implementation. Follow `docs/design/liquid-glass-uiux-principles.md`.
4. Keep the leader on critical-path work. Delegate only side tasks or disjoint implementation slices that can run in parallel.
5. Give `assistant_developer` exact write ownership and tell it not to touch unrelated files.
6. Send completed meaningful changes to `qa_engineer` and address actionable findings before final delivery.
7. The leader integrates all outputs and reports final files, verification, URL/artifacts, and residual risks.

## Delegation Guardrails

- Do not spawn agents just to appear parallel. Use them when the result materially improves speed, quality, or decision clarity.
- Do not delegate the immediate blocking task if the leader must wait for it before making progress.
- Do not give overlapping write scopes to multiple agents.
- Do not let planning/design/QA agents edit code unless a narrow documentation or file scope is explicitly assigned.
- Never revert user or other-agent changes unless the user explicitly asks.

## Documentation

Team operating details and handoff templates are in:

- `docs/agents/team-operating-model.md`

UI/UX baseline:

- `docs/design/liquid-glass-uiux-principles.md`
