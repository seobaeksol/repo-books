import type { ReactNode } from "react";

type TokenKind = "comment" | "function" | "keyword" | "literal" | "number" | "operator" | "property" | "string" | "type";

const jsKeywords = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "implements",
  "import",
  "interface",
  "let",
  "new",
  "private",
  "protected",
  "public",
  "readonly",
  "return",
  "static",
  "switch",
  "throw",
  "try",
  "type",
  "typeof",
  "var",
  "while"
]);

const literalKeywords = new Set(["false", "null", "true", "undefined"]);
const tsTypeKeywords = new Set(["Array", "Boolean", "Date", "Error", "Map", "Number", "Promise", "Record", "Set", "String", "URL"]);

export function HighlightedCodeBlock({ lines, filePath, lineHint }: { lines: string[]; filePath: string; lineHint?: string }) {
  const language = detectLanguage(filePath, lines);
  const startLine = parseStartLine(lineHint);
  const displayLines = lines.length ? lines : [""];

  return (
    <pre className={`highlighted-code language-${language}`} tabIndex={0} aria-label={`${filePath} code excerpt`}>
      <code className="code-lines">
        {displayLines.map((line, index) => (
          <span className={startLine ? "code-line has-line-number" : "code-line"} key={`${index}-${line}`}>
            {startLine ? (
              <span className="line-number" aria-hidden="true">
                {startLine + index}
              </span>
            ) : null}
            <span className="line-content">{highlightLine(line, language)}</span>
          </span>
        ))}
      </code>
    </pre>
  );
}

function detectLanguage(filePath: string, lines: string[]) {
  const path = filePath.toLowerCase();
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) return "javascript";
  if (/\.json$/.test(path)) return "json";
  if (/\.(css|scss|sass)$/.test(path)) return "css";
  if (/\.(html|xml|svg)$/.test(path)) return "markup";
  if (/\.(md|mdx)$/.test(path)) return "markdown";
  if (/\.(ya?ml)$/.test(path)) return "yaml";
  if (/\.(sh|bash|zsh)$/.test(path) || path.includes("dockerfile")) return "shell";
  if (/^\s*[{\[]/.test(lines.join("\n").trim())) return "json";
  return "plain";
}

function parseStartLine(lineHint?: string) {
  const match = lineHint?.match(/L(\d+)/i);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function highlightLine(line: string, language: string): ReactNode[] {
  if (!line) return [""];
  if (language === "plain") return [line];

  const pattern = tokenPattern(language);
  if (!pattern) return [line];

  const nodes: ReactNode[] = [];
  let cursor = 0;
  let tokenIndex = 0;
  pattern.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) {
    if (match.index > cursor) nodes.push(line.slice(cursor, match.index));
    const value = match[0];
    const after = line.slice(match.index + value.length);
    nodes.push(
      <span className={`syntax-token syntax-token--${classifyToken(value, language, after)}`} key={`${tokenIndex}-${value}`}>
        {value}
      </span>
    );
    cursor = match.index + value.length;
    tokenIndex += 1;
    if (pattern.lastIndex === match.index) pattern.lastIndex += 1;
  }

  if (cursor < line.length) nodes.push(line.slice(cursor));
  return nodes;
}

function tokenPattern(language: string) {
  if (language === "javascript") {
    return /\/\/.*$|\/\*.*?\*\/|(["'`])(?:\\.|(?!\1).)*\1|\b(?:as|async|await|break|case|catch|class|const|continue|default|else|export|extends|finally|for|from|function|if|implements|import|interface|let|new|private|protected|public|readonly|return|static|switch|throw|try|type|typeof|var|while|false|null|true|undefined)\b|\b(?:Array|Boolean|Date|Error|Map|Number|Promise|Record|Set|String|URL)\b|\b\d+(?:\.\d+)?\b|=>|[{}()[\].,;:?]|[A-Za-z_$][\w$]*(?=\s*\()/g;
  }
  if (language === "json") {
    return /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(?:false|null|true)\b|-?\b\d+(?:\.\d+)?\b|[{}[\],:]/g;
  }
  if (language === "css") {
    return /\/\*.*?\*\/|#[\da-fA-F]{3,8}\b|(["'])(?:\\.|(?!\1).)*\1|--?[A-Za-z][\w-]*(?=\s*:)|\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%|s|ms)?\b|[{}()[\].,;:]/g;
  }
  if (language === "markup") {
    return /<!--.*?-->|<\/?[A-Za-z][^>\s/]*|[A-Za-z_:][-A-Za-z0-9_:.]*(?==)|(["'])(?:\\.|(?!\1).)*\1|\/?>/g;
  }
  if (language === "markdown") {
    return /^#{1,6}\s.*$|`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)/g;
  }
  if (language === "yaml") {
    return /#.*$|(["'])(?:\\.|(?!\1).)*\1|^[\s-]*[A-Za-z0-9_.-]+(?=\s*:)|\b(?:false|null|true)\b|-?\b\d+(?:\.\d+)?\b|[:[\]{},|-]/g;
  }
  if (language === "shell") {
    return /#.*$|(["'])(?:\\.|(?!\1).)*\1|\b(?:cd|curl|echo|export|git|npm|pnpm|yarn|mkdir|rm|set|test)\b|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|&&|\|\||[|&;=]/g;
  }
  return null;
}

function classifyToken(value: string, language: string, after = ""): TokenKind {
  const trimmed = value.trim();
  if (value.startsWith("//") || value.startsWith("/*") || value.startsWith("<!--") || (value.startsWith("#") && language !== "css")) return "comment";
  if ((language === "json" || language === "yaml") && /^\s*:/.test(after) && /^["']?[\w.-]+["']?$/.test(trimmed)) return "property";
  if (language === "markdown" && value.startsWith("#")) return "keyword";
  if (/^["'`]/.test(value) || /^`/.test(value) || /^\*\*/.test(value) || /^\[/.test(value)) return "string";
  if (/^-?\d/.test(value) || /^#[\da-fA-F]{3,8}\b/.test(value)) return "number";
  if (literalKeywords.has(value)) return "literal";
  if (language === "javascript" && tsTypeKeywords.has(value)) return "type";
  if (language === "javascript" && jsKeywords.has(value)) return "keyword";
  if ((language === "json" || language === "yaml") && /"?[\w.-]+"?$/.test(trimmed)) return "property";
  if (language === "css" && /^--?[A-Za-z]/.test(value)) return "property";
  if (language === "markup" && /^<\/?[A-Za-z]/.test(value)) return "keyword";
  if (language === "markup" && /^[A-Za-z_:][-A-Za-z0-9_:.]*$/.test(value)) return "property";
  if (language === "shell" && /^(?:cd|curl|echo|export|git|npm|pnpm|yarn|mkdir|rm|set|test)$/.test(value)) return "keyword";
  if (/^[A-Za-z_$][\w$]*$/.test(value)) return "function";
  return "operator";
}
