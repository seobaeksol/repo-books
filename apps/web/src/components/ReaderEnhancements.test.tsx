import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FlowChart } from "./FlowChart";
import { HighlightedCodeBlock } from "./HighlightedCodeBlock";

describe("FlowChart", () => {
  it("renders Mermaid flowchart nodes, edges, labels, and accessible description", () => {
    const { container } = render(
      <FlowChart
        title="실행 흐름"
        summary="엔트리에서 리더로 이어진다."
        diagram={'flowchart LR\n  A["entry.ts"] -->|loads| B["ReaderRoute.tsx"]'}
      />
    );

    expect(screen.getByRole("img", { name: /실행 흐름/ })).toHaveAccessibleDescription(/entry\.ts to ReaderRoute\.tsx via loads/);
    expect(container.querySelectorAll(".flow-node")).toHaveLength(2);
    expect(container.querySelectorAll(".flow-edge-layer path")).toHaveLength(1);
    expect(screen.getAllByText("entry.ts").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ReaderRoute.tsx").length).toBeGreaterThan(0);
    expect(screen.getByText("loads")).toBeInTheDocument();
  });

  it("falls back to source text when the diagram is not a flowchart", () => {
    render(<FlowChart title="시퀀스" diagram={"sequenceDiagram\n  A->>B: hello"} />);

    expect(screen.getByText(/sequenceDiagram/)).toHaveClass("flow-diagram");
  });
});

describe("HighlightedCodeBlock", () => {
  it("highlights TypeScript and derives the starting line from a line range", () => {
    const { container } = render(<HighlightedCodeBlock filePath="src/app.ts" lineHint="L12-L14" lines={["const enabled = true;", "createApp();"]} />);

    expect(container.querySelector(".language-javascript")).toBeInTheDocument();
    expect(container.querySelector(".line-number")?.textContent).toBe("12");
    expect(container.querySelector(".syntax-token--keyword")?.textContent).toBe("const");
    expect(container.querySelector(".syntax-token--literal")?.textContent).toBe("true");
    expect(container.querySelector(".syntax-token--function")?.textContent).toBe("createApp");
  });

  it("highlights CSS properties and color literals", () => {
    const { container } = render(<HighlightedCodeBlock filePath="src/styles.css" lines={["--reader-accent: #76f0f7;"]} />);

    expect(container.querySelector(".language-css")).toBeInTheDocument();
    expect(container.querySelector(".syntax-token--property")?.textContent).toBe("--reader-accent");
    expect(container.querySelector(".syntax-token--number")?.textContent).toBe("#76f0f7");
  });

  it("renders empty excerpts without fake line numbers", () => {
    const { container } = render(<HighlightedCodeBlock filePath="README.md" lines={[]} />);

    expect(container.querySelector(".code-line")).toBeInTheDocument();
    expect(container.querySelector(".line-number")).not.toBeInTheDocument();
  });
});
