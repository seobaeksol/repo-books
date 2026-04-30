import { useId } from "react";

type FlowNode = {
  id: string;
  label: string;
};

type FlowEdge = {
  from: string;
  to: string;
  label?: string;
};

type ParsedFlowChart = {
  direction: "TD" | "BT" | "LR" | "RL";
  nodes: FlowNode[];
  edges: FlowEdge[];
};

const nodePattern = /([A-Za-z0-9_-]+)\s*(?:\[\s*(".*?"|'.*?'|[^\]]+)\s*\]|\(\s*(".*?"|'.*?'|[^)]+)\s*\)|\{\s*(".*?"|'.*?'|[^}]+)\s*\})/g;
const nodeStripPattern = /([A-Za-z0-9_-]+)\s*(?:\[\s*(".*?"|'.*?'|[^\]]+)\s*\]|\(\s*(".*?"|'.*?'|[^)]+)\s*\)|\{\s*(".*?"|'.*?'|[^}]+)\s*\})/g;
const edgePattern = /([A-Za-z0-9_-]+)\s*(?:-->|---|-.->|==>)\s*(?:\|([^|]+)\|\s*)?([A-Za-z0-9_-]+)/g;

export function FlowChart({ diagram, title, summary }: { diagram: string; title: string; summary?: string }) {
  const parsed = parseFlowChart(diagram);
  const idBase = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const markerId = `flow-arrow-${idBase}`;
  const descriptionId = `flow-description-${idBase}`;
  const ariaLabel = `Flowchart: ${[title, summary].filter(Boolean).join(". ")}`;

  if (!parsed || parsed.nodes.length === 0) {
    return <pre className="flow-diagram" tabIndex={0}>{diagram}</pre>;
  }

  const horizontal = parsed.direction === "LR" || parsed.direction === "RL";
  const nodeWidth = horizontal ? 220 : 280;
  const nodeHeight = 62;
  const gap = horizontal ? 82 : 54;
  const padding = 34;
  const width = horizontal ? padding * 2 + parsed.nodes.length * nodeWidth + Math.max(0, parsed.nodes.length - 1) * gap : 420;
  const height = horizontal ? 160 : padding * 2 + parsed.nodes.length * nodeHeight + Math.max(0, parsed.nodes.length - 1) * gap;
  const positions = new Map(
    parsed.nodes.map((node, index) => {
      const orderedIndex = parsed.direction === "RL" || parsed.direction === "BT" ? parsed.nodes.length - 1 - index : index;
      return [
        node.id,
        {
          x: horizontal ? padding + orderedIndex * (nodeWidth + gap) : (width - nodeWidth) / 2,
          y: horizontal ? (height - nodeHeight) / 2 : padding + orderedIndex * (nodeHeight + gap)
        }
      ];
    })
  );
  const edges = parsed.edges.filter((edge) => positions.has(edge.from) && positions.has(edge.to));
  const description = describeFlowChart(parsed.nodes, edges);

  return (
    <div className="flow-chart-shell" role="img" aria-label={ariaLabel} aria-describedby={descriptionId} tabIndex={0}>
      <span className="sr-only" id={descriptionId}>{description}</span>
      <svg
        className={`flow-chart ${horizontal ? "flow-chart--horizontal" : "flow-chart--vertical"}`}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <marker id={markerId} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        <g className="flow-edge-layer">
          {edges.map((edge, index) => {
            const from = positions.get(edge.from)!;
            const to = positions.get(edge.to)!;
            const path = horizontal
              ? horizontalPath(from.x, from.y, to.x, to.y, nodeWidth, nodeHeight)
              : verticalPath(from.x, from.y, to.x, to.y, nodeWidth, nodeHeight);
            const midpoint = horizontal
              ? { x: (from.x + to.x + nodeWidth) / 2, y: from.y + nodeHeight / 2 - 11 }
              : { x: from.x + nodeWidth / 2 + 24, y: (from.y + to.y + nodeHeight) / 2 };
            return (
              <g key={`${edge.from}-${edge.to}-${index}`}>
                <path d={path} markerEnd={`url(#${markerId})`} />
                {edge.label ? (
                  <text className="flow-edge-label" x={midpoint.x} y={midpoint.y} textAnchor="middle">
                    {edge.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
        <g className="flow-node-layer">
          {parsed.nodes.map((node, index) => {
            const position = positions.get(node.id)!;
            const lines = wrapLabel(node.label, horizontal ? 24 : 32);
            return (
              <g className="flow-node" transform={`translate(${position.x} ${position.y})`} key={`${node.id}-${index}`}>
                <rect width={nodeWidth} height={nodeHeight} rx="8" />
                <text x={nodeWidth / 2} y={nodeHeight / 2 - (lines.length - 1) * 8} textAnchor="middle">
                  <title>{node.label}</title>
                  {lines.map((line, lineIndex) => (
                    <tspan x={nodeWidth / 2} dy={lineIndex === 0 ? 0 : 17} key={line}>
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

function parseFlowChart(diagram: string): ParsedFlowChart | null {
  const lines = diagram
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/;$/, ""))
    .filter(Boolean);
  if (!lines.length) return null;

  const header = lines[0].match(/^(?:flowchart|graph)\s+(TD|BT|LR|RL)\b/i);
  if (!header) return null;

  const direction = header[1].toUpperCase() as ParsedFlowChart["direction"];
  const nodeMap = new Map<string, string>();
  const edges: FlowEdge[] = [];

  for (const line of lines.slice(1)) {
    nodePattern.lastIndex = 0;
    let nodeMatch: RegExpExecArray | null;
    while ((nodeMatch = nodePattern.exec(line))) {
      const id = nodeMatch[1];
      const label = cleanMermaidLabel(nodeMatch[2] ?? nodeMatch[3] ?? nodeMatch[4] ?? id);
      if (!nodeMap.has(id)) nodeMap.set(id, label);
    }

    const normalized = line.replace(nodeStripPattern, "$1");
    edgePattern.lastIndex = 0;
    let edgeMatch: RegExpExecArray | null;
    while ((edgeMatch = edgePattern.exec(normalized))) {
      const from = edgeMatch[1];
      const to = edgeMatch[3];
      if (!nodeMap.has(from)) nodeMap.set(from, from);
      if (!nodeMap.has(to)) nodeMap.set(to, to);
      edges.push({ from, to, label: edgeMatch[2]?.trim() });
    }
  }

  const nodes = Array.from(nodeMap.entries()).map(([id, label]) => ({ id, label }));
  if (nodes.length > 1 && edges.length === 0) {
    for (let index = 0; index < nodes.length - 1; index += 1) {
      edges.push({ from: nodes[index].id, to: nodes[index + 1].id });
    }
  }

  return { direction, nodes, edges };
}

function cleanMermaidLabel(value: string) {
  return value.trim().replace(/^["']|["']$/g, "");
}

function verticalPath(fromX: number, fromY: number, toX: number, toY: number, nodeWidth: number, nodeHeight: number) {
  const startX = fromX + nodeWidth / 2;
  const startY = fromY + nodeHeight;
  const endX = toX + nodeWidth / 2;
  const endY = toY;
  const midY = (startY + endY) / 2;
  return `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
}

function horizontalPath(fromX: number, fromY: number, toX: number, toY: number, nodeWidth: number, nodeHeight: number) {
  const forward = toX > fromX;
  const startX = forward ? fromX + nodeWidth : fromX;
  const endX = forward ? toX : toX + nodeWidth;
  const y = fromY + nodeHeight / 2;
  const endY = toY + nodeHeight / 2;
  const midX = (startX + endX) / 2;
  return `M ${startX} ${y} C ${midX} ${y}, ${midX} ${endY}, ${endX} ${endY}`;
}

function wrapLabel(label: string, maxLength: number) {
  const compactLabel = label.replace(/\s+/g, " ").trim();
  if (compactLabel.length <= maxLength) return [compactLabel];

  const parts = compactLabel
    .split(/(?<=\/)|\s+/)
    .filter(Boolean)
    .flatMap((part) => chunkLongLabelPart(part, maxLength));
  const lines: string[] = [];
  let current = "";

  for (const part of parts) {
    const next = current ? `${current}${part.includes("/") ? "" : " "}${part}` : part;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = part;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines.slice(0, 2).map((line, index, all) => (index === all.length - 1 && lines.length > 2 ? `${line.replace(/\.*$/, "")}...` : line));
}

function chunkLongLabelPart(part: string, maxLength: number) {
  if (part.length <= maxLength) return [part];
  const chunks: string[] = [];
  for (let index = 0; index < part.length; index += maxLength) {
    chunks.push(part.slice(index, index + maxLength));
  }
  return chunks;
}

function describeFlowChart(nodes: FlowNode[], edges: FlowEdge[]) {
  const nodeLabels = new Map(nodes.map((node) => [node.id, node.label]));
  const nodeText = nodes.map((node) => node.label).join(", ");
  const edgeText = edges.length
    ? edges
        .map((edge) => {
          const from = nodeLabels.get(edge.from) ?? edge.from;
          const to = nodeLabels.get(edge.to) ?? edge.to;
          return edge.label ? `${from} to ${to} via ${edge.label}` : `${from} to ${to}`;
        })
        .join("; ")
    : "No explicit edges";
  return `Nodes: ${nodeText}. Edges: ${edgeText}.`;
}
